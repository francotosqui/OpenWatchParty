(() => {
  const OWP = window.OpenWatchParty = window.OpenWatchParty || {};
  const ui = OWP.ui = OWP.ui || {};
  const state = OWP.state;

  const createElement = (tag, className, text) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = String(text);
    return element;
  };

  const NO_MEDIA_JOIN_HINT = 'This room has no media. Start playing something, then join it from the player.';

  const drawRoomList = (roomList) => {
    if (state.rooms.length === 0) {
      const empty = createElement('div', 'owp-room-empty', 'No active rooms.');
      roomList.replaceChildren(empty);
      return;
    }
    roomList.replaceChildren();
    state.rooms.forEach(room => {
      const item = createElement('div', 'owp-room-item');
      const details = createElement('div');
      const name = createElement('div', 'owp-room-title', room.name);
      const count = createElement('div', 'owp-room-count', `${String(room.count)} ${room.count === 1 ? 'user' : 'users'}`);
      details.append(name, count);
      if (!room.media_id) {
        const noMedia = createElement('div', 'owp-room-note', 'No media');
        details.appendChild(noMedia);
      }
      const join = createElement('button', 'owp-btn secondary', 'Join');
      join.dataset.roomId = String(room.id);
      item.append(details, join);
      item.onclick = () => {
        // A room without media has nothing to start here. From the player,
        // joining still syncs whatever is playing.
        if (!room.media_id && !OWP.utils?.getPlayingItemId?.()) {
          ui.showToast(NO_MEDIA_JOIN_HINT);
          return;
        }
        if (OWP.actions && OWP.actions.joinRoom) OWP.actions.joinRoom(room.id);
      };
      roomList.appendChild(item);
    });
  };

  // The list is drawn again on every room list update. Keyboard focus on a
  // Join button goes back to the same room's button, or to the panel's first
  // control once that room is gone, instead of falling out of the panel.
  const restoreRoomListFocus = (roomList, roomId) => {
    const same = roomId && Array.from(roomList.querySelectorAll('button')).find(button => button.dataset.roomId === roomId);
    if (same) {
      same.focus({ preventScroll: true });
      return;
    }
    const panel = document.getElementById(OWP.constants.PANEL_ID);
    if (panel && panel.contains(roomList) && ui.focusPanelStart) ui.focusPanelStart(panel);
  };

  const updateRoomListUI = () => {
    const roomList = document.getElementById('owp-room-list');
    if (!roomList) return;
    const active = document.activeElement;
    const focusInside = !!active && active !== roomList && typeof roomList.contains === 'function' && roomList.contains(active);
    const focusedRoomId = focusInside && active.dataset ? active.dataset.roomId || '' : '';
    drawRoomList(roomList);
    if (focusInside) restoreRoomListFocus(roomList, focusedRoomId);
  };

  // Same markup and classes as Jellyfin's landscape home cards ("Continue
  // Watching"), with no colours of its own, so the row matches its neighbours
  // and follows the active theme.
  const buildCardContent = (room, index) => {
    const box = createElement('div', 'cardBox cardBox-bottompadded');
    const scalable = createElement('div', 'cardScalable');
    const padder = createElement('div', 'cardPadder cardPadder-overflowBackdrop');
    const cardIcon = createElement('span', 'cardImageIcon material-icons groups owp-card-icon');
    cardIcon.setAttribute('aria-hidden', 'true');
    padder.appendChild(cardIcon);

    const image = createElement('div', `cardImageContainer coveredImage cardContent defaultCardBackground defaultCardBackground${(index % 5) + 1} owp-card-image-container`);
    const footer = createElement('div', 'innerCardFooter');
    const count = createElement('div', 'cardText');
    const countIcon = createElement('span', 'material-icons', 'groups');
    countIcon.style.cssText = 'font-size:14px;vertical-align:middle;';
    count.append(countIcon, document.createTextNode(` ${String(room.count)} watching`));
    footer.appendChild(count);
    image.appendChild(footer);

    const overlay = createElement('div', 'cardOverlayContainer itemAction');
    const join = createElement('button', 'cardOverlayButton cardOverlayButton-hover cardOverlayFab-primary owp-join-btn paper-icon-button-light');
    const playIcon = createElement('span', 'material-icons cardOverlayButtonIcon cardOverlayButtonIcon-hover play_arrow');
    playIcon.setAttribute('aria-hidden', 'true');
    join.appendChild(playIcon);
    overlay.appendChild(join);
    scalable.append(padder, image, overlay);

    const name = createElement('div', 'cardText cardTextCentered cardText-first owp-card-name');
    name.appendChild(createElement('bdi', '', room.name));
    const media = createElement('div', 'cardText cardTextCentered cardText-secondary owp-card-media');
    media.appendChild(createElement('bdi', 'owp-media-title', room.media_id ? 'Loading...' : 'No media'));
    box.append(scalable, name, media);
    return box;
  };

  // Landscape art, as Jellyfin's "Continue Watching" picks it: an episode's own
  // image is a 16:9 still; otherwise the thumb, then the backdrop (also from the
  // series), and the poster last, cropped to fit.
  const landscapeImage = (item, mediaId) => {
    const tags = item.ImageTags || {};
    if (item.Type === 'Episode' && tags.Primary) return { id: mediaId, type: 'Primary', tag: tags.Primary };
    if (tags.Thumb) return { id: mediaId, type: 'Thumb', tag: tags.Thumb };
    if (item.BackdropImageTags?.length) return { id: mediaId, type: 'Backdrop', tag: item.BackdropImageTags[0] };
    if (item.ParentThumbItemId && item.ParentThumbImageTag) {
      return { id: item.ParentThumbItemId, type: 'Thumb', tag: item.ParentThumbImageTag };
    }
    if (item.ParentBackdropItemId && item.ParentBackdropImageTags?.length) {
      return { id: item.ParentBackdropItemId, type: 'Backdrop', tag: item.ParentBackdropImageTags[0] };
    }
    if (tags.Primary) return { id: mediaId, type: 'Primary', tag: tags.Primary };
    return null;
  };

  const attachMediaInfo = (card, mediaId) => {
    if (!mediaId || !window.ApiClient) return;
    const userId = window.ApiClient.getCurrentUserId?.() || window.ApiClient._currentUserId;
    if (!userId) return;
    window.ApiClient.getItem(userId, mediaId).then(item => {
      const titleEl = card.querySelector('.owp-media-title');
      if (titleEl && item?.Name) {
        titleEl.textContent = item.Name;
      }
      const containerEl = card.querySelector('.owp-card-image-container');
      const iconEl = card.querySelector('.owp-card-icon');
      const image = item ? landscapeImage(item, mediaId) : null;
      if (containerEl && image) {
        const serverUrl = window.ApiClient._serverAddress || window.ApiClient.serverAddress?.() || '';
        const imageUrl = `${serverUrl}/Items/${encodeURIComponent(image.id)}/Images/${image.type}`
          + `?fillWidth=480&fillHeight=270&quality=96&tag=${encodeURIComponent(image.tag)}`;
        containerEl.style.backgroundImage = `url("${imageUrl}")`;
        if (iconEl) iconEl.style.display = 'none';
      }
    }).catch(() => {
      const titleEl = card.querySelector('.owp-media-title');
      if (titleEl) titleEl.textContent = 'Unknown';
    });
  };

  const attachCardHandlers = (card, room) => {
    const joinBtn = card.querySelector('.owp-join-btn');
    if (joinBtn) {
      joinBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        console.log('[OpenWatchParty] Play button clicked for room:', room.id, 'media:', room.media_id);
        if (!room.media_id) {
          ui.showToast('No media in this room');
          return;
        }
        state.pendingJoinRoomId = room.id;
        console.log('[OpenWatchParty] Set pendingJoinRoomId:', room.id);
        const serverId = window.ApiClient?.serverId?.() || window.ApiClient?._serverInfo?.Id || '';
        console.log('[OpenWatchParty] Navigating to details page');
        const detailsUrl = `#/details?id=${room.media_id}&serverId=${serverId}`;
        window.location.hash = detailsUrl;
        let attempts = 0;
        const maxAttempts = 50;
        const roomId = room.id;
        const cardPollAttempt = ++state.cardPollAttempt;
        const checkInterval = OWP.timers.setInterval(() => {
          if (cardPollAttempt !== state.cardPollAttempt || state.pendingJoinRoomId !== roomId) {
            OWP.timers.clear(checkInterval);
            return;
          }
          attempts++;
          const itemName = document.querySelector('.itemName bdi');
          const playBtn = document.querySelector('.mainDetailButtons .btnPlay, .mainDetailButtons button[data-action="resume"], .mainDetailButtons button[data-action="play"]');
          if (playBtn && itemName && itemName.textContent.trim()) {
            console.log('[OpenWatchParty] Play button found and page ready, clicking it');
            OWP.timers.clear(checkInterval);
            playBtn.click();
          } else if (attempts >= maxAttempts) {
            console.log('[OpenWatchParty] Play button not found or page not ready after 5s, giving up');
            OWP.timers.clear(checkInterval);
          }
        }, 100, 'ui');
      });
    }
    card.addEventListener('click', (e) => {
      if (e.target.closest('.owp-join-btn')) return;
      if (room.media_id && window.Emby && window.Emby.Page) {
        window.Emby.Page.show('/details?id=' + room.media_id);
      }
    });
  };

  const createRoomCard = (room, index) => {
    const card = document.createElement('div');
    card.className = 'card overflowBackdropCard card-hoverable card-withuserdata owp-room-card';
    card.dataset.index = String(index);
    card.dataset.roomId = String(room.id);
    card.dataset.mediaId = String(room.media_id || '');
    card.dataset.count = String(room.count);
    card.replaceChildren(buildCardContent(room, index));
    attachMediaInfo(card, room.media_id);
    attachCardHandlers(card, room);
    return card;
  };

  Object.assign(ui, { updateRoomListUI, createRoomCard });
})();
