const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const OWP = require('./setup.js');
const { FakeDocument } = require('./fake-dom.js');

globalThis.document = new FakeDocument();
OWP.ui = { updateParticipantList: () => {}, showToast: () => {}, showChatToast: () => {} };
require('../ui/avatars.js');
require('../chat/messages.js');
OWP.chat.isChatVisible = () => true;
OWP.chat.updateBadge = () => {};
require('../ws/handlers/room.js');

const ID = 'aaaaaaaabbbbccccddddeeeeeeeeeeee';
const image = element => element.children.find(child => child.tagName === 'IMG');

describe('Jellyfin avatars', () => {
  beforeEach(() => {
    globalThis.document = new FakeDocument();
    window.ApiClient = { getUrl: (path, query) => `https://jf.example/${path}?height=${query.height}&quality=${query.quality}` };
    OWP.avatars.reset();
  });

  it('avatar uses the Jellyfin image for a valid id', () => {
    const avatar = OWP.avatars.create('Ana', ID);
    assert.equal(image(avatar).src, `https://jf.example/Users/${ID}/Images/Primary?height=64&quality=90`);
    assert.equal(image(avatar).alt, '');
    assert.equal(OWP.avatars.create('Ana', 'AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE').children.length, 1);
  });

  it('avatar falls back to the initial and never refetches a failed id', () => {
    const avatar = OWP.avatars.create('ana', ID);
    image(avatar).onerror();
    assert.equal(image(avatar), undefined);
    assert.equal(avatar.textContent, 'A');
    const again = OWP.avatars.create('ana', ID);
    assert.equal(image(again), undefined);
    assert.equal(again.textContent, 'A');
  });

  it('avatar rejects a malformed id', () => {
    for (const id of ['', undefined, 'not-an-id', '../../etc', `${ID}0`]) {
      const avatar = OWP.avatars.create('Bruno', id);
      assert.equal(image(avatar), undefined);
      assert.equal(avatar.textContent, 'B');
    }
  });

  it('keeps the Jellyfin user id of participants and chat senders', () => {
    Object.assign(OWP.state, { inRoom: true, roomId: 'room-1', clientId: 'me' });
    OWP._wsHandlers.handleParticipantList({ room: 'room-1', payload: { participants: [{ name: 'Ana', is_host: true, id: 'c1', user_id: ID }, { name: 'Bruno', is_host: false }] } });
    assert.equal(OWP.state.participants[0].userId, ID);
    assert.equal(OWP.state.participants[1].userId, undefined);
    OWP.chat.messages = [];
    OWP.chat.receive({ client: 'c1', payload: { username: 'Ana', text: 'hola', user_id: ID } });
    assert.equal(OWP.chat.messages[0].userId, ID);
    OWP.chat.loadHistory([{ client: 'c1', username: 'Ana', text: 'hola', server_ts: 1, own: false, user_id: ID }]);
    assert.equal(OWP.chat.messages[0].userId, ID);
  });

  it('shows the sender avatar before the name in chat', () => {
    const container = document.createElement('div'); container.id = 'owp-chat-messages'; document.body.appendChild(container);
    OWP.chat.renderMessage({ username: 'Ana', text: 'hola', userId: ID, timestamp: 1 });
    const meta = container.children[0].children[0];
    assert.ok(meta.children[0].classList.contains('owp-chat-avatar'));
    assert.ok(image(meta.children[0]));
    assert.ok(meta.children[1].classList.contains('owp-chat-username'));
  });
});
