const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const OWP = require('./setup.js');
const { FakeDocument } = require('./fake-dom.js');

globalThis.document = new FakeDocument();
OWP.ui = {};
require('../chat/typing.js');

let sent;
let timers;
let clock;
const realNow = Date.now;
const typing = (client, username, active, room = 'room-1') => ({ type: 'chat_typing', room, client, payload: { username, active } });
const line = () => document.getElementById('owp-chat-typing');

describe('chat typing indicator', () => {
  beforeEach(() => {
    globalThis.document = new FakeDocument();
    const element = document.createElement('div'); element.id = 'owp-chat-typing';
    const text = document.createElement('span'); text.className = 'owp-chat-typing-text'; element.appendChild(text);
    document.body.appendChild(element);
    sent = []; timers = []; clock = 1_000_000;
    Date.now = () => clock;
    OWP.actions = OWP.actions || {};
    OWP.actions.send = (type, payload) => sent.push({ type, payload });
    OWP.timers.setTimeout = (callback, delay) => { timers.push({ callback, at: clock + delay }); return timers.length; };
    Object.assign(OWP.state, { inRoom: true, roomId: 'room-1', clientId: 'me', serverFeatures: ['chat_typing'] });
    OWP.chatTyping.reset();
  });
  const runTimers = () => timers.filter(timer => timer.at <= clock).forEach(timer => timer.callback());
  process.on('exit', () => { Date.now = realNow; });

  it('sends true at most every 3 s and false once', () => {
    OWP.chatTyping.inputChanged('h');
    clock += 1000; OWP.chatTyping.inputChanged('ho');
    clock += 2100; OWP.chatTyping.inputChanged('hol');
    assert.deepEqual(sent.map(m => m.payload.active), [true, true]);
    OWP.chatTyping.inputChanged('');
    OWP.chatTyping.stop();
    assert.deepEqual(sent.map(m => m.payload.active), [true, true, false]);
    assert.ok(sent.every(m => m.type === 'chat_typing'));
  });

  it('sends nothing without the server feature or outside a room', () => {
    OWP.state.serverFeatures = [];
    OWP.chatTyping.inputChanged('hola');
    Object.assign(OWP.state, { serverFeatures: ['chat_typing'], inRoom: false });
    OWP.chatTyping.inputChanged('hola');
    assert.equal(sent.length, 0);
  });

  it('shows one, two and many texts', () => {
    OWP.chatTyping.onMessage(typing('a', 'Ana', true));
    assert.equal(OWP.chatTyping.text(), 'Ana is typing…');
    assert.equal(line().hidden, false);
    OWP.chatTyping.onMessage(typing('b', 'Bruno', true));
    assert.equal(OWP.chatTyping.text(), 'Ana and Bruno are typing…');
    OWP.chatTyping.onMessage(typing('c', 'Caro', true));
    assert.equal(OWP.chatTyping.text(), 'Several people are typing…');
    OWP.chatTyping.onMessage(typing('a', 'Ana', true, 'other-room'));
    OWP.chatTyping.onMessage(typing('me', 'Me', true));
    OWP.chatTyping.onMessage(typing('b', 'Bruno', false));
    OWP.chatTyping.onMessage(typing('c', 'Caro', false));
    assert.equal(OWP.chatTyping.text(), 'Ana is typing…');
  });

  it('expires 5 s after the last notice', () => {
    OWP.chatTyping.onMessage(typing('a', 'Ana', true));
    clock += 3000; OWP.chatTyping.onMessage(typing('a', 'Ana', true));
    clock += 2500; runTimers();
    assert.equal(OWP.chatTyping.text(), 'Ana is typing…');
    clock += 2600; runTimers();
    assert.equal(OWP.chatTyping.text(), '');
    assert.equal(line().hidden, true);
  });

  it('is cleared by a message, a departure and a room reset', () => {
    OWP.chatTyping.onMessage(typing('a', 'Ana', true));
    OWP.chatTyping.onMessage(typing('b', 'Bruno', true));
    OWP.chatTyping.onMessage(typing('c', 'Caro', true));
    OWP.chatTyping.clear('a');
    OWP.chatTyping.prune(['b', 'me']);
    assert.equal(OWP.chatTyping.text(), 'Bruno is typing…');
    OWP.chatTyping.inputChanged('hola');
    OWP.chatTyping.reset();
    assert.equal(OWP.chatTyping.text(), '');
    OWP.chatTyping.stop();
    assert.deepEqual(sent.map(m => m.payload.active), [true]);
  });
});
