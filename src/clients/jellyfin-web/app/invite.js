(() => {
  const OWP = window.OpenWatchParty = window.OpenWatchParty || {};
  const actions = OWP.actions = OWP.actions || {};
  const state = OWP.state;
  const utils = OWP.utils;
  const ui = OWP.ui;
  const { DEFAULT_WS_URL } = OWP.constants;

  const INVITE_PARAM = utils.INVITE_PARAM || 'owp_invite';
  const INVITE_REQUEST_TIMEOUT_MS = 10000;

  // The room in the URL's ticket is only a hint; the session server verifies
  // the signature and the room scope before joining.
  const decodeInviteRoom = (ticket) => {
    try {
      const payload = String(ticket).split('.')[1];
      if (!payload) return '';
      const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
      const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
      const claims = JSON.parse(atob(padded));
      return typeof claims?.room === 'string' ? claims.room : '';
    } catch (err) {
      return '';
    }
  };

  // The ticket endpoint lives beside the WebSocket path on the session server.
  const inviteEndpoint = (sessionServerUrl) => {
    try {
      const url = new URL(sessionServerUrl);
      url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
      url.pathname = `${url.pathname.replace(/\/ws$/, '')}/invite`;
      url.search = '';
      url.hash = '';
      return url.href;
    } catch (err) {
      return '';
    }
  };

  const removeInviteParam = () => {
    const history = window.history;
    if (!history || typeof history.replaceState !== 'function' || !window.location?.href) return;
    const url = new URL(window.location.href);
    if (!url.searchParams.has(INVITE_PARAM)) return;
    url.searchParams.delete(INVITE_PARAM);
    history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  };

  // Read the ticket out of the page URL on load. It is consumed only once the
  // connection is authenticated, so a login round-trip does not lose the link.
  const captureInviteLink = (href = window.location?.href) => {
    const ticket = utils.parseInviteTicket(href);
    if (!ticket) return false;
    state.pendingInviteTicket = ticket;
    return true;
  };

  const consumePendingInvite = () => {
    const ticket = state.pendingInviteTicket;
    if (!ticket) return false;
    state.pendingInviteTicket = '';
    removeInviteParam();
    const roomId = decodeInviteRoom(ticket);
    if (!roomId) {
      ui.showToast('This invite link is invalid');
      return false;
    }
    state.inviteJoinPending = true;
    actions.joinRoom(roomId, false, ticket);
    return true;
  };

  const copyToClipboard = async (text) => {
    const clipboard = window.navigator?.clipboard;
    if (!clipboard || typeof clipboard.writeText !== 'function') return false;
    try {
      await clipboard.writeText(text);
      return true;
    } catch (err) {
      return false;
    }
  };

  const inviteRequest = async (endpoint, roomId, ttlSeconds) => {
    const controller = new AbortController();
    const timeout = OWP.timers.setTimeout(
      () => controller.abort(),
      INVITE_REQUEST_TIMEOUT_MS,
      'invite'
    );
    try {
      return await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${state.authToken}`
        },
        body: JSON.stringify({ room_id: roomId, ttl_seconds: ttlSeconds }),
        signal: controller.signal
      });
    } finally {
      OWP.timers.clear(timeout);
    }
  };

  // Host-only: asks the session server for a room-scoped ticket, turns it into
  // a link to the Jellyfin Web root and copies it to the clipboard.
  const copyInviteLink = async () => {
    if (!state.inRoom || !state.isHost) return false;
    if (!state.authToken) {
      ui.showToast('Invite links require an authenticated watch party');
      return false;
    }
    const sessionServerUrl = utils.normalizeSessionServerUrl(state.wsUrl || DEFAULT_WS_URL);
    if (!sessionServerUrl.valid) {
      ui.showToast(sessionServerUrl.error);
      return false;
    }
    const endpoint = inviteEndpoint(sessionServerUrl.url);
    if (!endpoint) {
      ui.showToast('The watch party server URL is invalid');
      return false;
    }
    let response;
    try {
      response = await inviteRequest(endpoint, state.roomId, state.inviteTtlSeconds);
    } catch (err) {
      ui.showToast('Could not reach the watch party server');
      return false;
    }
    let data = null;
    try {
      data = await response.json();
    } catch (err) {
      data = null;
    }
    if (!response.ok || typeof data?.ticket !== 'string' || !data.ticket) {
      const error = response.status === 404 && typeof data?.error !== 'string'
        ? 'Could not reach the invite service. Check that your reverse proxy sends /invite to the session server.'
        : data?.error || `Could not create the invite link (HTTP ${response.status})`;
      ui.showToast(error);
      return false;
    }
    const link = utils.buildInviteUrl(data.ticket);
    if (!link) {
      ui.showToast('Could not create the invite link');
      return false;
    }
    const copied = await copyToClipboard(link);
    ui.showToast(copied ? 'Invite link copied to the clipboard' : `Invite link: ${link}`);
    return true;
  };

  Object.assign(actions, {
    captureInviteLink,
    consumePendingInvite,
    copyInviteLink,
    decodeInviteRoom
  });
})();
