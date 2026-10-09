import { expect, test } from '@playwright/test';

test('unread badges count incoming messages once while closed or minimized and clear on opening', async ({ browser }) => {
  const writerContext = await browser.newContext();
  const readerContext = await browser.newContext();
  await readerContext.addInitScript(() => {
    const Original = window.WebSocket;
    window.WebSocket = class extends Original {
      constructor(...args) { super(...args); window.__testChatSocket = this; }
    };
  });
  const writer = await writerContext.newPage();
  const reader = await readerContext.newPage();
  await reader.routeWebSocket('**/v1/chat/socket', (socket) => {
    const server = socket.connectToServer();
    server.onMessage((raw) => {
      socket.send(raw);
      // A duplicate broadcast must not increase the badge twice.
      if (JSON.parse(raw).type === 'message') socket.send(raw);
    });
  });
  const login = async (page, email) => {
    await page.goto('/');
    await page.getByTestId('login-email').fill(email);
    await page.getByTestId('login-password').fill('demo1234');
    await page.getByTestId('login-submit').click();
    await expect(page.getByTestId('app-shell')).toBeVisible();
    await expect(page.getByTestId('chat-status')).toContainText('online');
  };
  const send = async (body) => {
    await writer.getByTestId('chat-input').fill(body);
    await writer.getByTestId('chat-send').click();
    await expect(writer.getByTestId('chat-history')).toContainText(body);
  };
  try {
    await Promise.all([login(writer, 'sam@example.test'), login(reader, 'dana@example.test')]);
    await expect(reader.getByTestId('chat-unread')).toHaveCount(0);
    await writer.getByTestId('nav-chat').click();
    const first = `Unread message ${Date.now()}`;
    await send(first);
    await expect(reader.getByTestId('chat-unread')).toHaveText('1');
    await send(`${first} second`);
    await expect(reader.getByTestId('chat-unread')).toHaveText('2');
    await expect(reader.getByTestId('chat-unread-toggle')).toHaveText('2');
    await reader.evaluate(() => window.__testChatSocket.send(JSON.stringify({
      type: 'message', body: 'My own background message', clientId: crypto.randomUUID(),
    })));
    await expect(writer.getByTestId('chat-history')).toContainText('My own background message');
    await expect(reader.getByTestId('chat-unread')).toHaveText('2');
    await reader.getByTestId('nav-chat').click();
    await expect(reader.getByTestId('chat-unread')).toHaveCount(0);
    await expect(reader.getByTestId('chat-history')).toContainText(first);
    await reader.getByTestId('toggle-chat').click();
    await reader.getByRole('button', { name: 'Minimize team chat', exact: true }).click();
    await send(`${first} minimized`);
    await expect(reader.getByTestId('chat-unread')).toHaveText('1');
    await reader.screenshot({ path: 'data/unread-chat-local.png', fullPage: true });
    await reader.getByRole('button', { name: 'Restore team chat', exact: true }).click();
    await expect(reader.getByTestId('chat-unread')).toHaveCount(0);
    await send(`${first} visible`);
    await expect(reader.getByTestId('chat-unread')).toHaveCount(0);
    await reader.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await send(`${first} background tab`);
    await expect(reader.getByTestId('chat-unread')).toHaveText('1');
    await reader.evaluate(() => {
      delete document.visibilityState;
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect(reader.getByTestId('chat-unread')).toHaveCount(0);
    await reader.getByRole('button', { name: 'Close team chat', exact: true }).click();
    await readerContext.setOffline(true);
    await reader.evaluate(() => window.__testChatSocket.close());
    await expect(reader.getByTestId('chat-status')).toContainText('Connecting');
    await send(`${first} missed offline`);
    await readerContext.setOffline(false);
    await expect(reader.getByTestId('chat-status')).toContainText('online');
    await expect(reader.getByTestId('chat-unread')).toHaveText('1');
    await reader.getByTestId('nav-chat').click();
    await expect(reader.getByTestId('chat-unread')).toHaveCount(0);
    await expect(reader.getByTestId('chat-history')).toContainText(`${first} missed offline`);
  } finally { await Promise.all([writerContext.close(), readerContext.close()]); }
});
