(() => {
  const OWP = window.OpenWatchParty = window.OpenWatchParty || {};
  const state = OWP.state;
  const actions = OWP.actions;
  const t = OWP.i18n.t;
  let sequence = 0;
  const accountId = value => String(value || '').replace(/-/g, '').toLowerCase();
  // The socket keeps the previous account until re-authentication; private lists must not leak to the next Jellyfin user.
  const sameAccount = () => {
    const jellyfinUser = window.ApiClient?.getCurrentUserId?.();
    return !jellyfinUser || !state.userId || accountId(jellyfinUser) === accountId(state.userId);
  };
  const supported = () => state.serverFeatures.includes('persistent_rooms')
    && state.connectionPhase === 'authenticated' && state.ws?.readyState === 1 && sameAccount();
  const update = () => OWP.ui.updateSavedSessions?.();
  const identity = () => ({ ws: state.ws, userId: state.userId });
  const current = request => request && request.ws === state.ws && request.userId === state.userId && supported();
  const request = (action, id) => ({ ...identity(), action, id, requestId: `saved-${++sequence}` });
  const reset = () => {
    OWP.timers.clearScope('saved-sessions');
    Object.assign(state, OWP.stateFactories.createSavedSessionState());
    update();
  };
  const watchTimeout = pending => {
    OWP.timers.setTimeout(() => {
      if (state.savedSessionPending !== pending || !current(pending)) return;
      state.savedSessionPending = null;
      state.savedResumeAfterLeave = null;
      state.savedSessionsError = t('savedRequestUncertain');
      actions.listSavedSessions();
      update();
    }, 20000, 'saved-sessions');
  };
  const listSavedSessions = () => {
    if (!supported()) return;
    const pending = request('list');
    state.savedListRequest = pending;
    actions.send('list_saved_sessions', { request_id: pending.requestId });
    OWP.timers.setTimeout(() => {
      if (state.savedListRequest !== pending || !current(pending)) return;
      state.savedListRequest = null; state.savedSessionsError = t('savedLoadFailed'); update();
    }, 15000, 'saved-sessions');
    update();
  };
  const mutate = (action, id, roomId) => {
    if (!supported() || state.savedSessionPending) return;
    if (action === 'save' && (!state.inRoom || !state.isHost || roomId !== state.roomId)) return;
    if (id && !state.savedSessions.some(session => session.id === id && !session.active)) return;
    const pending = request(action, id);
    state.savedSessionPending = pending; state.savedSessionsError = '';
    actions.send({ save: 'save_room_session', discard: 'discard_saved_session', resume: 'resume_saved_session' }[action], {
      request_id: pending.requestId, ...(id ? { id } : {})
    }, roomId);
    watchTimeout(pending); update();
  };
  const resumeSavedSession = async id => {
    if (!supported() || state.savedSessionPending) return;
    const session = state.savedSessions.find(entry => entry.id === id && !entry.active);
    if (!session) return;
    if (state.inRoom) {
      state.savedResumeAfterLeave = { ...identity(), id, roomId: state.roomId };
      state.roomBarSection = 'leave';
      OWP.ui.updateLeaveConfirm?.();
      OWP.ui._panelViews.applyRoomSection?.();
      return;
    }
    const pending = request('checking', id);
    state.savedSessionPending = pending; state.savedSessionsError = ''; watchTimeout(pending); update();
    try {
      const api = window.ApiClient;
      if (!api?.getItem) throw new Error('unavailable');
      await api.getItem(api.getCurrentUserId(), session.media_id);
      if (state.savedSessionPending !== pending || !current(pending)) return;
      state.savedSessionPending = null;
      mutate('resume', id);
    } catch (err) {
      if (state.savedSessionPending !== pending || !current(pending)) return;
      state.savedSessionPending = null; state.savedSessionsError = t('savedMediaUnavailable'); update();
    }
  };
  const onList = msg => {
    const pending = state.savedListRequest;
    if (!current(pending) || msg.payload.request_id !== pending.requestId) return;
    state.savedListRequest = null; state.savedSessions = msg.payload.sessions;
    state.savedSessionsReceived = true; state.savedSessionsError = ''; update();
  };
  const onResult = msg => {
    const pending = state.savedSessionPending;
    if (!current(pending) || msg.payload.request_id !== pending.requestId || msg.payload.action !== pending.action) return;
    if (msg.payload.action === 'resume') state.savedResumeRoomId = msg.payload.room_id;
    state.savedSessionPending = null;
    state.savedSessionConfirmation = null;
    state.savedSessionsError = '';
    if (msg.payload.action === 'discard') state.savedSessions = state.savedSessions.filter(session => session.id !== msg.payload.id);
    if (msg.payload.action === 'save') OWP.ui.showToast?.(t('savedSessionSaved'));
    listSavedSessions(); update();
  };
  const errorKey = code => ({
    SAVED_SESSION_CAPACITY: 'savedCapacity', SAVED_SESSION_NOT_FOUND: 'savedNotFound',
    SAVED_SESSION_BUSY: 'savedBusy', SAVED_SESSION_ALREADY_IN_ROOM: 'savedLeaveFirst',
    SAVED_SESSION_PERMISSION_REQUIRED: 'savedPermission', ROOM_SAVE_IN_PROGRESS: 'savedSaving',
  }[code] || 'savedOperationFailed');
  const onError = msg => {
    const pending = state.savedSessionPending;
    const listing = state.savedListRequest;
    if (current(pending) && msg.payload.request_id === pending.requestId) {
      state.savedSessionPending = null; state.savedResumeAfterLeave = null;
      state.savedSessionsError = t(errorKey(msg.payload.code)); update();
    } else if (current(listing) && msg.payload.request_id === listing.requestId) {
      state.savedListRequest = null; state.savedSessionsError = t(errorKey(msg.payload.code)); update();
    }
  };
  const leaveAndResume = () => {
    const flow = state.savedResumeAfterLeave;
    if (!current(flow) || flow.roomId !== state.roomId || state.savedSessionPending) return;
    const pending = { ...request('leave', flow.id), roomId: flow.roomId };
    state.savedSessionPending = pending;
    actions.send('leave_room', {}, flow.roomId);
    watchTimeout(pending); update();
  };
  const onRoomLeft = msg => {
    const pending = state.savedSessionPending;
    if (!current(pending) || pending.action !== 'leave' || msg.room !== pending.roomId) return;
    const id = pending.id;
    state.savedSessionPending = null; state.savedResumeAfterLeave = null;
    actions.resetRoomState(); OWP.ui.render(true);
    return resumeSavedSession(id);
  };
  const onGenericError = msg => {
    const pending = state.savedSessionPending;
    if (!current(pending) || pending.action !== 'leave') return false;
    state.savedSessionPending = null; state.savedResumeAfterLeave = null;
    state.savedSessionsError = t(errorKey(msg.payload.code)); state.roomBarSection = 'saved';
    update(); return true;
  };
  Object.assign(actions, { listSavedSessions, saveRoomSession: roomId => mutate('save', undefined, roomId), resumeSavedSession, discardSavedSession: id => mutate('discard', id) });
  OWP.savedSessions = { supported, sameAccount, reset, onList, onResult, onError, onRoomLeft, onGenericError, leaveAndResume, onAuthenticated: () => {
    if (supported()) listSavedSessions(); else reset();
  } };
})();
