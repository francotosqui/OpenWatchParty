import { test } from 'node:test';
import assert from 'node:assert/strict';
import { options, percentile, dockerSample, run } from '../load-session-server.mjs';

test('rejects loads above the real room limit and invalid arguments', () => {
  for (const args of [['--clients', '21'], ['--rooms', '-1'], ['--seconds', 'NaN'], ['--url', 'http://localhost'], ['--unknown', '1'], ['--rooms']]) {
    assert.throws(() => options(args));
  }
  assert.equal(options(['--clients', '20']).clients, 20);
});
test('Docker sampling handles binary and decimal units and rejects missing stats', () => {
  assert.deepEqual(dockerSample('12.5%|32MiB / 512MiB'), { cpu_percent: 12.5, memory_mib: 32 });
  assert.equal(dockerSample('0%|1GiB / 2GiB').memory_mib, 1024);
  assert.throws(() => dockerSample('unavailable'));
});
test('reports percentiles without changing samples or inventing empty results', () => {
  const values = [100, 2, 3, 1];
  assert.equal(percentile(values, .5), 2);
  assert.equal(percentile(values, .99), 100);
  assert.equal(percentile([], .99), null);
  assert.deepEqual(values, [100, 2, 3, 1]);
});

test('load probes complete with timestamp-only pongs, even when peers share a timestamp', async () => {
  const original = { WebSocket: globalThis.WebSocket, fetch: globalThis.fetch, now: Date.now };
  const peers = new Set();
  let rooms = 0;
  class Peer extends EventTarget {
    static OPEN = 1;
    readyState = Peer.OPEN;
    room = null;
    constructor() {
      super();
      peers.add(this);
      this.receive({ type: 'client_hello' });
    }
    receive(message) {
      queueMicrotask(() => this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(message) })));
    }
    send(text) {
      const message = JSON.parse(text);
      switch (message.type) {
        case 'auth': this.receive({ type: 'auth_success' }); break;
        case 'create_room':
          this.room = `room-${++rooms}`;
          this.receive({ type: 'room_state', room: this.room });
          break;
        case 'join_room':
          this.room = message.room;
          this.receive({ type: 'room_state', room: this.room });
          break;
        case 'ping':
          assert.deepEqual(Object.keys(message.payload), ['client_ts']);
          assert(Number.isSafeInteger(message.payload.client_ts) && message.payload.client_ts >= 0);
          this.receive({ type: 'pong', payload: { client_ts: message.payload.client_ts } });
          break;
        case 'chat_message':
          for (const peer of peers) {
            if (peer.room === this.room) peer.receive({ type: 'chat_message', payload: message.payload });
          }
          break;
      }
    }
    close() {
      this.readyState = 3;
      peers.delete(this);
      this.dispatchEvent(new Event('close'));
    }
  }
  try {
    globalThis.WebSocket = Peer;
    Date.now = () => 1_700_000_000_000;
    globalThis.fetch = async () => ({
      ok: true,
      text: async () => `owp_send_failures_total 0\nowp_connections_active ${peers.size}\nowp_rooms_active ${rooms}\n`,
    });
    const report = await run(options(['--rooms', '1', '--clients', '2', '--seconds', '1']));
    assert.equal(report.passed, true);
    assert.equal(report.ping.samples, 2);
    assert.equal(report.chat.delivered, 4);
    assert.equal(report.outstanding_probes, 0);
  } finally {
    globalThis.WebSocket = original.WebSocket;
    globalThis.fetch = original.fetch;
    Date.now = original.now;
  }
});
