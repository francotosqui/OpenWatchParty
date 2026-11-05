const { test, expect } = require('@playwright/test');
const helpers = require('./helpers');

test('participant option dots stay centered in a half-screen player', async ({ browser }) => {
  const hostContext = await browser.newContext({ viewport: { width: 960, height: 900 } });
  const guestContext = await browser.newContext();
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();
  try {
    await helpers.login(host, helpers.HOST_USER);
    await helpers.login(guest, helpers.GUEST_USER);
    const movie = await helpers.findMovieId(host, 'Wing It!');
    await helpers.startPlayback(host, movie);
    await helpers.waitForSettled(host);
    await helpers.createRoom(host);
    const { roomId } = await helpers.owpState(host);
    await helpers.joinRoomFromHomeCard(guest, roomId);
    await helpers.expectParticipants(host, 2);
    await helpers.ensureRoomBarVisible(host);
    const people = host.locator('#owp-btn-people');
    if (await people.getAttribute('aria-expanded') !== 'true') await helpers.clickRoomBar(host, people);
    const button = host.locator('.owp-participant', { hasText: helpers.GUEST_USER }).locator('.owp-mod-more');
    await expect(button).toBeVisible();
    for (const width of [960, 640, 375]) {
      await host.setViewportSize({ width, height: 900 });
      for (const size of [14, 18]) {
        await host.evaluate(size => {
          window.OpenWatchParty.state.appearanceTextSize = size;
          window.OpenWatchParty.ui.applyAppearance();
        }, size);
        const offset = await button.evaluate(el => {
          const box = el.getBoundingClientRect();
          const icon = el.querySelector('svg').getBoundingClientRect();
          return { x: Math.abs(icon.x + icon.width / 2 - box.x - box.width / 2), y: Math.abs(icon.y + icon.height / 2 - box.y - box.height / 2) };
        });
        expect(offset.x, `horizontal center at width ${width}, font ${size}`).toBeLessThanOrEqual(1);
        expect(offset.y, `vertical center at width ${width}, font ${size}`).toBeLessThanOrEqual(1);
      }
    }
    await helpers.clickRoomBar(host, button);
    await expect(host.locator('.owp-mod-actions')).toBeVisible();
    await host.evaluate(() => window.OpenWatchParty.actions.leaveRoom());
  } finally {
    await hostContext.close();
    await guestContext.close();
  }
});
