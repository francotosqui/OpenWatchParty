const { test, expect } = require('@playwright/test');
const helpers = require('./helpers');

test('typing, a picked mention and the toast mode reach the other member', async ({ browser }) => {
  const contexts = await Promise.all([0, 1].map(() => browser.newContext()));
  const [host, guest] = await Promise.all(contexts.map(context => context.newPage()));
  try {
    await helpers.login(host, helpers.HOST_USER);
    await helpers.login(guest, helpers.GUEST_USER);
    const movieId = await helpers.findMovieId(host, 'Wing It!');
    await helpers.startPlayback(host, movieId);
    await helpers.waitForSettled(host);
    await helpers.createRoom(host);
    const { roomId } = await helpers.owpState(host);
    await helpers.joinRoomFromHeader(guest, roomId);

    // Both features are negotiated, and members carry their Jellyfin user ids.
    await expect.poll(() => host.evaluate(() => ['chat_typing', 'user_avatars']
      .every(feature => window.OpenWatchParty.state.serverFeatures.includes(feature)))).toBe(true);
    await expect.poll(() => host.evaluate(() => window.OpenWatchParty.state.participants.length)).toBe(2);
    expect(await host.evaluate(() => window.OpenWatchParty.state.participants.every(member => /^[0-9a-f-]{32,36}$/i.test(member.userId || '')))).toBe(true);

    await helpers.clickRoomBar(host, '#owp-btn-chat');
    await helpers.clickRoomBar(guest, '#owp-btn-chat');
    const input = guest.locator('#owp-chat-input');

    // Typing shows on the other member and goes away when the field empties.
    await input.fill('ho');
    await expect(host.locator('#owp-chat-typing')).toBeVisible();
    await expect(host.locator('#owp-chat-typing')).toContainText(helpers.GUEST_USER);
    await input.fill('');
    await expect(host.locator('#owp-chat-typing')).toBeHidden();

    // A mention picked from the suggestions is highlighted for the host.
    await input.fill('@testh');
    await expect(guest.locator('#owp-mention-list [role="option"]')).toHaveCount(1);
    await input.press('Enter');
    await expect(input).toHaveValue(`@${helpers.HOST_USER} `);
    await input.pressSequentially('dale play');
    await input.press('Enter');
    await expect(host.locator('#owp-chat-messages .owp-chat-mentioned .owp-chat-mention')).toHaveText(`@${helpers.HOST_USER}`);

    // With the host's chat closed, a mention gets its own toast...
    await helpers.clickRoomBar(host, '#owp-btn-chat');
    await expect(host.locator('#owp-chat-section')).toBeHidden();
    await guest.evaluate(name => window.OpenWatchParty.chat.send(`@${name} otra vez`), helpers.HOST_USER);
    await expect(host.locator('.owp-toast.owp-toast-mention')).toBeVisible();

    // ...and in mentions-only mode a plain message adds to the badge without one.
    await host.evaluate(() => window.OpenWatchParty.chatAlerts.setMode('mentions'));
    const unread = await host.evaluate(() => window.OpenWatchParty.chat.unreadCount);
    const plainToasts = () => host.locator('.owp-toast:not(.owp-toast-mention):not(.owp-toast-out)').count();
    const before = await plainToasts();
    await guest.evaluate(() => window.OpenWatchParty.chat.send('mensaje común'));
    await expect.poll(() => host.evaluate(() => window.OpenWatchParty.chat.unreadCount)).toBe(unread + 1);
    expect(await plainToasts()).toBe(before);
  } finally {
    await helpers.leaveIfInRoom(guest);
    await helpers.leaveIfInRoom(host);
    await Promise.all(contexts.map(context => context.close()));
  }
});
