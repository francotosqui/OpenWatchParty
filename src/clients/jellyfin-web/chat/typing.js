(() => {
  const OWP = window.OpenWatchParty = window.OpenWatchParty || {};
  const state = OWP.state;
  const t = OWP.i18n.t;

  // A start is announced at most this often while typing; the server relays
  // one per 2 s. A notice that is not renewed disappears after EXPIRY_MS.
  const SEND_INTERVAL_MS = 3000;
  const EXPIRY_MS = 5000;

  // Who is typing in this room: client id -> { name, until }.
  const typists = new Map();
  // When this member last announced a start; 0 once it said it stopped.
  let announcedAt = 0;

  const supported = () => state.inRoom && state.serverFeatures.includes('chat_typing');
  const announce = active => OWP.actions.send('chat_typing', { active });

  const text = () => {
    const names = [...typists.values()].map(entry => entry.name);
    if (names.length === 0) return '';
    if (names.length === 1) return t('typingOne', { name: names[0] });
    if (names.length === 2) return t('typingTwo', { a: names[0], b: names[1] });
    return t('typingMany');
  };

  const render = () => {
    const line = document.getElementById('owp-chat-typing');
    if (!line) return;
    const value = text();
    line.hidden = !value;
    const label = line.querySelector('.owp-chat-typing-text');
    if (label) label.textContent = value;
  };

  const stop = () => {
    if (!announcedAt) return;
    announcedAt = 0;
    if (supported()) announce(false);
  };

  const inputChanged = value => {
    if (!supported()) return;
    if (!String(value).trim()) {
      stop();
      return;
    }
    if (announcedAt && Date.now() - announcedAt < SEND_INTERVAL_MS) return;
    announcedAt = Date.now();
    announce(true);
  };

  const onMessage = msg => {
    if (!state.inRoom || msg.room !== state.roomId || msg.client === state.clientId) return;
    if (!msg.payload.active) {
      clear(msg.client);
      return;
    }
    const until = Date.now() + EXPIRY_MS;
    typists.set(msg.client, { name: msg.payload.username || t('guest'), until });
    OWP.timers.setTimeout(() => {
      const entry = typists.get(msg.client);
      if (entry && entry.until <= Date.now()) clear(msg.client);
    }, EXPIRY_MS, 'chat-typing');
    render();
  };

  // A chat message from someone ends their notice.
  const clear = clientId => {
    if (typists.delete(clientId)) render();
  };

  // Keeps only members still in the room's participant list.
  const prune = ids => {
    let changed = false;
    for (const clientId of [...typists.keys()]) {
      if (!ids.includes(clientId)) changed = typists.delete(clientId) || changed;
    }
    if (changed) render();
  };

  const reset = () => {
    typists.clear();
    announcedAt = 0;
    OWP.timers.clearScope?.('chat-typing');
    render();
  };

  OWP.chatTyping = { inputChanged, stop, onMessage, clear, prune, reset, render, text };
})();
