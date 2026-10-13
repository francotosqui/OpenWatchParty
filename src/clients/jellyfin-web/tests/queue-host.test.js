const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const OWP = require('./setup.js');

let sent = [];
let playing = '';
let itemRequests = 0;
let segments = {};
let segmentRequests = 0;
OWP.actions = { send: (type, payload) => sent.push({ type, payload }) };
OWP.utils.log = () => {};
OWP.utils.getPlayingItemId = () => playing;

// A series of nine episodes, the fourth missing from the library, and a movie.
const series = Array.from({ length: 9 }, (_, i) => ({
  Id: `e${i + 1}`,
  Name: `Ep ${i + 1}`,
  Type: 'Episode',
  SeriesId: 'show',
  ParentIndexNumber: 1,
  IndexNumber: i + 1,
  LocationType: i === 3 ? 'Virtual' : 'FileSystem'
}));
const library = Object.fromEntries([...series, { Id: 'm1', Name: 'Movie', Type: 'Movie' }].map(item => [item.Id, item]));

globalThis.ApiClient = {
  getCurrentUserId: () => 'user',
  getItem: async (userId, id) => {
    itemRequests++;
    return library[id];
  },
  getUrl: (path, params) => ({ path, params }),
  getJSON: async ({ path, params }) => {
    if (path === 'Shows/show/Episodes') {
      const start = series.findIndex(episode => episode.Id === params.startItemId);
      return { Items: series.slice(start, start + params.limit) };
    }
    segmentRequests++;
    return { Items: segments[path.replace('MediaSegments/', '')] || [] };
  }
};
require('../app/queue.js');

const settle = () => new Promise(resolve => setTimeout(resolve, 0));
const item = id => ({ id, title: `S1:E${id.slice(1)} · Ep ${id.slice(1)}` });
const ids = message => message.payload.items.map(entry => entry.id);
const countdowns = () => sent.filter(message => message.type === 'queue_countdown').map(message => message.payload.start);
const video = (currentTime, { paused = false, ended = false, duration = NaN } = {}) => ({ currentTime, paused, ended, duration });

let room = 0;
const enterRoom = (fields = {}) => {
  room++;
  Object.assign(OWP.state, {
    inRoom: true,
    isHost: true,
    serverFeatures: ['media_queue'],
    roomId: `room-${room}`,
    roomMediaId: 'e1',
    queueItems: [],
    queueCurrent: null,
    queueCountdownUntil: 0
  }, fields);
};

describe('host queue', () => {
  beforeEach(() => {
    sent = [];
    playing = '';
    itemRequests = 0;
    segments = {};
    segmentRequests = 0;
  });

  it('fills an empty queue with the room episode and the next five in the library', async () => {
    enterRoom();
    OWP.queue.refresh();
    await settle();
    const adds = sent.filter(message => message.type === 'queue_add');
    assert.equal(adds.length, 1);
    assert.deepEqual(adds[0].payload.items, ['e1', 'e2', 'e3', 'e5', 'e6', 'e7'].map(item));
  });

  it('tops up from the episode it added last, so a removed one stays out', async () => {
    enterRoom();
    OWP.queue.refresh();
    await settle();
    sent = [];
    // The room moved on to e2 and the host removed e7.
    Object.assign(OWP.state, { roomMediaId: 'e2', queueItems: ['e1', 'e2', 'e3', 'e5', 'e6'].map(item) });
    OWP.queue.refresh();
    await settle();
    assert.deepEqual(sent.map(ids), [['e8', 'e9']]);
  });

  it('asks the library once per starting point', async () => {
    enterRoom({ roomMediaId: 'e9' });
    OWP.queue.refresh();
    await settle();
    OWP.queue.refresh();
    await settle();
    assert.equal(itemRequests, 1);
    assert.deepEqual(sent.map(ids), [['e9']]);
  });

  it('leaves a queue with five episodes ahead alone', async () => {
    enterRoom({ queueItems: ['e1', 'e2', 'e3', 'e5', 'e6', 'e7'].map(item) });
    OWP.queue.refresh();
    await settle();
    assert.equal(itemRequests, 0);
    assert.deepEqual(sent, []);
  });

  it('does nothing for a movie, a guest or a server without the queue', async () => {
    enterRoom({ roomMediaId: 'm1' });
    OWP.queue.refresh();
    enterRoom({ isHost: false });
    OWP.queue.refresh();
    enterRoom({ serverFeatures: [] });
    OWP.queue.refresh();
    enterRoom({ queueItems: [item('e5')] });
    OWP.queue.refresh();
    await settle();
    assert.deepEqual(sent, []);
  });

  // Credits are remembered per item, so each test below plays its own.
  it('counts down from the credits and stops when the room pauses or goes back', async () => {
    segments = { e3: [{ Type: 'Intro', StartTicks: 0 }, { Type: 'Outro', StartTicks: 1200 * 10000000 }] };
    enterRoom({ roomMediaId: 'e3', queueItems: ['e1', 'e2', 'e3', 'e5', 'e6', 'e7'].map(item) });
    playing = 'e3';
    OWP.queue.refresh();
    OWP.queue.refresh();
    await settle();
    assert.equal(segmentRequests, 1);

    OWP.queue.onVideoTime(video(1199));
    OWP.queue.onVideoTime(video(1200));
    OWP.queue.onVideoTime(video(1201));
    assert.deepEqual(countdowns(), [true]);

    // The server's queue_state answers each request.
    Object.assign(OWP.state, { queueCountdownUntil: 1 });
    OWP.queue.refresh();
    OWP.queue.onVideoTime(video(1202, { paused: true }));
    Object.assign(OWP.state, { queueCountdownUntil: 0 });
    OWP.queue.refresh();
    OWP.queue.onVideoTime(video(1202, { paused: true }));
    OWP.queue.onVideoTime(video(1203));
    Object.assign(OWP.state, { queueCountdownUntil: 1 });
    OWP.queue.refresh();
    OWP.queue.onVideoTime(video(900));
    assert.deepEqual(countdowns(), [true, false, true, false]);
  });

  it('counts down again when a new next item replaces a removed one', async () => {
    segments = { e7: [{ Type: 'Outro', StartTicks: 1200 * 10000000 }] };
    enterRoom({ roomMediaId: 'e7', queueItems: ['e6', 'e7', 'e8'].map(item) });
    playing = 'e7';
    OWP.queue.refresh();
    await settle();
    OWP.queue.onVideoTime(video(1250));
    // The host removes e8, which ends the countdown, and e9 is queued after.
    Object.assign(OWP.state, { queueItems: ['e6', 'e7'].map(item), queueCountdownUntil: 0 });
    OWP.queue.refresh();
    OWP.queue.onVideoTime(video(1251));
    Object.assign(OWP.state, { queueItems: ['e6', 'e7', 'e9'].map(item) });
    OWP.queue.refresh();
    OWP.queue.onVideoTime(video(1252));
    assert.deepEqual(countdowns(), [true, true]);
  });

  it('does not count down again on an item whose countdown the host cancelled', async () => {
    segments = { e5: [{ Type: 'Outro', StartTicks: 1200 * 10000000 }] };
    enterRoom({ roomMediaId: 'e5', queueItems: ['e1', 'e2', 'e3', 'e5', 'e6', 'e7'].map(item), queueCountdownUntil: 1 });
    playing = 'e5';
    OWP.queue.refresh();
    await settle();
    OWP.queue.cancelCountdown();
    Object.assign(OWP.state, { queueCountdownUntil: 0 });
    OWP.queue.refresh();
    OWP.queue.onVideoTime(video(1250));
    assert.deepEqual(countdowns(), [false]);
  });

  // Jellyfin closes the player at the end, so the room must move on before it.
  it('counts down 15 seconds before the end of an item without credits, and only toward a next item', async () => {
    enterRoom({ roomMediaId: 'e6', queueItems: ['e1', 'e2', 'e3', 'e5', 'e6', 'e7'].map(item) });
    playing = 'e6';
    OWP.queue.refresh();
    await settle();
    // Nothing to go by until the video knows its duration.
    OWP.queue.onVideoTime(video(1385));
    assert.deepEqual(countdowns(), []);
    OWP.queue.onVideoTime(video(1384, { duration: 1400 }));
    OWP.queue.onVideoTime(video(1385, { duration: 1400 }));
    assert.deepEqual(countdowns(), [true]);

    // The browser pauses at the end: the countdown keeps going.
    Object.assign(OWP.state, { queueCountdownUntil: 1 });
    OWP.queue.refresh();
    OWP.queue.onVideoTime(video(1400, { duration: 1400, paused: true, ended: true }));
    assert.deepEqual(countdowns(), [true]);

    sent = [];
    enterRoom({ roomMediaId: 'e9', queueItems: ['e8', 'e9'].map(item) });
    playing = 'e9';
    OWP.queue.refresh();
    await settle();
    OWP.queue.onVideoTime(video(1390, { duration: 1400 }));
    assert.deepEqual(countdowns(), []);
  });

  it('counts down before credits shorter than the countdown', async () => {
    segments = { e8: [{ Type: 'Outro', StartTicks: 1395 * 10000000 }] };
    enterRoom({ roomMediaId: 'e8', queueItems: ['e7', 'e8', 'e9'].map(item) });
    playing = 'e8';
    OWP.queue.refresh();
    await settle();
    OWP.queue.onVideoTime(video(1384, { duration: 1400 }));
    OWP.queue.onVideoTime(video(1385, { duration: 1400 }));
    assert.deepEqual(countdowns(), [true]);
  });

  it('waits for the room item to play before counting down', async () => {
    enterRoom({ roomMediaId: 'e2', queueItems: ['e1', 'e2', 'e3', 'e5', 'e6', 'e7'].map(item) });
    playing = 'e1';
    OWP.queue.refresh();
    await settle();
    OWP.queue.onVideoTime(video(1390, { duration: 1400 }));
    assert.deepEqual(countdowns(), []);
  });
});
