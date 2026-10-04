(() => {
  const OWP = window.OpenWatchParty = window.OpenWatchParty || {};
  const ui = OWP.ui = OWP.ui || {};
  const {
    PANEL_ID,
    STYLE_ID,
    SYNCPLAY_HIDE_STYLE_ID,
    HEADER_BTN_CLASS,
    MODERN_HEADER_BTN_ID,
    PANEL_HEADER_CLASS,
    ROOM_MODE_CLASS
  } = OWP.constants;

  // Jellyfin's built-in SyncPlay button: `.headerSyncButton` in the legacy
  // header, and the MUI toolbar button that opens the `app-sync-play-menu`.
  const NATIVE_SYNCPLAY_CSS =
    '.headerSyncButton, button[aria-controls="app-sync-play-menu"] { display: none !important; }';

  const CSS_STYLES = `
    #${PANEL_ID} {
      position: fixed; top: 72px; right: 20px; width: 300px; max-height: min(450px, calc(100vh - 88px));
      padding: 14px; border-radius: 12px; background: rgba(10, 10, 10, 0.98);
      backdrop-filter: blur(20px); color: #fff; font-family: sans-serif; z-index: 20000;
      border: 1px solid rgba(255,255,255,0.1); box-shadow: 0 12px 40px rgba(0,0,0,0.8);
      display: flex; flex-direction: column;
    }
    #${PANEL_ID}.hide { display: none; }
    /* Opened from the header: placed below it (top is set when it opens) */
    #${PANEL_ID}.${PANEL_HEADER_CLASS} { bottom: auto; }
    @media (max-width: 600px) {
      #${PANEL_ID}.${PANEL_HEADER_CLASS} { left: 8px; right: 8px; width: auto; }
    }
    /* The player has its own Watch Party button */
    .osdHeader .${HEADER_BTN_CLASS} { display: none !important; }
    /* In a room the panel is only the bar and its drop-down, each with its own
       background: a dark grey pill with outline icons and soft tinted states. */
    /* The bar fits the room name between a minimum (room for the chat input)
       and a maximum (longer names end in an ellipsis); it stays on the right. */
    #${PANEL_ID}.${ROOM_MODE_CLASS} {
      left: auto; width: auto; min-width: 300px; max-width: min(420px, calc(100vw - 40px));
      padding: 0; gap: 6px; font-family: inherit; font-size: 12px; color: #ecebe6;
      background: none; border: none; box-shadow: none; backdrop-filter: none;
    }
    @media (max-width: 420px) {
      #${PANEL_ID}.${ROOM_MODE_CLASS} { left: 8px; right: 8px; min-width: 0; max-width: none; }
    }
    .owp-room-bar, .owp-room-drop {
      background: rgba(38, 38, 36, 0.97); border: 1px solid rgba(255,255,255,0.14);
      box-shadow: 0 4px 16px rgba(0,0,0,0.35);
    }
    .owp-room-bar {
      display: flex; align-items: center; gap: 4px; flex-shrink: 0;
      padding: 5px 6px 5px 10px; border-radius: 20px;
    }
    .owp-room-bar .owp-sync-dot { width: 7px; height: 7px; flex-shrink: 0; }
    .owp-room-bar .owp-sync-dot.synced { background: #97c459; }
    .owp-room-bar .owp-sync-spinner { flex-shrink: 0; }
    /* Fixed width, so the bar does not jump when the latency gains a digit */
    .owp-room-bar .owp-latency {
      min-width: 3.4em; font-size: 11px; font-variant-numeric: tabular-nums;
      color: #9a9993; white-space: nowrap; margin: 0 4px 0 2px;
    }
    .owp-room-name { flex: 1; min-width: 0; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .owp-icon {
      width: 15px; height: 15px; flex-shrink: 0;
      fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round;
    }
    .owp-bar-btn {
      display: inline-flex; align-items: center; gap: 3px; flex-shrink: 0; height: 24px; padding: 0 6px;
      border: none; border-radius: 12px; background: transparent; color: #a6a59f;
      cursor: pointer; font-family: inherit; font-size: 12px;
    }
    .owp-bar-btn:hover, .owp-bar-btn:focus-visible { background: rgba(255,255,255,0.08); color: #ecebe6; }
    .owp-bar-btn[aria-expanded="true"] { background: #0c447c; color: #85b7eb; }
    .owp-bar-btn.danger { color: #f09595; }
    .owp-bar-btn.danger[aria-expanded="true"] { background: #791f1f; color: #f09595; }
    .owp-bar-btn .owp-expand { width: 12px; height: 12px; transition: transform 0.15s; }
    .owp-bar-btn[aria-expanded="true"] .owp-expand { transform: rotate(180deg); }
    .owp-room-bar .owp-close-btn { margin-left: 0; padding: 0 6px; border-radius: 12px; }
    /* As wide as the bar, without widening it: long chat lines wrap instead */
    .owp-room-drop {
      width: 0; min-width: 100%; box-sizing: border-box;
      min-height: 0; overflow-y: auto; padding: 8px 10px; border-radius: 10px;
    }
    .owp-room-drop[hidden], .owp-room-drop > [hidden] { display: none !important; }
    .owp-leave-confirm { display: flex; align-items: center; gap: 8px; }
    .owp-leave-question { flex: 1; }
    .owp-pill-btn {
      height: 24px; padding: 0 8px; border-radius: 12px; cursor: pointer; font-family: inherit; font-size: 12px;
    }
    .owp-pill-btn.secondary { background: transparent; border: 1px solid rgba(255,255,255,0.25); color: #a6a59f; }
    .owp-pill-btn.danger { background: #791f1f; border: none; color: #f09595; }
    /* Same size as the MUI SVG icons next to it (MuiSvgIcon fontSizeMedium) */
    #${MODERN_HEADER_BTN_ID} .material-icons { font-size: 1.5rem; width: 1em; height: 1em; line-height: 1; }
    .owp-header { font-weight: bold; margin-bottom: 15px; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #333; padding-bottom: 8px; }
    .owp-header-actions { display: flex; align-items: center; gap: 8px; }
    .owp-close-btn {
      display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0;
      margin-left: 8px; padding: 4px; border: none; border-radius: 50%;
      background: transparent; color: #aaa; cursor: pointer;
    }
    .owp-header-actions .owp-close-btn { margin-left: 0; }
    .owp-close-btn:hover, .owp-close-btn:focus-visible { background: rgba(255,255,255,0.1); color: #fff; }
    .owp-close-btn .material-icons { font-size: 20px; }
    .owp-section { margin-bottom: 15px; overflow-y: auto; }
    .owp-label { font-size: 11px; color: #888; text-transform: uppercase; margin-bottom: 8px; letter-spacing: 0.5px; }
    .owp-room-item {
      background: rgba(255,255,255,0.05); padding: 12px; border-radius: 8px; margin-bottom: 8px;
      display: flex; justify-content: space-between; align-items: center; cursor: pointer;
      border: 1px solid transparent; transition: all 0.2s;
    }
    .owp-room-item:hover { background: rgba(255,255,255,0.1); border-color: #1565c0; }
    .owp-btn {
      border: none; border-radius: 6px; padding: 8px 12px;
      background: #388e3c; color: #fff; cursor: pointer; font-weight: bold; font-size: 13px;
    }
    .owp-btn.secondary { background: #1565c0; }
    .owp-btn.danger { background: #d32f2f; }
    .owp-btn:disabled { background: #333; color: #888; cursor: not-allowed; }
    .owp-hint { font-size: 11px; color: #888; margin-top: 8px; text-align: center; }
    .owp-room-note { font-size: 10px; color: #ffb74d; }
    .owp-participants { display: flex; flex-direction: column; }
    .owp-participant { display: flex; align-items: center; gap: 6px; min-width: 0; padding: 4px 0; }
    .owp-participant-avatar {
      display: flex; align-items: center; justify-content: center; flex-shrink: 0;
      width: 20px; height: 20px; border-radius: 50%; background: #0c447c; color: #85b7eb; font-size: 11px;
    }
    .owp-participant-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .owp-host-badge {
      flex-shrink: 0; padding: 0 4px; border-radius: 5px;
      background: #27500a; color: #97c459; font-size: 11px; text-transform: lowercase;
    }
    .owp-input {
      width: 100%; padding: 12px; border-radius: 8px; border: 1px solid #444;
      background: #000; color: #fff; box-sizing: border-box; margin-bottom: 10px; font-size: 14px;
    }
    .owp-footer { font-size: 10px; color: #555; text-align: center; margin-top: auto; padding-top: 10px; }
    .owp-select {
      width: 100%; padding: 8px 10px; border-radius: 6px; border: 1px solid #444;
      background: #000; color: #fff; box-sizing: border-box; font-size: 13px;
      cursor: pointer; appearance: none;
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' fill='%23888'%3E%3Cpath d='M6 8L2 4h8z'/%3E%3C/svg%3E");
      background-repeat: no-repeat; background-position: right 10px center;
    }
    .owp-select:focus { border-color: #1565c0; outline: none; }
    .owp-checkbox-row {
      display: flex; align-items: center; gap: 8px; margin-top: 8px; font-size: 12px; color: #aaa;
    }
    .owp-checkbox-row input { accent-color: #388e3c; }
    /* UX-P3: Sync status indicator styles */
    .owp-sync-dot { width: 8px; height: 8px; border-radius: 50%; }
    .owp-sync-dot.synced { background: #69f0ae; }
    .owp-sync-dot.syncing { background: #ffd740; animation: owp-pulse 1s infinite; }
    .owp-sync-dot.pending { background: #ff9800; animation: owp-pulse 0.5s infinite; }
    @keyframes owp-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
    .owp-sync-spinner { width: 12px; height: 12px; border: 2px solid #444; border-top-color: #ff9800; border-radius: 50%; animation: owp-spin 0.8s linear infinite; }
    @keyframes owp-spin { to { transform: rotate(360deg); } }
    /* Chat styles (the chat drop-down of the room bar) */
    #owp-chat-section { display: flex; flex-direction: column; }
    #owp-chat-messages { max-height: 160px; overflow-y: auto; }
    #owp-chat-messages:empty { display: none; }
    .owp-chat-message { position: relative; padding: 3px 0; line-height: 1.4; }
    .owp-chat-message.owp-chat-own .owp-chat-username { color: #97c459; }
    .owp-chat-meta, .owp-chat-text { display: inline; }
    .owp-chat-username { font-weight: 500; color: #85b7eb; margin-right: 4px; }
    /* Hidden on screen like the mockup, still read by screen readers */
    .owp-chat-time {
      position: absolute; width: 1px; height: 1px; overflow: hidden;
      clip: rect(0 0 0 0); clip-path: inset(50%); white-space: nowrap;
    }
    .owp-chat-text { color: #ecebe6; word-wrap: break-word; }
    #owp-chat-input-container { display: flex; gap: 6px; }
    #owp-chat-messages:not(:empty) + #owp-chat-input-container { margin-top: 6px; padding-top: 6px; border-top: 1px solid rgba(255,255,255,0.1); }
    #owp-chat-input {
      flex: 1; min-width: 0; padding: 4px 8px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.14);
      background: transparent; color: #ecebe6; font-family: inherit; font-size: 12px;
    }
    #owp-chat-input::placeholder { color: #9a9993; }
    #owp-chat-input:focus { border-color: #85b7eb; outline: none; }
    #owp-chat-send {
      display: inline-flex; align-items: center; height: 24px; padding: 0 8px;
      border: none; border-radius: 12px; background: #0c447c; color: #85b7eb; cursor: pointer;
    }
    #owp-chat-send:hover { background: #185fa5; }
    .owp-chat-badge { display: none; padding: 0 5px; border-radius: 8px; background: #791f1f; color: #f09595; font-size: 11px; line-height: 1.45; }
    /* Toast styles */
    /* Bottom right, so chat toasts do not cover the room bar at the top */
    .owp-toast-container {
      position: fixed; bottom: 100px; right: 20px; z-index: 30000;
      display: flex; flex-direction: column; gap: 8px; pointer-events: none;
    }
    .owp-toast {
      background: rgba(38, 38, 36, 0.97); color: #ecebe6; padding: 8px 12px;
      border-radius: 10px; font-size: 12px; max-width: 320px;
      border: 1px solid rgba(255,255,255,0.14);
      box-shadow: 0 4px 16px rgba(0,0,0,0.35); pointer-events: auto; cursor: pointer;
      animation: owp-toast-in 0.3s ease-out;
      transition: transform 0.3s ease-out, opacity 0.3s ease-out;
    }
    .owp-toast.owp-toast-out {
      animation: owp-toast-out 0.3s ease-in forwards;
    }
    .owp-toast-username { font-weight: 500; color: #85b7eb; margin-right: 4px; }
    .owp-toast-text { color: #ecebe6; word-wrap: break-word; }
    .owp-toast-system {
      position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
      background: rgba(20, 20, 20, 0.95); color: #fff; padding: 12px 20px;
      border-radius: 8px; font-size: 13px; z-index: 30000;
      backdrop-filter: blur(10px); border: 1px solid rgba(255,255,255,0.1);
      box-shadow: 0 4px 20px rgba(0,0,0,0.5); cursor: pointer;
      animation: owp-toast-system-in 0.3s ease-out;
    }
    .owp-toast-system.owp-toast-out {
      animation: owp-toast-system-out 0.3s ease-in forwards;
    }
    @keyframes owp-toast-in {
      from { opacity: 0; transform: translateX(20px); }
      to { opacity: 1; transform: translateX(0); }
    }
    @keyframes owp-toast-out {
      from { opacity: 1; transform: translateX(0); }
      to { opacity: 0; transform: translateX(20px); }
    }
    @keyframes owp-toast-system-in {
      from { opacity: 0; transform: translate(-50%, -50%) scale(0.9); }
      to { opacity: 1; transform: translate(-50%, -50%) scale(1); }
    }
    @keyframes owp-toast-system-out {
      from { opacity: 1; transform: translate(-50%, -50%) scale(1); }
      to { opacity: 0; transform: translate(-50%, -50%) scale(0.9); }
    }
  `;

  const injectStyles = () => {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS_STYLES;
    document.head.appendChild(style);
  };

  // Hides or restores the native SyncPlay button to match the plugin setting.
  // A stylesheet, rather than removing the buttons, survives Jellyfin
  // re-rendering its headers.
  const applyNativeSyncPlayVisibility = () => {
    const existing = document.getElementById(SYNCPLAY_HIDE_STYLE_ID);
    if (!OWP.state.hideNativeSyncPlayButton) {
      if (existing) existing.remove();
      return;
    }
    if (existing) return;
    const style = document.createElement('style');
    style.id = SYNCPLAY_HIDE_STYLE_ID;
    style.textContent = NATIVE_SYNCPLAY_CSS;
    document.head.appendChild(style);
  };

  Object.assign(ui, { injectStyles, applyNativeSyncPlayVisibility });
})();
