import { expect, test } from '@playwright/test';

test('plain-language access choices create the required session permissions and explain removal', async ({ page, request }) => {
  const login = async (email, orgId) => (await request.post('/v1/auth/login', {
    data: { email, password: 'demo1234', ...(orgId ? { orgId } : {}) },
  })).json();
  const original = await login('dana@example.test');
  const created = await request.post('/v1/orgs', {
    headers: { authorization: `Bearer ${original.token}` }, data: { name: 'Studio Access Rules' },
  });
  expect(created.ok()).toBe(true);
  const company = await created.json();
  const owner = await login('dana@example.test', company.id);
  const headers = { authorization: `Bearer ${owner.token}` };
  const invite = await (await request.post(`/v1/orgs/${company.id}/invites`, {
    headers, data: { email: 'sam@example.test', role: 'viewer' },
  })).json();
  expect((await request.post(`/v1/invites/${invite.inviteToken}/accept`, {
    data: { password: 'demo1234' },
  })).ok()).toBe(true);
  const device = await (await request.post(`/v1/orgs/${company.id}/devices`, {
    headers, data: { name: 'Shared gaming PC', kind: 'windows', online: true },
  })).json();
  await page.goto('/');
  await page.getByTestId('login-email').fill('dana@example.test');
  await page.getByTestId('login-password').fill('demo1234');
  await page.getByTestId('login-submit').click();
  await page.getByTestId('org-option').filter({ hasText: 'Studio Access Rules' }).click();
  await page.getByTestId('nav-grants').click();
  await expect(page.getByRole('heading', { name: 'Access rules', exact: true }).first()).toBeVisible();
  await expect(page.locator('.access-explainer')).toContainText('Removing a rule does not remove access that still comes from a role');
  await page.getByTestId('new-grant').click();
  const member = await login('sam@example.test', company.id);
  await page.getByTestId('grant-user').selectOption(member.user.id);
  await page.getByTestId('grant-device').selectOption(device.id);
  await page.getByRole('button', { name: /Use a device/ }).click();
  await expect(page.getByTestId('grant-preview')).toContainText('Allow 4 actions');
  await expect(page.getByTestId('grant-preview')).toContainText('Sam Rivera');
  await expect(page.getByTestId('grant-preview')).toContainText('Shared gaming PC');
  await expect(page.getByTestId('grant-preview')).toContainText('Use keyboard and mouse');
  await page.screenshot({ path: 'test-results/access-rules-explained.png', fullPage: true });
  await page.getByTestId('grant-submit').click();
  await expect(page.getByTestId('grant-row')).toHaveCount(1);
  const fresh = await login('sam@example.test', company.id);
  const session = await request.post(`/v1/orgs/${company.id}/sessions`, {
    headers: { authorization: `Bearer ${fresh.token}` }, data: { deviceId: device.id, mode: 'control' },
  });
  expect(session.status()).toBe(201);
  await page.getByTestId('revoke-grant').click();
  await expect(page.getByTestId('grant-row')).toContainText('Removed');
  const after = await login('sam@example.test', company.id);
  const effective = await (await request.get(`/v1/orgs/${company.id}/users/${after.user.id}/effective`, {
    headers: { authorization: `Bearer ${after.token}` },
  })).json();
  expect(effective.permissions['device:control'].effect).toBe('deny');
  expect(effective.permissions['device:view'].effect).toBe('allow');
});
