import { expect, test } from '@playwright/test';

async function login(page, email, password = 'demo1234') {
  await page.goto('/');
  await page.getByTestId('login-email').fill(email);
  await page.getByTestId('login-password').fill(password);
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('app-shell')).toBeVisible();
}

test('organization members exchange live messages without cross-org history', async ({ browser }) => {
  const danaContext = await browser.newContext();
  const samContext = await browser.newContext();
  const dana = await danaContext.newPage();
  const sam = await samContext.newPage();

  await Promise.all([
    login(dana, 'dana@example.test'),
    login(sam, 'sam@example.test'),
  ]);
  await Promise.all([
    dana.getByTestId('nav-chat').click(),
    sam.getByTestId('nav-chat').click(),
  ]);
  await Promise.all([
    expect(dana.getByTestId('chat-status')).toContainText('online'),
    expect(sam.getByTestId('chat-status')).toContainText('online'),
  ]);

  const body = `live message ${Date.now()}`;
  await dana.getByTestId('chat-input').fill(body);
  await dana.getByTestId('chat-send').click();
  await Promise.all([
    expect(dana.getByTestId('chat-message').filter({ hasText: body })).toHaveCount(1),
    expect(sam.getByTestId('chat-message').filter({ hasText: body })).toHaveCount(1),
  ]);

  await dana.getByTestId('org-option').filter({ hasText: 'Globex Industries' }).click();
  await dana.getByTestId('nav-chat').click();
  await expect(dana.getByTestId('chat-status')).toContainText('online');
  await expect(dana.getByTestId('chat-message').filter({ hasText: body })).toHaveCount(0);

  await danaContext.close();
  await samContext.close();
});

test('offline chat recovers missed updates and preserves the draft', async ({ browser }) => {
  const writerContext = await browser.newContext();
  const readerContext = await browser.newContext();
  await readerContext.addInitScript(() => {
    const Original = window.WebSocket;
    window.WebSocket = class extends Original {
      constructor(...args) {
        super(...args);
        window.__testChatSocket = this;
      }
    };
  });
  const writer = await writerContext.newPage();
  const reader = await readerContext.newPage();
  await Promise.all([login(writer, 'dana@example.test'), login(reader, 'sam@example.test')]);
  await Promise.all([writer.getByTestId('nav-chat').click(), reader.getByTestId('nav-chat').click()]);
  await expect(reader.getByTestId('chat-status')).toContainText('online');
  const first = `Checkpoint ${Date.now()}`;
  await writer.getByTestId('chat-input').fill(first);
  await writer.getByTestId('chat-send').click();
  await expect(reader.getByTestId('chat-message').filter({ hasText: first })).toHaveCount(1);
  await reader.getByTestId('chat-input').fill('My unfinished design question');
  await readerContext.setOffline(true);
  await reader.evaluate(() => window.__testChatSocket.close());
  await expect(reader.getByTestId('chat-status')).toContainText('Connecting');
  const missed = `While disconnected ${Date.now()}`;
  await writer.getByTestId('chat-input').fill(missed);
  await writer.getByTestId('chat-send').click();
  await expect(writer.getByTestId('chat-message').filter({ hasText: missed })).toHaveCount(1);
  await readerContext.setOffline(false);
  await expect(reader.getByTestId('chat-status')).toContainText('online');
  await expect(reader.getByTestId('chat-message').filter({ hasText: missed })).toHaveCount(1);
  await expect(reader.getByTestId('chat-input')).toHaveValue('My unfinished design question');
  await Promise.all([writerContext.close(), readerContext.close()]);
});

test('mobile chat stays inside the viewport and renders untrusted text as text', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, 'dana@example.test');
  await page.getByRole('button', { name: 'Workspace ▾' }).click();
  await page.getByTestId('nav-chat').click();
  await expect(page.getByTestId('chat-status')).toContainText('online');
  const body = '<img src=x onerror=alert(1)> This is message text';
  await page.getByTestId('chat-input').fill(body);
  await page.getByTestId('chat-send').click();
  await expect(page.getByTestId('chat-message').filter({ hasText: body })).toHaveCount(1);
  await expect(page.getByTestId('chat-history').locator('img')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/chat-mobile.png', fullPage: true });
});

test('invited players and designers chat during an active session with distinct permission views', async ({ page, request, browser }) => {
  const signedIn = await (await request.post('/v1/auth/login', {
    data: { email: 'dana@example.test', password: 'demo1234' },
  })).json();
  const created = await request.post('/v1/orgs', {
    headers: { authorization: `Bearer ${signedIn.token}` }, data: { name: 'Play & Create Studio' },
  });
  expect(created.ok()).toBe(true);
  const company = await created.json();
  const owner = await (await request.post('/v1/auth/token', {
    headers: { authorization: `Bearer ${signedIn.token}` }, data: { orgId: company.id },
  })).json();
  const headers = { authorization: `Bearer ${owner.token}` };
  const provisioned = await request.post(`/v1/orgs/${company.id}/devices`, {
    headers, data: { name: 'studio-gaming-pc', kind: 'windows', online: true },
  });
  expect(provisioned.ok()).toBe(true);
  const device = await provisioned.json();
  const guests = [];
  try {
    for (const [role, name] of [['viewer', 'Design Teammate'], ['operator', 'Game Teammate']]) {
      const email = `${role}-${Date.now()}@example.test`;
      const invited = await (await request.post(`/v1/orgs/${company.id}/invites`, {
        headers, data: { email, role },
      })).json();
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
      const guest = await context.newPage();
      guests.push({ role, name, email, context, page: guest });
      // These members enter through the real invitation screen, then sign in as themselves.
      await guest.goto(`/invite/${invited.inviteToken}`);
      await expect(guest.getByTestId('invite-role')).toHaveText(role);
      await guest.getByTestId('invite-name').fill(name);
      await guest.getByTestId('invite-password').fill('private-test-password');
      await guest.getByTestId('invite-submit').click();
      await expect(guest.getByTestId('login-form')).toBeVisible();
      await guest.getByTestId('login-email').fill(email);
      await guest.getByTestId('login-password').fill('private-test-password');
      await guest.getByTestId('login-submit').click();
      await expect(guest.getByTestId('app-shell')).toBeVisible();
      await expect(guest.getByTestId('app-shell')).toHaveAttribute('data-org-id', company.id);
      await expect(guest.getByTestId('active-role')).toHaveText(role);
      await expect(guest.getByTestId('nav-admin')).toHaveCount(0);
      await expect(guest.getByTestId('create-org')).toBeVisible();
      const row = guest.getByTestId('device-row').filter({ hasText: 'studio-gaming-pc' });
      await expect(row).toBeVisible();
      await expect(row.getByTestId('start-control')).toHaveCount(role === 'operator' ? 1 : 0);
      if (role === 'operator') {
        await row.getByTestId('start-control').click();
        await expect(guest.getByRole('status')).toContainText('control session started');
      }
      await guest.getByTestId('nav-chat').click();
      await expect(guest.getByTestId('chat-status')).toContainText('online');
    }
    const designer = guests[0].page;
    const player = guests[1].page;
    await page.setViewportSize({ width: 1440, height: 1000 });
    await login(page, 'dana@example.test');
    await page.getByTestId('org-option').filter({ hasText: 'Play & Create Studio' }).click();
    await page.getByTestId('nav-chat').click();
    for (const member of [page, designer, player]) {
      await expect(member.getByTestId('chat-status')).toContainText('3 online');
    }
    const conversation = [
      [page, 'The gaming PC is ready. Use this chat to coordinate the playtest.'],
      [player, 'I have started the session. Is everyone ready for the first round?'],
      [designer, 'Ready! I will watch for UI issues and share feedback here.'],
      [player, 'Great. Let us start, then review the scene together.'],
    ];
    for (const [sender, body] of conversation) {
      await sender.getByTestId('chat-input').fill(body);
      await sender.getByTestId('chat-send').click();
      for (const member of [page, designer, player]) {
        await expect(member.getByTestId('chat-message').filter({ hasText: body })).toHaveCount(1);
      }
    }
    await designer.getByTestId('chat-input').fill('A note about the game UI…');
    await designer.getByTestId('toggle-chat').click();
    await expect(designer.getByTestId('chat-dock')).toBeVisible();
    await expect(designer.getByTestId('chat-input')).toHaveValue('A note about the game UI…');
    await designer.getByRole('button', { name: 'Expand team chat' }).click();
    await expect(designer.getByTestId('chat-input')).toHaveValue('A note about the game UI…');
    await designer.getByTestId('chat-input').fill('');

    await player.getByTestId('toggle-chat').click();
    await player.getByTestId('nav-sessions').click();
    await expect(player.getByTestId('chat-dock')).toBeVisible();
    await expect(player.getByTestId('session-row')).toContainText('active');
    const update = 'First round is done. I can keep the chat open while checking the session.';
    await player.getByTestId('chat-input').fill(update);
    await player.getByTestId('chat-send').click();
    for (const member of [page, designer, player]) {
      await expect(member.getByTestId('chat-message').filter({ hasText: update })).toHaveCount(1);
    }
    await player.screenshot({ path: 'test-results/chat-invited-player-docked.png', fullPage: true });
    await player.getByRole('button', { name: 'Expand team chat' }).click();
    // Colour and order must stay the same when the viewer changes.
    const styles = (member) => member.getByTestId('chat-message').evaluateAll((messages) =>
      messages.map((message) => ({
        seq: message.dataset.seq,
        colour: message.style.getPropertyValue('--participant-color'),
      })));
    expect(await styles(designer)).toEqual(await styles(player));
    expect(await styles(page)).toEqual(await styles(player));
    const sessions = await (await request.get(`/v1/orgs/${company.id}/sessions`, { headers })).json();
    expect(sessions.sessions.some((session) => session.device_id === device.id && session.state === 'active')).toBe(true);
    await page.screenshot({ path: 'test-results/chat-desktop.png', fullPage: true });
    await designer.screenshot({ path: 'test-results/chat-invited-designer.png', fullPage: true });
    await player.screenshot({ path: 'test-results/chat-invited-player.png', fullPage: true });
    await designer.setViewportSize({ width: 390, height: 844 });
    expect(await designer.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await designer.screenshot({ path: 'test-results/chat-invited-mobile.png', fullPage: true });

    const guestAuth = await (await guests[0].context.request.post('/v1/auth/login', {
      data: { email: guests[0].email, password: 'private-test-password' },
    })).json();
    const blocked = await request.post(`/v1/orgs/${company.id}/sessions`, {
      headers: { authorization: `Bearer ${guestAuth.token}` },
      data: { deviceId: device.id, mode: 'control' },
    });
    expect(blocked.status()).toBe(403);
    await request.delete(`/v1/orgs/${company.id}/members/${guestAuth.user.id}`, { headers });
    await expect(designer.getByTestId('login-form')).toBeVisible();
    expect((await request.get(`/v1/orgs/${company.id}/chat/messages`, {
      headers: { authorization: `Bearer ${guestAuth.token}` },
    })).status()).toBe(401);
  } finally {
    await Promise.all(guests.map((guest) => guest.context.close()));
  }
});

test('a lost acknowledgement stays visible and retry saves no duplicate', async ({ page, request }) => {
  let blockedId;
  let sends = 0;
  await page.routeWebSocket('**/v1/chat/socket', (socket) => {
    const server = socket.connectToServer();
    socket.onMessage((raw) => {
      const packet = JSON.parse(raw);
      if (packet.type === 'message') {
        sends++;
        if (!blockedId) blockedId = packet.clientId;
      }
      server.send(raw);
    });
    server.onMessage((raw) => {
      const packet = JSON.parse(raw);
      if (sends === 1 && (packet.clientId === blockedId || packet.message?.clientId === blockedId)) return;
      socket.send(raw);
    });
  });
  await login(page, 'dana@example.test');
  await page.getByTestId('nav-chat').click();
  await expect(page.getByTestId('chat-status')).toContainText('online');
  const body = `Delivery confirmation lost ${Date.now()}`;
  await page.getByTestId('chat-input').fill(body);
  await page.getByTestId('chat-send').click();
  await expect(page.getByTestId('chat-pending')).toContainText('Could not confirm delivery', { timeout: 12000 });
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByTestId('chat-pending')).toHaveCount(0);
  await expect(page.getByTestId('chat-message').filter({ hasText: body })).toHaveCount(1);
  const auth = await (await request.post('/v1/auth/login', {
    data: { email: 'dana@example.test', password: 'demo1234' },
  })).json();
  const history = await (await request.get(`/v1/orgs/${auth.orgId}/chat/messages`, {
    headers: { authorization: `Bearer ${auth.token}` },
  })).json();
  expect(history.messages.filter((message) => message.clientId === blockedId)).toHaveLength(1);
});

test('a role change refreshes chat authority without discarding the draft', async ({ page, request }) => {
  const owner = await (await request.post('/v1/auth/login', {
    data: { email: 'dana@example.test', password: 'demo1234' },
  })).json();
  const sam = await (await request.post('/v1/auth/login', {
    data: { email: 'sam@example.test', password: 'demo1234' },
  })).json();
  await login(page, 'sam@example.test');
  await page.getByTestId('nav-chat').click();
  await expect(page.getByTestId('chat-status')).toContainText('online');
  await page.getByTestId('chat-input').fill('Draft before my role changes');
  const route = `/v1/orgs/${owner.orgId}/members/${sam.user.id}`;
  const headers = { authorization: `Bearer ${owner.token}` };
  try {
    expect((await request.patch(route, { headers, data: { role: 'viewer' } })).ok()).toBe(true);
    await expect(page.getByTestId('active-role')).toHaveText('viewer');
    await expect(page.getByTestId('chat-status')).toContainText('online');
    await expect(page.getByTestId('chat-input')).toHaveValue('Draft before my role changes');
  } finally {
    await request.patch(route, { headers, data: { role: 'operator' } });
  }
});
