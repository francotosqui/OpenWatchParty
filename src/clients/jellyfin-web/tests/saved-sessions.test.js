const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const OWP = require('./setup.js');
const { FakeDocument } = require('./fake-dom.js');
globalThis.document = new FakeDocument();
OWP.ui = {};
OWP.chat = { messages: [], unreadCount: 0, markRead() {}, renderAllMessages() {}, clear() {} };
OWP.utils.getVideo = () => null; OWP.utils.log = () => {};
for (const file of ['ui/indicators','ui/cards','chat/messages','chat/input','ui/toasts','ui/home']) require(`../${file}.js`);
require('./load-panel-views.js');
require('../ui/saved-sessions.js'); require('../ws/send.js'); require('../app/saved-sessions.js'); require('../ws/handlers/room.js'); require('../ws/validation.js');
let sent;
const snapshot = () => ({ id: '11111111-1111-4111-8111-111111111111', name: 'Series night', media_id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', media_title: 'Pilot', position: 123.5, queue_count: 2, saved_at_ms: 100, expires_at_ms: null, active: false });
const element = id => document.getElementById(id);
const receiveList = sessions => { OWP.actions.listSavedSessions(); OWP.savedSessions.onList({ payload: { request_id: sent.at(-1).payload.request_id, sessions } }); };
describe('saved room sessions', () => {
  beforeEach(() => {
    globalThis.document = new FakeDocument();
    const panel = document.createElement('div'); panel.id = OWP.constants.PANEL_ID; document.body.appendChild(panel);
    sent = [];
    Object.assign(OWP.state, OWP.stateFactories.createState(), { serverFeatures: ['persistent_rooms'], connectionPhase: 'authenticated', clientId: 'owner', userId: 'account', ws: { readyState: 1, send: raw => sent.push(JSON.parse(raw)) } });
    OWP.timers.setTimeout = () => 1;
    for (const name of ['renderHomeWatchParties','updateRoomListUI','stopPlayerCapture','showToast']) OWP.ui[name] = () => {};
    window.ApiClient = { getCurrentUserId: () => 'account', getItem: async () => ({ Name: 'Pilot' }) };
    OWP.savedSessions.reset();
  });
  it('places the bookmark immediately before panel X in lobby and room, only when supported', () => {
    OWP.ui.render(true); assert.equal(element('owp-btn-saved').nextSibling.classList.contains('owp-close-btn'), true);
    Object.assign(OWP.state, { inRoom: true, isHost: true, roomId: 'room', roomName: 'Room' }); OWP.ui.render(true);
    assert.equal(element('owp-btn-saved').nextSibling.classList.contains('owp-close-btn'), true);
    OWP.state.serverFeatures = []; OWP.ui.render(true); assert.equal(element('owp-btn-saved'), null);
  });
  it('lists private sessions and ignores stale responses after account changes', () => {
    OWP.actions.listSavedSessions(); const old = sent.at(-1).payload.request_id; OWP.state.userId = 'other';
    OWP.savedSessions.onList({ payload: { request_id: old, sessions: [snapshot()] } }); assert.deepEqual(OWP.state.savedSessions, []);
    receiveList([snapshot()]); assert.equal(OWP.state.savedSessions.length, 1); OWP.savedSessions.reset(); assert.deepEqual(OWP.state.savedSessions, []);
  });
  it('asks before discarding and sends nothing on cancel', () => {
    receiveList([snapshot()]); OWP.ui.render(true); element('owp-btn-saved').click(); const id = `owp-saved-discard-${snapshot().id}`;
    element(id).click(); assert.ok(element('owp-saved-confirm')); const count = sent.length;
    element('owp-saved-confirm-cancel').click(); assert.equal(sent.length, count);
    element(id).click(); element('owp-saved-confirm-accept').click(); assert.equal(sent.at(-1).type, 'discard_saved_session'); assert.equal(sent.at(-1).payload.id, snapshot().id);
  });
  it('shows Save and close only to Owner and confirms before sending', () => {
    Object.assign(OWP.state, { inRoom: true, isHost: true, roomId: 'room', roomName: 'Room', roomBarSection: 'saved' });
    OWP.ui.render(true); element('owp-saved-save-current').click(); assert.equal(sent.some(message => message.type === 'save_room_session'), false);
    element('owp-saved-confirm-accept').click(); assert.equal(sent.at(-1).type, 'save_room_session');
    OWP.state.isHost = false; OWP.state.isAdministrator = true; OWP.ui.render(true); assert.equal(element('owp-saved-save-current'), null);
  });
  it('disables resume and discard for an active checkpoint', () => {
    receiveList([{ ...snapshot(), active: true }]); OWP.ui.render(true); element('owp-btn-saved').click();
    assert.equal(element(`owp-saved-discard-${snapshot().id}`).disabled, true); assert.equal(element(`owp-saved-resume-${snapshot().id}`).disabled, true);
  });
  it('checks Jellyfin availability and preserves missing media saves', async () => {
    receiveList([snapshot()]); window.ApiClient.getItem = async () => { throw new Error('missing'); }; await OWP.actions.resumeSavedSession(snapshot().id);
    assert.equal(sent.some(message => message.type === 'resume_saved_session'), false); assert.equal(OWP.state.savedSessions.length, 1); assert.ok(OWP.state.savedSessionsError);
  });
  it('marks resumed Owner media for restoration before room_state arrives', async () => {
    receiveList([snapshot()]); await OWP.actions.resumeSavedSession(snapshot().id); const request = sent.at(-1);
    OWP.savedSessions.onResult({ payload: { request_id: request.payload.request_id, action: 'resume', id: snapshot().id, room_id: 'new-live-room' } }); assert.equal(OWP.state.savedResumeRoomId, 'new-live-room');
  });
  it('ignores delayed availability after the connection changes', async () => {
    receiveList([snapshot()]); let finish; window.ApiClient.getItem = () => new Promise(resolve => { finish = resolve; });
    const pending = OWP.actions.resumeSavedSession(snapshot().id); OWP.state.ws = { readyState: 1, send: () => assert.fail('stale connection request') }; finish({}); await pending;
    assert.equal(sent.some(message => message.type === 'resume_saved_session'), false);
  });
  it('waits for server departure acknowledgement before resuming from another room', async () => {
    receiveList([snapshot()]);
    Object.assign(OWP.state, { inRoom: true, isHost: true, roomId: 'room', roomName: 'Room' }); OWP.ui.render(true);
    await OWP.actions.resumeSavedSession(snapshot().id);
    assert.equal(sent.some(message => message.type === 'leave_room'), false);
    OWP.savedSessions.leaveAndResume();
    assert.equal(sent.at(-1).type, 'leave_room');
    assert.equal(sent.some(message => message.type === 'resume_saved_session'), false);
    await OWP.savedSessions.onRoomLeft({ room: 'room', payload: {} });
    assert.equal(sent.at(-1).type, 'resume_saved_session');
  });

});
