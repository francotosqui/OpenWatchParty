const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const OWP = require('./setup.js');
const { FakeDocument } = require('./fake-dom.js');

OWP.ui = {};
OWP.actions = {};
require('../chat/messages.js');
require('../chat/input.js');

const captureDiagnostics = (t) => {
  const calls = [];
  for (const method of ['log', 'info', 'warn', 'error', 'debug']) {
    t.mock.method(console, method, (...args) => calls.push(args));
  }
  t.mock.method(OWP.utils, 'log', (...args) => calls.push(args));
  return calls;
};

describe('chat diagnostic privacy', () => {
  beforeEach(() => {
    globalThis.document = new FakeDocument();
    OWP.state.ws = { readyState: 1 };
    OWP.state.roomId = 'private-room';
    OWP.state.clientId = 'self';
    OWP.chat.messages = [];
    OWP.chat.unreadCount = 0;
    OWP.utils.log = () => {};
    OWP.ui.showToast = () => {};
    OWP.ui.showChatToast = () => {};
    OWP.actions.send = () => {};
  });

  it('sends the trimmed message without copying it to diagnostics', (t) => {
    const diagnostics = captureDiagnostics(t);
    const sent = [];
    t.mock.method(OWP.actions, 'send', (...args) => sent.push(args));

    assert.equal(OWP.chat.send('  private outgoing message  '), true);
    assert.deepEqual(sent, [['chat_message', { text: 'private outgoing message' }]]);
    assert.deepEqual(diagnostics, []);
  });

  it('keeps validation feedback without logging rejected drafts', (t) => {
    const diagnostics = captureDiagnostics(t);
    const toasts = [];
    const sent = [];
    t.mock.method(OWP.ui, 'showToast', message => toasts.push(message));
    t.mock.method(OWP.actions, 'send', (...args) => sent.push(args));

    assert.equal(OWP.chat.send(' '), false);
    assert.equal(OWP.chat.send('x'.repeat(501)), false);
    OWP.state.ws = null;
    assert.equal(OWP.chat.send('private disconnected draft'), false);
    OWP.state.ws = { readyState: 1 };
    OWP.state.roomId = '';
    assert.equal(OWP.chat.send('private draft outside a room'), false);

    assert.equal(toasts.length, 3);
    assert.match(toasts[0], /too long/);
    assert.match(toasts[1], /Not connected/);
    assert.match(toasts[2], /Not in a room/);
    assert.deepEqual(sent, []);
    assert.deepEqual(diagnostics, []);
  });

  it('renders and notifies a received message without logging its payload', (t) => {
    const diagnostics = captureDiagnostics(t);
    const toasts = [];
    t.mock.method(OWP.ui, 'showChatToast', (...args) => toasts.push(args));
    const container = document.createElement('div');
    container.id = 'owp-chat-messages';
    document.body.appendChild(container);

    OWP.chat.receive({
      client: 'other',
      server_ts: 1000,
      payload: { username: 'Private name', text: 'private incoming message' }
    });

    assert.equal(container.querySelector('.owp-chat-text').textContent, 'private incoming message');
    assert.equal(container.querySelector('.owp-chat-username').textContent, 'Private name');
    assert.equal(OWP.chat.messages.length, 1);
    assert.equal(OWP.chat.unreadCount, 1);
    assert.deepEqual(toasts, [['Private name', 'private incoming message']]);
    assert.deepEqual(diagnostics, []);
  });
});
