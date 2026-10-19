const { it } = require('node:test');
const assert = require('node:assert/strict');
const OWP = require('./setup.js');
const { FakeDocument } = require('./fake-dom.js');

globalThis.document = new FakeDocument();
OWP.chat = { messages: [], unreadCount: 0, isChatVisible: () => true, updateBadge() {} };
require('../chat/messages.js');

it('keeps the rendered chat to the same last 100 messages as its history', () => {
  const container = document.createElement('div');
  container.id = 'owp-chat-messages';
  document.body.appendChild(container);
  for (let i = 0; i < 1000; i++) {
    OWP.chat.receive({ client: 'other', payload: { username: 'User', text: `message-${i}` }, server_ts: 1000 + i });
  }
  assert.equal(OWP.chat.messages.length, 100);
  assert.equal(container.children.length, 100);
  assert.ok(container.children[0].textContent.includes('message-900'));
  assert.ok(container.children[99].textContent.includes('message-999'));
  OWP.chat.renderAllMessages();
  assert.equal(container.children.length, 100);
  assert.ok(container.children[0].textContent.includes('message-900'));
  OWP.chat.clear();
  assert.equal(container.children.length, 0);
  assert.equal(OWP.chat.messages.length, 0);
});
