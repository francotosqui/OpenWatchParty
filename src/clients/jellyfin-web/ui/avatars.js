(() => {
  const OWP = window.OpenWatchParty = window.OpenWatchParty || {};
  // Jellyfin user ids are 32 hexadecimal digits; the server may send them
  // with dashes. Anything else never reaches a URL.
  const USER_ID = /^[0-9a-f]{32}$/;
  // Users whose image failed to load: they keep their initial for the session
  // instead of asking Jellyfin again on every render.
  const failed = new Set();

  const normalize = value => (typeof value === 'string' ? value.replace(/-/g, '').toLowerCase() : '');
  const initial = name => (Array.from(String(name || '?'))[0] || '?').toUpperCase();
  const imageUrl = id => {
    const api = window.ApiClient;
    const path = `Users/${id}/Images/Primary`;
    if (api?.getUrl) return api.getUrl(path, { height: 64, quality: 90 });
    return `${api?.serverAddress?.() || ''}/${path}?height=64&quality=90`;
  };

  const create = (name, userId, className = 'owp-participant-avatar') => {
    const avatar = document.createElement('span');
    avatar.className = className;
    avatar.setAttribute('aria-hidden', 'true');
    const id = normalize(userId);
    if (!USER_ID.test(id) || failed.has(id)) {
      avatar.textContent = initial(name);
      return avatar;
    }
    const image = document.createElement('img');
    image.alt = '';
    image.onerror = () => {
      failed.add(id);
      avatar.classList.remove('owp-avatar-photo');
      avatar.replaceChildren(document.createTextNode(initial(name)));
    };
    image.src = imageUrl(id);
    avatar.classList.add('owp-avatar-photo');
    avatar.appendChild(image);
    return avatar;
  };

  OWP.avatars = { create, isUserId: value => USER_ID.test(normalize(value)), reset: () => failed.clear() };
})();
