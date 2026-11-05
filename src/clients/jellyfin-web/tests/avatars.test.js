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
require('../ui/cards.js');

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

// Clients that show avatars get each room's host in the room list.
describe('the host photo on the room lists', () => {
  const named = { id: 'room-1', name: "Ana's room", count: 1, media_id: null, host_user_id: ID, host_name: 'Ana' };
  beforeEach(() => {
    globalThis.document = new FakeDocument();
    window.ApiClient = { getUrl: path => `https://jf.example/${path}` };
    OWP.avatars.reset();
    OWP.state.pendingJoin = null;
    OWP.state.joinOutcome = null;
  });

  it('shows the host photo before the room name in the panel list', () => {
    const list = document.createElement('div');
    list.id = 'owp-room-list';
    document.body.appendChild(list);
    OWP.state.rooms = [named];
    OWP.ui.updateRoomListUI();
    const host = list.querySelector('.owp-room-host');
    assert.ok(host.children[0].classList.contains('owp-participant-avatar'));
    assert.equal(image(host.children[0]).src, `https://jf.example/Users/${ID}/Images/Primary`);
    assert.equal(host.querySelector('.owp-room-title').textContent, "Ana's room");
    // An older server names no host: the list stays as it was.
    OWP.state.rooms = [{ ...named, host_user_id: undefined, host_name: undefined }];
    OWP.ui.updateRoomListUI();
    assert.equal(list.querySelector('.owp-participant-avatar'), null);
  });

  it('shows a small host photo before the name on the home card', () => {
    const card = OWP.ui.createRoomCard(named, 0);
    const avatar = card.querySelector('.owp-card-name .owp-card-avatar');
    assert.equal(image(avatar).src, `https://jf.example/Users/${ID}/Images/Primary`);
    assert.equal(card.querySelector('.owp-card-name').textContent, "Ana's room");
    assert.equal(card.dataset.host, ID);
    assert.equal(OWP.ui.createRoomCard({ ...named, host_user_id: undefined }, 0).querySelector('.owp-card-avatar'), null);
  });
});
