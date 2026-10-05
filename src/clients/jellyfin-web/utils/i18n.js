(() => {
  const OWP = window.OpenWatchParty = window.OpenWatchParty || {};

  const en = {
    watchParty: 'Watch Party', closePanel: 'Close panel', availableRooms: 'Available rooms', createRoom: 'Create Room',
    createRoomHint: 'Start playing something to create a room.', server: 'Server: ', onlineCount: 'Online: {count}',
    guest: 'Guest', anonymous: 'Anonymous', host: 'Host', participants: 'Participants', participantsCount: 'Participants, {count}', chat: 'Chat',
    chatUnread_one: 'Chat, {count} unread', chatUnread_other: 'Chat, {count} unread',
    latency: 'Latency to the watch party server (client {client})', leaveRoom: 'Leave room', closeRoom: 'Close room',
    invite: 'Invite', typeMessage: 'Type a message...', sendMessage: 'Send message', cancel: 'Cancel', leave: 'Leave',
    closeRoomQuestion: 'Close the room for everyone?', leaveRoomQuestion: 'Leave the room?', noActiveRooms: 'No active rooms.',
    user_one: '{count} user', user_other: '{count} users', noMedia: 'No media', join: 'Join',
    watching_one: '{count} watching', watching_other: '{count} watching', loading: 'Loading...', unknown: 'Unknown',
    watchParties: 'Watch Parties', online: 'Online', offline: 'Offline', hosting: 'Hosting',
    playbackBlockedLabel: 'Playback blocked - press Play', waitingSync: 'Waiting for sync... {seconds}s',
    outOfSync: 'Out of sync', inSync: 'In sync', noMediaJoinHint: 'This room has no media. Start playing something, then join it from the player.',
    noMediaInRoom: 'No media in this room', messageTooLong: 'Message too long (max {count} characters)',
    notConnected: 'Not connected to server', notInRoom: 'Not in a room', inviteInvalid: 'This invite link is invalid',
    inviteAuthRequired: 'Invite links require an authenticated watch party', serverUrlInvalid: 'The watch party server URL is invalid',
    serverUnreachable: 'Could not reach the watch party server', inviteCreateHttp: 'Could not create the invite link (HTTP {status})',
    inviteCreateFailed: 'Could not create the invite link', inviteCopied: 'Invite link copied to the clipboard', inviteLink: 'Invite link: {link}',
    playbackStartFailed: 'Failed to start playback. Try refreshing the page.',
    playbackBlocked: 'Playback was blocked. Press Play in Jellyfin to continue.', waitingForMedia: 'Still waiting for the watch party media',
    hostOnlyPlayback: 'Only the host can control playback', participantJoined: 'A participant joined the room',
    participantLeft: 'A participant left the room', roomClosed: 'The room was closed', unknownError: 'Unknown error',
    hostResumed: 'Host resumed playback', hostPaused: 'Host paused playback', roomName: "{name}'s room",
    rejoinFailed: 'Could not rejoin the watch party', reauthFailed: 'Could not reauthenticate the watch party connection',
    hostDisconnected: 'The watch party closed when the host disconnected', authInvalidResult: 'OpenWatchParty authentication returned an invalid result',
    urlString: 'Session server URL must be a string', urlAbsolute: 'Session server URL must be an absolute ws:// or wss:// URL with a host',
    urlCredentials: 'Session server URL must not contain credentials', urlQuery: 'Session server URL must not contain a query string or fragment',
    urlHttps: 'An HTTPS page requires a secure wss:// session server URL', authUnavailable: 'Jellyfin authentication is not available',
    authInvalidToken: 'Jellyfin returned an unusable access token', authRejected: 'Jellyfin rejected the OpenWatchParty token request (HTTP 401)',
    authRateLimited: 'Too many OpenWatchParty token requests (HTTP 429)', authServerError: 'The OpenWatchParty token endpoint failed (HTTP 500)',
    authNotConfigured: 'JWT authentication is not configured or unavailable in the OpenWatchParty plugin (HTTP 503)',
    authHttp: 'Could not obtain an OpenWatchParty token (HTTP {status})', authInvalidJson: 'OpenWatchParty token endpoint returned invalid JSON',
    authMissingUrl: 'OpenWatchParty token endpoint must explicitly provide session_server_url',
    authBadUrl: 'OpenWatchParty token endpoint returned an invalid session server URL: {error}',
    authBadResponse: 'OpenWatchParty token endpoint returned an invalid authentication response', authTimeout: 'OpenWatchParty token request timed out',
    authAborted: 'OpenWatchParty token request was aborted', authUnreachable: 'Could not reach the OpenWatchParty token endpoint',
    errorRoomNotFound: 'Room not found', errorRoomFull: 'Room is full', errorRateLimited: 'Rate limit exceeded', errorHostOnly: 'Only the room host can do that', errorChatTooLong: 'Message too long', errorProtocol: 'The OpenWatchParty client and server versions are incompatible', inviteExpired: 'Invite ticket has expired', inviteWrongRoom: 'Invite ticket does not match this room', roomClosedHostLeft: 'Host left the room', roomClosedNewRoom: 'Host started a new room', inviteHostOnly: 'Only the room host can create invite links', authInvalidated: 'Authentication request was invalidated'
  };

  const es = {
    watchParty: 'Watch Party', closePanel: 'Cerrar panel', availableRooms: 'Salas disponibles', createRoom: 'Crear sala',
    createRoomHint: 'Para crear una sala, primero hay que reproducir algo.', server: 'Servidor: ', onlineCount: 'En línea: {count}',
    guest: 'Invitado', anonymous: 'Anónimo', host: 'Anfitrión', participants: 'Participantes', participantsCount: 'Participantes: {count}', chat: 'Chat',
    chatUnread_one: 'Chat, {count} sin leer', chatUnread_other: 'Chat, {count} sin leer',
    latency: 'Latencia al servidor de la sala (cliente {client})', leaveRoom: 'Salir de la sala', closeRoom: 'Cerrar sala',
    invite: 'Invitar', typeMessage: 'Escribir un mensaje...', sendMessage: 'Enviar mensaje', cancel: 'Cancelar', leave: 'Salir',
    closeRoomQuestion: '¿Cerrar la sala para todos?', leaveRoomQuestion: '¿Salir de la sala?', noActiveRooms: 'No hay salas activas.',
    user_one: '{count} usuario', user_other: '{count} usuarios', noMedia: 'Sin contenido', join: 'Unirse',
    watching_one: '{count} viendo', watching_other: '{count} viendo', loading: 'Cargando...', unknown: 'Desconocido',
    watchParties: 'Watch Parties', online: 'En línea', offline: 'Sin conexión', hosting: 'Anfitrión',
    playbackBlockedLabel: 'Reproducción bloqueada: pulsar Reproducir', waitingSync: 'Esperando sincronización... {seconds}s',
    outOfSync: 'Sin sincronizar', inSync: 'Sincronizado', noMediaJoinHint: 'Esta sala no tiene contenido. Para unirse, reproducir algo y entrar desde el reproductor.',
    noMediaInRoom: 'La sala no tiene contenido', messageTooLong: 'Mensaje demasiado largo (máx. {count} caracteres)',
    notConnected: 'Sin conexión al servidor', notInRoom: 'No hay una sala activa', inviteInvalid: 'El enlace de invitación no es válido',
    inviteAuthRequired: 'Los enlaces de invitación requieren una sala autenticada', serverUrlInvalid: 'La URL del servidor de la sala no es válida',
    serverUnreachable: 'No se pudo acceder al servidor de la sala', inviteCreateHttp: 'No se pudo crear el enlace (HTTP {status})',
    inviteCreateFailed: 'No se pudo crear el enlace de invitación', inviteCopied: 'Enlace copiado al portapapeles', inviteLink: 'Enlace: {link}',
    playbackStartFailed: 'No se pudo iniciar la reproducción. Recargar la página puede ayudar.',
    playbackBlocked: 'El navegador bloqueó la reproducción. Para continuar, pulsar Reproducir en Jellyfin.', waitingForMedia: 'Esperando el contenido de la sala',
    hostOnlyPlayback: 'Solo el anfitrión controla la reproducción', participantJoined: 'Se unió un participante',
    participantLeft: 'Un participante salió de la sala', roomClosed: 'La sala se cerró', unknownError: 'Error desconocido',
    hostResumed: 'El anfitrión reanudó la reproducción', hostPaused: 'El anfitrión pausó la reproducción', roomName: 'Sala de {name}',
    rejoinFailed: 'No se pudo volver a la sala', reauthFailed: 'No se pudo reautenticar la conexión',
    hostDisconnected: 'La sala se cerró al desconectarse el anfitrión', authInvalidResult: 'La autenticación de OpenWatchParty devolvió un resultado no válido',
    urlString: 'La URL del servidor debe ser texto', urlAbsolute: 'La URL debe ser absoluta, ws:// o wss://, y tener un host',
    urlCredentials: 'La URL no debe incluir credenciales', urlQuery: 'La URL no debe incluir consulta ni fragmento',
    urlHttps: 'Una página HTTPS requiere una URL segura wss://', authUnavailable: 'La autenticación de Jellyfin no está disponible',
    authInvalidToken: 'Jellyfin devolvió un token no válido', authRejected: 'Jellyfin rechazó el token de OpenWatchParty (HTTP 401)',
    authRateLimited: 'Demasiadas solicitudes de token (HTTP 429)', authServerError: 'Falló el servicio de tokens (HTTP 500)',
    authNotConfigured: 'La autenticación JWT no está configurada o disponible (HTTP 503)',
    authHttp: 'No se pudo obtener un token de OpenWatchParty (HTTP {status})', authInvalidJson: 'El servicio de tokens devolvió JSON no válido',
    authMissingUrl: 'El servicio de tokens debe proporcionar session_server_url', authBadUrl: 'El servicio de tokens devolvió una URL no válida: {error}',
    authBadResponse: 'El servicio de tokens devolvió una respuesta de autenticación no válida', authTimeout: 'La solicitud del token agotó el tiempo',
    authAborted: 'Se canceló la solicitud del token', authUnreachable: 'No se pudo acceder al servicio de tokens',
    errorRoomNotFound: 'La sala ya no existe', errorRoomFull: 'La sala está llena', errorRateLimited: 'Demasiadas solicitudes. Intentar de nuevo en un momento.', errorHostOnly: 'Solo el anfitrión puede hacer eso', errorChatTooLong: 'Mensaje demasiado largo', errorProtocol: 'Las versiones del cliente y del servidor de OpenWatchParty no son compatibles', inviteExpired: 'El enlace de invitación expiró', inviteWrongRoom: 'El enlace de invitación es de otra sala', roomClosedHostLeft: 'El anfitrión salió de la sala', roomClosedNewRoom: 'El anfitrión creó otra sala', inviteHostOnly: 'Solo el anfitrión puede crear enlaces de invitación', authInvalidated: 'Se invalidó la solicitud de autenticación'
  };

  const fr = {
    watchParty: 'Watch Party', closePanel: 'Fermer le panneau', availableRooms: 'Salons disponibles', createRoom: 'Créer un salon',
    createRoomHint: 'Lancez une vidéo pour créer un salon.', server: 'Serveur : ', onlineCount: 'En ligne : {count}',
    guest: 'Invité', anonymous: 'Anonyme', host: 'Hôte', participants: 'Participants', participantsCount: 'Participants : {count}', chat: 'Chat',
    chatUnread_one: 'Chat, {count} non lu', chatUnread_other: 'Chat, {count} non lus',
    latency: 'Latence vers le serveur de session (client {client})', leaveRoom: 'Quitter le salon', closeRoom: 'Fermer le salon',
    invite: 'Inviter', typeMessage: 'Écrire un message...', sendMessage: 'Envoyer', cancel: 'Annuler', leave: 'Quitter',
    closeRoomQuestion: 'Fermer le salon pour tous ?', leaveRoomQuestion: 'Quitter le salon ?', noActiveRooms: 'Aucun salon actif.',
    user_one: '{count} personne', user_other: '{count} personnes', noMedia: 'Aucun média', join: 'Rejoindre',
    watching_one: '{count} spectateur', watching_other: '{count} spectateurs', loading: 'Chargement...', unknown: 'Inconnu',
    watchParties: 'Watch Parties', online: 'En ligne', offline: 'Hors ligne', hosting: 'Hôte',
    playbackBlockedLabel: 'Lecture bloquée — appuyez sur Lecture', waitingSync: 'Synchronisation... {seconds}s',
    outOfSync: 'Désynchronisé', inSync: 'Synchronisé', noMediaJoinHint: "Ce salon n'a aucun média. Lancez une vidéo puis rejoignez-le depuis le lecteur.",
    noMediaInRoom: 'Aucun média dans ce salon', messageTooLong: 'Message trop long ({count} caractères max.)',
    notConnected: 'Non connecté au serveur', notInRoom: 'Aucun salon rejoint', inviteInvalid: "Le lien d'invitation est invalide",
    inviteAuthRequired: "Les invitations nécessitent une Watch Party authentifiée", serverUrlInvalid: "L'URL du serveur de session est invalide",
    serverUnreachable: 'Serveur de session inaccessible', inviteCreateHttp: "Impossible de créer l'invitation (HTTP {status})",
    inviteCreateFailed: "Impossible de créer l'invitation", inviteCopied: "Lien d'invitation copié", inviteLink: 'Invitation : {link}',
    playbackStartFailed: 'Impossible de lancer la lecture. Actualisez la page.',
    playbackBlocked: 'Lecture bloquée. Appuyez sur Lecture dans Jellyfin.', waitingForMedia: 'En attente du média de la Watch Party',
    hostOnlyPlayback: "Seul l'hôte contrôle la lecture", participantJoined: 'Un participant a rejoint le salon',
    participantLeft: 'Un participant a quitté le salon', roomClosed: 'Le salon a été fermé', unknownError: 'Erreur inconnue',
    hostResumed: "L'hôte a repris la lecture", hostPaused: "L'hôte a mis en pause", roomName: 'Salon : {name}',
    rejoinFailed: 'Impossible de rejoindre à nouveau la Watch Party', reauthFailed: 'Impossible de réauthentifier la connexion',
    hostDisconnected: "La Watch Party a été fermée après la déconnexion de l'hôte", authInvalidResult: "Résultat d'authentification OpenWatchParty invalide",
    urlString: "L'URL du serveur doit être une chaîne", urlAbsolute: "L'URL doit être absolue, en ws:// ou wss://, avec un hôte",
    urlCredentials: "L'URL ne doit pas contenir d'identifiants", urlQuery: "L'URL ne doit contenir ni requête ni fragment",
    urlHttps: 'Une page HTTPS exige une URL sécurisée wss://', authUnavailable: "L'authentification Jellyfin est indisponible",
    authInvalidToken: 'Jellyfin a renvoyé un jeton inutilisable', authRejected: 'Jellyfin a refusé le jeton OpenWatchParty (HTTP 401)',
    authRateLimited: 'Trop de demandes de jeton (HTTP 429)', authServerError: 'Le service de jetons a échoué (HTTP 500)',
    authNotConfigured: "L'authentification JWT est indisponible ou non configurée (HTTP 503)",
    authHttp: "Impossible d'obtenir un jeton OpenWatchParty (HTTP {status})", authInvalidJson: 'Le service de jetons a renvoyé un JSON invalide',
    authMissingUrl: 'Le service de jetons doit fournir session_server_url', authBadUrl: 'Le service de jetons a renvoyé une URL invalide : {error}',
    authBadResponse: "Réponse d'authentification du service de jetons invalide", authTimeout: 'La demande de jeton a expiré',
    authAborted: 'La demande de jeton a été annulée', authUnreachable: 'Le service de jetons est inaccessible',
    errorRoomNotFound: "Le salon n'existe plus", errorRoomFull: 'Le salon est complet', errorRateLimited: 'Trop de requêtes. Réessayez dans un instant.', errorHostOnly: "Seul l'hôte peut faire cela", errorChatTooLong: 'Message trop long', errorProtocol: 'Les versions du client et du serveur OpenWatchParty sont incompatibles', inviteExpired: "Le lien d'invitation a expiré", inviteWrongRoom: "Le lien d'invitation correspond à un autre salon", roomClosedHostLeft: "L'hôte a quitté le salon", roomClosedNewRoom: "L'hôte a créé un autre salon", inviteHostOnly: "Seul l'hôte peut créer des liens d'invitation", authInvalidated: "La demande d'authentification a été invalidée"
  };

  const de = {
    watchParty: 'Watch Party', closePanel: 'Panel schließen', availableRooms: 'Verfügbare Räume', createRoom: 'Raum erstellen',
    createRoomHint: 'Zum Erstellen erst etwas abspielen.', server: 'Server: ', onlineCount: 'Online: {count}',
    guest: 'Gast', anonymous: 'Anonym', host: 'Host', participants: 'Teilnehmer', participantsCount: 'Teilnehmer: {count}', chat: 'Chat',
    chatUnread_one: 'Chat, {count} ungelesen', chatUnread_other: 'Chat, {count} ungelesen',
    latency: 'Latenz zum Watch-Party-Server (Client {client})', leaveRoom: 'Raum verlassen', closeRoom: 'Raum schließen',
    invite: 'Einladen', typeMessage: 'Nachricht schreiben...', sendMessage: 'Senden', cancel: 'Abbrechen', leave: 'Verlassen',
    closeRoomQuestion: 'Raum für alle schließen?', leaveRoomQuestion: 'Raum verlassen?', noActiveRooms: 'Keine aktiven Räume.',
    user_one: '{count} Person', user_other: '{count} Personen', noMedia: 'Keine Medien', join: 'Beitreten',
    watching_one: '{count} schaut zu', watching_other: '{count} schauen zu', loading: 'Lädt...', unknown: 'Unbekannt',
    watchParties: 'Watch Parties', online: 'Online', offline: 'Offline', hosting: 'Host',
    playbackBlockedLabel: 'Wiedergabe blockiert – Play drücken', waitingSync: 'Synchronisierung... {seconds}s',
    outOfSync: 'Nicht synchron', inSync: 'Synchron', noMediaJoinHint: 'Dieser Raum hat keine Medien. Etwas abspielen und über den Player beitreten.',
    noMediaInRoom: 'Keine Medien in diesem Raum', messageTooLong: 'Nachricht zu lang (max. {count} Zeichen)',
    notConnected: 'Nicht mit dem Server verbunden', notInRoom: 'In keinem Raum', inviteInvalid: 'Einladungslink ist ungültig',
    inviteAuthRequired: 'Einladungen erfordern eine authentifizierte Watch Party', serverUrlInvalid: 'Die Server-URL ist ungültig',
    serverUnreachable: 'Watch-Party-Server nicht erreichbar', inviteCreateHttp: 'Einladung konnte nicht erstellt werden (HTTP {status})',
    inviteCreateFailed: 'Einladung konnte nicht erstellt werden', inviteCopied: 'Einladungslink kopiert', inviteLink: 'Einladung: {link}',
    playbackStartFailed: 'Wiedergabe konnte nicht starten. Seite neu laden.',
    playbackBlocked: 'Wiedergabe wurde blockiert. In Jellyfin Play drücken.', waitingForMedia: 'Warten auf Watch-Party-Medien',
    hostOnlyPlayback: 'Nur der Host steuert die Wiedergabe', participantJoined: 'Ein Teilnehmer ist beigetreten',
    participantLeft: 'Ein Teilnehmer hat den Raum verlassen', roomClosed: 'Der Raum wurde geschlossen', unknownError: 'Unbekannter Fehler',
    hostResumed: 'Der Host hat die Wiedergabe fortgesetzt', hostPaused: 'Der Host hat die Wiedergabe pausiert', roomName: 'Raum von {name}',
    rejoinFailed: 'Watch Party konnte nicht erneut betreten werden', reauthFailed: 'Verbindung konnte nicht neu authentifiziert werden',
    hostDisconnected: 'Watch Party wurde nach Trennung des Hosts geschlossen', authInvalidResult: 'Ungültiges OpenWatchParty-Authentifizierungsergebnis',
    urlString: 'Server-URL muss Text sein', urlAbsolute: 'Server-URL muss absolut sein und ws:// oder wss:// mit Host verwenden',
    urlCredentials: 'Server-URL darf keine Zugangsdaten enthalten', urlQuery: 'Server-URL darf weder eine Abfrage noch ein Fragment enthalten',
    urlHttps: 'Eine HTTPS-Seite erfordert eine sichere wss://-URL', authUnavailable: 'Jellyfin-Authentifizierung ist nicht verfügbar',
    authInvalidToken: 'Jellyfin hat ein unbrauchbares Token geliefert', authRejected: 'Jellyfin hat das OpenWatchParty-Token abgelehnt (HTTP 401)',
    authRateLimited: 'Zu viele Token-Anfragen (HTTP 429)', authServerError: 'Token-Dienst fehlgeschlagen (HTTP 500)',
    authNotConfigured: 'JWT-Authentifizierung ist nicht eingerichtet oder verfügbar (HTTP 503)',
    authHttp: 'OpenWatchParty-Token konnte nicht abgerufen werden (HTTP {status})', authInvalidJson: 'Token-Dienst lieferte ungültiges JSON',
    authMissingUrl: 'Token-Dienst muss session_server_url angeben', authBadUrl: 'Token-Dienst lieferte eine ungültige URL: {error}',
    authBadResponse: 'Token-Dienst lieferte eine ungültige Authentifizierungsantwort', authTimeout: 'Token-Anfrage hat das Zeitlimit überschritten',
    authAborted: 'Token-Anfrage wurde abgebrochen', authUnreachable: 'Token-Dienst ist nicht erreichbar',
    errorRoomNotFound: 'Der Raum existiert nicht mehr', errorRoomFull: 'Der Raum ist voll', errorRateLimited: 'Zu viele Anfragen. Bitte gleich erneut versuchen.', errorHostOnly: 'Nur der Host kann das tun', errorChatTooLong: 'Nachricht zu lang', errorProtocol: 'Die Versionen von OpenWatchParty-Client und -Server sind nicht kompatibel', inviteExpired: 'Der Einladungslink ist abgelaufen', inviteWrongRoom: 'Der Einladungslink gehört zu einem anderen Raum', roomClosedHostLeft: 'Der Host hat den Raum verlassen', roomClosedNewRoom: 'Der Host hat einen neuen Raum erstellt', inviteHostOnly: 'Nur der Host kann Einladungslinks erstellen', authInvalidated: 'Die Authentifizierungsanfrage ist nicht mehr gültig'
  };

  const catalogs = { en, es, fr, de };
  const locale = () => {
    const requested = String(document.documentElement?.lang || window.navigator?.language || 'en').trim().toLowerCase() || 'en';
    if (catalogs[requested]) return requested;
    const base = requested.split('-')[0];
    return catalogs[base] ? base : 'en';
  };
  const pluralKey = (key, params, language) => {
    if (params?.count === undefined) return key;
    let category = Number(params.count) === 1 ? 'one' : 'other';
    try {
      if (typeof Intl !== 'undefined' && Intl.PluralRules) category = new Intl.PluralRules(language).select(Number(params.count));
    } catch (err) {}
    const candidate = `${key}_${category}`;
    return Object.prototype.hasOwnProperty.call(en, candidate) ? candidate : key;
  };
  const t = (key, params = {}) => {
    const language = locale();
    const resolvedKey = pluralKey(key, params, language);
    const message = catalogs[language][resolvedKey] ?? en[resolvedKey] ?? resolvedKey;
    return String(message).replace(/\{([A-Za-z0-9_]+)\}/g, (match, name) =>
      Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match);
  };

  // The session server names every room "<host>'s room". Show that name in
  // the viewer's language; any other name is kept as it is.
  const DEFAULT_ROOM_NAME = /^(.+)'s room$/;
  const localizeRoomName = (name) => {
    const text = String(name ?? '');
    const match = DEFAULT_ROOM_NAME.exec(text);
    return match ? t('roomName', { name: match[1] }) : text;
  };

  // The session server writes its errors and room-closed reasons in English.
  // Known error codes and reasons are shown in the viewer's language; anything
  // else is shown as the server wrote it.
  const SERVER_ERROR_KEYS = {
    ROOM_NOT_FOUND: 'errorRoomNotFound',
    ROOM_FULL: 'errorRoomFull',
    RATE_LIMITED: 'errorRateLimited',
    HOST_PERMISSION_REQUIRED: 'errorHostOnly',
    NOT_IN_ROOM: 'notInRoom',
    NOT_ROOM_MEMBER: 'notInRoom',
    CHAT_MESSAGE_TOO_LONG: 'errorChatTooLong',
    PROTOCOL_VERSION_UNSUPPORTED: 'errorProtocol'
  };
  // Some codes carry different messages (authentication errors are about
  // invite tickets, for example): those are matched by message first.
  const SERVER_MESSAGE_KEYS = {
    'Invalid invite ticket': 'inviteInvalid',
    'Invite ticket has expired': 'inviteExpired',
    'Invite ticket does not match this room': 'inviteWrongRoom',
    'Only the room host can control playback': 'hostOnlyPlayback'
  };
  const ROOM_CLOSED_KEYS = {
    'Host left the room': 'roomClosedHostLeft',
    'Host started a new room': 'roomClosedNewRoom'
  };
  const ownKey = (map, key) => (Object.prototype.hasOwnProperty.call(map, key) ? map[key] : null);
  const localizeServerError = (code, message) => {
    const key = ownKey(SERVER_MESSAGE_KEYS, message) || ownKey(SERVER_ERROR_KEYS, code);
    return key ? t(key) : (message || t('unknownError'));
  };
  const localizeRoomClosedReason = (reason) => {
    const key = ownKey(ROOM_CLOSED_KEYS, reason);
    return key ? t(key) : (reason || t('roomClosed'));
  };

  OWP.i18n = { t, locale, catalogs, localizeRoomName, localizeServerError, localizeRoomClosedReason };
})();
