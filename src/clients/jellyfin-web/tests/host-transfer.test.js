const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const OWP = require('./setup.js');
const sockets = [];
let toasts = [];
let renders = 0;

class FakeWebSocket {
  static OPEN = 1;
  static CLOSED = 3;

  constructor() {
    this.readyState = 0;
    this.sent = [];
    sockets.push(this);
  }

  send(data) {
    this.sent.push(JSON.parse(data));
  }

  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen();
  }

  receive(message) {
    this.onmessage({
      data: JSON.stringify({ ts: Date.now(), server_ts: Date.now(), ...message })
    });
  }

  close() {
    this.readyState = FakeWebSocket.CLOSED;
  }
}

globalThis.WebSocket = FakeWebSocket;
globalThis.document.getElementById = () => null;
OWP.ui = {
  render: () => { renders++; },
  showToast: message => toasts.push(message),
  updateRoomListUI: () => {},
  updateParticipantList: () => {},
  renderHomeWatchParties: () => {},
  hidePanel: () => {},
  updateSyncIndicator: () => {}
};
OWP.playback = {};
OWP.utils.getVideo = () => OWP.state.currentVideoElement;

require('../ws/send.js');
require('../ws/validation.js');
require('../ws/handlers/room.js');
require('../ws/connection.js');
require('../app/lifecycle.js');

const envelope = (type, payload, room) => ({
  type,
  room,
  payload,
  ts: Date.now(),
  server_ts: Date.now()
});

describe('host transfer client support', () => {
  beforeEach(() => {
    sockets.length = 0;
    toasts = [];
    renders = 0;
    Object.assign(OWP.state, {
      ws: null,
      authToken: 'jwt-token',
      authBlocked: false,
      userName: 'Guest',
      userId: 'user',
      clientId: 'client-1',
      inRoom: false,
      roomId: '',
      isHost: false,
      serverFeatures: [],
      autoReconnect: true,
      isConnecting: false,
      connectionAttempt: 0,
      authRequestAttempt: 0,
      connectionPhase: 'disconnected',
      desiredRoomId: '',
      rejoinPending: false,
      rejectedRejoinRoomIds: [],
      currentVideoElement: null,
      pendingActionTimer: null,
      mediaReadyCleanup: null,
      playbackActionAttempt: 0
    });
  });

  afterEach(() => {
    OWP.state.autoReconnect = false;
    if (OWP.state.intervals.ping) {
      OWP.timers.clear(OWP.state.intervals.ping);
      OWP.state.intervals.ping = null;
    }
    if (OWP.state.pendingActionTimer) OWP.timers.clear(OWP.state.pendingActionTimer);
    OWP.actions.cancelRoomRejoin();
    OWP.state.ws = null;
  });

  it('declares host_transfer in the auth payload and stores the server response', async () => {
    await OWP.actions.connect();
    const socket = sockets[0];
    socket.open();

    const auth = socket.sent.find(message => message.type === 'auth');
    assert.deepEqual(auth.payload.features, ['host_transfer']);
    socket.receive({
      type: 'auth_success',
      payload: { user_name: 'Guest', features: ['host_transfer'] }
    });
    assert.deepEqual(OWP.state.serverFeatures, ['host_transfer']);

    OWP.state.serverFeatures = ['stale'];
    OWP._wsHandlers.handleAuthSuccess({ payload: { user_name: 'Guest' } });
    assert.deepEqual(OWP.state.serverFeatures, []);
  });

  it('declares host_transfer on the insecure identity path', async () => {
    const originalFetchAuthToken = OWP.actions.fetchAuthToken;
    OWP.state.authToken = null;
    OWP.actions.fetchAuthToken = async () => ({ mode: 'insecure', token: null });
    try {
      await OWP.actions.connect();
      const socket = sockets[0];
      socket.open();
      const auth = socket.sent.find(message => message.type === 'auth');
      assert.deepEqual(auth.payload.features, ['host_transfer']);
      assert.equal(auth.payload.token, undefined);
    } finally {
      OWP.actions.fetchAuthToken = originalFetchAuthToken;
    }
  });

  it('does not repeat pending rejoin after insecure auth_success', async () => {
    const originalFetchAuthToken = OWP.actions.fetchAuthToken;
    OWP.state.authToken = null;
    Object.assign(OWP.state, {
      desiredRoomId: 'room-1',
      rejoinPending: true
    });
    OWP.actions.fetchAuthToken = async () => ({ mode: 'insecure', token: null });
    try {
      await OWP.actions.connect();
      const socket = sockets[0];
      socket.open();
      assert.equal(
        socket.sent.filter(message => message.type === 'join_room').length,
        1
      );

      socket.receive({
        type: 'auth_success',
        payload: { user_name: 'Guest', features: ['host_transfer'] }
      });

      assert.equal(OWP.state.connectionPhase, 'authenticated');
      assert.equal(
        socket.sent.filter(message => message.type === 'join_room').length,
        1
      );
    } finally {
      OWP.actions.fetchAuthToken = originalFetchAuthToken;
    }
  });

  it('clears stale server features when a new connection opens', async () => {
    OWP.state.serverFeatures = ['host_transfer'];
    await OWP.actions.connect();
    const socket = sockets[0];
    socket.open();

    assert.deepEqual(OWP.state.serverFeatures, []);
    socket.receive({ type: 'auth_success', payload: { user_name: 'Guest' } });
    Object.assign(OWP.state, {
      inRoom: true,
      roomId: 'room-1',
      isHost: true
    });
    OWP.actions.closeRoom();

    const closeMessage = socket.sent.find(message => (
      message.type === 'close_room' || message.type === 'leave_room'
    ));
    assert.equal(closeMessage.type, 'leave_room');
  });

  it('validates auth features and host_changed strictly', () => {
    assert.equal(OWP.wsValidation.validateMessage(
      envelope('auth_success', { user_name: 'Guest', features: ['host_transfer'] })
    ).valid, true);
    for (const features of ['host_transfer', [1], [null]]) {
      assert.equal(OWP.wsValidation.validateMessage(
        envelope('auth_success', { user_name: 'Guest', features })
      ).valid, false);
    }
    assert.equal(OWP.wsValidation.validateMessage(
      envelope('host_changed', { host_id: 'client-1', host_name: 'Guest' }, 'room-1')
    ).valid, true);
    assert.equal(OWP.wsValidation.validateMessage(
      envelope('host_changed', { host_id: 'client-1', host_name: 'Guest', extra: true }, 'room-1')
    ).valid, false);
    assert.equal(OWP.wsValidation.validateMessage(
      envelope('host_changed', { host_id: 1, host_name: 'Guest' }, 'room-1')
    ).valid, false);
  });

  it('resets guest synchronization state when this client becomes host', () => {
    let cleaned = 0;
    const video = { playbackRate: 1.5 };
    const timer = OWP.timers.setTimeout(() => {}, 10000, 'room');
    Object.assign(OWP.state, {
      inRoom: true,
      roomId: 'room-1',
      clientId: 'client-1',
      isHost: false,
      currentVideoElement: video,
      pendingActionTimer: timer,
      mediaReadyCleanup: () => { cleaned++; OWP.state.mediaReadyCleanup = null; },
      isSyncing: true,
      isInitialSync: true,
      initialSyncTargetPos: 12,
      syncStatus: 'pending_play',
      currentDrift: 3,
      pendingPlayUntil: Date.now() + 1000,
      pendingMediaId: 'item',
      lastSyncServerTs: Date.now(),
      lastSyncPosition: 12,
      lastSyncPlayState: 'playing',
      suppressUntil: Date.now() + 1000
    });

    OWP._wsHandlers.handleHostChanged({
      room: 'room-1',
      payload: { host_id: 'client-1', host_name: 'Guest' }
    });

    assert.equal(OWP.state.isHost, true);
    assert.equal(video.playbackRate, 1);
    assert.equal(OWP.state.pendingActionTimer, null);
    assert.equal(OWP.state.isSyncing, false);
    assert.equal(OWP.state.isInitialSync, false);
    assert.equal(OWP.state.initialSyncTargetPos, null);
    assert.equal(OWP.state.syncStatus, 'synced');
    assert.equal(OWP.state.pendingMediaId, '');
    assert.equal(OWP.state.lastSyncServerTs, 0);
    assert.equal(OWP.state.lastSyncPosition, 0);
    assert.equal(OWP.state.lastSyncPlayState, '');
    assert.equal(OWP.state.suppressUntil, 0);
    assert.equal(cleaned, 1);
    assert.equal(renders, 1);
    assert.deepEqual(toasts, ['You are now the host']);
  });

  it('shows the new host name to other members', () => {
    Object.assign(OWP.state, { inRoom: true, roomId: 'room-1', clientId: 'client-1', isHost: true });

    OWP._wsHandlers.handleHostChanged({
      room: 'room-1',
      payload: { host_id: 'client-2', host_name: 'Alice' }
    });

    assert.equal(OWP.state.isHost, false);
    assert.deepEqual(toasts, ['Alice is now the host']);
    assert.equal(renders, 1);
  });

  it('uses close_room only when the server negotiated host transfer', () => {
    const sent = [];
    OWP.state.ws = { readyState: 1, send: data => sent.push(JSON.parse(data)) };
    Object.assign(OWP.state, { inRoom: true, roomId: 'room-1', isHost: true, serverFeatures: ['host_transfer'] });
    OWP.actions.closeRoom();
    assert.equal(sent[0].type, 'close_room');

    Object.assign(OWP.state, { inRoom: true, roomId: 'room-2', isHost: true, serverFeatures: [] });
    OWP.actions.closeRoom();
    assert.equal(sent[1].type, 'leave_room');
  });

  it('leaving the player still sends leave_room for a host', () => {
    const sent = [];
    OWP.state.ws = { readyState: 1, send: data => sent.push(JSON.parse(data)) };
    Object.assign(OWP.state, {
      inRoom: true,
      roomId: 'room-1',
      isHost: true,
      serverFeatures: ['host_transfer']
    });

    OWP._lifecycle.onVideoPlayerExit();

    assert.equal(sent[0].type, 'leave_room');
  });
});
