(() => {
  const OWP = window.OpenWatchParty = window.OpenWatchParty || {};
  const chat = OWP.chat = OWP.chat || { messages: [], unreadCount: 0 };
  const MAX_MESSAGES = 100;

  const formatTime = (ts) => {
    const date = new Date(ts);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  // The message text, with "@name" of anyone known to the chat highlighted.
  const appendText = (element, message) => {
    const value = String(message.text);
    if (message.system || !OWP.mentions) {
      element.textContent = value;
      return;
    }
    const names = [OWP.state.userName, ...(OWP.state.participants || []).map(p => p.name), ...chat.messages.map(m => m.username)];
    for (const part of OWP.mentions.segments(value, names, OWP.state.userName)) {
      if (!part.mention) {
        element.appendChild(document.createTextNode(part.text));
        continue;
      }
      const mention = document.createElement('span');
      mention.className = 'owp-chat-mention';
      mention.textContent = part.text;
      element.appendChild(mention);
    }
  };
  const mentionsMe = message => !message.isOwn && Boolean(OWP.mentions?.mentionsMe(String(message.text), OWP.state.userName));

  const renderMessage = (message) => {
    const container = document.getElementById('owp-chat-messages');
    if (!container) return;
    const msgEl = document.createElement('div');
    msgEl.className = 'owp-chat-message' + (message.isOwn ? ' owp-chat-own' : '')
      + (message.system ? ' owp-chat-system' : '') + (message.isError ? ' owp-chat-error' : '')
      + (message.mentionsMe ? ' owp-chat-mentioned' : '');
    // One line per message in the room bar: the time is in the tooltip.
    msgEl.title = formatTime(message.timestamp);
    const meta = document.createElement('div');
    meta.className = 'owp-chat-meta';
    const username = document.createElement('span');
    username.className = 'owp-chat-username';
    username.textContent = String(message.username);
    if (!message.system && OWP.avatars) meta.appendChild(OWP.avatars.create(message.username, message.userId, 'owp-chat-avatar'));
    const time = document.createElement('span');
    time.className = 'owp-chat-time';
    time.textContent = formatTime(message.timestamp);
    meta.append(username, time);
    const text = document.createElement('div');
    text.className = 'owp-chat-text';
    appendText(text, message);
    msgEl.append(meta, text);
    container.appendChild(msgEl);
    // The rendered chat keeps the same messages as chat.messages, which gains
    // one at a time.
    if (container.children.length > MAX_MESSAGES) container.children[0].remove();
    container.scrollTop = container.scrollHeight;
  };

  const renderAllMessages = () => {
    const container = document.getElementById('owp-chat-messages');
    if (!container) return;
    container.replaceChildren();
    chat.messages.forEach(msg => renderMessage(msg));
  };

  const receive = (msg) => {
    const message = {
      clientId: msg.client,
      username: msg.payload?.username || 'Anonymous',
      userId: msg.payload?.user_id,
      text: msg.payload?.text || '',
      timestamp: msg.server_ts || Date.now(),
      isOwn: msg.client === OWP.state.clientId
    };
    message.mentionsMe = mentionsMe(message);
    chat.messages.push(message);
    if (chat.messages.length > MAX_MESSAGES) {
      chat.messages.shift();
    }
    OWP.chatTyping?.clear(message.clientId);
    // Your own messages are never unread, even if the chat closed before the
    // server echoed them back.
    if (!chat.isChatVisible() && !message.isOwn) {
      chat.unreadCount++;
      chat.updateBadge();
      if (OWP.chatAlerts) OWP.chatAlerts.notify(message);
      else if (OWP.ui && OWP.ui.showChatToast) OWP.ui.showChatToast(message.username, message.text);
      chat.updateBadge();
    }
    renderMessage(message);
  };

  // A line from OWP itself, as SERVER: who the room waits for and why, say.
  // Only an error counts as unread (and shows a toast) while the chat is closed.
  const system = (text, isError = false) => {
    const message = { system: true, isError, username: 'SERVER', text, timestamp: Date.now(), isOwn: false };
    chat.messages.push(message);
    if (chat.messages.length > MAX_MESSAGES) chat.messages.shift();
    if (isError && !chat.isChatVisible()) {
      chat.unreadCount++;
      chat.updateBadge();
      if (OWP.ui && OWP.ui.showChatToast) OWP.ui.showChatToast(message.username, message.text);
    }
    renderMessage(message);
  };

  // The room's last messages, which a server with chat_history sends once on
  // joining. They replace what the chat shows (a rejoin after a lost
  // connection gets them again), and none counts as unread. The server marks
  // this member's own ones (its client id changes with each connection).
  const loadHistory = (entries) => {
    chat.messages = entries.slice(-MAX_MESSAGES).map(entry => ({
      clientId: entry.client,
      username: entry.username || 'Anonymous',
      userId: entry.user_id,
      text: entry.text,
      timestamp: entry.server_ts,
      isOwn: entry.own || entry.client === OWP.state.clientId
    }));
    chat.messages.forEach(message => { message.mentionsMe = mentionsMe(message); });
    chat.unreadCount = 0;
    chat.updateBadge();
    renderAllMessages();
  };

  const clear = () => {
    chat.messages = [];
    chat.unreadCount = 0;
    chat.updateBadge();
    const container = document.getElementById('owp-chat-messages');
    if (container) container.replaceChildren();
  };

  Object.assign(chat, { renderMessage, renderAllMessages, receive, system, loadHistory, clear });
})();
