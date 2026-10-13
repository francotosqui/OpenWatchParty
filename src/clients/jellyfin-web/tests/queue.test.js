const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const OWP = require('./setup.js');

let queueUpdates = 0;
let refreshes = 0;
OWP.queue = { refresh: () => { refreshes++; } };
OWP.ui = { render: () => {}, updateQueue: () => { queueUpdates++; } };
OWP.utils.getVideo = () => null;
OWP.utils.log = () => {};
OWP.actions = { completeRoomRejoin: () => {} };
require('../ws/handlers/room.js');
require('../ws/handlers/sync.js');

const h = OWP._wsHandlers;
const item = (id, title = `Episode ${id}`) => ({ id, title });

const queueState = (room, payload) => ({ type: 'queue_state', room, payload });

const roomState = (room, mediaId) => ({
  type: 'room_state',
  room,
  client: 'host',
  server_ts: Date.now(),
  payload: {
    name: room,
    host_id: 'host',
    participant_count: 2,
    media_id: mediaId,
    state_server_ts: Date.now(),
    target_server_ts: null,
    state: { position: 0, play_state: 'paused' }
  }
});

describe('room queue', () => {
  let started;
  let watched;

  beforeEach(() => {
    queueUpdates = 0;
    refreshes = 0;
    started = [];
    watched = [];
    OWP.playback = {
      ensurePlayback: mediaId => { started.push(mediaId); },
      watchReady: options => { watched.push(options.mediaId); }
    };
    Object.assign(OWP.state, OWP.stateFactories.createRoomState(), {
      clientId: 'host',
      inRoom: true,
      roomId: 'room-1',
      isHost: true,
      roomHostId: 'host',
      roomMediaId: 'a',
      readyRoomId: 'room-1',
      pendingMediaId: '',
      rejoinPending: false,
      desiredRoomId: '',
      rejectedRejoinRoomIds: []
    });
  });

  it('stores the queue of its own room only', () => {
    h.handleQueueState(queueState('room-1', { items: [item('a'), item('b')], current: 0, countdown_until: 1234 }));
    assert.deepEqual(OWP.state.queueItems, [item('a'), item('b')]);
    assert.equal(OWP.state.queueCurrent, 0);
    assert.equal(OWP.state.queueCountdownUntil, 1234);
    assert.equal(queueUpdates, 1);

    h.handleQueueState(queueState('room-1', { items: [item('a')], current: 0, countdown_until: null }));
    assert.equal(OWP.state.queueCountdownUntil, 0);

    h.handleQueueState(queueState('room-2', { items: [], current: null, countdown_until: null }));
    assert.deepEqual(OWP.state.queueItems, [item('a')]);
    assert.equal(queueUpdates, 2);
    assert.equal(refreshes, 2);
  });

  it('lets the host logic look again after each room state and on becoming the host', () => {
    h.handleRoomState(roomState('room-1', 'a'), null);
    assert.equal(refreshes, 1);
    OWP.ui.updateRoomRoleControls = () => {};
    OWP.ui.showToast = () => {};
    Object.assign(OWP.state, { isHost: false, clientId: 'guest' });
    h.handleHostChanged({ room: 'room-1', payload: { host_id: 'other', host_name: 'Other' } });
    assert.equal(refreshes, 1);
    h.handleHostChanged({ room: 'room-1', payload: { host_id: 'guest', host_name: 'Guest' } });
    assert.equal(refreshes, 2);
  });

  it('forgets the queue on entering another room', () => {
    h.handleQueueState(queueState('room-1', { items: [item('a')], current: 0, countdown_until: 1234 }));
    h.handleRoomState(roomState('room-2', 'x'), null);
    assert.deepEqual(OWP.state.queueItems, []);
    assert.equal(OWP.state.queueCurrent, null);
    assert.equal(OWP.state.queueCountdownUntil, 0);
    assert.equal(OWP.state.roomMediaId, 'x');
  });

  it('loads the next item on the host too and reports ready again after an advance', () => {
    h.handleRoomState(roomState('room-1', 'b'), null);
    assert.deepEqual(started, ['b']);
    assert.deepEqual(watched, ['b']);
    assert.equal(OWP.state.pendingMediaId, 'b');
    assert.equal(OWP.state.readyRoomId, '');
    assert.equal(OWP.state.roomMediaId, 'b');
  });

  it('keeps a host on its item when the room state names the same one', () => {
    h.handleRoomState(roomState('room-1', 'a'), null);
    assert.deepEqual(started, []);
    assert.deepEqual(watched, []);
    assert.equal(OWP.state.readyRoomId, 'room-1');
  });
});
