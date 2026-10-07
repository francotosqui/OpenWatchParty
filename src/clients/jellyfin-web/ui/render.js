(() => {
  const OWP = window.OpenWatchParty = window.OpenWatchParty || {};
  const ui = OWP.ui = OWP.ui || {};
  const state = OWP.state;
  const { PANEL_ID, BTN_ID, DEFAULT_WS_URL, ROOM_MODE_CLASS } = OWP.constants;

  const createElement = (tag, className, text) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = String(text);
    return element;
  };

  // Outline icons for the room bar, from Tabler Icons (MIT, https://tabler.io/icons;
  // see THIRD_PARTY_NOTICES.md). Jellyfin only ships the filled Material icons.
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const ICON_PATHS = {
    users: ['M5 7a4 4 0 1 0 8 0a4 4 0 1 0 -8 0', 'M3 21v-2a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4v2', 'M16 3.13a4 4 0 0 1 0 7.75', 'M21 21v-2a4 4 0 0 0 -3 -3.85'],
    chat: ['M3 20l1.3 -3.9c-2.324 -3.437 -1.426 -7.872 2.1 -10.374c3.526 -2.501 8.59 -2.296 11.845 .48c3.255 2.777 3.695 7.266 1.029 10.501c-2.666 3.235 -7.615 4.215 -11.574 2.293l-4.7 1'],
    logout: ['M14 8v-2a2 2 0 0 0 -2 -2h-7a2 2 0 0 0 -2 2v12a2 2 0 0 0 2 2h7a2 2 0 0 0 2 -2v-2', 'M9 12h12l-3 -3', 'M18 15l3 -3'],
    x: ['M18 6l-12 12', 'M6 6l12 12'],
    chevron: ['M6 9l6 6l6 -6'],
    send: ['M10 14l11 -11', 'M21 3l-6.5 18a.55 .55 0 0 1 -1 0l-3.5 -7l-7 -3.5a.55 .55 0 0 1 0 -1l18 -6.5'],
    share: ['M6 12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0 -6 0', 'M18 6m-3 0a3 3 0 1 0 6 0a3 3 0 1 0 -6 0', 'M18 18m-3 0a3 3 0 1 0 6 0a3 3 0 1 0 -6 0', 'M8.7 10.7l6.6 -3.4', 'M8.7 13.3l6.6 3.4']
  };

  // The Watch Party icon for the header and player buttons: a screen with a
  // play button and two viewers. Original artwork contributed to the project
  // by francotosqui, drawn on Material's 24 grid with 2-unit lines so it sits
  // next to Jellyfin's own icons (Cast, Search) at the same size and weight.
  const WATCH_PARTY_ICON = [
    ['path', { fill: 'none', stroke: 'currentColor', 'stroke-width': '2', d: 'M5.9 15H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h18a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-2.9' }],
    ['path', { d: 'M10.2 6.9v4.6l4-2.3z' }],
    ['circle', { cx: '8.6', cy: '14.8', r: '1.9' }],
    ['circle', { cx: '15.4', cy: '14.8', r: '1.9' }],
    ['path', { d: 'M5 21a3.6 3.1 0 0 1 7.2 0zM11.8 21a3.6 3.1 0 0 1 7.2 0z' }]
  ];

  // Wrapped in `.material-icons` so it takes the size the native icons get in
  // each button.
  const createWatchPartyIcon = () => {
    const wrapper = createElement('span', 'material-icons owp-watch-party-icon');
    wrapper.setAttribute('aria-hidden', 'true');
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'currentColor');
    svg.setAttribute('focusable', 'false');
    WATCH_PARTY_ICON.forEach(([tag, attributes]) => {
      const shape = document.createElementNS(SVG_NS, tag);
      Object.entries(attributes).forEach(([name, value]) => shape.setAttribute(name, value));
      svg.appendChild(shape);
    });
    wrapper.appendChild(svg);
    return wrapper;
  };
  // The header buttons (ui/header.js) use it too.
  ui.createWatchPartyIcon = createWatchPartyIcon;

  const createIcon = (name) => {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', `owp-icon owp-icon-${name}`);
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    ICON_PATHS[name].forEach((d) => {
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', d);
      svg.appendChild(path);
    });
    return svg;
  };

  // Hides the panel. Keyboard focus inside it must not stay in a hidden panel:
  // it goes back to the button that opened the panel when that button is
  // shown, or out of the panel otherwise.
  const hidePanel = () => {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;
    const active = document.activeElement;
    const hadFocus = !!active && active !== panel && typeof panel.contains === 'function' && panel.contains(active);
    panel.classList.add('hide');
    if (!hadFocus) return;
    const opener = panel.dataset.opener && document.getElementById(panel.dataset.opener);
    if (opener && typeof opener.getClientRects === 'function' && opener.getClientRects().length > 0) opener.focus();
    else if (typeof active.blur === 'function') active.blur();
  };

  // Hides the panel from inside it, so closing does not mean reaching for the
  // button that opened it.
  const createCloseButton = () => {
    const button = createElement('button', 'owp-close-btn owp-bar-btn');
    button.type = 'button';
    button.title = 'Close panel';
    button.setAttribute('aria-label', 'Close panel');
    button.appendChild(createIcon('x'));
    button.onclick = hidePanel;
    return button;
  };

  const CREATE_ROOM_HINT_ID = 'owp-create-hint';
  const CREATE_ROOM_HINT = 'Start playing something to create a room.';

  // A room starts from what is playing; without it there is nothing to share.
  const canCreateRoom = () => Boolean(OWP.utils?.getPlayingItemId?.());

  const updateCreateRoomButton = () => {
    const button = document.getElementById('owp-btn-create');
    if (!button) return;
    const enabled = canCreateRoom();
    button.disabled = !enabled;
    const hint = document.getElementById(CREATE_ROOM_HINT_ID);
    if (hint) hint.hidden = enabled;
  };

  const renderLobby = (panel) => {
    const header = createElement('div', 'owp-header');
    header.append(createElement('span', 'owp-panel-title', 'OpenWatchParty'), document.createTextNode(' '));
    const status = createElement('span');
    status.id = 'owp-ws-indicator';
    const actions = createElement('span', 'owp-header-actions');
    actions.append(status, createCloseButton());
    header.appendChild(actions);

    const lobby = createElement('div', 'owp-lobby-container');
    const roomSection = createElement('div', 'owp-section');
    roomSection.appendChild(createElement('div', 'owp-label', 'Available rooms'));
    const roomList = createElement('div');
    roomList.id = 'owp-room-list';
    roomSection.appendChild(roomList);
    const createSection = createElement('div', 'owp-section owp-create-section');
    const btn = createElement('button', 'owp-btn', 'Create Room');
    btn.id = 'owp-btn-create';
    btn.style.width = '100%';
    btn.onclick = () => OWP.actions && OWP.actions.createRoom && OWP.actions.createRoom();
    btn.setAttribute('aria-describedby', CREATE_ROOM_HINT_ID);
    const hint = createElement('div', 'owp-hint', CREATE_ROOM_HINT);
    hint.id = CREATE_ROOM_HINT_ID;
    createSection.append(btn, hint);
    lobby.append(roomSection, createSection);

    const footer = createElement('div', 'owp-footer');
    footer.append(document.createTextNode('Server: '), document.createTextNode(String(DEFAULT_WS_URL.replace(/^wss?:\/\//, '').replace('/ws', ''))));
    panel.replaceChildren(header, lobby, footer);
    ui.updateRoomListUI();
    updateCreateRoomButton();
  };

  // Names when the server sends them (participant_list), otherwise the count,
  // so an older session server still shows something useful. Each name and the
  // host badge are separate elements, so a name such as "Ana (host)" or one
  // with commas cannot pass for the host or for several people.
  const fillParticipantList = (list) => {
    if (!state.participants.length) {
      list.replaceChildren(document.createTextNode(`Online: ${String(state.participantCount || 1)}`));
      return;
    }
    list.replaceChildren(...state.participants.map((participant) => {
      const name = participant.name || 'Guest';
      const item = createElement('div', 'owp-participant');
      const avatar = createElement('span', 'owp-participant-avatar', Array.from(name)[0].toUpperCase());
      avatar.setAttribute('aria-hidden', 'true');
      item.append(avatar, createElement('span', 'owp-participant-name', name));
      if (participant.isHost) item.appendChild(createElement('span', 'owp-host-badge', 'Host'));
      return item;
    }));
  };

  const participantTotal = () => state.participants.length || state.participantCount || 1;

  // Icon-only buttons: the count goes in the accessible name too.
  const peopleLabel = () => `Participants, ${String(participantTotal())}`;

  const updateParticipantList = () => {
    const list = document.getElementById('owp-participants-list');
    if (list) fillParticipantList(list);
    const count = document.getElementById('owp-people-count');
    if (count) count.textContent = String(participantTotal());
    const button = document.getElementById('owp-btn-people');
    if (button) button.setAttribute('aria-label', peopleLabel());
  };

  const createBarButton = (id, label, iconName, sectionId) => {
    const button = createElement('button', 'owp-bar-btn');
    button.id = id;
    button.type = 'button';
    button.title = label;
    button.setAttribute('aria-label', label);
    if (sectionId) {
      button.setAttribute('aria-controls', sectionId);
      button.setAttribute('aria-expanded', 'false');
    }
    button.appendChild(createIcon(iconName));
    return button;
  };

  // The room view is a single bar; people, chat and the host's "close the
  // room" confirmation open one at a time in a drop-down below it.
  const ROOM_SECTIONS = [
    { name: 'people', sectionId: 'owp-people-section', buttonId: 'owp-btn-people' },
    { name: 'chat', sectionId: 'owp-chat-section', buttonId: 'owp-btn-chat' },
    { name: 'leave', sectionId: 'owp-leave-confirm', buttonId: 'owp-btn-leave' }
  ];

  const applyRoomSection = () => {
    const open = state.roomBarSection;
    const drop = document.getElementById('owp-room-drop');
    if (drop) drop.hidden = !open;
    ROOM_SECTIONS.forEach(({ name, sectionId, buttonId }) => {
      const section = document.getElementById(sectionId);
      if (section) section.hidden = name !== open;
      const button = document.getElementById(buttonId);
      if (button && button.getAttribute('aria-controls') === sectionId) button.setAttribute('aria-expanded', String(name === open));
    });
    // Read only when it is on screen: a redraw while the panel is hidden must
    // not mark messages that nobody saw.
    if (open === 'chat' && OWP.chat && OWP.chat.isChatVisible()) {
      OWP.chat.markRead();
      const messages = document.getElementById('owp-chat-messages');
      if (messages) messages.scrollTop = messages.scrollHeight;
    }
  };

  const toggleRoomSection = (name) => {
    state.roomBarSection = state.roomBarSection === name ? '' : name;
    applyRoomSection();
  };

  // Escape closes the open drop-down and puts focus back on its button.
  const closeRoomSectionFromKeyboard = (event) => {
    if (event.key !== 'Escape') return false;
    const open = ROOM_SECTIONS.find(section => section.name === state.roomBarSection);
    if (!open) return false;
    event.preventDefault();
    state.roomBarSection = '';
    applyRoomSection();
    const button = document.getElementById(open.buttonId);
    if (button) button.focus();
    return true;
  };

  const leaveRoom = () => {
    const action = state.isHost ? OWP.actions?.closeRoom : OWP.actions?.leaveRoom;
    if (action) action();
  };

  const renderRoom = (panel) => {
    const bar = createElement('div', 'owp-room-bar');
    const clientId = String(state.clientId).split('-')[1] || '...';
    // The last measured value, so a redraw does not blank it until the next pong.
    const latency = createElement('span', 'owp-latency', state.lastRttMs === null ? '-' : `${state.lastRttMs} ms`);
    latency.title = `Latency to the watch party server (client ${clientId})`;
    const roomName = createElement('span', 'owp-room-name', state.roomName);
    roomName.title = state.roomName;

    const peopleBtn = createBarButton('owp-btn-people', 'Participants', 'users', 'owp-people-section');
    peopleBtn.setAttribute('aria-label', peopleLabel());
    const peopleCount = createElement('span', 'owp-people-count', String(participantTotal()));
    peopleCount.id = 'owp-people-count';
    const arrow = createIcon('chevron');
    arrow.setAttribute('class', 'owp-icon owp-icon-chevron owp-expand');
    peopleBtn.append(peopleCount, arrow);
    peopleBtn.onclick = () => toggleRoomSection('people');

    const chatBtn = createBarButton('owp-btn-chat', 'Chat', 'chat', 'owp-chat-section');
    const badge = createElement('span', 'owp-chat-badge');
    badge.id = 'owp-chat-badge';
    chatBtn.appendChild(badge);
    chatBtn.onclick = () => toggleRoomSection('chat');

    // Leaving always asks first; for the host it ends the room for everyone.
    const leaveBtn = createBarButton('owp-btn-leave', state.isHost ? 'Close room' : 'Leave room', 'logout', 'owp-leave-confirm');
    leaveBtn.classList.add('danger');
    leaveBtn.onclick = () => toggleRoomSection('leave');

    // Invite links are minted by the host: guests get no button at all.
    const roomActions = [peopleBtn, chatBtn];
    if (state.isHost) {
      const inviteBtn = createBarButton('owp-btn-invite', 'Invite', 'share');
      inviteBtn.onclick = () => OWP.actions && OWP.actions.copyInviteLink && OWP.actions.copyInviteLink();
      roomActions.push(inviteBtn);
    }
    roomActions.push(leaveBtn);

    bar.append(ui.buildSyncStatusIndicator(), latency, roomName, ...roomActions, createCloseButton());

    const drop = createElement('div', 'owp-room-drop');
    drop.id = 'owp-room-drop';
    bar.addEventListener('keydown', closeRoomSectionFromKeyboard);
    drop.addEventListener('keydown', closeRoomSectionFromKeyboard);

    const peopleSection = createElement('div');
    peopleSection.id = 'owp-people-section';
    const participantList = createElement('div', 'owp-participants');
    participantList.id = 'owp-participants-list';
    fillParticipantList(participantList);
    peopleSection.appendChild(participantList);

    const chatSection = createElement('div');
    chatSection.id = 'owp-chat-section';
    const messages = createElement('div');
    messages.id = 'owp-chat-messages';
    const inputContainer = createElement('div');
    inputContainer.id = 'owp-chat-input-container';
    const input = createElement('input');
    input.id = 'owp-chat-input';
    input.type = 'text';
    input.placeholder = 'Type a message...';
    input.maxLength = 500;
    const send = createElement('button');
    send.id = 'owp-chat-send';
    send.type = 'button';
    send.title = 'Send message';
    send.setAttribute('aria-label', 'Send message');
    send.appendChild(createIcon('send'));
    inputContainer.append(input, send);
    chatSection.append(messages, inputContainer);

    const confirm = createElement('div', 'owp-leave-confirm');
    confirm.id = 'owp-leave-confirm';
    const cancel = createElement('button', 'owp-pill-btn secondary', 'Cancel');
    cancel.type = 'button';
    cancel.onclick = () => {
      toggleRoomSection('leave');
      leaveBtn.focus();
    };
    const confirmLeave = createElement('button', 'owp-pill-btn danger', state.isHost ? 'Close room' : 'Leave');
    confirmLeave.id = 'owp-btn-confirm-leave';
    confirmLeave.type = 'button';
    confirmLeave.onclick = leaveRoom;
    const question = state.isHost ? 'Close the room for everyone?' : 'Leave the room?';
    confirm.append(createElement('span', 'owp-leave-question', question), cancel, confirmLeave);
    drop.append(peopleSection, chatSection, confirm);

    panel.replaceChildren(bar, drop);
    applyRoomSection();
  };

  const setupChatInput = (panel) => {
    const chatInput = panel.querySelector('#owp-chat-input');
    const chatSend = panel.querySelector('#owp-chat-send');
    if (!chatInput || !chatSend) return;
    ui.stopPlayerCapture(chatInput);
    chatInput.addEventListener('keydown', (e) => {
      // The input stops key events from bubbling (so the player ignores
      // typing), so the drop-down's Escape handler is called from here.
      if (closeRoomSectionFromKeyboard(e)) return;
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (OWP.chat && OWP.chat.send(chatInput.value)) {
          chatInput.value = '';
        }
      }
    });
    chatSend.addEventListener('click', () => {
      if (OWP.chat && OWP.chat.send(chatInput.value)) {
        chatInput.value = '';
      }
    });
    if (OWP.chat) {
      OWP.chat.renderAllMessages();
      if (OWP.chat.isChatVisible()) OWP.chat.markRead();
      else OWP.chat.updateBadge();
    }
  };

  const render = (forceFullRender = false) => {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;
    if (!forceFullRender && panel.dataset.inRoom === String(state.inRoom) && panel.children.length > 0) {
      ui.updateStatusIndicator();
      ui.updateSyncIndicator();
      ui.updateRoomListUI();
      updateCreateRoomButton();
      ui.renderHomeWatchParties();
      return;
    }
    const redrawingRoom = state.inRoom
      && panel.dataset.inRoom === 'true'
      && panel.children.length > 0;
    const oldMessages = redrawingRoom ? panel.querySelector('#owp-chat-messages') : null;
    const messageNodes = oldMessages ? Array.from(oldMessages.childNodes) : null;
    const oldScrollTop = oldMessages ? Number(oldMessages.scrollTop) || 0 : 0;
    const wasChatAtBottom = oldMessages
      ? oldScrollTop + (Number(oldMessages.clientHeight) || 0) >= (Number(oldMessages.scrollHeight) || 0) - 1
      : true;
    const oldInput = redrawingRoom ? panel.querySelector('#owp-chat-input') : null;
    const chatDraft = oldInput ? oldInput.value : '';
    // A full draw replaces every control. Keyboard focus inside the panel
    // (on Create Room or Join, say) goes to the same control if it is drawn
    // again, or to the first one, instead of falling out of the dialog.
    const active = document.activeElement;
    const focusInside = !!active && active !== panel && typeof panel.contains === 'function' && panel.contains(active);
    const focusedId = focusInside ? active.id : '';
    panel.dataset.inRoom = String(state.inRoom);
    if (state.inRoom) panel.classList.add(ROOM_MODE_CLASS);
    else panel.classList.remove(ROOM_MODE_CLASS);
    if (!state.inRoom) {
      renderLobby(panel);
    } else {
      renderRoom(panel);
      setupChatInput(panel);
      if (redrawingRoom) {
        const messages = panel.querySelector('#owp-chat-messages');
        if (messages && messageNodes) {
          messages.replaceChildren(...messageNodes);
          messages.scrollTop = wasChatAtBottom ? messages.scrollHeight : oldScrollTop;
        }
        const input = panel.querySelector('#owp-chat-input');
        if (input) input.value = chatDraft;
      }
    }
    ui.updateStatusIndicator();
    ui.renderHomeWatchParties();
    if (focusInside && !panel.classList.contains('hide')) {
      const same = focusedId && document.getElementById(focusedId);
      if (same && panel.contains(same)) same.focus({ preventScroll: true });
      else focusPanelStart(panel);
    }
  };

  // A panel opened from the keyboard takes focus, as a dialog should: its first
  // control other than the close button, or the close button. A mouse click
  // leaves focus alone, so the player's keyboard shortcuts keep working.
  const focusPanelStart = (panel) => {
    const buttons = Array.from(panel.querySelectorAll('button')).filter(button => !button.disabled);
    const target = buttons.find(button => !button.classList.contains('owp-close-btn')) || buttons[0];
    if (target) target.focus({ preventScroll: true });
  };

  // Enter and Space fire `click` with `detail` 0; a mouse click counts its clicks.
  const isKeyboardClick = event => !!event && event.detail === 0;

  const injectOsdButton = () => {
    if (document.getElementById(BTN_ID)) return;
    const videoOsd = document.querySelector('.videoOsdBottom .buttons');
    if (!videoOsd) return;
    const btn = document.createElement('button');
    btn.id = BTN_ID;
    btn.className = 'paper-icon-button-light btnWatchParty autoSize';
    btn.title = 'Watch Party';
    btn.appendChild(createWatchPartyIcon());
    btn.onclick = (e) => {
      e.stopPropagation(); e.preventDefault();
      const panel = document.getElementById(PANEL_ID);
      panel.classList.toggle('hide');
      if (!panel.classList.contains('hide')) {
        panel.dataset.opener = BTN_ID;
        if (ui.resetPanelPlacement) ui.resetPanelPlacement(panel);
        render(true);
        if (isKeyboardClick(e)) focusPanelStart(panel);
      }
      btn.setAttribute('aria-expanded', String(!panel.classList.contains('hide')));
    };
    btn.setAttribute('aria-label', 'Watch Party');
    btn.setAttribute('aria-controls', PANEL_ID);
    const currentPanel = document.getElementById(PANEL_ID);
    btn.setAttribute('aria-expanded', String(!!currentPanel && !currentPanel.classList.contains('hide')));
    const favBtn = videoOsd.querySelector('[title="Add to favorites"], [title="Remove from favorites"]');
    if (favBtn) {
      favBtn.insertAdjacentElement('beforebegin', btn);
    } else {
      videoOsd.appendChild(btn);
    }
  };

  Object.assign(ui, { render, injectOsdButton, updateCreateRoomButton, updateParticipantList, focusPanelStart, isKeyboardClick, hidePanel });
})();
