const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const OWP = require('./setup.js');
const { FakeDocument } = require('./fake-dom.js');

globalThis.document = new FakeDocument();
OWP.ui = {};
OWP.chat = { messages: [], unreadCount: 0 };
OWP.utils.getVideo = () => null;
OWP.utils.log = () => {};
require('../ui/indicators.js');
require('../ui/cards.js');
require('../chat/messages.js');
require('../chat/input.js');
require('../ui/toasts.js');
require('../ui/home.js');
require('../ui/render.js');
OWP.actions = { schedulePing: () => {} };
require('../ws/handlers/clock.js');

const { PANEL_ID, ROOM_MODE_CLASS } = OWP.constants;
const updateRoomListUI = OWP.ui.updateRoomListUI;
let focused = null;
Object.getPrototypeOf(document.createElement('div')).focus = function focus() {
  focused = this;
};
const byId = id => document.getElementById(id);
const panel = () => byId(PANEL_ID);
const expanded = id => byId(id).getAttribute('aria-expanded');
const openSections = () => ['owp-people-section', 'owp-chat-section', 'owp-leave-confirm']
  .filter(id => byId(id) && !byId(id).hidden);

let left;
let chatToasts;

const renderRoom = (overrides = {}) => {
  Object.assign(OWP.state, {
    inRoom: true,
    roomId: 'room-1',
    roomName: "FrancoTosky's room",
    clientId: 'client-a5be',
    isHost: false,
    participantCount: 2,
    participants: [{ name: 'FrancoTosky', isHost: true }, { name: 'Ana', isHost: false }],
    syncStatus: 'synced',
    ...overrides
  });
  OWP.ui.render(true);
};

describe('room bar', () => {
  beforeEach(() => {
    globalThis.document = new FakeDocument();
    const element = document.createElement('div');
    element.id = PANEL_ID;
    document.body.appendChild(element);
    left = 0;
    chatToasts = [];
    OWP.timers.setTimeout = () => 1;
    OWP.ui.renderHomeWatchParties = () => {};
    OWP.ui.updateRoomListUI = () => {};
    OWP.ui.stopPlayerCapture = () => {};
    OWP.ui.showChatToast = (username, text) => chatToasts.push(`${username}: ${text}`);
    OWP.actions = { leaveRoom: () => { left++; } };
    OWP.chat.messages = [];
    OWP.chat.unreadCount = 0;
    OWP.state.roomBarSection = '';
  });

  it('shows the sync dot, latency, room name and buttons in that order', () => {
    renderRoom();
    const bar = panel().querySelector('.owp-room-bar');
    const ids = bar.children.map(child => child.id || child.className.split(' ')[0]);
    assert.deepEqual(ids, [
      'owp-sync-indicator',
      'owp-latency',
      'owp-room-name',
      'owp-btn-people',
      'owp-btn-chat',
      'owp-btn-leave',
      'owp-close-btn'
    ]);
    assert.equal(bar.querySelector('.owp-room-name').textContent, "FrancoTosky's room");
    assert.equal(bar.querySelector('.owp-room-name').title, "FrancoTosky's room");
    assert.equal(byId('owp-people-count').textContent, '2');
    assert.ok(panel().classList.contains(ROOM_MODE_CLASS));
    // Outline SVG icons, not Jellyfin's filled Material icons.
    assert.ok(byId('owp-btn-people').querySelector('.owp-icon-users'));
    assert.ok(byId('owp-btn-people').querySelector('.owp-expand'));
    assert.ok(byId('owp-btn-chat').querySelector('.owp-icon-chat'));
    assert.ok(byId('owp-btn-leave').querySelector('.owp-icon-logout'));
    assert.ok(bar.querySelector('.owp-close-btn .owp-icon-x'));
    assert.ok(byId('owp-chat-send').querySelector('.owp-icon-send'));
    assert.equal(bar.querySelector('.material-icons'), null);
  });

  it('starts with every drop-down closed', () => {
    renderRoom();
    assert.equal(byId('owp-room-drop').hidden, true);
    assert.deepEqual(openSections(), []);
    assert.equal(expanded('owp-btn-people'), 'false');
    assert.equal(expanded('owp-btn-chat'), 'false');
  });

  it('opens one drop-down at a time and closes it from the same button', () => {
    renderRoom();
    byId('owp-btn-people').click();
    assert.equal(byId('owp-room-drop').hidden, false);
    assert.deepEqual(openSections(), ['owp-people-section']);
    assert.equal(expanded('owp-btn-people'), 'true');

    byId('owp-btn-chat').click();
    assert.deepEqual(openSections(), ['owp-chat-section']);
    assert.equal(expanded('owp-btn-people'), 'false');
    assert.equal(expanded('owp-btn-chat'), 'true');

    byId('owp-btn-chat').click();
    assert.equal(byId('owp-room-drop').hidden, true);
    assert.deepEqual(openSections(), []);
  });

  it('keeps the open drop-down when the panel is drawn again', () => {
    renderRoom();
    byId('owp-btn-people').click();
    OWP.ui.render(true);
    assert.deepEqual(openSections(), ['owp-people-section']);
  });

  it('counts chat messages as unread, with a toast, while the chat is closed', () => {
    renderRoom();
    OWP.chat.receive({ client: 'client-other', payload: { username: 'Ana', text: 'pause' }, server_ts: 1 });
    assert.equal(OWP.chat.unreadCount, 1);
    assert.equal(byId('owp-chat-badge').textContent, '1');
    assert.equal(byId('owp-chat-badge').style.display, 'inline-block');
    assert.deepEqual(chatToasts, ['Ana: pause']);

    byId('owp-btn-chat').click();
    assert.equal(OWP.chat.unreadCount, 0);
    assert.equal(byId('owp-chat-badge').style.display, 'none');
    assert.equal(OWP.chat.isChatVisible(), true);

    OWP.chat.receive({ client: 'client-other', payload: { username: 'Ana', text: 'back' }, server_ts: 2 });
    assert.equal(OWP.chat.unreadCount, 0);
    assert.equal(chatToasts.length, 1);
    assert.equal(byId('owp-chat-messages').children.length, 2);
    // One line per message: the time moves to the tooltip.
    assert.match(String(byId('owp-chat-messages').children[0].title), /\d/);
  });

  it('keeps unread messages unread when the panel is drawn with the chat closed', () => {
    renderRoom();
    OWP.chat.receive({ client: 'client-other', payload: { username: 'Ana', text: 'pause' }, server_ts: 1 });
    OWP.ui.render(true);
    assert.equal(OWP.chat.unreadCount, 1);
    assert.equal(byId('owp-chat-badge').textContent, '1');
    assert.equal(byId('owp-chat-messages').children.length, 1);
  });

  it('does not mark the chat read while the panel is hidden', () => {
    renderRoom();
    byId('owp-btn-chat').click();
    panel().classList.add('hide');
    OWP.chat.receive({ client: 'client-other', payload: { username: 'Ana', text: 'pause' }, server_ts: 1 });
    assert.equal(OWP.chat.unreadCount, 1);

    OWP.ui.render(true);
    assert.equal(OWP.chat.unreadCount, 1);
    assert.equal(byId('owp-chat-badge').textContent, '1');

    panel().classList.remove('hide');
    OWP.ui.render(true);
    assert.equal(OWP.chat.unreadCount, 0);
  });

  it('names the participant count and unread messages on the icon buttons', () => {
    renderRoom();
    assert.equal(byId('owp-btn-people').getAttribute('aria-label'), 'Participants, 2');
    assert.equal(byId('owp-btn-chat').getAttribute('aria-label'), 'Chat');

    OWP.state.participants = [{ name: 'FrancoTosky', isHost: true }];
    OWP.ui.updateParticipantList();
    assert.equal(byId('owp-btn-people').getAttribute('aria-label'), 'Participants, 1');

    OWP.chat.receive({ client: 'client-other', payload: { username: 'Ana', text: 'pause' }, server_ts: 1 });
    assert.equal(byId('owp-btn-chat').getAttribute('aria-label'), 'Chat, 1 unread');
    byId('owp-btn-chat').click();
    assert.equal(byId('owp-btn-chat').getAttribute('aria-label'), 'Chat');
  });

  it('keeps the last measured latency when the bar is drawn again', () => {
    OWP.state.lastRttMs = null;
    renderRoom();
    assert.equal(panel().querySelector('.owp-latency').textContent, '-');

    OWP._wsHandlers.handlePong({ payload: { client_ts: OWP.utils.nowMs() - 12 } });
    assert.equal(OWP.state.lastRttMs >= 12, true);
    const shown = panel().querySelector('.owp-latency').textContent;
    assert.equal(shown, `${OWP.state.lastRttMs} ms`);

    OWP.ui.render(true);
    assert.equal(panel().querySelector('.owp-latency').textContent, shown);
    OWP.state.lastRttMs = null;
  });

  it('asks a guest before leaving the room', () => {
    renderRoom();
    const leave = byId('owp-btn-leave');
    assert.equal(leave.getAttribute('aria-label'), 'Leave room');
    assert.equal(leave.getAttribute('aria-controls'), 'owp-leave-confirm');
    leave.click();
    assert.equal(left, 0);
    assert.deepEqual(openSections(), ['owp-leave-confirm']);
    assert.equal(panel().querySelector('.owp-leave-question').textContent, 'Leave the room?');
    assert.equal(byId('owp-btn-confirm-leave').textContent, 'Leave');

    focused = null;
    panel().querySelector('.owp-leave-confirm .secondary').click();
    assert.deepEqual(openSections(), []);
    assert.equal(left, 0);
    assert.equal(focused, leave);

    leave.click();
    byId('owp-btn-confirm-leave').click();
    assert.equal(left, 1);
  });

  it('asks the host before closing the room for everyone', () => {
    renderRoom({ isHost: true, clientId: 'client-host' });
    const leave = byId('owp-btn-leave');
    assert.equal(leave.getAttribute('aria-label'), 'Close room');
    leave.click();
    assert.equal(left, 0);
    assert.deepEqual(openSections(), ['owp-leave-confirm']);
    assert.equal(expanded('owp-btn-leave'), 'true');
    assert.equal(panel().querySelector('.owp-leave-question').textContent, 'Close the room for everyone?');

    focused = null;
    panel().querySelector('.owp-leave-confirm .secondary').click();
    assert.deepEqual(openSections(), []);
    assert.equal(left, 0);
    // Focus does not stay on the hidden Cancel button.
    assert.equal(focused, leave);

    leave.click();
    assert.equal(byId('owp-btn-confirm-leave').textContent, 'Close room');
    byId('owp-btn-confirm-leave').click();
    assert.equal(left, 1);
  });

  it('words a reopened confirmation for the current role', () => {
    OWP.state.roomBarSection = 'leave';
    renderRoom({ isHost: true });
    assert.equal(panel().querySelector('.owp-leave-question').textContent, 'Close the room for everyone?');
    renderRoom({ isHost: false });
    assert.deepEqual(openSections(), ['owp-leave-confirm']);
    assert.equal(panel().querySelector('.owp-leave-question').textContent, 'Leave the room?');
  });

  it('updates the people count with the names and with count updates', () => {
    renderRoom({ participants: [] });
    assert.equal(byId('owp-people-count').textContent, '2');
    OWP.state.participants = [{ name: 'FrancoTosky', isHost: true }];
    OWP.ui.updateParticipantList();
    assert.equal(byId('owp-people-count').textContent, '1');
    assert.equal(byId('owp-participants-list').querySelector('.owp-participant-avatar').textContent, 'F');
  });

  it('shows the sync state as a dot with its label as tooltip', () => {
    renderRoom({ isHost: true });
    assert.equal(byId('owp-sync-indicator').className, 'owp-sync-dot synced');
    assert.equal(byId('owp-sync-indicator').title, 'Hosting');

    renderRoom({ isHost: false, syncStatus: 'syncing' });
    assert.equal(byId('owp-sync-indicator').className, 'owp-sync-dot syncing');
    assert.equal(byId('owp-sync-indicator').getAttribute('aria-label'), 'Out of sync');

    OWP.state.syncStatus = 'pending_play';
    OWP.state.pendingPlayUntil = 0;
    OWP.ui.updateSyncIndicator();
    assert.equal(byId('owp-sync-indicator').className, 'owp-sync-spinner');
  });

  it('draws the lobby in the same style as the bar', () => {
    OWP.state.inRoom = false;
    OWP.state.rooms = [
      { id: 'room-1', name: "Ana's room", count: 1, media_id: 'media' },
      { id: 'room-2', name: "FrancoTosky's room", count: 3, media_id: null }
    ];
    OWP.state.ws = { readyState: 1 };
    OWP.ui.updateRoomListUI = updateRoomListUI;
    OWP.ui.render(true);

    const header = panel().querySelector('.owp-header');
    assert.equal(header.querySelector('.owp-panel-title').textContent, 'OpenWatchParty');
    assert.ok(header.querySelector('.owp-close-btn .owp-icon-x'));
    assert.equal(byId('owp-ws-indicator').className, 'owp-ws-status online');
    assert.equal(byId('owp-ws-indicator').textContent, 'Online');
    assert.equal(panel().querySelector('.owp-label').textContent, 'Available rooms');
    assert.ok(panel().querySelector('.owp-create-section #owp-btn-create'));

    const rows = byId('owp-room-list').querySelectorAll('.owp-room-item');
    assert.deepEqual(rows.map(row => row.querySelector('.owp-room-count').textContent), ['1 user', '3 users']);
    assert.equal(rows[0].querySelector('.owp-room-title').textContent, "Ana's room");
    assert.ok(rows[1].querySelector('.owp-room-note'));

    OWP.state.ws = null;
    OWP.ui.updateStatusIndicator();
    assert.equal(byId('owp-ws-indicator').className, 'owp-ws-status offline');
    assert.equal(byId('owp-ws-indicator').textContent, 'Offline');

    OWP.state.rooms = [];
    OWP.ui.updateRoomListUI();
    assert.equal(byId('owp-room-list').querySelector('.owp-room-empty').textContent, 'No active rooms.');
    OWP.ui.updateRoomListUI = () => {};
  });

  it('drops the room style back in the lobby', () => {
    renderRoom();
    OWP.state.inRoom = false;
    OWP.ui.render(true);
    assert.equal(panel().classList.contains(ROOM_MODE_CLASS), false);
    assert.equal(panel().querySelector('.owp-room-bar'), null);
  });
});
