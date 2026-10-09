import { expect, test } from '@playwright/test';

async function login(page, email, orgName) {
  await page.goto('/');
  await page.getByTestId('login-email').fill(email);
  await page.getByTestId('login-password').fill('demo1234');
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('app-shell')).toBeVisible();
  if (orgName) await page.getByTestId('org-option').filter({ hasText: orgName }).click();
  await page.getByTestId('nav-chat').click();
  await expect(page.getByTestId('chat-status')).toContainText('online');
}

test('two teammates reconnect to a live video call and keep chat history after sign-out', async ({ browser, request }) => {
  const apiLogin = async (email, orgId) => (await request.post('/v1/auth/login', {
    data: { email, password: 'demo1234', ...(orgId ? { orgId } : {}) },
  })).json();
  const original = await apiLogin('dana@example.test');
  const created = await (await request.post('/v1/orgs', {
    headers: { authorization: `Bearer ${original.token}` }, data: { name: 'Live Call Studio' },
  })).json();
  const ownerToken = (await apiLogin('dana@example.test', created.id)).token;
  const invite = await (await request.post(`/v1/orgs/${created.id}/invites`, {
    headers: { authorization: `Bearer ${ownerToken}` },
    data: { email: 'sam@example.test', role: 'operator' },
  })).json();
  expect((await request.post(`/v1/invites/${invite.inviteToken}/accept`, {
    data: { password: 'demo1234' },
  })).ok()).toBe(true);
  const options = { baseURL: 'http://localhost:8124', permissions: ['camera', 'microphone'] };
  const ownerContext = await browser.newContext(options);
  const teammateContext = await browser.newContext(options);
  const owner = await ownerContext.newPage();
  const teammate = await teammateContext.newPage();
  await Promise.all([
    login(owner, 'dana@example.test', 'Live Call Studio'),
    login(teammate, 'sam@example.test', 'Live Call Studio'),
  ]);

  await owner.getByTestId('call-toggle').click();
  await expect(owner.getByTestId('video-call')).toBeVisible();
  await expect(teammate.getByTestId('call-toggle')).toContainText('Join video · 1');
  await teammate.getByTestId('call-toggle').click();
  await expect(owner.getByTestId('call-participant')).toHaveCount(1);
  await expect(teammate.getByTestId('call-participant')).toHaveCount(1);
  await expect(owner.getByTestId('remote-video')).toHaveCount(1);
  await expect(teammate.getByTestId('remote-video')).toHaveCount(1);
  await expect.poll(() => owner.getByTestId('remote-video').evaluate((video) => video.readyState)).toBeGreaterThanOrEqual(2);
  await expect.poll(() => teammate.getByTestId('remote-video').evaluate((video) => video.readyState)).toBeGreaterThanOrEqual(2);
  const remembered = 'Call notes stay here after I sign out.';
  await teammate.getByTestId('chat-input').fill(remembered);
  await teammate.getByTestId('chat-send').click();
  await expect(owner.getByTestId('chat-history')).toContainText(remembered);
  await owner.screenshot({ path: 'test-results/video-call-two-members.png', fullPage: true });
  await teammate.getByRole('button', { name: 'Sign out' }).click();
  await expect(teammate.getByTestId('login-form')).toBeVisible();
  await expect(owner.getByTestId('call-participant')).toHaveCount(0);

  await login(teammate, 'sam@example.test', 'Live Call Studio');
  await expect(teammate.getByTestId('chat-history')).toContainText(remembered);
  await expect(teammate.getByTestId('call-toggle')).toContainText('Join video · 1');
  await teammate.getByTestId('call-toggle').click();
  await expect(owner.getByTestId('remote-video')).toHaveCount(1);
  await teammate.getByTestId('call-mute').click();
  await expect(teammate.getByTestId('call-mute')).toHaveAttribute('aria-pressed', 'true');
  await teammate.getByTestId('call-camera').click();
  await expect(teammate.getByTestId('call-camera')).toHaveAttribute('aria-pressed', 'true');
  await teammate.getByTestId('call-leave').click();
  await expect(owner.getByTestId('call-participant')).toHaveCount(0);
  await owner.getByTestId('call-leave').click();

  await Promise.all([ownerContext.close(), teammateContext.close()]);
});
