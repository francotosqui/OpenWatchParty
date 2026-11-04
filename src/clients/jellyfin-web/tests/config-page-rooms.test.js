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

function setup({ tokenResponses = [], getItems } = {}) {
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
      this.closed = true;
      this.readyState = 3;
    }
  }
  const timers = [];
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
    setInterval: () => 0,
    clearInterval: () => {},
    fetch: async (url, options) => {
      fetches.push({ url, options });
      const next = responses.shift() || { status: 200, body: TOKEN };
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
  return { document, page, sockets, timers, fetches, confirms, alerts, byId, receive };
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

  it('stops listening when the page is left', async () => {
    const env = await connected();
    env.page.stop();

    assert.ok(env.socket.closed);
    assert.equal(env.page.socket, null);
  });
});
