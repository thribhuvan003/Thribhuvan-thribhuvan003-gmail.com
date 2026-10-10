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
    await owner.getByTestId('call-join-submit').click();
    await expect(owner.getByTestId('video-call')).toBeVisible();
    await expect(teammate.getByTestId('call-toggle')).toContainText('Join call · 1');
    await teammate.getByTestId('call-toggle').click();
    await teammate.getByTestId('call-join-submit').click();
    await expect(owner.getByTestId('call-participant')).toHaveCount(1);
    await expect(teammate.getByTestId('call-participant')).toHaveCount(1);
    await expect(owner.getByTestId('remote-video')).toHaveCount(1);
    await expect(teammate.getByTestId('remote-video')).toHaveCount(1);
    await expect.poll(() => owner.getByTestId('remote-video').evaluate((video) => video.readyState)).toBeGreaterThanOrEqual(2);
    await expect.poll(() => teammate.getByTestId('remote-video').evaluate((video) => video.readyState)).toBeGreaterThanOrEqual(2);
    await expect.poll(() => inboundAudioPackets(owner)).toBeGreaterThan(0);
    await expect.poll(() => inboundAudioPackets(teammate)).toBeGreaterThan(0);

    const packetsBeforeMaximize = await inboundAudioPackets(owner);
    await owner.getByRole('button', { name: 'Maximize video call', exact: true }).click();
    await expect(owner.getByTestId('video-window')).toHaveClass(/is-maximized/);
    await expect.poll(() => inboundAudioPackets(owner)).toBeGreaterThan(packetsBeforeMaximize);
    await expect(owner.getByTestId('call-mute')).toBeInViewport();
    await owner.getByRole('button', { name: 'Restore size of video call', exact: true }).click();
    const resize = owner.getByRole('button', { name: 'Resize video call window', exact: true });
    await resize.focus();
    await resize.press('Shift+ArrowLeft');
    await resize.press('Shift+ArrowUp');
    await expect.poll(() => owner.getByTestId('remote-video').evaluate((video) => video.readyState)).toBeGreaterThanOrEqual(2);
    await expect.poll(async () => {
      const grid = await owner.locator('.video-grid').boundingBox();
      const names = await owner.locator('.video-person').all();
      for (const name of names) {
        const box = await name.boundingBox();
        if (box.y < grid.y || box.y + box.height > grid.y + grid.height + 1) return false;
      }
      return true;
    }).toBe(true);

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
    await expect(teammate.getByTestId('call-toggle')).toContainText('Join call · 1');
    await teammate.getByTestId('call-toggle').click();
    await teammate.getByTestId('call-join-submit').click();
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

test('permission denial recovers and disconnected media cannot be toggled back on', async ({ page }) => {
  await page.addInitScript(() => {
    const native = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    let first = true;
    navigator.mediaDevices.getUserMedia = async (...args) => {
      if (first) { first = false; throw new DOMException('Denied for this test', 'NotAllowedError'); }
      const stream = await native(...args);
      window.__localTestStream = stream;
      return stream;
    };

  });
  await login(page, 'dana@example.test');
  await page.getByTestId('call-toggle').click();
  await page.getByTestId('call-join-submit').click();
  await expect(page.getByRole('alert')).toContainText('permission is required');
  await expect(page.getByTestId('video-window')).toHaveCount(0);
  await expect(page.getByTestId('call-join-submit')).toBeEnabled();
  await page.getByTestId('call-join-submit').click();
  await expect(page.getByTestId('video-window')).toBeVisible();
  await page.evaluate(() => {
    const track = window.__localTestStream.getVideoTracks()[0];
    track.stop();
    track.dispatchEvent(new Event('ended'));
  });
  await expect(page.getByTestId('call-camera')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('video-call').getByRole('alert')).toContainText('disconnected');
  await page.getByTestId('call-camera').click();
  await expect(page.getByTestId('call-camera')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('call-leave').click();
  await expect(page.getByTestId('video-window')).toHaveCount(0);
  expect(await page.evaluate(() => window.__localTestStream.getTracks().every(track => track.readyState === 'ended'))).toBe(true);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('join choices request no devices before consent and fit a small screen', async ({ page }) => {
  await page.addInitScript(() => {
    window.__mediaRequests = 0;
    navigator.mediaDevices.getUserMedia = async () => { window.__mediaRequests++; throw new Error('Unexpected access'); };
  });
  await login(page, 'dana@example.test');
  await page.setViewportSize({ width: 390, height: 360 });
  await page.getByTestId('chat-input').fill('Keep this draft while choosing a call');
  await page.getByTestId('call-toggle').click();
  const dialog = page.getByTestId('call-join-dialog');
  await expect(dialog).toBeVisible();
  await expect(page.getByRole('radio', { name: /Video and audio/ })).toBeFocused();
  await page.getByTestId('call-mode-audio').check();
  await page.getByTestId('call-start-muted').check();
  await page.getByTestId('call-join-cancel').scrollIntoViewIfNeeded();
  const bounds = await dialog.boundingBox();
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.y).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(360);
  await page.screenshot({ path: 'data/call-join-mobile.png' });
  expect(await page.evaluate(() => window.__mediaRequests)).toBe(0);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId('call-toggle')).toBeFocused();
  await expect(page.getByTestId('chat-input')).toHaveValue('Keep this draft while choosing a call');
});

test('cancelled permission request cannot replace a later active call', async ({ page }) => {
  await page.addInitScript(() => {
    const native = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    let first = true;
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      if (first) {
        first = false;
        return new Promise(resolve => { window.__finishCancelledRequest = async () => {
          const stream = await native(constraints);
          window.__cancelledStream = stream;
          resolve(stream);
        }; });
      }
      const stream = await native(constraints);
      window.__activeStream = stream;
      return stream;
    };
  });
  await login(page, 'dana@example.test');
  await page.getByTestId('call-toggle').click();
  await page.getByTestId('call-join-submit').click();
  await expect(page.getByTestId('call-join-submit')).toBeDisabled();
  await page.getByTestId('call-join-cancel').click();
  await expect(page.getByTestId('video-window')).toHaveCount(0);
  await page.getByTestId('call-toggle').click();
  await page.getByTestId('call-join-submit').click();
  await expect(page.getByTestId('video-window')).toBeVisible();
  await page.evaluate(() => window.__finishCancelledRequest());
  await expect.poll(() => page.evaluate(() => window.__cancelledStream.getTracks().every(track => track.readyState === 'ended'))).toBe(true);
  expect(await page.evaluate(() => window.__activeStream.getTracks().every(track => track.readyState === 'live'))).toBe(true);
  await expect(page.getByTestId('video-window')).toBeVisible();
  await page.getByTestId('call-leave').click();
});

test('audio-only calls receive video, present screens, and keep microphone media flowing', async ({ browser }) => {
  test.setTimeout(60_000);
  const contexts = await Promise.all([browser.newContext({ permissions: ['camera', 'microphone'] }),
    browser.newContext({ permissions: ['camera', 'microphone'] })]);
  for (const context of contexts) await context.addInitScript(() => {
    const NativeSocket = window.WebSocket;
    window.WebSocket = class extends NativeSocket {
      constructor(...args) {
        super(...args);
        this.addEventListener('message', event => {
          const packet = JSON.parse(event.data);
          if (packet.peerId) window.__testPeerId = packet.peerId;
        });
      }
    };
    const NativePeer = window.RTCPeerConnection;
    window.__testCallPeers = [];
    window.__audioAtAttach = [];
    window.RTCPeerConnection = class extends NativePeer {
      constructor(...args) { super(...args); window.__testCallPeers.push(this); }
      addTrack(track, ...streams) {
        if (track.kind === 'audio') window.__audioAtAttach.push(track.enabled);
        return super.addTrack(track, ...streams);
      }
    };
    const native = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    window.__mediaConstraints = [];
    navigator.mediaDevices.getUserMedia = async constraints => {
      window.__mediaConstraints.push(constraints);
      const stream = await native(constraints);
      window.__localTestStream = stream;
      return stream;
    };
    navigator.mediaDevices.getDisplayMedia = async options => {
      window.__displayOptions = options;
      const canvas = document.createElement('canvas');
      canvas.width = 640; canvas.height = 360;
      const context = canvas.getContext('2d');
      const draw = () => {
        context.fillStyle = '#713fd0'; context.fillRect(0, 0, 640, 360);
        context.fillStyle = '#fff'; context.font = '24px sans-serif';
        context.fillText('Shared test window', 30, 45);
      };
      draw();
      const timer = setInterval(draw, 60);
      const stream = canvas.captureStream(15);
      const track = stream.getVideoTracks()[0];
      const stop = track.stop.bind(track);
      track.stop = () => { clearInterval(timer); stop(); };
      window.__displayStream = stream;
      return stream;
    };
  });
  try {
    const pages = await Promise.all(contexts.map(context => context.newPage()));
    await Promise.all([login(pages[0], 'dana@example.test', 'Acme Robotics'), login(pages[1], 'sam@example.test', 'Acme Robotics')]);
    await Promise.all(pages.map(page => expect.poll(() => page.evaluate(() => window.__testPeerId)).toBeTruthy()));
    const ids = await Promise.all(pages.map(page => page.evaluate(() => window.__testPeerId)));
    const audioIndex = ids[0].localeCompare(ids[1]) < 0 ? 0 : 1;
    const audio = pages[audioIndex];
    const video = pages[1 - audioIndex];
    await audio.getByTestId('call-toggle').click();
    await audio.getByTestId('call-mode-audio').check();
    await audio.getByTestId('call-start-muted').check();
    await audio.getByTestId('call-join-submit').click();
    await expect(audio.getByTestId('video-window')).toBeVisible();
    await expect(audio.getByTestId('call-mute')).toHaveAttribute('aria-pressed', 'true');
    await expect(audio.getByTestId('call-camera')).toBeDisabled();
    expect(await audio.evaluate(() => window.__mediaConstraints[0].video)).toBe(false);
    expect(await audio.evaluate(() => window.__localTestStream.getVideoTracks().length)).toBe(0);
    await video.getByTestId('call-toggle').click();
    await video.getByTestId('call-join-submit').click();
    await expect.poll(() => audio.getByTestId('remote-video').evaluate(el => el.readyState)).toBeGreaterThanOrEqual(2);
    await expect.poll(() => inboundAudioPackets(audio)).toBeGreaterThan(0);
    expect(await audio.evaluate(() => window.__audioAtAttach)).toEqual([false]);
    expect(await audio.evaluate(() => window.__testCallPeers[0].localDescription.type)).toBe('offer');
    await expect(video.getByTestId('call-participant').getByText('Camera off', { exact: true })).toBeVisible();
    await expect(video.getByTestId('call-participant').getByLabel(/is muted/)).toBeVisible();
    await audio.getByTestId('call-mute').click();
    await expect(video.getByTestId('call-participant').getByLabel(/is muted/)).toHaveCount(0);
    await expect.poll(() => inboundAudioPackets(video)).toBeGreaterThan(0);
    const packetsBeforeShare = await inboundAudioPackets(video);
    await audio.getByTestId('call-share').click();
    await expect(audio.getByTestId('call-share')).toHaveAttribute('aria-pressed', 'true');
    await expect(audio.getByTestId('call-camera')).toHaveText('Audio only');
    await expect(video.getByTestId('call-participant').getByText('Sharing screen')).toBeVisible();
    await expect.poll(() => video.getByTestId('remote-video').evaluate(element => element.readyState)).toBeGreaterThanOrEqual(2);
    await expect.poll(() => video.getByTestId('remote-video').evaluate(element => {
      const canvas = document.createElement('canvas'); canvas.width = 1; canvas.height = 1;
      const context = canvas.getContext('2d'); context.drawImage(element, element.videoWidth / 2, element.videoHeight / 2, 1, 1, 0, 0, 1, 1);
      const pixel = context.getImageData(0, 0, 1, 1).data;
      return Math.abs(pixel[0] - 113) < 20 && Math.abs(pixel[1] - 63) < 20 && Math.abs(pixel[2] - 208) < 20;
    })).toBe(true);
    await expect.poll(() => inboundAudioPackets(video)).toBeGreaterThan(packetsBeforeShare);
    expect(await audio.evaluate(() => window.__displayOptions.audio)).toBe(false);
    expect(await audio.getByTestId('local-video').evaluate(element => getComputedStyle(element).transform)).toBe('none');
    await audio.screenshot({ path: 'data/audio-screen-sharing.png' });
    await audio.getByRole('button', { name: 'Maximize video call', exact: true }).click();
    await expect(audio.getByTestId('call-share')).toBeInViewport();
    await audio.getByRole('button', { name: 'Restore size of video call', exact: true }).click();
    await audio.getByRole('button', { name: 'Minimize video call', exact: true }).click();
    await expect(audio.getByTestId('call-share')).toBeVisible();
    await expect(video.getByTestId('call-participant').getByText('Sharing screen')).toBeVisible();
    await audio.getByRole('button', { name: 'Restore video call', exact: true }).click();
    await audio.getByTestId('call-share').click();
    await expect(video.getByTestId('call-participant').getByText('Sharing screen')).toHaveCount(0);
    await expect(video.getByTestId('call-participant').getByText('Camera off', { exact: true })).toBeVisible();
    expect(await audio.evaluate(() => window.__displayStream.getTracks().every(track => track.readyState === 'ended'))).toBe(true);
    // Restart sharing and exercise the browser's own Stop sharing notification.
    await audio.getByTestId('call-share').click();
    await expect(video.getByTestId('call-participant').getByText('Sharing screen')).toBeVisible();
    await audio.evaluate(() => {
      const track = window.__displayStream.getVideoTracks()[0];
      track.stop(); track.dispatchEvent(new Event('ended'));
    });
    await expect(audio.getByTestId('call-share')).toHaveAttribute('aria-pressed', 'false');
    await expect(video.getByTestId('call-participant').getByText('Sharing screen')).toHaveCount(0);
    // The other participant replaces a real camera sender, then restores it.
    await video.getByTestId('call-share').click();
    await expect(audio.getByTestId('call-participant').getByText('Sharing screen')).toBeVisible();
    await video.getByTestId('call-share').click();
    await expect(audio.getByTestId('call-participant').getByText('Sharing screen')).toHaveCount(0);
    expect(await video.evaluate(() => window.__testCallPeers[0].getSenders().some(sender =>
      sender.track === window.__localTestStream.getVideoTracks()[0]))).toBe(true);
    await audio.evaluate(() => {
      const native = RTCRtpSender.prototype.replaceTrack;
      let fail = true;
      RTCRtpSender.prototype.replaceTrack = function(track) {
        if (fail && track === window.__displayStream?.getVideoTracks()[0]) {
          fail = false;
          return Promise.reject(new DOMException('Synthetic replacement failure', 'InvalidModificationError'));
        }
        return native.call(this, track);
      };
    });
    await audio.getByTestId('call-share').click();
    await expect(audio.getByRole('alert')).toContainText('Screen sharing could not start');
    await expect(audio.getByTestId('call-share')).toHaveAttribute('aria-pressed', 'false');
    expect(await audio.evaluate(() => window.__displayStream.getTracks().every(track => track.readyState === 'ended'))).toBe(true);
    await audio.getByTestId('call-share').click();
    await expect(audio.getByTestId('call-share')).toHaveAttribute('aria-pressed', 'true');
    await audio.getByTestId('call-leave').click();
    await expect(video.getByTestId('call-participant')).toHaveCount(0);
    expect(await audio.evaluate(() => window.__localTestStream.getTracks().every(track => track.readyState === 'ended'))).toBe(true);
    expect(await audio.evaluate(() => window.__displayStream.getTracks().every(track => track.readyState === 'ended'))).toBe(true);
    await video.getByTestId('call-leave').click();
    // Reverse roles: an audio-only answerer must also be able to present without rejoining.
    await audio.getByTestId('call-toggle').click();
    await audio.getByTestId('call-join-submit').click();
    await expect(audio.getByTestId('video-window')).toBeVisible();
    await video.getByTestId('call-toggle').click();
    await video.getByTestId('call-mode-audio').check();
    await video.getByTestId('call-join-submit').click();
    await expect.poll(() => inboundAudioPackets(video)).toBeGreaterThan(0);
    await expect.poll(() => video.evaluate(() => window.__testCallPeers.at(-1).localDescription?.type)).toBe('answer');
    expect(await video.evaluate(() => window.__testCallPeers.at(-1).getTransceivers().some(transceiver =>
      transceiver.receiver.track.kind === 'video' && transceiver.currentDirection === 'sendrecv'))).toBe(true);
    await video.getByTestId('call-share').click();
    await expect(audio.getByTestId('call-participant').getByText('Sharing screen')).toBeVisible();
    await expect.poll(() => audio.getByTestId('remote-video').evaluate(element => element.readyState)).toBeGreaterThanOrEqual(2);
    await expect.poll(() => audio.getByTestId('remote-video').evaluate(element => {
      const canvas = document.createElement('canvas'); canvas.width = 1; canvas.height = 1;
      const context = canvas.getContext('2d'); context.drawImage(element, element.videoWidth / 2, element.videoHeight / 2, 1, 1, 0, 0, 1, 1);
      const pixel = context.getImageData(0, 0, 1, 1).data;
      return Math.abs(pixel[0] - 113) < 20 && Math.abs(pixel[2] - 208) < 20;
    })).toBe(true);
    expect(await video.evaluate(() => window.__testCallPeers.at(-1).getSenders().some(sender =>
      sender.track === window.__displayStream.getVideoTracks()[0]))).toBe(true);
    await Promise.all([audio.getByTestId('call-leave').click(), video.getByTestId('call-leave').click()]);
  } finally { await Promise.all(contexts.map(context => context.close())); }
});

test('screen chooser cancellation and late responses leave the call state intact', async ({ page }) => {
  await page.addInitScript(() => {
    let first = true;
    navigator.mediaDevices.getDisplayMedia = async () => {
      if (first) { first = false; throw new DOMException('User cancelled', 'NotAllowedError'); }
      return new Promise(resolve => { window.__finishDisplayRequest = () => {
        const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 360;
        window.__lateDisplayStream = canvas.captureStream(15);
        resolve(window.__lateDisplayStream);
      }; });
    };
  });
  await login(page, 'dana@example.test');
  await page.getByTestId('call-toggle').click();
  await page.getByTestId('call-join-submit').click();
  await expect(page.getByTestId('video-window')).toBeVisible();
  await page.getByTestId('call-share').click();
  await expect(page.getByTestId('call-share')).toBeEnabled();
  await expect(page.getByTestId('call-share')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByTestId('call-share').click();
  await expect(page.getByTestId('call-share')).toBeDisabled();
  await page.getByTestId('call-leave').click();
  await page.evaluate(() => window.__finishDisplayRequest());
  await expect.poll(() => page.evaluate(() => window.__lateDisplayStream.getTracks().every(track => track.readyState === 'ended'))).toBe(true);
  await expect(page.getByTestId('video-window')).toHaveCount(0);
  await expect(page.getByTestId('call-toggle')).toBeEnabled();
});

test('unsupported screen capture explains the disabled control without blocking audio', async ({ page }) => {
  await page.addInitScript(() => { navigator.mediaDevices.getDisplayMedia = undefined; });
  await login(page, 'dana@example.test');
  await page.getByTestId('call-toggle').click();
  await page.getByTestId('call-mode-audio').check();
  await page.getByTestId('call-join-submit').click();
  await expect(page.getByTestId('call-share')).toBeDisabled();
  await expect(page.getByTestId('call-share')).toHaveAttribute('title', 'Screen sharing needs a supported desktop browser');
  await expect(page.getByTestId('call-mute')).toBeEnabled();
  await page.getByTestId('call-mute').click();
  await expect(page.getByTestId('call-mute')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('call-leave').click();
});
