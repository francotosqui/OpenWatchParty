(() => {
  const OWP = window.OpenWatchParty = window.OpenWatchParty || {};
  const h = OWP._wsHandlers = OWP._wsHandlers || {};
  const state = OWP.state;
  const ui = OWP.ui;
  const t = OWP.i18n.t;

  h.handleRoomList = (msg) => {
    state.rooms = msg.payload || [];
    if (!state.inRoom) ui.updateRoomListUI();
    ui.renderHomeWatchParties();
  };

  h.handleClientHello = (msg) => {
    if (msg.payload && msg.payload.client_id) {
      state.clientId = msg.payload.client_id;
      ui.render();
    }
  };

  h.handleAuthSuccess = () => {
    if (OWP.actions?.handleAuthenticatedConnection) {
      OWP.actions.handleAuthenticatedConnection();
    }
  };

  h.handleParticipantsUpdate = (msg) => {
    state.participantCount = msg.payload.participant_count;
    if (state.inRoom) ui.updateParticipantList();
    if (state.lastParticipantCount && state.participantCount > state.lastParticipantCount) {
      ui.showToast(t('participantJoined'));
    }
    state.lastParticipantCount = state.participantCount;
  };

  h.handleClientLeft = (msg) => {
    if (msg.payload?.participant_count !== undefined) {
      state.participantCount = msg.payload.participant_count;
      if (state.inRoom) {
        ui.updateParticipantList();
        ui.showToast(t('participantLeft'));
      }
      state.lastParticipantCount = state.participantCount;
    }
  };

  h.handleParticipantList = (msg) => {
    if (!state.inRoom || msg.room !== state.roomId) return;
    state.participants = msg.payload.participants.map(participant => ({
      name: participant.name,
      isHost: participant.is_host
    }));
    ui.updateParticipantList();
  };

  h.handleRoomClosed = (msg) => {
    if (OWP.actions?.cancelRoomRejoin) OWP.actions.cancelRoomRejoin();
    if (OWP.actions?.resetRoomState) OWP.actions.resetRoomState();
    else {
      state.inRoom = false;
      state.roomId = '';
    }
    const reason = OWP.i18n.localizeRoomClosedReason(msg.payload?.reason);
    ui.showToast(reason);
    ui.render();
  };

  h.handleError = (msg) => {
    const message = OWP.i18n.localizeServerError(msg.payload?.code, msg.payload?.message);
    console.error('[OpenWatchParty] Server error:', msg.payload?.code, msg.payload?.message);
    if (state.inviteJoinPending) {
      // A bad or expired invite must fall back to the normal room list.
      state.inviteJoinPending = false;
      if (OWP.actions?.resetRoomState) OWP.actions.resetRoomState();
      ui.showToast(message);
      ui.render();
      return;
    }
    if (state.rejoinPending && OWP.actions?.failRoomRejoin) {
      OWP.actions.failRoomRejoin(message);
      return;
    }
    ui.showToast(message);
  };
})();
