const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { FakeDocument } = require('./fake-dom');

const configPage = fs.readFileSync(
  path.join(__dirname, '..', '..', '..', 'plugins', 'jellyfin', 'OpenWatchParty', 'Web', 'configPage.html'),
  'utf8'
);
const script = configPage.match(/<script type="text\/javascript">([\s\S]*?)<\/script>/)[1];

const MINUTE = 60_000;
const T = 1_700_000_000_000;
const TOKEN = { token: 'tok', expires_in: 300, session_server_url: 'wss://media.example/ws', protocol_version: 1 };

const person = name => ({ user_id: 'u-' + name.toLowerCase(), name });
const room = overrides => ({
  room_id: 'r1',
  name: 'Movie night',
  opened_at_ms: T - 65 * MINUTE,
  owner: person('Ana'),
  participants: [person('Ana'), person('Luz'), person('Pablo')],
  media_id: null,
  playing: true,
  ...overrides
});
const snapshot = rooms => ({ server_now_ms: T, rooms });
const flush = async () => {
  for (let i = 0; i < 6; i += 1) await new Promise(resolve => setImmediate(resolve));
};

function setup({ tokenResponses = [], getItems, fetchToken } = {}) {
  const document = new FakeDocument();
  document.documentElement.lang = 'en';
  for (const id of ['ActiveRoomsLive', 'ActiveRoomsSummary', 'ActiveRoomsList']) {
    const element = document.createElement(id === 'ActiveRoomsList' ? 'div' : 'span');
    element.id = id;
    document.body.appendChild(element);
  }
  const sockets = [];
  class FakeWebSocket {
    constructor(url) {
      this.url = url;
      this.sent = [];
      this.readyState = 1;
      sockets.push(this);
    }

    send(data) { this.sent.push(JSON.parse(data)); }

    close() {
      // Like a browser, closing fires onclose.
      if (this.closed) return;
      this.closed = true;
      this.readyState = 3;
      if (this.onclose) this.onclose();
    }
  }
  const timers = [];
  const intervals = [];
  const fetches = [];
  const responses = [...tokenResponses];
  const confirms = [];
  const alerts = [];
  const context = vm.createContext({
    console,
    Map,
    Array,
    Math,
    atob,
    navigator: { userAgent: 'test-agent', language: 'en-US' },
    window: { location: { origin: 'https://media.example', protocol: 'https:', hostname: 'media.example' } },
    document,
    WebSocket: FakeWebSocket,
    setTimeout: (fn, delay) => {
      timers.push({ fn, delay });
      return timers.length;
    },
    clearTimeout: () => {},
    setInterval: (fn, delay) => { intervals.push({ fn, delay }); return intervals.length; },
    clearInterval: () => {},
    fetch: async (url, options) => {
      fetches.push({ url, options });
      const next = fetchToken ? await fetchToken() : responses.shift() || { status: 200, body: TOKEN };
      return { ok: next.status >= 200 && next.status < 300, status: next.status, json: async () => next.body };
    },
    ApiClient: {
      accessToken: () => 'jelly-token',
      getUrl: name => '/' + name,
      getCurrentUserId: () => 'me',
      getItems: getItems || (async () => ({ Items: [] }))
    },
    Dashboard: {
      confirm: (options, title, callback) => confirms.push({ options, callback }),
      alert: message => alerts.push(message)
    },
    $: () => ({ on: () => {} })
  });
  vm.runInContext(script, context, { filename: 'configPage.html' });
  const page = context.OpenWatchPartyActiveRooms;
  const byId = id => document.getElementById(id);
  const receive = (socket, message) => socket.onmessage({ data: JSON.stringify(message) });
  return { document, page, sockets, timers, intervals, fetches, confirms, alerts, byId, receive };
}

async function connected(options) {
  const env = setup(options);
  env.page.start();
  await flush();
  const socket = env.sockets[0];
  env.receive(socket, { type: 'client_hello', payload: { client_id: 'c1' } });
  env.receive(socket, { type: 'auth_success', payload: { user_name: 'Admin', features: ['room_dashboard'] } });
  return { ...env, socket };
}

describe('configuration page active rooms', () => {
  it('draws each room with its owner, people, state and time', () => {
    const { page, byId } = setup();
    page.render(snapshot([
      room(),
      room({
        room_id: 'r2',
        name: 'Luz room',
        opened_at_ms: T - 12 * MINUTE,
        owner: person('Luz'),
        participants: [person('Luz'), person('Martin')],
        playing: false
      })
    ]), page.now());

    assert.equal(byId('ActiveRoomsSummary').textContent, '2 rooms · 5 people');
    const rows = byId('ActiveRoomsList').children;
    assert.equal(rows.length, 2);
    for (const text of ['Movie night', 'Owner: Ana · 3 people · Ana, Luz, Pablo', 'Playing', 'open for 1 h 05 min']) {
      assert.ok(rows[0].textContent.includes(text), text);
    }
    for (const text of ['Luz room', 'Owner: Luz · 2 people · Luz, Martin', 'Paused', 'open for 12 min']) {
      assert.ok(rows[1].textContent.includes(text), text);
    }
  });

  it("shows the server's default room name in the page language", () => {
    const { page, byId, document } = setup();
    document.documentElement.lang = 'es';
    page.render(snapshot([room({ name: "Ana's room" }), room({ room_id: 'r2', name: "Luz's room by Ana" })]), page.now());

    const rows = byId('ActiveRoomsList').children;
    assert.ok(rows[0].textContent.includes('Sala de Ana'));
    assert.ok(rows[1].textContent.includes("Luz's room by Ana"));
  });

  it('counts one room and one person in the singular', () => {
    const { page, byId } = setup();
    page.render(snapshot([room({ participants: [person('Ana')] })]), page.now());

    assert.equal(byId('ActiveRoomsSummary').textContent, '1 room · 1 person');
    assert.ok(byId('ActiveRoomsList').textContent.includes('Owner: Ana · 1 person · Ana'));
  });

  it('says when no room is open', () => {
    const { page, byId } = setup();
    page.render(snapshot([room()]), page.now());
    page.render(snapshot([]), page.now());

    assert.equal(byId('ActiveRoomsSummary').textContent, 'No rooms open right now');
    assert.equal(byId('ActiveRoomsList').children.length, 0);
  });

  it('shows names with markup as text', () => {
    const { page, byId } = setup();
    page.render(snapshot([room({
      name: '<img src=x onerror=alert(1)>',
      owner: person('<b>x</b>'),
      participants: [person('<b>x</b>')]
    })]), page.now());

    const list = byId('ActiveRoomsList');
    assert.ok(list.textContent.includes('<img src=x onerror=alert(1)>'));
    assert.ok(list.textContent.includes('<b>x</b>'));
    assert.equal(list.querySelectorAll('b').length, 0);
    assert.equal(list.querySelectorAll('img').length, 0);
  });

  it('shows the title once the library answers', async () => {
    const { page, byId } = setup({ getItems: async () => ({ Items: [{ Id: 'm1', Name: 'Wing It!' }] }) });
    page.render(snapshot([room({ media_id: 'm1' })]), page.now());
    await flush();

    assert.ok(byId('ActiveRoomsList').textContent.includes('“Wing It!”'));
  });

  it('leaves the title out when the library lookup fails', async () => {
    const { page, byId } = setup({ getItems: async () => { throw new Error('offline'); } });
    page.render(snapshot([room({ media_id: 'm1' })]), page.now());
    await flush();

    const text = byId('ActiveRoomsList').textContent;
    assert.ok(text.includes('open for 1 h 05 min'));
    assert.ok(!text.includes('“'));
  });

  it('connects with the administrator token and declares the dashboard feature', async () => {
    const { socket, fetches } = await connected();

    assert.equal(fetches[0].url, '/OpenWatchParty/AdminToken');
    assert.equal(fetches[0].options.headers.Authorization, 'MediaBrowser Token="jelly-token"');
    assert.equal(socket.url, 'wss://media.example/ws');
    assert.deepEqual(socket.sent[0].type, 'auth');
    assert.deepEqual(socket.sent[0].payload, { token: 'tok', protocol_version: 1, features: ['room_dashboard'] });
  });

  it('asks before closing and sends admin_close_room', async () => {
    const env = await connected();
    env.receive(env.socket, { type: 'admin_rooms', payload: snapshot([room()]) });
    const button = env.byId('ActiveRoomsList').querySelector('button');
    button.click();

    assert.equal(env.confirms.length, 1);
    assert.deepEqual({ ...env.confirms[0].options }, {
      title: 'Close room',
      text: 'Close “Movie night”? The 3 people inside leave the room and see “The server administrator closed the room”.',
      confirmText: 'Close room',
      primary: 'delete'
    });
    const sentBefore = env.socket.sent.length;
    env.confirms[0].callback(false);
    assert.equal(env.socket.sent.length, sentBefore);
    env.confirms[0].callback(true);
    const last = env.socket.sent.at(-1);
    assert.equal(last.type, 'admin_close_room');
    assert.deepEqual({ ...last.payload }, { room_id: 'r1' });
  });

  it('escapes room names for the HTML text accepted by Jellyfin confirmation dialogs', async () => {
    const env = await connected();
    env.page.confirmClose(room({ name: '<b>Ana & Luz</b> &lt;img&gt;' }));

    assert.equal(env.confirms[0].options.text,
      'Close “&lt;b&gt;Ana &amp; Luz&lt;/b&gt; &amp;lt;img&amp;gt;”? The 3 people inside leave the room and see “The server administrator closed the room”.');
  });

  it('explains an old session server', async () => {
    const env = setup();
    env.page.start();
    await flush();
    const socket = env.sockets[0];
    env.receive(socket, { type: 'client_hello', payload: { client_id: 'c1' } });
    env.receive(socket, { type: 'auth_success', payload: { user_name: 'Admin', features: [] } });

    assert.equal(env.byId('ActiveRoomsSummary').textContent, "The session server doesn't support this function; update it");
    assert.ok(socket.closed);
  });

  it('renews the administrator token before it expires', async () => {
    const env = await connected({ tokenResponses: [{ status: 200, body: TOKEN }, { status: 200, body: { ...TOKEN, token: 'tok2' } }] });
    const renewal = env.timers.find(timer => timer.delay === 240_000);
    assert.ok(renewal, 'a renewal is scheduled 60 s before the token expires');

    renewal.fn();
    await flush();

    assert.equal(env.fetches.length, 2);
    assert.equal(env.fetches[1].url, '/OpenWatchParty/AdminToken');
    const last = env.socket.sent.at(-1);
    assert.equal(last.type, 'auth');
    assert.equal(last.payload.token, 'tok2');
  });

  it('retries a failed token renewal before the token expires', async () => {
    const env = await connected({ tokenResponses: [
      { status: 200, body: TOKEN },
      { status: 503, body: {} },
      { status: 200, body: { ...TOKEN, token: 'tok3' } }
    ] });
    env.timers.find(timer => timer.delay === 240_000).fn();
    await flush();
    const retry = env.timers.find(timer => timer.delay === 30_000);
    assert.ok(retry, 'a failed renewal is retried in 30 s');

    retry.fn();
    await flush();

    assert.equal(env.fetches.length, 3);
    const last = env.socket.sent.at(-1);
    assert.equal(last.type, 'auth');
    assert.equal(last.payload.token, 'tok3');
  });

  it('explains a session server running without authentication, and stops retrying', async () => {
    const env = setup();
    env.page.start();
    await flush();
    const socket = env.sockets[0];
    env.receive(socket, { type: 'client_hello', payload: { client_id: 'c1' } });
    env.receive(socket, { type: 'error', payload: { code: 'AUTHENTICATION_REQUIRED', message: 'Administrator access requires authentication on the session server' } });

    assert.equal(
      env.byId('ActiveRoomsSummary').textContent,
      "The session server runs without authentication; administrator access needs it to share the plugin's JWT secret or pairing key"
    );
    assert.ok(socket.closed);
    assert.ok(!env.timers.some(timer => timer.delay === 10_000), 'no pointless retry');
  });

  it('explains that authentication is required', async () => {
    const env = setup({
      tokenResponses: [{ status: 409, body: { error: 'Administrator access requires authentication', auth_required: true } }]
    });
    env.page.start();
    await flush();

    assert.equal(env.byId('ActiveRoomsSummary').textContent, 'Requires authentication (JWT secret or pairing key)');
    assert.equal(env.sockets.length, 0);
  });

  it('reports a room that is being saved', async () => {
    const env = await connected();
    env.receive(env.socket, { type: 'error', payload: { code: 'ROOM_SAVE_IN_PROGRESS', message: 'The room is being saved' } });

    assert.deepEqual(env.alerts, ['The room is being saved; try again in a moment']);
  });

  it('ignores an old token fetch after leaving and returning to the page', async () => {
    const pending = [];
    const env = setup({ fetchToken: () => new Promise(resolve => pending.push(resolve)) });
    env.page.start();
    env.page.stop();
    env.page.start();
    pending[1]({ status: 200, body: TOKEN });
    await flush();
    pending[0]({ status: 200, body: TOKEN });
    await flush();

    assert.equal(env.sockets.length, 1);
    env.page.stop();
    assert.ok(env.sockets.every(socket => socket.closed));
  });

  it('ignores a renewal from the previous connection after reconnecting', async () => {
    const pending = [];
    const env = await connected();
    env.page.fetchToken = () => new Promise(resolve => pending.push(resolve));
    const renewal = env.page.refresh();
    env.page.stop();
    env.page.start();
    pending[1]({ ok: true, body: TOKEN });
    await flush();
    const socket = env.sockets.at(-1);
    env.receive(socket, { type: 'client_hello' });
    const sentBefore = socket.sent.length;
    pending[0]({ ok: true, body: { ...TOKEN, token: 'stale-renewal' } });
    await renewal;

    assert.equal(socket.sent.length, sentBefore);
    assert.equal(env.page.token.token, 'tok');
  });

  it('keeps a connection problem visible when the age clock updates', async () => {
    const env = await connected();
    env.receive(env.socket, { type: 'admin_rooms', payload: snapshot([room()]) });
    env.page.showProblem('roomsAuthRequired');
    env.intervals.find(timer => timer.delay === 30000).fn();

    assert.equal(env.byId('ActiveRoomsSummary').textContent, 'Requires authentication (JWT secret or pairing key)');
    assert.equal(env.byId('ActiveRoomsList').children.length, 0);
  });

  it('says the session server is unreachable when the connection drops, and clears the rooms', async () => {
    const env = await connected();
    env.receive(env.socket, { type: 'admin_rooms', payload: snapshot([room()]) });
    assert.equal(env.byId('ActiveRoomsList').children.length, 1);

    env.socket.onclose();

    assert.equal(env.byId('ActiveRoomsSummary').textContent, "Couldn't connect to the session server");
    assert.equal(env.byId('ActiveRoomsList').children.length, 0);
    assert.ok(env.timers.some(timer => timer.delay === 10_000), 'a retry is scheduled');
  });

  it('explains a refused administrator token', async () => {
    const env = await connected();
    env.receive(env.socket, { type: 'error', payload: { code: 'AUTHENTICATION_FAILED', message: 'Authentication failed' } });

    assert.equal(
      env.byId('ActiveRoomsSummary').textContent,
      'The session server refused the administrator token; check that it shares the JWT secret or pairing key with the plugin'
    );
    assert.ok(env.socket.closed);
  });

  it('updates the open time every 30 s without redrawing the rooms', async () => {
    const env = await connected();
    env.receive(env.socket, { type: 'admin_rooms', payload: snapshot([room()]) });
    const row = env.byId('ActiveRoomsList').children[0];
    assert.ok(row.textContent.includes('open for 1 h 05 min'));
    const receivedAt = env.page.receivedAt;
    env.page.now = () => receivedAt + 60_000;

    env.intervals.find(timer => timer.delay === 30_000).fn();

    const after = env.byId('ActiveRoomsList').children[0];
    assert.equal(after, row, 'the same row stays on the page');
    assert.ok(after.textContent.includes('open for 1 h 06 min'));
  });

  it("keeps keyboard focus on a room's close button when the list changes", async () => {
    const env = await connected();
    globalThis.document = env.document;
    try {
      env.receive(env.socket, { type: 'admin_rooms', payload: snapshot([room(), room({ room_id: 'r2', name: 'Other' })]) });
      env.byId('ActiveRoomsList').querySelector('[data-room-id="r2"] button').focus();

      env.receive(env.socket, { type: 'admin_rooms', payload: snapshot([room({ room_id: 'r2', name: 'Other' })]) });

      const focused = env.document.activeElement;
      assert.equal(focused?.tagName, 'BUTTON');
      assert.ok(env.byId('ActiveRoomsList').contains(focused), 'the focused button is on the page');
      assert.equal(focused.closest('.owp-room').getAttribute('data-room-id'), 'r2');
    } finally {
      delete globalThis.document;
    }
  });

  it('announces the summary, not every redraw of the list', () => {
    assert.match(configPage, /id="ActiveRoomsSummary"[^>]*aria-live="polite"/);
    assert.doesNotMatch(configPage, /id="ActiveRoomsList"[^>]*aria-live/);
  });

  it('stops listening when the page is left', async () => {
    const env = await connected();
    env.page.stop();

    assert.ok(env.socket.closed);
    assert.equal(env.page.socket, null);
  });
});
