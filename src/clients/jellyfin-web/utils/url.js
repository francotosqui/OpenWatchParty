(() => {
  const OWP = window.OpenWatchParty = window.OpenWatchParty || {};
  const utils = OWP.utils = OWP.utils || {};

  const defaultPort = (protocol) => protocol === 'https:' || protocol === 'wss:' ? '443' : '80';

  const normalizeSessionServerUrl = (value, pageLocation = window.location) => {
    if (value === undefined || value === null || value === '') {
      return { valid: true, url: '', thirdParty: false };
    }
    if (typeof value !== 'string') {
      return { valid: false, error: 'Session server URL must be a string' };
    }

    const candidate = value.trim();
    if (!candidate) return { valid: true, url: '', thirdParty: false };

    let url;
    try {
      url = new URL(candidate);
    } catch (err) {
      return { valid: false, error: 'Session server URL must be an absolute ws:// or wss:// URL with a host' };
    }
    if (!['ws:', 'wss:'].includes(url.protocol) || !url.hostname) {
      return { valid: false, error: 'Session server URL must be an absolute ws:// or wss:// URL with a host' };
    }
    if (url.username || url.password) {
      return { valid: false, error: 'Session server URL must not contain credentials' };
    }
    if (candidate.includes('?') || candidate.includes('#')) {
      return { valid: false, error: 'Session server URL must not contain a query string or fragment' };
    }
    if (pageLocation?.protocol === 'https:' && url.protocol === 'ws:') {
      return { valid: false, error: 'An HTTPS page requires a secure wss:// session server URL' };
    }

    const pageHost = String(pageLocation?.hostname || '').toLowerCase();
    const pagePort = String(pageLocation?.port || defaultPort(pageLocation?.protocol));
    const targetPort = url.port || defaultPort(url.protocol);
    return {
      valid: true,
      url: url.href,
      thirdParty: url.hostname.toLowerCase() !== pageHost || targetPort !== pagePort
    };
  };

  const INVITE_PARAM = 'owp_invite';

  // Invite links land on the Jellyfin Web root: the directory of the current
  // document, so a deployment under a sub-path keeps working.
  const webRootPath = (pathname) => {
    const path = String(pathname || '/');
    const separator = path.lastIndexOf('/');
    return separator <= 0 ? '/' : path.slice(0, separator + 1);
  };

  const locationOrigin = (pageLocation) => {
    if (pageLocation?.origin) return pageLocation.origin;
    const protocol = pageLocation?.protocol || 'http:';
    const host = pageLocation?.hostname || 'localhost';
    const port = pageLocation?.port ? `:${pageLocation.port}` : '';
    return `${protocol}//${host}${port}`;
  };

  const buildInviteUrl = (ticket, pageLocation = window.location) => {
    if (typeof ticket !== 'string' || !ticket) return '';
    try {
      const url = new URL(webRootPath(pageLocation?.pathname), locationOrigin(pageLocation));
      url.searchParams.set(INVITE_PARAM, ticket);
      return url.href;
    } catch (err) {
      return '';
    }
  };

  const parseInviteTicket = (href) => {
    if (typeof href !== 'string' || !href) return '';
    try {
      const url = new URL(href, 'http://localhost/');
      return url.searchParams.get(INVITE_PARAM) || '';
    } catch (err) {
      return '';
    }
  };

  Object.assign(utils, { normalizeSessionServerUrl, buildInviteUrl, parseInviteTicket, INVITE_PARAM });
})();
