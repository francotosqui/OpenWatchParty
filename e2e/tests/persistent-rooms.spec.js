const { test, expect } = require('@playwright/test');
const { execFileSync } = require('node:child_process');
const helpers = require('./helpers');

function restartIsolatedSessionServer() {
  // This hook is opt-in and addresses only the disposable development stack.
  // Never derive a container name or executable from browser content.
  const [server] = JSON.parse(execFileSync('docker', ['inspect', 'owp-session-server'], { encoding: 'utf8' }));
  const [jellyfin] = JSON.parse(execFileSync('docker', ['inspect', 'jellyfin-dev'], { encoding: 'utf8' }));
  const web = new URL(process.env.OWP_WEB_URL);
  expect(['localhost', '127.0.0.1']).toContain(web.hostname);
  expect(jellyfin.HostConfig.PortBindings['8096/tcp'][0].HostPort).toBe(web.port);
  expect(server.Config.Labels['com.docker.compose.service']).toBe('session-server');
  expect(server.Config.Labels['com.docker.compose.project.config_files']).toContain('/infra/docker/dev/docker-compose.yml');
  expect(server.HostConfig.PortBindings['3000/tcp'][0].HostPort).toBe('3000');
  expect(server.Mounts.some(mount => mount.Destination === '/data/openwatchparty')).toBe(true);
  execFileSync('docker', ['restart', '--time', '15', 'owp-session-server'], { stdio: 'pipe', timeout: 30_000 });
}

test('private saved sessions survive a real server restart and resume paused', async ({ browser }) => {
  test.skip(process.env.OWP_E2E_PERSISTENCE_RESTART !== '1', 'Requires an isolated persistence-enabled lab and the explicit restart hook');
  test.setTimeout(240_000);
  const ownerContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const owner = await ownerContext.newPage();
  const guest = await guestContext.newPage();
  try {
    await helpers.login(owner, helpers.HOST_USER);
    await helpers.login(guest, helpers.GUEST_USER);
    await expect.poll(() => owner.evaluate(() => window.OpenWatchParty.state.serverFeatures.includes('persistent_rooms'))).toBe(true);
    // Clean only checkpoints owned by this disposable test account.
    await expect.poll(() => owner.evaluate(() => window.OpenWatchParty.state.savedSessionsReceived)).toBe(true);
    const existing = await owner.evaluate(() => window.OpenWatchParty.state.savedSessions.map(session => session.id));
    for (const id of existing) {
      await owner.evaluate(id => window.OpenWatchParty.actions.discardSavedSession(id), id);
      await expect.poll(() => owner.evaluate(() => window.OpenWatchParty.state.savedSessionPending)).toBeNull();
    }
    const movieId = await helpers.findMovieId(owner, 'Wing It!');
    const nextId = await helpers.findMovieId(owner, 'Sprite Fright');
    await helpers.startPlayback(owner, movieId);
    await helpers.waitForSettled(owner);
    await helpers.createRoom(owner);
    const originalRoomId = (await helpers.owpState(owner)).roomId;
    await helpers.joinRoomFromHomeCard(guest, originalRoomId);
    await helpers.waitForSettled(owner);
    await helpers.togglePlayback(owner);
    await helpers.waitForPaused(owner); await helpers.waitForPaused(guest);
    await helpers.waitForSettled(owner);
    await owner.evaluate(() => { window.OpenWatchParty.utils.getVideo().currentTime = 42; });
    await expect.poll(async () => Math.abs((await helpers.videoState(guest)).time - 42)).toBeLessThan(1);
    await owner.evaluate(id => window.OpenWatchParty.queue.add({ id }), nextId);
    await expect.poll(() => owner.evaluate(() => window.OpenWatchParty.state.queueItems.length)).toBe(2);
    await owner.evaluate(() => window.OpenWatchParty.actions.setRoomAccess(false, true));
    await expect.poll(() => owner.evaluate(() => window.OpenWatchParty.state.roomAccess.unlisted)).toBe(true);
    // Simulate a lost success acknowledgement: server room_closed still proves
    // durable commit, then transport restart must recover by listing checkpoints.
    await owner.evaluate(() => {
      const previous = window.OpenWatchParty.savedSessions.onResult;
      let dropSaveAck = true;
      window.OpenWatchParty.savedSessions.onResult = msg => {
        if (msg.payload.action === 'save' && dropSaveAck) { dropSaveAck = false; return; }
        previous(msg);
      };
    });
    await helpers.clickRoomBar(owner, '#owp-btn-saved');
    await helpers.clickRoomBar(owner, '#owp-saved-save-current');
    await expect(owner.locator('#owp-saved-confirm')).toContainText('The session will end for everyone');
    await owner.locator('#owp-saved-confirm-accept').click();
    await helpers.waitInRoom(owner, false); await helpers.waitInRoom(guest, false);
    restartIsolatedSessionServer();
    await expect.poll(() => owner.evaluate(() => window.OpenWatchParty.state.savedSessionsReceived), { timeout: 40_000 }).toBe(true);
    await expect.poll(() => owner.evaluate(() => window.OpenWatchParty.state.savedSessions.length), { timeout: 40_000 }).toBe(1);
    const saved = await owner.evaluate(() => window.OpenWatchParty.state.savedSessions[0]);
    expect(saved.position).toBeCloseTo(42, 0); expect(saved.queue_count).toBe(2);
    await expect.poll(() => guest.evaluate(() => window.OpenWatchParty.state.savedSessionsReceived)).toBe(true);
    expect(await guest.evaluate(() => window.OpenWatchParty.state.savedSessions.length)).toBe(0);
    await helpers.ensureRoomBarVisible(owner);
    if ((await owner.locator('#owp-btn-saved').getAttribute('aria-expanded')) !== 'true') await helpers.clickRoomBar(owner, '#owp-btn-saved');
    await owner.screenshot({ path: 'test-results/persistent-sessions-desktop.png' });
    await owner.setViewportSize({ width: 375, height: 800 });
    await helpers.ensureRoomBarVisible(owner);
    expect(await owner.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await owner.screenshot({ path: 'test-results/persistent-sessions-phone.png' });
    await owner.setViewportSize({ width: 1280, height: 800 });
    await helpers.clickRoomBar(owner, `#owp-saved-resume-${saved.id}`);
    await helpers.waitInRoom(owner, true); await helpers.waitForPaused(owner);
    await expect.poll(async () => Math.abs((await helpers.videoState(owner)).time - 42)).toBeLessThan(1);
    await expect.poll(() => owner.evaluate(() => window.OpenWatchParty.state.roomAccess.unlisted)).toBe(true);
    const resumed = await helpers.owpState(owner); expect(resumed.isHost).toBe(true); expect(resumed.roomId).not.toBe(originalRoomId);
    await expect.poll(() => owner.evaluate(() => window.OpenWatchParty.state.queueItems.length)).toBe(2);
    // The room is paused on purpose; join without a helper that requires playing.
    await guest.evaluate(id => window.OpenWatchParty.actions.joinRoom(id), resumed.roomId);
    await helpers.waitInRoom(guest, true); await helpers.waitForPaused(guest);
    await expect.poll(async () => Math.abs((await helpers.videoState(guest)).time - 42)).toBeLessThan(1);
    await helpers.expectParticipants(owner, 2);
    await helpers.clickRoomBar(owner, '#owp-btn-saved');
    await helpers.clickRoomBar(owner, '#owp-saved-save-current');
    await owner.locator('#owp-saved-confirm-accept').click();
    await helpers.waitInRoom(owner, false); await helpers.waitInRoom(guest, false);
    // Explicit save replaces this account's checkpoint rather than duplicating it.
    await owner.evaluate(() => window.OpenWatchParty.actions.listSavedSessions());
    await expect.poll(() => owner.evaluate(() => window.OpenWatchParty.state.savedSessions[0]?.active)).toBe(false);
    expect(await owner.evaluate(() => window.OpenWatchParty.state.savedSessions.map(session => session.id))).toEqual([saved.id]);
    await helpers.ensureRoomBarVisible(owner);
    if ((await owner.locator('#owp-btn-saved').getAttribute('aria-expanded')) !== 'true') await helpers.clickRoomBar(owner, '#owp-btn-saved');
    await helpers.clickRoomBar(owner, `#owp-saved-discard-${saved.id}`);
    await expect(owner.locator('#owp-saved-confirm')).toContainText('Discard this session?');
    await owner.locator('#owp-saved-confirm-cancel').click();
    expect(await owner.evaluate(() => window.OpenWatchParty.state.savedSessions.length)).toBe(1);
    await helpers.clickRoomBar(owner, `#owp-saved-discard-${saved.id}`);
    await owner.locator('#owp-saved-confirm-accept').click();
    await expect.poll(() => owner.evaluate(() => window.OpenWatchParty.state.savedSessions.length)).toBe(0);
  } finally {
    await ownerContext.close(); await guestContext.close();
  }
});
