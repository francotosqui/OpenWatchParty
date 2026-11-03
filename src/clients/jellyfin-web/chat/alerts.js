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
  const updateBell = () => {
    const bell = wrap?.querySelector('#owp-chat-bell');
    if (!bell) return;
    const current = mode();
    bell.classList.toggle('owp-chat-bell-on', current === 'mentions');
    bell.title = `${t('chatToasts')}: ${t(current === 'mentions' ? 'chatToastsMentions' : 'chatToastsAll')}`;
    bell.setAttribute('aria-label', bell.title);
    wrap.querySelectorAll('[role="menuitemradio"]').forEach(option => {
      option.setAttribute('aria-checked', String(option.dataset.mode === current));
    });
  };

  const setOpen = open => {
    const bell = wrap.querySelector('#owp-chat-bell');
    const menu = wrap.querySelector('.owp-chat-bell-menu');
    bell.setAttribute('aria-expanded', String(open));
    menu.hidden = !open;
    if (open) document.addEventListener('pointerdown', outside, true);
    else document.removeEventListener?.('pointerdown', outside, true);
  };
  const outside = event => {
    if (wrap && !wrap.contains(event.target)) setOpen(false);
  };
  const closeMenu = () => {
    setOpen(false);
    wrap.querySelector('#owp-chat-bell').focus?.({ preventScroll: true });
  };

  // The bell next to the emoji button, with its two-choice menu.
  const createBell = () => {
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
    const menu = document.createElement('div');
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
        closeMenu();
      };
      menu.appendChild(option);
    }
    menu.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation?.();
      closeMenu();
    });
    bell.onclick = () => setOpen(bell.getAttribute('aria-expanded') !== 'true');
    wrap.append(bell, menu);
    setOpen(false);
    updateBell();
    return wrap;
  };

  OWP.chatAlerts = { mode, setMode, notify, markRead, hasUnreadMention, createBell };
})();
