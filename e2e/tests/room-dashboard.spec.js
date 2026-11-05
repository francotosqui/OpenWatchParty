const { test, expect } = require('@playwright/test');
const helpers = require('./helpers');

// #186: a Jellyfin administrator follows the open rooms on the plugin page and
// closes one; the people inside are told why.
test.describe.configure({ mode: 'serial' });

let adminContext;
let guestContext;
let observerContext;
let observer;
let admin;
let guest;
let movieId;

test.beforeAll(async ({ browser }) => {
  adminContext = await browser.newContext();
  guestContext = await browser.newContext();
  observerContext = await browser.newContext();
  observer = await observerContext.newPage();
  admin = await adminContext.newPage();
  guest = await guestContext.newPage();
  await helpers.login(admin, helpers.HOST_USER);
  await helpers.login(observer, helpers.HOST_USER);
  await helpers.login(guest, helpers.GUEST_USER);
  movieId = await helpers.findMovieId(guest, 'Wing It!');
});

test.afterAll(async () => {
  await adminContext?.close();
  await guestContext?.close();
  await observerContext?.close();
});

test("an administrator sees and closes a guest's room", async () => {
  const denied = await guest.evaluate(async () => {
    const response = await fetch(ApiClient.getUrl('OpenWatchParty/AdminToken'), {
      headers: { Authorization: 'MediaBrowser Token="' + ApiClient.accessToken() + '"' }
    });
    return response.status;
  });
  expect(denied).toBe(403);

  await helpers.leaveIfInRoom(admin);
  await helpers.leaveIfInRoom(guest);
  await helpers.startPlayback(guest, movieId);
  await helpers.waitForSettled(guest);
  await helpers.createRoom(guest);
  const { roomId } = await helpers.owpState(guest);

  await admin.goto('/#/configurationpage?name=OpenWatchParty');
  const row = admin.locator(`#ActiveRoomsList .owp-room[data-room-id="${roomId}"]`);
  await expect(row).toContainText(`Owner: ${helpers.GUEST_USER} · 1 person · ${helpers.GUEST_USER}`);
  await expect(admin.locator('#ActiveRoomsLive')).toHaveText('Live');
  await observer.goto('/#/configurationpage?name=OpenWatchParty');
  const observedRow = observer.locator(`#ActiveRoomsList .owp-room[data-room-id="${roomId}"]`);
  await expect(observedRow).toBeVisible();

  // Jellyfin renders Dashboard.confirm's body as HTML, unlike the room rows.
  // Exercise that real sink with a name containing both markup and entities.
  await admin.evaluate(roomId => {
    OpenWatchPartyActiveRooms.confirmClose({
      room_id: roomId,
      name: '<b>Ana & Luz</b> &lt;img&gt;',
      participants: [{ name: 'testclient1' }]
    });
  }, roomId);
  const dialog = admin.locator('.dialog');
  await expect(dialog.locator('.text')).toHaveText(
    'Close “<b>Ana & Luz</b> &lt;img&gt;”? The person inside leaves the room and sees “The server administrator closed the room”.'
  );
  await expect(dialog.locator('.text b, .text img')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();

  await row.getByRole('button', { name: 'Close room' }).click();
  await admin.locator('.dialog').getByRole('button', { name: 'Close room' }).click();

  await expect(guest.locator('.owp-toast-system', { hasText: 'The server administrator closed the room' })).toBeVisible();
  await helpers.waitInRoom(guest, false);
  await expect(row).toHaveCount(0);
  await expect(observedRow).toHaveCount(0);
});
