import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';

async function openChat(page, email = 'dana@example.test') {
  await page.goto('/');
  await page.getByTestId('login-email').fill(email);
  await page.getByTestId('login-password').fill('demo1234');
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('app-shell')).toBeVisible();
  if (await page.getByTestId('app-shell').getAttribute('data-org-id') !== 'org_acme') {
    await page.getByTestId('org-option').filter({ hasText: 'Acme Robotics' }).click();
  }
  await expect(page.getByTestId('app-shell')).toHaveAttribute('data-org-id', 'org_acme');
  await page.getByTestId('nav-chat').click();
  await expect(page.getByTestId('chat-status')).toContainText('online');
}

async function dragChat(page, dx, dy) {
  const handle = await page.getByRole('button', { name: 'Move team chat window' }).boundingBox();
  expect(handle).not.toBeNull();
  const x = handle.x + Math.min(90, handle.width / 2);
  const y = handle.y + handle.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 8 });
  await page.mouse.up();
}

async function expectInViewport(page, window) {
  await expect.poll(async () => {
    const box = await window.boundingBox();
    const viewport = page.viewportSize();
    return Boolean(box && box.x >= 11 && box.y >= 11 &&
      box.x + box.width <= viewport.width - 11 && box.y + box.height <= viewport.height - 11);
  }).toBe(true);
}

test('floating chat keeps its draft through dragging, minimizing and expanding', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openChat(page);
  const draft = 'Check the scene lighting before our next playtest.';
  await page.getByTestId('chat-input').fill(draft);
  await page.getByRole('button', { name: 'Float team chat' }).click();
  const window = page.getByTestId('chat-window');
  await expect(window).toHaveClass(/\bfloating-window\b/);
  const before = await window.boundingBox();
  const dx = before.x > 450 ? -180 : 140;
  const dy = before.y > 180 ? -100 : 90;
  await dragChat(page, dx, dy);
  await expect.poll(async () => (await window.boundingBox()).x).toBeCloseTo(before.x + dx, 0);
  await expect.poll(async () => (await window.boundingBox()).y).toBeCloseTo(before.y + dy, 0);
  await expect(page.getByTestId('chat-input')).toHaveValue(draft);
  await expectInViewport(page, window);

  await page.getByRole('button', { name: 'Minimize team chat', exact: true }).click();
  await expect(page.getByTestId('chat-input')).toBeHidden();
  await expect.poll(async () => (await window.boundingBox()).height).toBeLessThan(70);
  await page.getByRole('button', { name: 'Restore team chat', exact: true }).click();
  await expect(page.getByTestId('chat-input')).toBeVisible();
  await expect(page.getByTestId('chat-input')).toHaveValue(draft);
  await page.getByRole('button', { name: 'Expand team chat', exact: true }).click();
  await expect(window).not.toHaveClass(/\bfloating-window\b/);
  await expect(page.getByTestId('chat-input')).toHaveValue(draft);

  await page.getByRole('button', { name: 'Float team chat' }).click();
  await expect(window).toHaveClass(/\bfloating-window\b/);
  await expect(page.getByTestId('chat-input')).toHaveValue(draft);
  mkdirSync('data', { recursive: true });
  await page.screenshot({ path: 'data/floating-chat-local.png', fullPage: true });
  await page.getByRole('button', { name: 'Close team chat', exact: true }).click();
  await expect(window).toHaveCount(0);
});

test('keyboard movement and resizing keep the floating chat reachable on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openChat(page);
  await page.getByRole('button', { name: 'Float team chat' }).click();
  const window = page.getByTestId('chat-window');
  const handle = page.getByRole('button', { name: 'Move team chat window' });
  const home = await window.boundingBox();
  await handle.focus();
  await handle.press('Shift+ArrowLeft');
  await handle.press('ArrowUp');
  await expect.poll(async () => (await window.boundingBox()).x).toBeCloseTo(home.x - 40, 0);
  await expect.poll(async () => (await window.boundingBox()).y).toBeCloseTo(home.y - 12, 0);
  await handle.press('Home');
  await expect.poll(async () => (await window.boundingBox()).x).toBeCloseTo(home.x, 0);
  await expect.poll(async () => (await window.boundingBox()).y).toBeCloseTo(home.y, 0);

  await page.setViewportSize({ width: 390, height: 844 });
  await expectInViewport(page, window);
  await handle.focus();
  for (let i = 0; i < 12; i++) {
    await handle.press('Shift+ArrowLeft');
    await handle.press('Shift+ArrowUp');
  }
  await expect.poll(async () => (await window.boundingBox()).x).toBeCloseTo(12, 0);
  await expect.poll(async () => (await window.boundingBox()).y).toBeCloseTo(12, 0);
  for (let i = 0; i < 24; i++) {
    await handle.press('Shift+ArrowRight');
    await handle.press('Shift+ArrowDown');
  }
  await expectInViewport(page, window);
  await expect(page.getByRole('button', { name: 'Minimize team chat', exact: true })).toBeVisible();
  await handle.press('Home');
  await expectInViewport(page, window);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  mkdirSync('data', { recursive: true });
  await page.screenshot({ path: 'data/floating-chat-mobile.png', fullPage: true });
});

test('a minimized teammate chat receives messages without replacing its connection', async ({ browser }) => {
  const options = { baseURL: 'http://localhost:8124', viewport: { width: 1440, height: 1000 } };
  const writerContext = await browser.newContext(options);
  const readerContext = await browser.newContext(options);
  await readerContext.addInitScript(() => {
    const NativeSocket = window.WebSocket;
    window.__floatingChatSockets = [];
    window.WebSocket = class extends NativeSocket {
      constructor(...args) {
        super(...args);
        window.__floatingChatSockets.push(this);
      }
    };
  });
  try {
    const writer = await writerContext.newPage();
    const reader = await readerContext.newPage();
    await Promise.all([openChat(writer), openChat(reader, 'sam@example.test')]);
    await expect(reader.getByTestId('chat-status')).toContainText('2 online');
    await reader.getByTestId('chat-input').fill('I am still reviewing the first scene.');
    await reader.getByRole('button', { name: 'Float team chat' }).click();
    await reader.getByRole('button', { name: 'Minimize team chat', exact: true }).click();
    const body = `Update while chat is minimized ${Date.now()}`;
    await writer.getByTestId('chat-input').fill(body);
    await writer.getByTestId('chat-send').click();
    await expect(reader.getByTestId('chat-message').filter({ hasText: body })).toHaveCount(1);
    await expect(reader.getByTestId('chat-input')).toBeHidden();
    expect(await reader.evaluate(() => window.__floatingChatSockets.length)).toBe(1);
    expect(await reader.evaluate(() => window.__floatingChatSockets[0].readyState)).toBe(1);
    await reader.getByRole('button', { name: 'Restore team chat', exact: true }).click();
    await expect(reader.getByTestId('chat-message').filter({ hasText: body })).toBeVisible();
    await expect(reader.getByTestId('chat-input')).toHaveValue('I am still reviewing the first scene.');
    await expect(reader.getByTestId('chat-status')).toContainText('2 online');
  } finally {
    await Promise.all([writerContext.close(), readerContext.close()]);
  }
});
