const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const OWP = require('./setup.js');
const { FakeDocument } = require('./fake-dom.js');

require('../utils/video.js');
require('../utils/media.js');
require('../playback/sync.js');

const CURRENT = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const PREVIOUS = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
let sent;

const playerPage = (itemId, hidden = false, readyState = 2) => {
  const page = document.createElement('div');
  page.className = `page${hidden ? ' hide' : ''}`;
  const video = document.createElement('video');
  Object.assign(video, { readyState, src: itemId, removeEventListener: () => {} });
  const title = document.createElement('div');
  title.className = 'osdTitle';
  title.setAttribute('data-id', itemId);
  title.dataset.id = itemId;
  page.append(video, title);
  document.body.appendChild(page);
  return { page, video };
};

describe('visible player readiness integration', () => {
  beforeEach(() => {
    globalThis.document = new FakeDocument();
    delete window.NowPlayingItem;
    OWP.utils.getPlaybackManager = () => null;
    sent = [];
    OWP.actions = { send: (type, payload) => sent.push({ type, payload }) };
    Object.assign(OWP.state, { inRoom: true, roomId: 'room', readyRoomId: '', mediaReadyCleanup: null });
  });

  afterEach(() => {
    OWP.state.mediaReadyCleanup?.();
    OWP.timers.clearScope('media');
  });

  it('uses the visible video and item together despite an older ready hidden video', () => {
    playerPage(PREVIOUS, true);
    const { video } = playerPage(CURRENT);
    let readyVideo;
    OWP.playback.watchReady({ roomId: 'room', mediaId: CURRENT, onReady: v => { readyVideo = v; } });
    assert.equal(readyVideo, video);
    assert.deepEqual(sent, [{ type: 'ready', payload: { room: 'room', media_id: CURRENT } }]);
  });

  it('does not report ready from the hidden video while the visible video is loading', () => {
    playerPage(PREVIOUS, true);
    const { video } = playerPage(CURRENT, false, 0);
    OWP.playback.watchReady({ roomId: 'room', mediaId: CURRENT });
    assert.deepEqual(sent, []);
    video.readyState = 2;
    video.dispatchEvent('canplay');
    assert.equal(sent.length, 1);
  });

  it('does not use an OSD from a different visible page', () => {
    const other = playerPage(PREVIOUS);
    other.video.remove();
    playerPage(CURRENT);
    assert.equal(OWP.utils.getPlayingItemId(), CURRENT);
  });

  it('reports no playing item when all player pages are hidden', () => {
    playerPage(PREVIOUS, true);
    assert.equal(OWP.utils.getVideo(), null);
    assert.equal(OWP.utils.getPlayingItemId(), null);
  });
});
