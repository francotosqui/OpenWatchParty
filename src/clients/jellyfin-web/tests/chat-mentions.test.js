const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const OWP = require('./setup.js');
const { FakeDocument } = require('./fake-dom.js');

globalThis.document = new FakeDocument();
OWP.ui = {};
require('../ui/avatars.js');
require('../chat/mentions.js');

const M = () => OWP.mentions;
const people = names => names.map(name => ({ name }));
const key = (k, extra = {}) => { let prevented = false; return { key: k, preventDefault() { prevented = true; }, get prevented() { return prevented; }, ...extra }; };

describe('chat mentions', () => {
  beforeEach(() => {
    globalThis.document = new FakeDocument();
    Object.assign(OWP.state, { userName: 'testhost', participants: people(['testhost', 'testclient1', 'testclient2']) });
  });

  it('matches a mention case-insensitively with word boundaries', () => {
    assert.equal(M().mentionsMe('hola @TestHost, ¿vamos?', 'testhost'), true);
    assert.equal(M().mentionsMe('@testhost', 'testhost'), true);
    assert.equal(M().mentionsMe('mail@testhost.com', 'testhost'), false);
    assert.equal(M().mentionsMe('@testhostx hola', 'testhost'), false);
    assert.equal(M().mentionsMe('@Ana (TV) mirá', 'Ana (TV)'), true);
    assert.equal(M().mentionsMe('@Ana TV', 'Ana (TV)'), false);
    assert.deepEqual(M().segments('hey @Ana (TV)!', ['Ana (TV)', 'Bruno'], 'me'), [
      { text: 'hey ', mention: false, me: false },
      { text: '@Ana (TV)', mention: true, me: false },
      { text: '!', mention: false, me: false }
    ]);
    assert.deepEqual(M().segments('@ana paula hi', ['Ana', 'Ana Paula'], 'ana paula').slice(0, 1), [{ text: '@ana paula', mention: true, me: true }]);
  });

  it('suggests prefix matches first, then contains, at most 6, without me', () => {
    const list = people(['testhost', 'Bob', 'client test', 'testclient1', 'Testa', 'tester', 'test4', 'test5', 'test6', 'test7']);
    const names = M().suggest('test', list, 'testhost').map(p => p.name);
    assert.equal(names.length, 6);
    assert.equal(names.includes('testhost'), false);
    assert.deepEqual(names.slice(0, 2), ['testclient1', 'Testa']);
    assert.deepEqual(M().suggest('zz', list, 'testhost').map(p => p.name), []);
    assert.deepEqual(M().suggest('client', list, 'testhost').map(p => p.name), ['client test', 'testclient1']);
  });

  it('reads the query from @ to the caret, allowing spaces', () => {
    assert.deepEqual(M().activeQuery('hola @Ana P', 11), { start: 5, query: 'Ana P' });
    assert.deepEqual(M().activeQuery('@', 1), { start: 0, query: '' });
    assert.equal(M().activeQuery('mail@x', 6), null);
    assert.equal(M().activeQuery(`@${'a'.repeat(33)}`, 34), null);
    assert.equal(M().activeQuery('hola', 4), null);
  });

  it('opens a listbox, moves with arrows, picks with Enter or Tab and closes with Escape', () => {
    const container = document.createElement('div'); container.id = 'owp-chat-input-container';
    const input = document.createElement('input'); input.id = 'owp-chat-input';
    container.appendChild(input); document.body.appendChild(container);
    M().attach(input);
    const type = (value) => { input.value = value; input.selectionStart = input.selectionEnd = value.length; input.dispatchEvent({ type: 'input' }); };
    type('hola @test');
    const list = document.getElementById('owp-mention-list');
    assert.equal(list.getAttribute('role'), 'listbox');
    assert.equal(input.getAttribute('aria-expanded'), 'true');
    const options = list.querySelectorAll('[role="option"]');
    assert.deepEqual(options.map(o => o.getAttribute('aria-selected')), ['true', 'false']);
    assert.ok(list.querySelector('.owp-mention-hint'));
    const down = key('ArrowDown');
    assert.equal(M().handleKeydown(down), true); assert.equal(down.prevented, true);
    assert.equal(input.getAttribute('aria-activedescendant'), options[1].id);
    const enter = key('Enter');
    assert.equal(M().handleKeydown(enter), true); assert.equal(enter.prevented, true);
    assert.equal(input.value, 'hola @testclient2 ');
    assert.equal(document.getElementById('owp-mention-list'), null);
    assert.equal(M().handleKeydown(key('Enter')), false);
    type('@testc');
    assert.equal(M().handleKeydown(key('Tab')), true);
    assert.equal(input.value, '@testclient1 ');
    type('@test');
    assert.equal(M().handleKeydown(key('Escape')), true);
    assert.equal(document.getElementById('owp-mention-list'), null);
    type('@zzz');
    assert.equal(document.getElementById('owp-mention-list'), null);
  });

  // Like the bell's menu, drawn over the page so an empty chat does not cut it.
  it('draws the list over the page, above the input', () => {
    globalThis.innerHeight = 720;
    const container = document.createElement('div'); container.id = 'owp-chat-input-container';
    const input = document.createElement('input'); input.id = 'owp-chat-input';
    input.getBoundingClientRect = () => ({ top: 115, bottom: 145, left: 797, right: 1126, width: 329 });
    container.appendChild(input); document.body.appendChild(container);
    M().attach(input);
    input.value = '@test'; input.selectionStart = input.selectionEnd = 5; input.dispatchEvent({ type: 'input' });
    const list = document.getElementById('owp-mention-list');
    assert.equal(list.parentNode, document.body);
    assert.equal(list.style.left, '797px');
    assert.equal(list.style.width, '329px');
    assert.equal(list.style.bottom, '609px');
    for (const type of ['pointerdown', 'mousedown', 'wheel']) {
      const event = { type, stopPropagation() { this.stopped = true; } };
      list.dispatchEvent(event);
      assert.equal(event.stopped, true, type);
    }
    M().close();
    assert.equal(document.getElementById('owp-mention-list'), null);
  });
});
