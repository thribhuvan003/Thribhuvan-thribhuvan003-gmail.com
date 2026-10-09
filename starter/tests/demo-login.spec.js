import { expect, test } from '@playwright/test';

test('the public owner credentials fill a working login and allow invitations', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('demo-login')).toBeVisible();
  await expect(page.getByTestId('demo-email')).toHaveText('dana@example.test');
  await expect(page.getByTestId('demo-password')).toHaveText('demo1234');
  await page.screenshot({ path: 'data/demo-owner-login-local.png', fullPage: true });
  await page.getByTestId('use-demo-login').click();
  await expect(page.getByTestId('login-email')).toHaveValue('dana@example.test');
  await expect(page.getByTestId('login-password')).toHaveValue('demo1234');
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('active-role')).toHaveText('owner');
  await page.getByTestId('nav-people').click();
  await page.getByTestId('invite-user').click();
  await expect(page.getByTestId('invite-recipient')).toBeVisible();
});
