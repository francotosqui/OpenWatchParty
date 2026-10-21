(() => {
  const OWP = window.OpenWatchParty = window.OpenWatchParty || {};
  const queue = OWP.queue = OWP.queue || {};
  const state = OWP.state;
  const utils = OWP.utils;
  const t = OWP.i18n.t;

  const UPCOMING = 5;                // Episodes the host keeps queued after the room's item
  const TICKS_PER_SECOND = 10000000; // Jellyfin times are in ticks of 100 ns

  // The server keeps the queue and runs the countdown; the host's client fills
  // the queue and says when the credits start. Nothing here runs for a guest,
  // outside a room or with a server without media_queue.
  const isQueueHost = () => state.inRoom && state.isHost && state.serverFeatures.includes('media_queue');
  const send = (type, payload) => {
    if (OWP.actions?.send) OWP.actions.send(type, payload);
  };

  // The room's item is the room_state media: queue_state can still describe
  // the previous one for a moment after an advance.
  const roomIndex = () => state.queueItems.findIndex(item => item.id === state.roomMediaId);
  const nextItem = () => {
    const index = roomIndex();
    return index < 0 ? null : state.queueItems[index + 1] || null;
  };
  const previousItem = () => {
    const index = roomIndex();
    return index > 0 ? state.queueItems[index - 1] : null;
  };

  const episodeTitle = episode => (Number.isInteger(episode.ParentIndexNumber) && Number.isInteger(episode.IndexNumber)
    ? t('queueEpisodeTitle', { season: episode.ParentIndexNumber, episode: episode.IndexNumber, name: episode.Name || '' })
    : episode.Name || episode.Id);

  // The host fills an empty queue, then tops it up only when the room moves on
  // from an item this client saw as host. It waits for the room's queue_state,
  // which comes after room_state on joining. Filling goes on from the episode
  // the room's queue_add appended last, which the server keeps, so one the
  // host removed doesn't come back after a reload or a host change either.
  // Each room item is looked at once.
  let seenItem = '';

  const fill = async () => {
    if (!state.queueReceived) return;
    const roomId = state.roomId;
    const item = `${roomId}|${state.roomMediaId}`;
    const previous = seenItem;
    if (previous === item) return;
    const seenRoom = previous.startsWith(`${roomId}|`);
    seenItem = item;
    if (state.queueItems.length && !seenRoom) return;
    const index = roomIndex();
    // A room item that isn't queued leaves the host's list as it is.
    if (state.queueItems.length && index < 0) return;
    const upcoming = state.queueItems.length ? state.queueItems.length - 1 - index : 0;
    if (upcoming >= UPCOMING) return;
    const startId = state.queueLastAdded || state.roomMediaId;
    const userId = window.ApiClient.getCurrentUserId();
    let start;
    let result;
    try {
      start = await window.ApiClient.getItem(userId, startId);
      if (start?.Type !== 'Episode' || !start.SeriesId) return;
      result = await window.ApiClient.getJSON(window.ApiClient.getUrl(`Shows/${start.SeriesId}/Episodes`, {
        userId, startItemId: startId, limit: UPCOMING + 10
      }));
    } catch (err) {
      // The next room_state or queue_state tries this item again.
      if (seenItem === item) seenItem = previous;
      throw err;
    }
    if (!isQueueHost() || state.roomId !== roomId) return;
    const episodes = (result?.Items || [])
      .filter(episode => episode.Id !== startId && episode.LocationType !== 'Virtual')
      .slice(0, UPCOMING - upcoming);
    const items = (state.queueItems.length ? [] : [start]).concat(episodes);
    if (!items.length) return;
    send('queue_add', { items: items.map(episode => ({ id: episode.Id, title: episodeTitle(episode) })) });
  };

  // Where the room's item's credits start (Jellyfin's Outro media segment, as
  // Intro Skipper marks it), in seconds, or null to wait for the end.
  let credits = { mediaId: '', start: null };

  const loadCredits = async (mediaId) => {
    credits = { mediaId, start: null };
    const result = await window.ApiClient.getJSON(window.ApiClient.getUrl(`MediaSegments/${mediaId}`, {
      includeSegmentTypes: 'Outro'
    }));
    const outro = (result?.Items || []).find(segment => segment.Type === 'Outro');
    if (outro && credits.mediaId === mediaId) credits.start = outro.StartTicks / TICKS_PER_SECOND;
  };

  const report = (what, err) => utils.log('QUEUE', { what, error: err?.name || 'Error' });

  // The room and item whose countdown the host cancelled: it doesn't start
  // again on that item in that room.
  let cancelledFor = '';
  const cancelKey = () => `${state.roomId}|${state.roomMediaId}`;
  // The last countdown request, until a queue_state answers it.
  let countdownRequest = '';

  // After room_state and queue_state, and when this client becomes the host.
  queue.refresh = () => {
    if (!isQueueHost() || !state.roomMediaId || !window.ApiClient) return;
    if (credits.mediaId !== state.roomMediaId) loadCredits(state.roomMediaId).catch(err => report('credits', err));
    fill().catch(err => report('fill', err));
  };

  // A queue_state answers the last countdown request. The host's video is
  // looked at again: it may have paused or gone back meanwhile, with no other
  // event to tell while it stays paused.
  queue.onQueueState = () => {
    countdownRequest = '';
    queue.refresh();
    const video = utils.getVideo?.();
    if (video) queue.onVideoTime(video);
  };

  const requestCountdown = (start) => {
    const key = `${state.roomMediaId}|${start}`;
    if (countdownRequest === key) return;
    countdownRequest = key;
    send('queue_countdown', { start });
  };

  // Jellyfin closes the player when a video ends, which takes everyone out of
  // the room, so the countdown starts this long before the end at the latest
  // and the room moves on while the video still plays.
  const END_MARGIN_S = OWP.constants.QUEUE_COUNTDOWN_MS / 1000 + 5;

  const countdownStart = (video) => {
    const outro = credits.mediaId === state.roomMediaId ? credits.start : null;
    const latest = Number.isFinite(video.duration) ? video.duration - END_MARGIN_S : null;
    if (outro === null || latest === null) return outro ?? latest;
    return Math.min(outro, latest);
  };

  // From the host's video events: the countdown starts at the credits, and
  // stops when the room pauses or the host goes back before them. The browser
  // also pauses at the end, which keeps it going.
  queue.onVideoTime = (video) => {
    if (!isQueueHost() || !state.roomMediaId || utils.getPlayingItemId?.() !== state.roomMediaId) return;
    const start = countdownStart(video);
    const inCredits = start !== null && video.currentTime >= start;
    const stopped = video.paused && !video.ended;
    if (state.queueCountdownUntil) {
      if (!inCredits || stopped) requestCountdown(false);
    } else if (inCredits && !stopped && nextItem() && cancelledFor !== cancelKey()) {
      requestCountdown(true);
    }
  };

  Object.assign(queue, {
    nextItem,
    previousItem,
    advance: id => send('queue_advance', { id }),
    remove: id => send('queue_remove', { id }),
    move: (id, to) => send('queue_move', { id, to }),
    cancelCountdown: () => {
      cancelledFor = cancelKey();
      requestCountdown(false);
    }
  });
})();
