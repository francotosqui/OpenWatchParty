(() => {
  const OWP = window.OpenWatchParty = window.OpenWatchParty || {};
  const ui = OWP.ui = OWP.ui || {};
  const state = OWP.state;

  const updateStatusIndicator = () => {
    const el = document.getElementById('owp-ws-indicator');
    if (!el) return;
    const connected = state.ws && state.ws.readyState === 1;
    el.className = `owp-ws-status ${connected ? 'online' : 'offline'}`;
    el.textContent = connected ? 'Online' : 'Offline';
  };

  // The sync state is a dot in the room bar (a spinner while a start is
  // pending); its label is the tooltip. The host is the reference, so it is
  // always shown as in sync.
  const describeSyncStatus = () => {
    if (state.isHost) return { marker: 'synced', label: 'Hosting' };
    const status = state.syncStatus || 'synced';
    if (status === 'blocked') return { marker: 'syncing', label: 'Playback blocked - press Play' };
    if (status === 'pending_play') {
      const remaining = Math.max(0, (state.pendingPlayUntil - (Date.now() + (state.serverOffsetMs || 0))) / 1000);
      return { marker: 'spinner', label: `Waiting for sync... ${remaining.toFixed(1)}s` };
    }
    if (status === 'syncing') return { marker: 'syncing', label: 'Out of sync' };
    return { marker: 'synced', label: 'In sync' };
  };

  const paintSyncIndicator = (el) => {
    const { marker, label } = describeSyncStatus();
    el.className = marker === 'spinner' ? 'owp-sync-spinner' : `owp-sync-dot ${marker}`;
    el.title = label;
    el.setAttribute('aria-label', label);
  };

  const updateSyncIndicator = () => {
    const el = document.getElementById('owp-sync-indicator');
    if (el) paintSyncIndicator(el);
  };

  const buildSyncStatusIndicator = () => {
    const indicator = document.createElement('span');
    indicator.id = 'owp-sync-indicator';
    indicator.setAttribute('role', 'img');
    paintSyncIndicator(indicator);
    return indicator;
  };

  const stopPlayerCapture = (input) => {
    const stopPropagation = (e) => e.stopPropagation();
    input.addEventListener('keydown', stopPropagation);
    input.addEventListener('keyup', stopPropagation);
    input.addEventListener('keypress', stopPropagation);
    input.addEventListener('click', stopPropagation);
    input.addEventListener('mousedown', stopPropagation);
  };

  Object.assign(ui, { updateStatusIndicator, updateSyncIndicator, buildSyncStatusIndicator, stopPlayerCapture });
})();
