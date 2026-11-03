(() => {
  const OWP = window.OpenWatchParty = window.OpenWatchParty || {};
  const ui = OWP.ui = OWP.ui || {};
  const views = ui._panelViews = ui._panelViews || {};
  const state = OWP.state;
  const t = OWP.i18n.t;
  const { createElement, createIcon } = views;
  const { PANEL_ID } = OWP.constants;


  // Names when the server sends them (participant_list), otherwise the count,
  // so an older session server still shows something useful. Each name and the
  // host badge are separate elements, so a name such as "Ana (host)" or one
  // with commas cannot pass for the host or for several people.
  // Each participant's status (participant_statuses), shown under the name with
  // a colored dot. Older servers and clients send none: the row stays as it was.
  const PARTICIPANT_STATUS = {
    playing: { tone: 'good' },
    paused: { tone: 'idle' },
    in_sync: { tone: 'good' },
    catching_up: { tone: 'warn' },
    buffering: { tone: 'warn' },
    loading: { tone: 'info' },
    blocked: { tone: 'bad' },
    not_watching: { tone: 'idle' }
  };


  // Each participant's audio and subtitle tracks for the room's item
  // (participant_tracks), in a box under the row that the arrow beside the
  // name opens. Only to see them: nothing changes anyone's tracks. One box is
  // open at a time, and a press in the panel outside it closes it.
  let openTracks = '';
  const tracksKey = (participant, index) => `${state.roomId}|${index}|${participant.name}`;
  const roomTracks = participant => (participant.tracks && state.roomMediaId
    && participant.tracks.media_id === String(state.roomMediaId).toLowerCase() ? participant.tracks : null);

  // The language of a code such as "spa" or "pt-BR", in the interface's own
  // language; '' when it is unknown.
  const languageName = (code) => {
    if (!code || code.toLowerCase() === 'und') return '';
    const language = OWP.i18n.locale();
    try {
      const name = new Intl.DisplayNames([language], { type: 'language' }).of(code);
      return name ? name.charAt(0).toLocaleUpperCase(language) + name.slice(1) : code;
    } catch (err) {
      return code;
    }
  };

  // A track by its title, else by its language; none is "Off" for subtitles.
  // A forced one is marked, unless its title already says so in the
  // interface language, as Jellyfin's own track names do.
  const trackLabel = (track, kind) => {
    if (!track) return t(kind === 'subtitle' ? 'tracksOff' : 'tracksNone');
    const name = track.title || languageName(track.language) || t('unknown');
    if (!track.forced) return name;
    const forced = t('tracksForced', { track: '' }).replace(/[()]/g, '').trim().toLocaleLowerCase();
    return track.title?.toLocaleLowerCase().includes(forced) ? name : t('tracksForced', { track: name });
  };

  const tracksBox = (tracks, id) => {
    const box = createElement('div', 'owp-tracks');
    box.id = id;
    for (const [key, kind] of [['tracksAudio', 'audio'], ['tracksSubtitles', 'subtitle']]) {
      box.append(createElement('span', 'owp-tracks-label', t(key)), createElement('span', 'owp-tracks-value', trackLabel(tracks[kind], kind)));
    }
    return box;
  };

  const tracksFold = (key, name, boxId) => {
    const fold = createElement('button', 'owp-bar-btn owp-tracks-fold');
    fold.type = 'button';
    fold.dataset.tracksKey = key;
    fold.setAttribute('aria-expanded', String(openTracks === key));
    fold.setAttribute('aria-controls', boxId);
    fold.setAttribute('aria-label', t('tracksOf', { name }));
    fold.title = t('tracksOf', { name });
    const arrow = createIcon('chevron');
    arrow.setAttribute('class', 'owp-icon owp-icon-chevron owp-expand');
    fold.appendChild(arrow);
    fold.onclick = () => {
      openTracks = openTracks === key ? '' : key;
      updateParticipantList();
      const list = document.getElementById('owp-participants-list');
      const again = Array.from(list?.querySelectorAll('.owp-tracks-fold') || []).find(other => other.dataset.tracksKey === key);
      if (again?.focus) again.focus();
    };
    return fold;
  };

  // A press in the panel outside the open box and the arrows closes the box.
  const closeTracksOnPress = new WeakSet();
  const watchPresses = () => {
    const panel = document.getElementById(PANEL_ID);
    if (!panel || closeTracksOnPress.has(panel)) return;
    closeTracksOnPress.add(panel);
    panel.addEventListener('pointerdown', (event) => {
      if (!openTracks || event.target?.closest?.('.owp-tracks, .owp-tracks-fold')) return;
      openTracks = '';
      // Keep the pressed control alive until its click fires (for example,
      // the moderation menu beside these tracks).
      panel.querySelectorAll('.owp-tracks').forEach(box => box.remove());
      panel.querySelectorAll('.owp-tracks-fold').forEach(fold => fold.setAttribute('aria-expanded', 'false'));
    });
  };

  const canModerate = participant => (state.isHost || state.isAdministrator)
    && state.serverFeatures.includes('room_moderation')
    && participant.id
    && participant.id !== state.clientId
    && participant.id !== (state.roomHostId || state.participants.find(member => member.isHost)?.id)
    && (state.isHost || !state.administratorParticipantIds.includes(participant.id));

  let roleConfirmation = null;
  let offlineRoleConfirm = false;


  const moderationButton = (className, label, action) => {
    const button = createElement('button', className, label);
    button.type = 'button';
    button.dataset.moderationAction = action;
    return button;
  };


  const closeModeration = (list, participantId) => {
    roleConfirmation = null;
    state.moderationOpenParticipantId = '';
    fillParticipantList(list);
    const button = Array.from(list.querySelectorAll('.owp-mod-more'))
      .find(candidate => candidate.dataset.participantId === participantId);
    if (button) button.focus({ preventScroll: true });
  };


  const createModerationControls = (list, participant, name) => {
    const open = state.moderationOpenParticipantId === participant.id;
    const more = createElement('button', 'owp-bar-btn owp-mod-more');
    more.type = 'button';
    more.dataset.participantId = participant.id;
    more.dataset.moderationAction = 'options';
    more.title = t('participantOptions', { name });
    more.setAttribute('aria-label', more.title);
    more.setAttribute('aria-expanded', String(open));
    more.appendChild(views.createIcon('more'));
    more.onclick = () => {
      state.moderationOpenParticipantId = open ? '' : participant.id;
      fillParticipantList(list);
    };
    if (!open) return [more];

    const actions = createElement('div', 'owp-mod-actions');
    const hint = createElement('div', 'owp-mod-hint', t('moderationHint'));
    const buttons = createElement('div', 'owp-mod-buttons');
    const cancel = moderationButton('owp-pill-btn secondary owp-mod-cancel', t('cancel'), 'cancel');
    const remove = moderationButton('owp-pill-btn secondary owp-mod-remove', t('removeParticipant'), 'remove');
    remove.prepend(createIcon('user-x'));
    const block = moderationButton('owp-pill-btn danger owp-mod-block', t('blockParticipant'), 'block');
    const isAdministrator = state.administratorParticipantIds.includes(participant.id);
    const canChangeRole = state.isHost && state.serverFeatures.includes('room_administrator')
      && (isAdministrator || !state.administratorUserId);
    cancel.onclick = () => closeModeration(list, participant.id);
    remove.onclick = () => {
      OWP.actions?.removeParticipant?.(participant.id, false);
      closeModeration(list, participant.id);
    };
    block.onclick = () => {
      OWP.actions?.removeParticipant?.(participant.id, true);
      closeModeration(list, participant.id);
    };
    actions.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      closeModeration(list, participant.id);
    });
    if (canChangeRole) {
      const enabled = !isAdministrator;
      const role = moderationButton('owp-pill-btn secondary owp-mod-role', t(enabled ? 'makeAdministrator' : 'removeAdministrator'), 'role');
      role.dataset.participantId = participant.id;
      role.onclick = () => {
        roleConfirmation = { participantId: participant.id, enabled };
        fillParticipantList(list);
        list.querySelector('[data-moderation-action="confirm-role"]')?.focus?.({ preventScroll: true });
      };
      buttons.appendChild(role);
    }
    if (roleConfirmation?.participantId === participant.id) {
      const confirmation = createElement('div', 'owp-mod-confirm');
      confirmation.appendChild(createElement('span', '', t(roleConfirmation.enabled ? 'confirmMakeAdministrator' : 'confirmRemoveAdministrator', { name })));
      const confirm = moderationButton('owp-pill-btn primary', t('confirm'), 'confirm-role');
      confirm.dataset.participantId = participant.id;
      confirm.onclick = () => {
        OWP.actions?.setRoomAdministrator?.(participant.id, roleConfirmation.enabled);
        closeModeration(list, participant.id);
      };
      const cancelRole = moderationButton('owp-pill-btn secondary', t('cancel'), 'cancel-role');
      cancelRole.dataset.participantId = participant.id;
      cancelRole.onclick = () => closeModeration(list, participant.id);
      confirmation.append(confirm, cancelRole);
      actions.appendChild(confirmation);
    }
    buttons.append(cancel, remove, block);
    actions.append(hint, buttons);
    return [more, actions];
  };


  const createAccessControls = (creating = false) => {
    const group = createElement('div', creating ? 'owp-access owp-access-create' : 'owp-access');
    if (!creating) group.appendChild(createElement('div', 'owp-access-title', t('roomAccess')));
    for (const key of ['approval', 'unlisted']) {
      const value = creating ? state.createAccess : state.roomAccess;
      const row = createElement('div', 'owp-access-row');
      const text = createElement('span', 'owp-access-text');
      const label = key === 'approval' ? 'accessApproval' : 'accessUnlisted';
      text.append(createElement('span', 'owp-access-label', t(label)), createElement('span', 'owp-access-hint', t(`${label}Hint`)));
      const button = createElement('button', 'owp-switch');
      button.type = 'button';
      button.setAttribute('role', 'switch');
      button.setAttribute('aria-label', t(label));
      button.setAttribute('aria-checked', String(value[key]));
      button.onclick = () => {
        if (creating) {
          state.createAccess[key] = !state.createAccess[key];
          button.setAttribute('aria-checked', String(state.createAccess[key]));
        } else {
          OWP.actions.setRoomAccess(key === 'approval' ? !value.approval : value.approval, key === 'unlisted' ? !value.unlisted : value.unlisted);
        }
      };
      row.append(text, button);
      group.appendChild(row);
    }
    return group;
  };

  const requestRow = (request, card = false) => {
    const row = createElement('div', 'owp-participant owp-request-row');
    const avatar = createElement('span', 'owp-participant-avatar', Array.from(request.name || t('guest'))[0].toUpperCase());
    avatar.setAttribute('aria-hidden', 'true');
    const text = createElement('span', 'owp-participant-main');
    if (card) {
      const sentence = t('joinRequest', { name: request.name });
      const start = sentence.indexOf(request.name);
      text.append(document.createTextNode(sentence.slice(0, start)), createElement('strong', '', request.name), document.createTextNode(sentence.slice(start + request.name.length)));
    } else {
      text.append(createElement('span', 'owp-participant-name', request.name), createElement('span', 'owp-participant-status warn', t('wantsToJoin')));
    }
    const buttons = createElement('div', 'owp-request-buttons');
    for (const admit of [false, true]) {
      const button = createElement('button', `owp-pill-btn ${admit ? 'primary' : 'secondary'}`, t(admit ? 'letIn' : 'reject'));
      button.type = 'button';
      button.onclick = () => OWP.actions.answerJoin(request.id, admit);
      buttons.appendChild(button);
    }
    row.append(avatar, text, buttons);
    return row;
  };

  const updateAccessUI = () => {
    document.getElementById('owp-access-controls')?.remove();
    document.getElementById('owp-request-card')?.remove();
    document.getElementById('owp-request-badge')?.remove();
    if (!state.inRoom || !state.isHost || !state.serverFeatures.includes('room_access')) return;
    const people = document.getElementById('owp-people-section');
    if (people) {
      const controls = createAccessControls();
      controls.id = 'owp-access-controls';
      people.appendChild(controls);
    }
    if (!state.joinRequests.length || state.roomBarSection === 'people') return;
    const badge = createElement('span', 'owp-request-badge', state.joinRequests.length);
    badge.id = 'owp-request-badge';
    badge.setAttribute('aria-label', t('joinWaitingCount', { count: state.joinRequests.length }));
    document.getElementById('owp-btn-people')?.appendChild(badge);
    const card = createElement('div', 'owp-request-card');
    card.id = 'owp-request-card';
    card.appendChild(requestRow(state.joinRequests[0], true));
    if (state.joinRequests.length > 1) card.appendChild(createElement('div', 'owp-access-hint', t('moreWaiting', { count: state.joinRequests.length - 1 })));
    document.getElementById(OWP.constants.PANEL_ID)?.appendChild(card);
  };

  const fillParticipantList = (list) => {
    if (!state.participants.some(participant => canModerate(participant)
        && participant.id === state.moderationOpenParticipantId)) {
      state.moderationOpenParticipantId = '';
    }
    const active = document.activeElement;
    const focusedAction = active && list.contains(active) ? active.dataset?.moderationAction : '';
    const focusedParticipantId = active && list.contains(active) ? active.dataset?.participantId : '';
    const focusedTracksKey = active && list.contains(active) ? active.dataset?.tracksKey : '';
    watchPresses();
    if (!state.participants.length) {
      openTracks = '';
      list.replaceChildren(document.createTextNode(t('onlineCount', { count: state.participantCount || 1 })));
      return;
    }
    const keys = state.participants.map((participant, index) => (roomTracks(participant) ? tracksKey(participant, index) : ''));
    if (!keys.includes(openTracks)) openTracks = '';
    list.replaceChildren(...state.participants.map((participant, index) => {
      const name = participant.name || t('guest');
      const item = createElement('div', 'owp-participant');
      const avatar = OWP.avatars.create(name, participant.userId);
      const nameEl = createElement('span', 'owp-participant-name', name);
      const isOwner = state.roomHostId && participant.id ? participant.id === state.roomHostId : participant.isHost;
      const badge = isOwner ? createElement('span', 'owp-host-badge', t('owner'))
        : state.administratorParticipantIds.includes(participant.id) ? createElement('span', 'owp-host-badge', t('administrator')) : null;
      const status = PARTICIPANT_STATUS[participant.status];
      const moderation = canModerate(participant) ? createModerationControls(list, participant, name) : [];
      if (moderation.length > 1) item.classList.add('owp-mod-row');
      const tracks = roomTracks(participant);
      if (!status && !tracks) {
        item.append(avatar, nameEl);
        if (badge) item.appendChild(badge);
        item.append(...moderation);
        return item;
      }
      item.classList.add('owp-has-status');
      const line = createElement('span', 'owp-participant-line');
      line.appendChild(nameEl);
      if (badge) line.appendChild(badge);
      const main = createElement('span', 'owp-participant-main');
      main.appendChild(line);
      if (status) main.appendChild(createElement('span', `owp-participant-status ${status.tone}`, t(`status_${participant.status}`)));
      if (tracks) {
        const key = keys[index];
        const boxId = `owp-tracks-${index}`;
        line.appendChild(tracksFold(key, name, boxId));
        if (openTracks === key) main.appendChild(tracksBox(tracks, boxId));
      }
      item.append(avatar, main, ...moderation);
      return item;
    }));
    if (state.isHost && state.serverFeatures.includes('room_administrator')
        && state.administratorUserId && !state.administratorParticipantIds.length) {
      const offline = createElement('div', 'owp-mod-actions owp-offline-admin');
      offline.appendChild(createElement('span', 'owp-mod-hint', t('administratorDisconnected')));
      const revoke = moderationButton('owp-pill-btn secondary', t('removeAdministrator'), 'revoke-offline');
      revoke.onclick = () => {
        offlineRoleConfirm = true;
        fillParticipantList(list);
        list.querySelector('[data-moderation-action="confirm-offline"]')?.focus?.({ preventScroll: true });
      };
      offline.appendChild(revoke);
      if (offlineRoleConfirm) {
        const confirm = moderationButton('owp-pill-btn primary', t('confirm'), 'confirm-offline');
        confirm.onclick = () => {
          OWP.actions?.revokeOfflineAdministrator?.(state.administratorUserId);
          offlineRoleConfirm = false;
          fillParticipantList(list);
          list.querySelector('.owp-offline-admin button')?.focus?.({ preventScroll: true });
        };
        const cancel = moderationButton('owp-pill-btn secondary', t('cancel'), 'cancel-offline');
        cancel.onclick = () => {
          offlineRoleConfirm = false;
          fillParticipantList(list);
          list.querySelector('.owp-offline-admin button')?.focus?.({ preventScroll: true });
        };
        offline.append(createElement('span', 'owp-mod-hint', t('confirmOfflineAdministrator')), confirm, cancel);
      }
      list.appendChild(offline);
    } else {
      offlineRoleConfirm = false;
    }
    if (focusedAction) {
      const replacement = Array.from(list.querySelectorAll('button')).find(button =>
        button.dataset.moderationAction === focusedAction
        && (!focusedParticipantId || button.dataset.participantId === focusedParticipantId));
      if (replacement) replacement.focus({ preventScroll: true });
    }
    if (focusedTracksKey) {
      const replacement = Array.from(list.querySelectorAll('.owp-tracks-fold')).find(fold => fold.dataset.tracksKey === focusedTracksKey);
      if (replacement) replacement.focus({ preventScroll: true });
    }
    if (state.isHost && state.serverFeatures.includes('room_access')) {
      for (const request of state.joinRequests) list.appendChild(requestRow(request));
    }
  };


  const participantTotal = () => state.participants.length || state.participantCount || 1;


  // Icon-only buttons: the count goes in the accessible name too.
  const peopleLabel = () => t('participantsCount', { count: participantTotal() });


  const updateParticipantList = () => {
    const list = document.getElementById('owp-participants-list');
    if (list) fillParticipantList(list);
    const count = document.getElementById('owp-people-count');
    if (count) count.textContent = String(participantTotal());
    const button = document.getElementById('owp-btn-people');
    if (button) button.setAttribute('aria-label', peopleLabel());
    if (ui.updateRoomRoleControls) ui.updateRoomRoleControls();
  };

  Object.assign(views, { fillParticipantList, participantTotal, peopleLabel });
  Object.assign(ui, { updateParticipantList, createAccessControls, updateAccessUI });
})();
