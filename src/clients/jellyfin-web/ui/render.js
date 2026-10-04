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

  // Outline icons for the room bar, from Tabler Icons (MIT, https://tabler.io/icons):
  // Jellyfin only ships the filled Material icons.
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const ICON_PATHS = {
    users: ['M5 7a4 4 0 1 0 8 0a4 4 0 1 0 -8 0', 'M3 21v-2a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4v2', 'M16 3.13a4 4 0 0 1 0 7.75', 'M21 21v-2a4 4 0 0 0 -3 -3.85'],
    chat: ['M3 20l1.3 -3.9c-2.324 -3.437 -1.426 -7.872 2.1 -10.374c3.526 -2.501 8.59 -2.296 11.845 .48c3.255 2.777 3.695 7.266 1.029 10.501c-2.666 3.235 -7.615 4.215 -11.574 2.293l-4.7 1'],
    logout: ['M14 8v-2a2 2 0 0 0 -2 -2h-7a2 2 0 0 0 -2 2v12a2 2 0 0 0 2 2h7a2 2 0 0 0 2 -2v-2', 'M9 12h12l-3 -3', 'M18 15l3 -3'],
    x: ['M18 6l-12 12', 'M6 6l12 12'],
    chevron: ['M6 9l6 6l6 -6'],
    send: ['M10 14l11 -11', 'M21 3l-6.5 18a.55 .55 0 0 1 -1 0l-3.5 -7l-7 -3.5a.55 .55 0 0 1 0 -1l18 -6.5']
  };

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

  // Hides the panel from inside it, so closing does not mean reaching for the
  // button that opened it; focus goes back to that button when it is shown.
  const createCloseButton = () => {
    const button = createElement('button', 'owp-close-btn owp-bar-btn');
    button.type = 'button';
    button.title = 'Close panel';
    button.setAttribute('aria-label', 'Close panel');
    button.appendChild(createIcon('x'));
    button.onclick = () => {
      const panel = document.getElementById(PANEL_ID);
      if (!panel) return;
      panel.classList.add('hide');
      // Keep keyboard focus out of the hidden panel: back on the button that
      // opened it, or nowhere if that button is not shown any more.
      const opener = panel.dataset.opener && document.getElementById(panel.dataset.opener);
      if (opener && typeof opener.getClientRects === 'function' && opener.getClientRects().length > 0) opener.focus();
      else button.blur();
    };
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

  const leaveRoom = () => OWP.actions && OWP.actions.leaveRoom && OWP.actions.leaveRoom();

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

    // A guest leaves right away; the host confirms, since it ends the room for everyone.
    const leaveBtn = state.isHost
      ? createBarButton('owp-btn-leave', 'Close room', 'logout', 'owp-leave-confirm')
      : createBarButton('owp-btn-leave', 'Leave room', 'logout');
    leaveBtn.classList.add('danger');
    leaveBtn.onclick = state.isHost ? () => toggleRoomSection('leave') : leaveRoom;

    bar.append(ui.buildSyncStatusIndicator(), latency, roomName, peopleBtn, chatBtn, leaveBtn, createCloseButton());

    const drop = createElement('div', 'owp-room-drop');
    drop.id = 'owp-room-drop';

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

    drop.append(peopleSection, chatSection);
    if (state.isHost) {
      const confirm = createElement('div', 'owp-leave-confirm');
      confirm.id = 'owp-leave-confirm';
      const cancel = createElement('button', 'owp-pill-btn secondary', 'Cancel');
      cancel.type = 'button';
      cancel.onclick = () => {
        toggleRoomSection('leave');
        leaveBtn.focus();
      };
      const close = createElement('button', 'owp-pill-btn danger', 'Close room');
      close.id = 'owp-btn-close-room';
      close.type = 'button';
      close.onclick = leaveRoom;
      confirm.append(createElement('span', 'owp-leave-question', 'Close the room for everyone?'), cancel, close);
      drop.appendChild(confirm);
    } else if (state.roomBarSection === 'leave') {
      state.roomBarSection = '';
    }

    panel.replaceChildren(bar, drop);
    applyRoomSection();
  };

  const setupChatInput = (panel) => {
    const chatInput = panel.querySelector('#owp-chat-input');
    const chatSend = panel.querySelector('#owp-chat-send');
    if (!chatInput || !chatSend) return;
    ui.stopPlayerCapture(chatInput);
    chatInput.addEventListener('keydown', (e) => {
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
    panel.dataset.inRoom = String(state.inRoom);
    if (state.inRoom) panel.classList.add(ROOM_MODE_CLASS);
    else panel.classList.remove(ROOM_MODE_CLASS);
    if (!state.inRoom) {
      renderLobby(panel);
    } else {
      renderRoom(panel);
      setupChatInput(panel);
    }
    ui.updateStatusIndicator();
    ui.renderHomeWatchParties();
  };

  const injectOsdButton = () => {
    if (document.getElementById(BTN_ID)) return;
    const videoOsd = document.querySelector('.videoOsdBottom .buttons');
    if (!videoOsd) return;
    const btn = document.createElement('button');
    btn.id = BTN_ID;
    btn.className = 'paper-icon-button-light btnWatchParty autoSize';
    btn.title = 'Watch Party';
    btn.innerHTML = '<span class="material-icons groups" aria-hidden="true"></span>';
    btn.onclick = (e) => {
      e.stopPropagation(); e.preventDefault();
      const panel = document.getElementById(PANEL_ID);
      panel.classList.toggle('hide');
      if (!panel.classList.contains('hide')) {
        panel.dataset.opener = BTN_ID;
        if (ui.resetPanelPlacement) ui.resetPanelPlacement(panel);
        render(true);
      }
    };
    const favBtn = videoOsd.querySelector('[title="Add to favorites"], [title="Remove from favorites"]');
    if (favBtn) {
      favBtn.insertAdjacentElement('beforebegin', btn);
    } else {
      videoOsd.appendChild(btn);
    }
  };

  Object.assign(ui, { render, injectOsdButton, updateCreateRoomButton, updateParticipantList });
})();
