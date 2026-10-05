const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const OWP = require('./setup.js');
const { FakeDocument } = require('./fake-dom.js');

globalThis.document = new FakeDocument();
OWP.ui = {};
require('../ui/toasts.js');
require('../ui/cards.js');

const MEDIA_ID = '0123456789abcdef0123456789abcdef';
const room = { id: 'room-1', name: "Ana's room", count: 2, media_id: MEDIA_ID };
const flush = async () => {
  for (let i = 0; i < 3; i++) await Promise.resolve();
};

const cardFor = async (item, index = 0) => {
  window.ApiClient = {
    getCurrentUserId: () => 'user',
    serverAddress: () => 'https://jf.example',
    getItem: async () => item
  };
  const card = OWP.ui.createRoomCard(room, index);
  document.body.appendChild(card);
  await flush();
  return card;
};
const imageOf = card => card.querySelector('.owp-card-image-container').style.backgroundImage || '';

describe('home Watch Parties card', () => {
  beforeEach(() => {
    globalThis.document = new FakeDocument();
    OWP.timers.setTimeout = () => 1;
  });

  it('uses the landscape card markup of the home rows, with no colours of its own', async () => {
    const card = await cardFor({ Name: 'Sprite Fright', Type: 'Movie' }, 6);
    assert.ok(card.classList.contains('overflowBackdropCard'));
    assert.equal(card.classList.contains('overflowPortraitCard'), false);
    assert.ok(card.querySelector('.cardPadder-overflowBackdrop'));
    const image = card.querySelector('.owp-card-image-container');
    assert.ok(image.classList.contains('defaultCardBackground'));
    assert.ok(image.classList.contains('defaultCardBackground2'));
    assert.equal(image.style.backgroundColor, undefined);
    const count = card.querySelector('.innerCardFooter .cardText');
    assert.equal(count.textContent, 'groups 2 watching');
    assert.equal(count.style.cssText, undefined);
    assert.equal(card.querySelector('.owp-card-name').textContent, "Ana's room");
    assert.equal(card.querySelector('.owp-media-title').textContent, 'Sprite Fright');
    assert.equal(imageOf(card), '');
  });

  it('shows an episode with its own still', async () => {
    const card = await cardFor({ Name: 'Pilot', Type: 'Episode', ImageTags: { Primary: 'p1' }, ParentThumbItemId: 'series', ParentThumbImageTag: 't1' });
    assert.equal(imageOf(card), `url("https://jf.example/Items/${MEDIA_ID}/Images/Primary?fillWidth=480&fillHeight=270&quality=96&tag=p1")`);
    assert.equal(card.querySelector('.owp-card-icon').style.display, 'none');
  });

  it('prefers a thumb, then a backdrop, for a movie', async () => {
    let card = await cardFor({ Name: 'Movie', Type: 'Movie', ImageTags: { Primary: 'p', Thumb: 'th' }, BackdropImageTags: ['b'] });
    assert.match(imageOf(card), new RegExp(`/Items/${MEDIA_ID}/Images/Thumb\\?.*tag=th`));
    card = await cardFor({ Name: 'Movie', Type: 'Movie', ImageTags: { Primary: 'p' }, BackdropImageTags: ['b'] });
    assert.match(imageOf(card), new RegExp(`/Items/${MEDIA_ID}/Images/Backdrop\\?.*tag=b`));
  });

  it('falls back to the series art, then to the poster', async () => {
    let card = await cardFor({ Name: 'Episode', Type: 'Episode', ParentThumbItemId: 'series', ParentThumbImageTag: 't1' });
    assert.match(imageOf(card), /\/Items\/series\/Images\/Thumb\?.*tag=t1/);
    card = await cardFor({ Name: 'Episode', Type: 'Episode', ParentBackdropItemId: 'series', ParentBackdropImageTags: ['b1'] });
    assert.match(imageOf(card), /\/Items\/series\/Images\/Backdrop\?.*tag=b1/);
    card = await cardFor({ Name: 'Video', Type: 'Video', ImageTags: { Primary: 'p2' } });
    assert.match(imageOf(card), new RegExp(`/Items/${MEDIA_ID}/Images/Primary\\?.*tag=p2`));
  });
});
