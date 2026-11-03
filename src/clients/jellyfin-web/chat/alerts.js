(() => {
  const OWP = window.OpenWatchParty = window.OpenWatchParty || {};
  const state = OWP.state;
  const t = OWP.i18n.t;

  // Which chat messages show a floating toast while the chat is closed: all of
  // them (the default) or only those that mention this member. Kept per
  // Jellyfin user in this browser; unreadable storage means "all".
  const MODES = ['all', 'mentions'];
  const storageKey = () => `owp-chat-toasts-${state.userId || ''}`;
  let unreadMention = false;

  const mode = () => {
    try {
      return globalThis.localStorage?.getItem(storageKey()) === 'mentions' ? 'mentions' : 'all';
    } catch {
      return 'all';
    }
  };

  const setMode = value => {
    if (!MODES.includes(value)) return;
    try {
      globalThis.localStorage?.setItem(storageKey(), value);
    } catch {
      // Storage unavailable: the choice lasts until the menu re-reads it.
    }
    updateBell();
  };

  const hasUnreadMention = () => unreadMention;

  // A new message from someone else while the chat is closed.
  const notify = message => {
    if (message.mentionsMe) {
      unreadMention = true;
      OWP.ui?.showChatToast?.(message.username, message.text, { mention: true, userId: message.userId });
    } else if (mode() === 'all') {
      OWP.ui?.showChatToast?.(message.username, message.text);
    }
  };

  const markRead = () => {
    unreadMention = false;
  };

  let wrap = null;
  let menu = null;
  const updateBell = () => {
    const bell = wrap?.querySelector('#owp-chat-bell');
    if (!bell) return;
    const current = mode();
    bell.classList.toggle('owp-chat-bell-on', current === 'mentions');
    bell.title = `${t('chatToasts')}: ${t(current === 'mentions' ? 'chatToastsMentions' : 'chatToastsAll')}`;
    bell.setAttribute('aria-label', bell.title);
    menu?.querySelectorAll('[role="menuitemradio"]').forEach(option => {
      option.setAttribute('aria-checked', String(option.dataset.mode === current));
    });
  };

  // The chat drop-down scrolls and cuts whatever sticks out of it, so the menu
  // is drawn over the page, below the bell, as the emoji picker is.
  const place = bell => {
    const rect = bell.getBoundingClientRect?.();
    if (!rect) return;
    menu.style.right = `${Math.max(8, window.innerWidth - rect.right)}px`;
    menu.style.top = `${rect.bottom + 6}px`;
  };

  const setOpen = open => {
    const bell = wrap?.querySelector('#owp-chat-bell');
    if (!bell || !menu) return;
    bell.setAttribute('aria-expanded', String(open));
    menu.hidden = !open;
    if (open) {
      document.body.appendChild(menu);
      place(bell);
      document.addEventListener('pointerdown', outside, true);
    } else {
      menu.remove();
      document.removeEventListener?.('pointerdown', outside, true);
    }
  };
  const outside = event => {
    if (!wrap?.contains(event.target) && !menu?.contains(event.target)) setOpen(false);
  };
  const closeMenu = () => setOpen(false);
  const closeMenuToBell = () => {
    setOpen(false);
    wrap.querySelector('#owp-chat-bell').focus?.({ preventScroll: true });
  };
  const isOpen = () => wrap?.querySelector('#owp-chat-bell')?.getAttribute('aria-expanded') === 'true';
  const escape = event => {
    if (event.key !== 'Escape' || !isOpen()) return;
    event.preventDefault();
    event.stopPropagation?.();
    closeMenuToBell();
  };

  // The bell next to the emoji button, with its two-choice menu.
  const createBell = () => {
    closeMenu();
    const createIcon = OWP.ui?._panelViews?.createIcon;
    wrap = document.createElement('div');
    wrap.className = 'owp-chat-bell-wrap';
    const bell = document.createElement('button');
    bell.id = 'owp-chat-bell';
    bell.type = 'button';
    bell.className = 'owp-chat-bell';
    bell.setAttribute('aria-haspopup', 'menu');
    bell.setAttribute('aria-controls', 'owp-chat-bell-menu');
    if (createIcon) bell.appendChild(createIcon('bell'));
    menu = document.createElement('div');
    menu.id = 'owp-chat-bell-menu';
    menu.className = 'owp-chat-bell-menu';
    menu.setAttribute('role', 'menu');
    menu.hidden = true;
    const title = document.createElement('div');
    title.className = 'owp-chat-bell-title';
    title.textContent = t('chatToasts');
    menu.appendChild(title);
    for (const value of MODES) {
      const option = document.createElement('button');
      option.type = 'button';
      option.className = 'owp-chat-bell-option';
      option.dataset.mode = value;
      option.setAttribute('role', 'menuitemradio');
      option.textContent = t(value === 'mentions' ? 'chatToastsMentions' : 'chatToastsAll');
      option.onclick = () => {
        setMode(value);
        closeMenuToBell();
      };
      menu.appendChild(option);
    }
    // Outside the panel, the menu keeps presses, wheel and keys from the player.
    for (const type of ['pointerdown', 'mousedown', 'wheel', 'keyup', 'keypress']) menu.addEventListener(type, event => event.stopPropagation?.());
    menu.addEventListener('keydown', event => {
      escape(event);
      event.stopPropagation?.();
    });
    bell.addEventListener('keydown', escape);
    bell.onclick = () => setOpen(!isOpen());
    wrap.appendChild(bell);
    setOpen(false);
    updateBell();
    return wrap;
  };

  OWP.chatAlerts = { mode, setMode, notify, markRead, hasUnreadMention, createBell, closeMenu };
})();
