const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const OWP = require('./setup.js');
let serverNow;
let video;
let toasts;
OWP.ui = { updateSyncIndicator: () => {}, showToast: message => toasts.push(message) };
OWP.utils.getVideo = () => video;
OWP.utils.getServerNow = () => serverNow;
OWP.utils.nowMs = () => serverNow;
OWP.utils.isVideoReady = () => true;
OWP.utils.log = () => {};
require('../playback/sync.js');

describe('guest play while the room is paused', () => {
  beforeEach(() => {
    serverNow = 10000;
    toasts = [];
    video = {
      currentTime: 12,
      playbackRate: 1,
      paused: false,
      readyState: 4,
      pause() { this.paused = true; }
    };
    Object.assign(OWP.state, {
      currentVideoElement: null,
      inRoom: true,
      isHost: false,
      isBuffering: false,
      isSyncing: false,
      pendingMediaId: '',
      pendingPlayUntil: 0,
      lastSyncServerTs: 9000,
      lastSyncPosition: 10,
      lastSyncPlayState: 'paused',
      isInitialSync: false,
      syncCooldownUntil: 0,
      syncStatus: 'synced'
    });
  });

  it('pauses the guest again and says why', () => {
    OWP.playback.syncLoop();

    assert.equal(video.paused, true);
    assert.deepEqual(toasts, ['Only the host can control playback']);
  });

  it('leaves a guest who is already paused alone', () => {
    video.paused = true;

    OWP.playback.syncLoop();

    assert.deepEqual(toasts, []);
  });

  it('does not touch the host', () => {
    OWP.state.isHost = true;

    OWP.playback.syncLoop();

    assert.equal(video.paused, false);
  });

  it('waits for the first room state', () => {
    OWP.state.lastSyncServerTs = 0;

    OWP.playback.syncLoop();

    assert.equal(video.paused, false);
  });

  it('only holds a room known to be paused', () => {
    OWP.state.lastSyncPlayState = '';

    OWP.playback.syncLoop();

    assert.equal(video.paused, false);
  });

  it('waits while the room media is still loading', () => {
    OWP.state.pendingMediaId = '0123456789abcdef0123456789abcdef';

    OWP.playback.syncLoop();

    assert.equal(video.paused, false);
  });

  it('does not fight a host play that is about to start', () => {
    OWP.state.pendingPlayUntil = serverNow + 500;

    OWP.playback.syncLoop();

    assert.equal(video.paused, false);
  });

  it('does not fight a room command being applied', () => {
    OWP.state.isSyncing = true;

    OWP.playback.syncLoop();

    assert.equal(video.paused, false);
  });

  it('keeps a guest playing while the room plays', () => {
    OWP.state.lastSyncPlayState = 'playing';
    OWP.state.lastSyncServerTs = serverNow;
    OWP.state.lastSyncPosition = 12;

    OWP.playback.syncLoop();

    assert.equal(video.paused, false);
    assert.deepEqual(toasts, []);
  });
});
