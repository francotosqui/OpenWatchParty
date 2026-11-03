(() => {
  const OWP = window.OpenWatchParty = window.OpenWatchParty || {};
  const ui = OWP.ui = OWP.ui || {};
  const views = ui._panelViews;
  const state = OWP.state;
  const t = OWP.i18n.t;
  const { createElement, createIcon } = views;
  const supported = () => state.serverFeatures.includes('persistent_rooms') && state.connectionPhase === 'authenticated';
  const open = () => state.inRoom ? state.roomBarSection === 'saved' : state.savedSessionsOpen;
  const time = value => {
    const seconds = Math.max(0, Math.floor(value));
    const minutes = Math.floor(seconds / 60);
    return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
  };
  const date = value => new Date(value).toLocaleString(OWP.i18n.locale(), { dateStyle: 'short', timeStyle: 'short' });
  const button = (label, className, handler, id) => {
    const result = createElement('button', className, label);
    result.type = 'button'; if (id) result.id = id;
    result.onclick = handler; return result;
  };
  const returnFocus = id => document.getElementById(id)?.focus?.({ preventScroll: true });
  const cancelConfirmation = () => {
    const confirm = state.savedSessionConfirmation;
    state.savedSessionConfirmation = null;
    updateSavedSessions();
    returnFocus(confirm?.returnId || 'owp-btn-saved');
  };
  const ask = (action, session, returnId) => {
    state.savedSessionConfirmation = { action, id: session?.id, name: session?.name || state.roomName, returnId };
    updateSavedSessions();
  };
  const renderConfirmation = () => {
    const existing = document.getElementById('owp-saved-confirm');
    const confirmation = state.savedSessionConfirmation;
    if (!confirmation || !supported()) { existing?.remove(); return; }
    const key = JSON.stringify(confirmation);
    if (existing?.dataset.confirmKey === key) return;
    existing?.remove();
    const overlay = createElement('div', 'owp-saved-overlay');
    overlay.id = 'owp-saved-confirm'; overlay.dataset.confirmKey = key;
    const dialog = createElement('div', 'owp-saved-dialog');
    dialog.setAttribute('role', 'alertdialog'); dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'owp-saved-confirm-title');
    dialog.setAttribute('aria-describedby', 'owp-saved-confirm-description');
    const title = createElement('h3', '', t(confirmation.action === 'save' ? 'savedSaveQuestion' : 'savedDiscardQuestion'));
    title.id = 'owp-saved-confirm-title';
    const description = createElement('p', '', t(confirmation.action === 'save' ? 'savedSaveExplanation' : 'savedDiscardExplanation', { name: confirmation.name }));
    description.id = 'owp-saved-confirm-description';
    const controls = createElement('div', 'owp-saved-dialog-actions');
    const cancel = button(t('cancel'), 'owp-pill-btn secondary', cancelConfirmation, 'owp-saved-confirm-cancel');
    const accept = button(t(confirmation.action === 'save' ? 'savedSaveClose' : 'savedDiscard'), `owp-pill-btn ${confirmation.action === 'save' ? 'primary' : 'danger'}`, () => {
      state.savedSessionConfirmation = null;
      if (confirmation.action === 'save') OWP.actions.saveRoomSession();
      else OWP.actions.discardSavedSession(confirmation.id);
      updateSavedSessions(); returnFocus(confirmation.returnId);
    }, 'owp-saved-confirm-accept');
    controls.append(cancel, accept); dialog.append(title, description, controls); overlay.appendChild(dialog);
    overlay.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancelConfirmation(); }
      if (event.key === 'Tab') {
        event.preventDefault();
        if (document.activeElement === cancel) accept.focus(); else cancel.focus();
      }
    });
    document.body.appendChild(overlay); cancel.focus({ preventScroll: true });
  };
  const createSavedSessionsButton = () => {
    const result = button('', 'owp-bar-btn owp-saved-button', () => {
      state.savedSessionConfirmation = null;
      if (state.inRoom) views.toggleRoomSection('saved');
      else state.savedSessionsOpen = !state.savedSessionsOpen;
      if (open()) OWP.actions?.listSavedSessions?.();
      updateSavedSessions();
    }, 'owp-btn-saved');
    result.title = t('savedSessions'); result.setAttribute('aria-label', t('savedSessions'));
    result.setAttribute('aria-controls', 'owp-saved-section');
    result.appendChild(createIcon('bookmark')); return result;
  };
  const sessionCard = session => {
    const card = createElement('article', 'owp-saved-card');
    const discardId = `owp-saved-discard-${session.id}`;
    const discard = button('', 'owp-bar-btn owp-saved-discard', () => ask('discard', session, discardId), discardId);
    discard.title = t('savedDiscardName', { name: session.name }); discard.setAttribute('aria-label', discard.title);
    discard.appendChild(createIcon('x')); discard.disabled = session.active || Boolean(state.savedSessionPending);
    if (session.active) discard.title = t('savedBusy');
    const heading = createElement('h4', '', session.name);
    const media = createElement('div', 'owp-saved-media', session.media_title);
    const meta = createElement('div', 'owp-saved-meta', t('savedAt', { date: date(session.saved_at_ms), count: session.queue_count }));
    const bottom = createElement('div', 'owp-saved-bottom');
    const position = createElement('div');
    position.append(createElement('div', 'owp-saved-position', t('savedPosition', { position: time(session.position) })), createElement('div', 'owp-saved-meta', t('savedPaused')));
    const resume = button(t(session.active ? 'savedInProgress' : 'savedResume'), 'owp-pill-btn primary', () => OWP.actions.resumeSavedSession(session.id), `owp-saved-resume-${session.id}`);
    resume.disabled = session.active || Boolean(state.savedSessionPending);
    bottom.append(position, resume); card.append(discard, heading, media, meta, bottom);
    if (session.expires_at_ms) card.appendChild(createElement('div', 'owp-saved-meta', t('savedExpires', { date: date(session.expires_at_ms) })));
    return card;
  };
  const updateSavedSessions = () => {
    const panel = document.getElementById(OWP.constants.PANEL_ID);
    if (!panel) return;
    if (!supported()) {
      document.getElementById('owp-btn-saved')?.remove(); document.getElementById('owp-saved-section')?.remove();
      document.getElementById('owp-saved-confirm')?.remove(); return;
    }
    const host = panel.querySelector('.owp-room-bar') || panel.querySelector('.owp-header-actions');
    const close = host?.querySelector('.owp-close-btn');
    if (!host || !close) return;
    let control = document.getElementById('owp-btn-saved');
    if (!control) { control = createSavedSessionsButton(); host.insertBefore(control, close); }
    control.setAttribute('aria-expanded', String(open()));
    control.classList.toggle('active', open());
    let count = control.querySelector('.owp-saved-count');
    if (state.savedSessions.length) {
      if (!count) { count = createElement('span', 'owp-saved-count'); control.appendChild(count); }
      count.textContent = String(state.savedSessions.length);
    } else count?.remove();
    const parent = state.inRoom ? document.getElementById('owp-room-drop') : panel;
    let section = document.getElementById('owp-saved-section');
    if (!section) { section = createElement('section', 'owp-saved-section'); section.id = 'owp-saved-section'; parent.appendChild(section); }
    section.hidden = !open();
    if (!state.inRoom) {
      panel.querySelector('.owp-lobby-container')?.classList.toggle('hide', open());
      const help = document.getElementById('owp-help'); if (help && open()) help.hidden = true;
    }
    const signature = JSON.stringify([state.savedSessions, state.savedSessionsReceived, state.savedSessionsError, Boolean(state.savedListRequest), state.savedSessionPending?.action, state.inRoom, state.isHost, state.roomId, OWP.i18n.locale()]);
    if (section.dataset.viewKey !== signature) {
      const active = document.activeElement;
      const focusId = active && section.contains(active) ? active.id : '';
      section.dataset.viewKey = signature;
      const heading = createElement('h3', 'owp-saved-heading', t('savedSessions'));
      const intro = createElement('p', 'owp-saved-intro', t('savedSessionsHint'));
      const content = createElement('div', 'owp-saved-list');
      if (state.savedSessions.length) state.savedSessions.forEach(session => content.appendChild(sessionCard(session)));
      else content.appendChild(createElement('p', 'owp-saved-meta', t(state.savedListRequest ? 'loading' : 'savedEmpty')));
      section.replaceChildren(heading, intro, content);
      if (state.savedSessionsError) {
        const error = createElement('div', 'owp-saved-error', state.savedSessionsError); error.setAttribute('role', 'alert');
        error.appendChild(button(t('savedRefresh'), 'owp-pill-btn secondary', () => OWP.actions.listSavedSessions(), 'owp-saved-refresh')); section.appendChild(error);
      }
      if (state.savedSessionPending) section.appendChild(createElement('div', 'owp-saved-meta', t(state.savedSessionPending.action === 'save' ? 'savedSaving' : 'savedWorking')));
      if (state.inRoom && state.isHost) {
        const footer = createElement('div', 'owp-saved-footer');
        const save = button(t('savedSaveClose'), 'owp-pill-btn secondary owp-saved-save', () => ask('save', null, 'owp-saved-save-current'), 'owp-saved-save-current');
        save.prepend(createIcon('bookmark')); save.disabled = Boolean(state.savedSessionPending);
        footer.append(createElement('div', 'owp-saved-meta', t('savedCurrent')), save, createElement('p', 'owp-saved-meta', t('savedSaveHint'))); section.appendChild(footer);
      }
      if (focusId) returnFocus(focusId);
    }
    if (state.inRoom) views.applyRoomSection?.();
    renderConfirmation();
  };
  Object.assign(ui, { updateSavedSessions, createSavedSessionsButton });
})();
