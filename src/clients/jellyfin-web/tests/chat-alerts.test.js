const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const OWP = require('./setup.js');
const { FakeDocument } = require('./fake-dom.js');

globalThis.document = new FakeDocument();
OWP.ui = {};
require('../ui/avatars.js');
require('../ui/toasts.js');
const realShowChatToast = OWP.ui.showChatToast;
require('../chat/mentions.js');
require('../chat/alerts.js');
require('../chat/messages.js');
require('../chat/input.js');

let toasts;
let storage;
let chatVisible;
const message = (text, client = 'c2', username = 'testclient2') => ({ client, payload: { username, text } });

describe('chat alerts', () => {
  beforeEach(() => {
    globalThis.document = new FakeDocument();
    const badge = document.createElement('span'); badge.id = 'owp-chat-badge'; document.body.appendChild(badge);
    const button = document.createElement('button'); button.id = 'owp-btn-chat'; document.body.appendChild(button);
    const container = document.createElement('div'); container.id = 'owp-chat-messages'; document.body.appendChild(container);
    storage = new Map();
    globalThis.localStorage = { getItem: k => (storage.has(k) ? storage.get(k) : null), setItem: (k, v) => storage.set(k, String(v)) };
    toasts = [];
    OWP.ui.showChatToast = (username, text, options = {}) => toasts.push({ username, text, options });
    chatVisible = false;
    OWP.chat.isChatVisible = () => chatVisible;
    OWP.chat.messages = []; OWP.chat.unreadCount = 0;
    Object.assign(OWP.state, { clientId: 'me', userId: 'u1', userName: 'testhost', participants: [{ name: 'testhost' }, { name: 'testclient2' }] });
    OWP.chatAlerts.markRead();
  });

  it('gives a mention its own toast and an accent badge until read', () => {
    OWP.chat.receive(message('@testhost ya llegué'));
    assert.equal(toasts.length, 1);
    assert.equal(toasts[0].options.mention, true);
    assert.equal(OWP.chatAlerts.hasUnreadMention(), true);
    assert.equal(document.getElementById('owp-chat-badge').classList.contains('owp-chat-badge-mention'), true);
    assert.match(document.getElementById('owp-btn-chat').getAttribute('aria-label'), /mentioned/);
    OWP.chat.markRead();
    assert.equal(OWP.chatAlerts.hasUnreadMention(), false);
    assert.equal(document.getElementById('owp-chat-badge').classList.contains('owp-chat-badge-mention'), false);
  });

  it('forgets an unread mention when the chat is cleared on leaving the room', () => {
    OWP.chat.receive(message('@testhost hola'));
    OWP.chat.clear();
    OWP.chat.receive(message('mensaje común'));
    assert.equal(OWP.chatAlerts.hasUnreadMention(), false);
    assert.equal(document.getElementById('owp-chat-badge').classList.contains('owp-chat-badge-mention'), false);
  });

  it('renders the mention toast with its label', () => {
    realShowChatToast('testclient2', 'hola', { mention: true });
    const toast = document.querySelector('.owp-toast');
    assert.ok(toast.classList.contains('owp-toast-mention'));
    assert.equal(toast.querySelector('.owp-toast-label').textContent, 'Mentioned you');
  });

  it('highlights mentions from history without a toast', () => {
    OWP.chat.loadHistory([{ client: 'c2', username: 'testclient2', text: 'hola @testhost', server_ts: 1, own: false }]);
    assert.equal(toasts.length, 0);
    const rendered = document.getElementById('owp-chat-messages').children[0];
    assert.ok(rendered.classList.contains('owp-chat-mentioned'));
    assert.equal(rendered.querySelector('.owp-chat-mention').textContent, '@testhost');
  });

  it('in mentions-only mode skips plain toasts but still counts them', () => {
    OWP.chatAlerts.setMode('mentions');
    OWP.chat.receive(message('hola a todos'));
    assert.equal(toasts.length, 0);
    assert.equal(OWP.chat.unreadCount, 1);
    OWP.chat.receive(message('@testhost dale'));
    assert.equal(toasts.length, 1);
    assert.equal(OWP.chat.unreadCount, 2);
  });

  it('keeps the mode per Jellyfin user and falls back to all when storage fails', () => {
    OWP.chatAlerts.setMode('mentions');
    assert.equal(storage.get('owp-chat-toasts-u1'), 'mentions');
    OWP.state.userId = 'u2';
    assert.equal(OWP.chatAlerts.mode(), 'all');
    globalThis.localStorage = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
    assert.doesNotThrow(() => OWP.chatAlerts.setMode('mentions'));
    assert.equal(OWP.chatAlerts.mode(), 'all');
  });

  it('opens the bell menu as selected and returns focus after choosing', () => {
    const wrap = OWP.chatAlerts.createBell();
    document.body.appendChild(wrap);
    const bell = wrap.querySelector('#owp-chat-bell');
    assert.equal(bell.getAttribute('aria-expanded'), 'false');
    bell.click();
    assert.equal(bell.getAttribute('aria-expanded'), 'true');
    const options = wrap.querySelectorAll('[role="menuitemradio"]');
    assert.equal(options.length, 2);
    assert.equal(options[0].getAttribute('aria-checked'), 'true');
    let focused = null; bell.focus = () => { focused = bell; };
    options[1].click();
    assert.equal(OWP.chatAlerts.mode(), 'mentions');
    assert.equal(bell.getAttribute('aria-expanded'), 'false');
    assert.equal(focused, bell);
    assert.ok(bell.classList.contains('owp-chat-bell-on'));
    bell.click();
    wrap.querySelector('.owp-chat-bell-menu').dispatchEvent({ type: 'keydown', key: 'Escape', preventDefault() {}, stopPropagation() {} });
    assert.equal(bell.getAttribute('aria-expanded'), 'false');
  });
});
