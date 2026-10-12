#!/usr/bin/env node
// Node 22+; no npm dependencies. Run only against a disposable test server.
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execute = promisify(execFile);

export function options(args) {
  const result = { url: 'ws://127.0.0.1:19000/ws', rooms: 10, clients: 5, seconds: 30, container: null };
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i]?.replace(/^--/, '');
    if (!Object.hasOwn(result, key) || args[i + 1] === undefined) throw new Error('Use --url --rooms --clients --seconds');
    result[key] = ['url', 'container'].includes(key) ? args[i + 1] : Number(args[i + 1]);
  }
  const url = new URL(result.url);
  if (!['ws:', 'wss:'].includes(url.protocol)) throw new Error('URL must use ws:// or wss://');
  for (const [key, max] of [['rooms', 1000], ['clients', 20], ['seconds', 3600]]) {
    if (!Number.isInteger(result[key]) || result[key] < 1 || result[key] > max) throw new Error(`${key} must be 1..${max}`);
  }
  return result;
}

export function dockerSample(text) {
  const [cpu, memory] = text.trim().split('|');
  const match = memory?.match(/^([\d.]+)\s*(B|KiB|MiB|GiB|kB|MB|GB)\s*\//);
  const scales = { B: 1, KiB: 1024, MiB: 1024 ** 2, GiB: 1024 ** 3, kB: 1000, MB: 1000 ** 2, GB: 1000 ** 3 };
  const percent = Number(cpu?.replace('%', ''));
  if (!match || !Number.isFinite(percent)) throw new Error('Invalid Docker stats output');
  return { cpu_percent: percent, memory_mib: Number(match[1]) * scales[match[2]] / 1024 ** 2 };
}

export function percentile(samples, fraction) {
  if (!samples.length) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  return Number(sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)].toFixed(3));
}

export async function run(config) {
  const sockets = [];
  const groups = [];
  const pending = new Map();
  const chatLatency = [];
  const pingLatency = [];
  let sent = 0, received = 0, expectedChat = 0, deliveredChat = 0, errors = 0, unexpectedCloses = 0;
  let measuring = false, closing = false, sequence = 0;
  let sampling = false, sampleTask;
  const resources = [];
  let metricsBefore;
  const http = new URL(config.url);
  http.protocol = http.protocol === 'ws:' ? 'http:' : 'https:';
  http.pathname = '/metrics';
  async function metrics() {
    const response = await fetch(http, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error(`Metrics unavailable: HTTP ${response.status}`);
    const text = await response.text();
    return Object.fromEntries(['owp_send_failures_total', 'owp_connections_active', 'owp_rooms_active'].map(name => {
      const match = text.match(new RegExp(`^${name} ([0-9.e+-]+)$`, 'm'));
      if (!match) throw new Error(`Missing metric ${name}`);
      return [name, Number(match[1])];
    }));
  }
  function send(client, type, payload, room = client.room) {
    if (client.socket.readyState !== WebSocket.OPEN) throw new Error('Connection closed during load');
    client.socket.send(JSON.stringify({ type, ...(room ? { room } : {}), payload, ts: Date.now() }));
    if (measuring) sent++;
  }
  async function connect(index) {
    const client = { socket: new WebSocket(config.url), room: null, waits: [] };
    sockets.push(client);
    function wait(type) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${type}`)), 10_000);
        client.waits.push({ type, resolve: message => { clearTimeout(timer); resolve(message); }, reject: error => { clearTimeout(timer); reject(error); } });
      });
    }
    client.wait = wait;
    const hello = wait('client_hello');
    client.socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (measuring) received++;
      if (message.type === 'error') {
        errors++;
        for (const waiter of client.waits.splice(0)) waiter.reject(new Error(`Server error: ${message.payload?.code}`));
      }
      const i = client.waits.findIndex(waiter => waiter.type === message.type);
      if (i >= 0) client.waits.splice(i, 1)[0].resolve(message);
      const key = message.type === 'chat_message' ? message.payload?.text : message.type === 'pong' ? message.payload?.probe : null;
      const probe = pending.get(key);
      if (probe && !probe.clients.has(index)) {
        probe.clients.add(index);
        const elapsed = performance.now() - probe.start;
        if (message.type === 'chat_message') { chatLatency.push(elapsed); deliveredChat++; }
        else pingLatency.push(elapsed);
        if (probe.clients.size === probe.expected) pending.delete(key);
      }
    });
    client.socket.addEventListener('close', () => {
      if (!closing) unexpectedCloses++;
      for (const waiter of client.waits.splice(0)) waiter.reject(new Error('Connection closed'));
    });
    client.socket.addEventListener('error', () => {
      for (const waiter of client.waits.splice(0)) waiter.reject(new Error('WebSocket connection failed'));
    });
    await hello;
    const auth = wait('auth_success');
    send(client, 'auth', { user_id: `load-${index}`, user_name: `Load ${index}`, protocol_version: 1, features: ['host_transfer'] });
    await auth;
    return client;
  }
  try {
    const initial = await metrics();
    if (initial.owp_connections_active || initial.owp_rooms_active) throw new Error('Target must be an empty, disposable server');
    for (let r = 0; r < config.rooms; r++) {
      const host = await connect(sockets.length);
      const roomState = host.wait('room_state');
      send(host, 'create_room', { media_id: '0123456789abcdef0123456789abcdef', start_pos: 0 });
      const created = await roomState;
      host.room = created.room;
      const members = [host];
      for (let c = 1; c < config.clients; c++) {
        const guest = await connect(sockets.length);
        guest.room = host.room;
        const joined = guest.wait('room_state');
        send(guest, 'join_room', {});
        await joined;
        send(guest, 'ready', { media_id: '0123456789abcdef0123456789abcdef' });
        members.push(guest);
      }
      groups.push(members);
    }
    // Keep setup broadcasts and rate-limit windows out of the measurement.
    await delay(1200);
    metricsBefore = await metrics();
    measuring = true;
    if (config.container) {
      sampling = true;
      sampleTask = (async () => {
        while (sampling) {
          const { stdout } = await execute('docker', ['stats', '--no-stream', '--format', '{{.CPUPerc}}|{{.MemUsage}}', config.container], { timeout: 10_000 });
          resources.push(dockerSample(stdout));
          if (sampling) await delay(1000);
        }
      })();
      // Attach a handler immediately; the awaited result below still fails
      // the run if Docker sampling fails.
      sampleTask.catch(() => {});
    }
    const start = performance.now();
    for (let tick = 0; tick < config.seconds; tick++) {
      for (const members of groups) {
        send(members[0], 'state_update', { position: tick, play_state: 'playing' });
        // Exercise scheduled play/pause in addition to host state updates.
        if (tick % 10 === 0) send(members[0], 'player_event', { action: tick % 20 === 0 ? 'play' : 'pause', position: tick });
        for (const client of members) {
          const probe = `ping-${sequence++}`;
          pending.set(probe, { start: performance.now(), expected: 1, clients: new Set() });
          send(client, 'ping', { probe });
          if (tick % 5 === 0) {
            const text = `load-${sequence++}`;
            pending.set(text, { start: performance.now(), expected: members.length, clients: new Set() });
            expectedChat += members.length;
            send(client, 'chat_message', { text });
          }
        }
      }
      const deadline = start + (tick + 1) * 1000;
      await delay(Math.max(0, deadline - performance.now()));
    }
    const seconds = (performance.now() - start) / 1000;
    sampling = false;
    if (sampleTask) await sampleTask;
    for (let i = 0; i < 50 && pending.size; i++) await delay(100);
    const after = await metrics();
    const report = {
      config, seconds: Number(seconds.toFixed(3)), sent, received,
      messages_per_second: Number((sent / seconds).toFixed(2)),
      chat: { expected: expectedChat, delivered: deliveredChat, p50_ms: percentile(chatLatency, .5), p95_ms: percentile(chatLatency, .95), p99_ms: percentile(chatLatency, .99) },
      ping: { samples: pingLatency.length, p50_ms: percentile(pingLatency, .5), p95_ms: percentile(pingLatency, .95), p99_ms: percentile(pingLatency, .99) },
      errors, unexpected_closes: unexpectedCloses, outstanding_probes: pending.size,
      send_failures: after.owp_send_failures_total - metricsBefore.owp_send_failures_total,
      active_connections: after.owp_connections_active, active_rooms: after.owp_rooms_active,
      resources: resources.length ? {
        samples: resources.length,
        cpu_percent_mean: Number((resources.reduce((sum, value) => sum + value.cpu_percent, 0) / resources.length).toFixed(3)),
        cpu_percent_max: Math.max(...resources.map(value => value.cpu_percent)),
        memory_mib_max: Number(Math.max(...resources.map(value => value.memory_mib)).toFixed(3)),
      } : null,
    };
    report.passed = errors === 0 && unexpectedCloses === 0 && pending.size === 0 && report.send_failures === 0 &&
      report.active_connections === config.rooms * config.clients && report.active_rooms === config.rooms;
    return report;
  } finally {
    sampling = false;
    if (sampleTask) await sampleTask.catch(() => {});
    closing = true;
    for (const client of sockets) client.socket.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const report = await run(options(process.argv.slice(2)));
    console.log(JSON.stringify(report, null, 2));
    if (!report.passed) process.exitCode = 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
