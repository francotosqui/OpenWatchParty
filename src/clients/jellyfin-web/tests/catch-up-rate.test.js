const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const OWP = require('./setup.js');
let serverNow;
let video;
OWP.ui = { updateSyncIndicator: () => {}, showToast: () => {} };
OWP.utils.getVideo = () => video;
OWP.utils.getServerNow = () => serverNow;
OWP.utils.nowMs = () => serverNow;
OWP.utils.isVideoReady = () => true;
OWP.utils.log = () => {};
OWP.utils.suppress = () => {};
require('../playback/sync.js');

describe('a guest catching up with the host', () => {
  // The host is at 100 s; the guest at 100 s minus `behind`.
  const rateWhen = (behind) => {
    video.currentTime = 100 - behind;
    OWP.playback.syncLoop();
    return Math.round(video.playbackRate * 1000) / 1000;
  };

  beforeEach(() => {
    serverNow = 10000;
    video = { currentTime: 100, playbackRate: 1, paused: false, readyState: 4 };
    Object.assign(OWP.state, {
      currentVideoElement: null,
      inRoom: true,
      isHost: false,
      isBuffering: false,
      isSyncing: false,
      pendingMediaId: '',
      pendingPlayUntil: 0,
      lastSyncServerTs: serverNow,
      lastSyncPosition: 100,
      lastSyncPlayState: 'playing',
      isInitialSync: false,
      syncCooldownUntil: 0,
      syncStatus: 'synced'
    });
  });

  it('speeds up gently, at most 1.15x', () => {
    assert.equal(rateWhen(0.25), 1.075);
    assert.equal(rateWhen(1), 1.15);
    assert.equal(rateWhen(1.9), 1.15);
  });

  it('slows down gently when ahead, at most to 0.90x', () => {
    assert.equal(rateWhen(-0.1), 0.953);
    assert.equal(rateWhen(-0.5), 0.9);
    assert.equal(rateWhen(-1.5), 0.9);
  });

  it('leaves the rate alone in sync, and still seeks from 2 s', () => {
    assert.equal(rateWhen(0.02), 1);
    assert.equal(rateWhen(2), 1);
    assert.equal(video.currentTime, 100);
  });
});
