import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';

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

async function inboundAudioPackets(page) {
  return page.evaluate(async () => {
    let packets = 0;
    for (const peer of window.__testCallPeers) {
      if (peer.connectionState !== 'connected') continue;
      const stats = await peer.getStats();
      for (const report of stats.values()) {
        if (report.type === 'inbound-rtp' && (report.kind ?? report.mediaType) === 'audio') {
          packets += report.packetsReceived ?? 0;
        }
      }
    }
    return packets;
  });
}

test('two teammates keep media and drafts while moving windows and reconnect after sign-out', async ({ browser, request }) => {
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
  const options = { baseURL: 'http://localhost:8124', viewport: { width: 1440, height: 1000 },
    permissions: ['camera', 'microphone'] };
  const ownerContext = await browser.newContext(options);
  const teammateContext = await browser.newContext(options);
  for (const context of [ownerContext, teammateContext]) {
    await context.addInitScript(() => {
      const NativePeer = window.RTCPeerConnection;
      window.__testCallPeers = [];
      window.RTCPeerConnection = class extends NativePeer {
        constructor(...args) {
          super(...args);
          window.__testCallPeers.push(this);
        }
      };
    });
  }
  try {
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
    await expect.poll(() => inboundAudioPackets(owner)).toBeGreaterThan(0);
    await expect.poll(() => inboundAudioPackets(teammate)).toBeGreaterThan(0);

    const videoWindow = owner.getByTestId('video-window');
    const handle = await owner.getByRole('button', { name: 'Move video call window', exact: true }).boundingBox();
    const before = await videoWindow.boundingBox();
    const x = handle.x + 90;
    const y = handle.y + handle.height / 2;
    await owner.mouse.move(x, y);
    await owner.mouse.down();
    await owner.mouse.move(x - 40, y + 80, { steps: 8 });
    await owner.mouse.up();
    await expect.poll(async () => (await videoWindow.boundingBox()).x).toBeCloseTo(before.x - 40, 0);
    await expect.poll(async () => (await videoWindow.boundingBox()).y).toBeCloseTo(before.y + 80, 0);
    await expect.poll(() => owner.getByTestId('remote-video').evaluate((video) => video.readyState)).toBeGreaterThanOrEqual(2);

    const packetsBeforeMinimize = await inboundAudioPackets(owner);
    await owner.getByRole('button', { name: 'Minimize video call', exact: true }).click();
    await expect(owner.getByTestId('remote-video')).toBeHidden();
    await expect(owner.getByTestId('call-mute')).toBeVisible();
    await expect.poll(() => owner.getByTestId('remote-video').evaluate((video) => video.readyState)).toBeGreaterThanOrEqual(2);
    await expect.poll(() => inboundAudioPackets(owner)).toBeGreaterThan(packetsBeforeMinimize);
    await owner.getByRole('button', { name: 'Restore video call', exact: true }).click();
    await expect(owner.getByTestId('remote-video')).toBeVisible();

    const remembered = 'Call notes stay here after I sign out.';
    await teammate.getByTestId('chat-input').fill(remembered);
    await teammate.getByTestId('chat-send').click();
    await expect(owner.getByTestId('chat-history')).toContainText(remembered);
    const draft = 'Review the scene together before taking the next workstation.';
    await owner.getByTestId('chat-input').fill(draft);
    const packetsBeforeClose = await inboundAudioPackets(owner);
    await owner.getByRole('button', { name: 'Close team chat', exact: true }).click();
    await expect(owner.getByTestId('chat-input')).toBeHidden();
    await expect(videoWindow).toBeVisible();
    await expect.poll(() => owner.getByTestId('remote-video').evaluate((video) => video.readyState)).toBeGreaterThanOrEqual(2);
    await expect.poll(() => inboundAudioPackets(owner)).toBeGreaterThan(packetsBeforeClose);
    await owner.getByTestId('toggle-chat').click();
    await expect(owner.getByTestId('chat-input')).toBeVisible();
    await expect(owner.getByTestId('chat-input')).toHaveValue(draft);
    const chatBox = await owner.getByTestId('chat-window').boundingBox();
    const callBox = await videoWindow.boundingBox();
    expect(chatBox.x + chatBox.width).toBeLessThan(callBox.x);
    mkdirSync('data', { recursive: true });
    await owner.screenshot({ path: 'data/teamroom-floating-call-local.png', fullPage: true });
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
    await expect(owner.getByTestId('call-participant').getByLabel('Sam Rivera is muted')).toBeVisible();
    await teammate.getByTestId('call-camera').click();
    await expect(teammate.getByTestId('call-camera')).toHaveAttribute('aria-pressed', 'true');
    await expect(owner.getByTestId('call-participant').getByText('Camera off', { exact: true })).toBeVisible();
    await teammate.getByTestId('call-mute').click();
    await teammate.getByTestId('call-camera').click();
    await expect(owner.getByTestId('call-participant').getByLabel('Sam Rivera is muted')).toHaveCount(0);
    await expect(owner.getByTestId('call-participant').getByText('Camera off', { exact: true })).toHaveCount(0);
    await expect.poll(() => owner.getByTestId('remote-video').evaluate((video) => video.readyState)).toBeGreaterThanOrEqual(2);
    await teammate.getByTestId('call-leave').click();
    await expect(owner.getByTestId('call-participant')).toHaveCount(0);
    await owner.getByTestId('call-leave').click();

  } finally {
    await Promise.all([ownerContext.close(), teammateContext.close()]);
  }
});
