const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const OWP = require('./setup.js');
let resolveItem;
let playCalls = 0;
let getItemCalls = 0;
let getItemImpl = () => new Promise(resolve => { resolveItem = resolve; });

OWP.state.inRoom = true;
OWP.state.joiningItemId = '';
OWP.state.playbackRequestAttempt = 0;
OWP.utils.getCurrentItemId = () => '';
OWP.utils.getVideo = () => null;
OWP.utils.getPlaybackManager = () => ({
  play: () => { playCalls++; }
});
globalThis.ApiClient = {
  getCurrentUserId: () => 'user',
  getItem: (...args) => {
    getItemCalls++;
    return getItemImpl(...args);
  }
};

require('../ws/send.js');
require('../playback/play.js');

describe('playback request invalidation', () => {
  it('does not start media after room state was reset', async () => {
    OWP.playback.ensurePlayback('item-a');
    assert.equal(OWP.state.joiningItemId, 'item-a');

    OWP.actions.resetRoomState();
    resolveItem({ Id: 'item-a' });
    await new Promise(resolve => setImmediate(resolve));

    assert.equal(playCalls, 0);
    assert.equal(OWP.state.inRoom, false);
    assert.equal(OWP.state.joiningItemId, '');
  });

  it('invalidates a scheduled retry before entering another room', async () => {
    OWP.state.inRoom = true;
    OWP.state.joiningItemId = '';
    OWP.state.playbackRequestAttempt = 0;
    getItemCalls = 0;
    getItemImpl = () => Promise.reject(new Error('temporary failure'));
    let scheduledRetry;
    const realSetTimeout = globalThis.setTimeout;
    globalThis.setTimeout = callback => {
      scheduledRetry = callback;
      return 1;
    };

    try {
      OWP.playback.ensurePlayback('old-item');
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(typeof scheduledRetry, 'function');
      assert.equal(getItemCalls, 1);

      OWP.actions.resetRoomState();
      OWP.state.inRoom = true;
      scheduledRetry();

      assert.equal(getItemCalls, 1);
    } finally {
      globalThis.setTimeout = realSetTimeout;
    }
  });
  for (const failure of ['missing user', 'item lookup', 'playback']) {
    it(`bounds ${failure} retries and retains the same request generation`, async () => {
      const originalTimer = OWP.timers.setTimeout;
      const originalUser = globalThis.ApiClient.getCurrentUserId;
      const originalManager = OWP.utils.getPlaybackManager;
      const retries = [];
      const generations = [];
      OWP.state.inRoom = true;
      OWP.state.joiningItemId = '';
      OWP.state.playbackRequestAttempt = 10;
      globalThis.ApiClient.getCurrentUserId = () => failure === 'missing user' ? '' : 'user';
      getItemCalls = 0;
      getItemImpl = async () => {
        if (failure === 'item lookup') throw new Error('lookup failed');
        return { Id: 'item-a' };
      };
      OWP.utils.getPlaybackManager = () => ({ play: async () => { throw new Error('play failed'); } });
      OWP.timers.setTimeout = (callback, delay, scope) => {
        assert.equal(delay, 500);
        assert.equal(scope, 'media');
        generations.push(OWP.state.playbackRequestAttempt);
        retries.push(callback);
        return {};
      };
      try {
        assert.equal(await OWP.playback.ensurePlayback('item-a'), false);
        for (let attempt = 0; attempt < 5; attempt++) {
          assert.equal(retries.length, 1);
          await retries.shift()();
        }
        assert.equal(retries.length, 0);
        assert.deepEqual(generations, [11, 11, 11, 11, 11]);
        assert.equal(OWP.state.playbackRequestAttempt, 11);
        assert.equal(OWP.state.joiningItemId, '');
        assert.equal(getItemCalls, failure === 'missing user' ? 0 : 6);
      } finally {
        OWP.timers.setTimeout = originalTimer;
        globalThis.ApiClient.getCurrentUserId = originalUser;
        OWP.utils.getPlaybackManager = originalManager;
      }
    });
  }

});
