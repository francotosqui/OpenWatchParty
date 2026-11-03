const { test, expect } = require('@playwright/test');
const helpers = require('./helpers');

test('Owner appoints and revokes one administrator, who then inherits the room', async ({ browser }) => {
  const contexts = await Promise.all(Array.from({ length: 3 }, () => browser.newContext()));
  const [owner, administrator, guest] = await Promise.all(contexts.map(context => context.newPage()));
  try {
    await helpers.login(owner, helpers.HOST_USER);
    await helpers.login(administrator, helpers.GUEST_USER);
    await helpers.login(guest, helpers.THIRD_USER);
    const movieId = await helpers.findMovieId(owner, 'Wing It!');
    await helpers.startPlayback(owner, movieId);
    await helpers.waitForSettled(owner);
    await helpers.createRoom(owner);
    const roomId = (await helpers.owpState(owner)).roomId;
    await helpers.joinRoomFromHomeCard(administrator, roomId);
    await helpers.joinRoomFromHomeCard(guest, roomId);
    await helpers.expectParticipants(owner, 3);

    await helpers.ensureRoomBarVisible(owner);
    const people = owner.locator('#owp-btn-people');
    if ((await people.getAttribute('aria-expanded')) !== 'true') await helpers.clickRoomBar(owner, people);
    const adminRow = owner.locator('.owp-participant', { hasText: helpers.GUEST_USER });
    await helpers.clickRoomBar(owner, adminRow.locator('.owp-mod-more'));
    await helpers.clickRoomBar(owner, adminRow.locator('.owp-mod-role'));
    await expect(adminRow.locator('.owp-mod-confirm')).toContainText(helpers.GUEST_USER);
    await helpers.clickRoomBar(owner, adminRow.locator('[data-moderation-action="confirm-role"]'));
    await expect(adminRow.locator('.owp-host-badge')).toHaveText('Administrator');
    await expect.poll(() => administrator.evaluate(() => window.OpenWatchParty.state.isAdministrator)).toBe(true);
    await expect(administrator.locator('.owp-participant', { hasText: helpers.HOST_USER }).locator('.owp-mod-more')).toHaveCount(0);

    await helpers.clickRoomBar(owner, adminRow.locator('.owp-mod-more'));
    await helpers.clickRoomBar(owner, adminRow.locator('.owp-mod-role'));
    await helpers.clickRoomBar(owner, adminRow.locator('[data-moderation-action="confirm-role"]'));
    await expect.poll(() => administrator.evaluate(() => window.OpenWatchParty.state.isAdministrator)).toBe(false);

    await helpers.clickRoomBar(owner, adminRow.locator('.owp-mod-more'));
    await helpers.clickRoomBar(owner, adminRow.locator('.owp-mod-role'));
    await helpers.clickRoomBar(owner, adminRow.locator('[data-moderation-action="confirm-role"]'));
    await expect.poll(() => administrator.evaluate(() => window.OpenWatchParty.state.isAdministrator)).toBe(true);

    await helpers.waitForPlaying(administrator);
    await helpers.waitForSettled(administrator);
    await helpers.togglePlayback(administrator);
    await helpers.waitForPaused(owner);
    await helpers.togglePlayback(administrator);
    await helpers.waitForPlaying(owner);

    await helpers.ensureRoomBarVisible(administrator);
    const adminPeople = administrator.locator('#owp-btn-people');
    if ((await adminPeople.getAttribute('aria-expanded')) !== 'true') await helpers.clickRoomBar(administrator, adminPeople);
    const guestRow = administrator.locator('.owp-participant', { hasText: helpers.THIRD_USER });
    await helpers.clickRoomBar(administrator, guestRow.locator('.owp-mod-more'));
    await helpers.clickRoomBar(administrator, guestRow.locator('.owp-mod-remove'));
    await helpers.waitInRoom(guest, false);
    await helpers.expectParticipants(owner, 2);

    await owner.evaluate(() => window.OpenWatchParty.actions.leaveRoom());
    await expect.poll(async () => (await helpers.owpState(administrator)).isHost).toBe(true);
    await expect.poll(async () => (await helpers.owpState(administrator)).roomHostId).toBe((await helpers.owpState(administrator)).clientId);
    await helpers.waitInRoom(guest, false);
    await expect.poll(() => administrator.evaluate(() => window.OpenWatchParty.state.isAdministrator)).toBe(false);
  } finally {
    await Promise.all(contexts.map(context => context.close()));
  }
});
