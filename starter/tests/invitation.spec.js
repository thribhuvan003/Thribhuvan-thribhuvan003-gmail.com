import { expect, test } from '@playwright/test';

test('a full invitation link can be copied, accepted once, and used to join team chat', async ({ page, request, browser, baseURL }) => {
  const login = await request.post('/v1/auth/login', {
    data: { email: 'dana@example.test', password: 'demo1234' },
  });
  const owner = await login.json();
  const orgResponse = await request.post('/v1/orgs', {
    headers: { authorization: `Bearer ${owner.token}` }, data: { name: 'Z Invite Links Studio' },
  });
  expect(orgResponse.ok()).toBe(true);
  const org = await orgResponse.json();
  await page.goto('/');
  await page.getByTestId('login-email').fill('dana@example.test');
  await page.getByTestId('login-password').fill('demo1234');
  await page.getByTestId('login-submit').click();
  await page.getByTestId('org-option').filter({ hasText: 'Z Invite Links Studio' }).click();
  await page.getByTestId('nav-people').click();
  await page.getByTestId('invite-user').click();
  await page.getByTestId('invite-recipient').fill('link-invitee@example.test');
  await page.getByTestId('invite-starting-role').selectOption('viewer');
  await page.getByTestId('create-invite-link').click();
  await expect(page.getByTestId('invite-link-result')).toContainText('link-invitee@example.test');
  const link = await page.getByTestId('invite-share-link').getAttribute('href');
  expect(link).toMatch(/^http:\/\/localhost:8124\/invite\//);
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.getByTestId('copy-invite-link').click();
  await expect(page.getByTestId('invite-link-result')).toContainText('Link copied.');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(link);
  await page.screenshot({ path: 'test-results/invite-link-ready.png', fullPage: true });

  const guestContext = await browser.newContext({ baseURL });
  try {
    const guest = await guestContext.newPage();
    await guest.goto(link);
    await expect(guest.getByTestId('invite-email')).toHaveValue('link-invitee@example.test');
    await guest.getByTestId('invite-name').fill('Invited Teammate');
    await guest.getByTestId('invite-password').fill('test-password123');
    await guest.getByTestId('invite-submit').click();
    await guest.getByTestId('login-email').fill('link-invitee@example.test');
    await guest.getByTestId('login-password').fill('test-password123');
    await guest.getByTestId('login-submit').click();
    await expect(guest.getByTestId('app-shell')).toHaveAttribute('data-org-id', org.id);
    await guest.getByTestId('nav-chat').click();
    await expect(guest.getByTestId('chat-status')).toContainText('online');
    await guest.getByTestId('chat-input').fill('I joined through my personal invitation.');
    await guest.getByTestId('chat-send').click();
    await expect(guest.getByTestId('chat-history')).toContainText('I joined through my personal invitation.');
    const token = new URL(link).pathname.slice('/invite/'.length);
    expect((await request.post(`/v1/invites/${token}/accept`, {
      data: { name: 'Reuse', password: 'test-password123' },
    })).status()).toBe(409);
    await guest.screenshot({ path: 'test-results/invited-member-joined.png', fullPage: true });
  } finally { await guestContext.close(); }
});
