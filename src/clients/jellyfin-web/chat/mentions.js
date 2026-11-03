(() => {
  const OWP = window.OpenWatchParty = window.OpenWatchParty || {};
  const state = OWP.state;
  const t = OWP.i18n.t;

  const MAX_SUGGESTIONS = 6;
  const MAX_QUERY_LENGTH = 32;
  const LIST_ID = 'owp-mention-list';

  // A mention starts after the text's start or a non-word character, and its
  // name ends at the text's end or a non-word character: mail@host is none.
  const WORD = /[\p{L}\p{N}_]/u;
  const boundary = character => !character || !WORD.test(character);
  const lower = value => String(value).toLocaleLowerCase();

  // Splits text into plain runs and "@name" runs for the given names, matched
  // literally and case-insensitively, the longest name first.
  const segments = (text, names, myName) => {
    const known = [...new Set(names.filter(Boolean))].sort((a, b) => b.length - a.length);
    const result = [];
    let plain = '';
    let index = 0;
    while (index < text.length) {
      const name = text[index] === '@' && boundary(text[index - 1])
        ? known.find(candidate => lower(text.slice(index + 1, index + 1 + candidate.length)) === lower(candidate)
          && boundary(text[index + 1 + candidate.length]))
        : null;
      if (!name) {
        plain += text[index];
        index += 1;
        continue;
      }
      if (plain) result.push({ text: plain, mention: false, me: false });
      plain = '';
      const token = text.slice(index, index + 1 + name.length);
      result.push({ text: token, mention: true, me: Boolean(myName) && lower(name) === lower(myName) });
      index += token.length;
    }
    if (plain) result.push({ text: plain, mention: false, me: false });
    return result;
  };

  const mentionsMe = (text, myName) => Boolean(myName) && segments(text, [myName], myName).some(part => part.me);

  // Participants other than me whose name starts with the query, then those
  // that contain it.
  const suggest = (query, participants, myName) => {
    const wanted = lower(query);
    const seen = new Set([lower(myName || '')]);
    const others = participants.filter(participant => {
      const key = lower(participant.name || '');
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const starts = others.filter(participant => lower(participant.name).startsWith(wanted));
    const contains = others.filter(participant => !starts.includes(participant) && lower(participant.name).includes(wanted));
    return [...starts, ...contains].slice(0, MAX_SUGGESTIONS);
  };

  // The "@query" the caret is in, if any.
  const activeQuery = (value, caret) => {
    const before = value.slice(0, caret);
    const start = before.lastIndexOf('@');
    if (start < 0 || !boundary(before[start - 1])) return null;
    const query = before.slice(start + 1);
    if (query.length > MAX_QUERY_LENGTH || query.includes('@')) return null;
    return { start, query };
  };

  let input = null;
  let match = null;
  let options = [];
  let active = 0;

  const close = () => {
    document.getElementById(LIST_ID)?.remove();
    options = [];
    match = null;
    if (input) {
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
    }
  };

  const highlight = () => {
    const list = document.getElementById(LIST_ID);
    if (!list) return;
    list.querySelectorAll('[role="option"]').forEach((option, index) => {
      option.setAttribute('aria-selected', String(index === active));
      option.classList.toggle('owp-mention-active', index === active);
      if (index === active) input.setAttribute('aria-activedescendant', option.id);
    });
  };

  const choose = index => {
    const participant = options[index];
    if (!participant || !match) return;
    const caret = input.selectionStart ?? input.value.length;
    const inserted = `@${participant.name} `;
    input.value = input.value.slice(0, match.start) + inserted + input.value.slice(caret);
    const position = match.start + inserted.length;
    input.selectionStart = input.selectionEnd = position;
    input.setSelectionRange?.(position, position);
    close();
    input.focus?.();
    OWP.chatTyping?.inputChanged(input.value);
  };

  const update = () => {
    const found = activeQuery(input.value, input.selectionStart ?? input.value.length);
    const matches = found ? suggest(found.query, state.participants || [], state.userName) : [];
    if (!matches.length) {
      close();
      return;
    }
    close();
    match = found;
    options = matches;
    active = 0;
    const list = document.createElement('div');
    list.id = LIST_ID;
    list.className = 'owp-mention-list';
    list.setAttribute('role', 'listbox');
    matches.forEach((participant, index) => {
      const option = document.createElement('div');
      option.id = `owp-mention-option-${index}`;
      option.className = 'owp-mention-option';
      option.setAttribute('role', 'option');
      option.append(OWP.avatars.create(participant.name, participant.userId, 'owp-chat-avatar'), document.createTextNode(participant.name));
      // mousedown, not click: the input keeps its focus.
      option.addEventListener('mousedown', event => {
        event.preventDefault?.();
        choose(index);
      });
      list.appendChild(option);
    });
    const hint = document.createElement('div');
    hint.className = 'owp-mention-hint';
    hint.textContent = t('mentionHint');
    list.appendChild(hint);
    input.closest?.('#owp-chat-input-container')?.appendChild(list) ?? input.parentNode?.appendChild(list);
    input.setAttribute('aria-expanded', 'true');
    input.setAttribute('aria-controls', LIST_ID);
    highlight();
  };

  // Called from the input's keydown first: true when the list used the key.
  const handleKeydown = event => {
    if (!options.length) return false;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      active = (active + step + options.length) % options.length;
      highlight();
      return true;
    }
    if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault();
      choose(active);
      return true;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return true;
    }
    return false;
  };

  const attach = element => {
    input = element;
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-expanded', 'false');
    input.addEventListener('input', update);
    input.addEventListener('blur', close);
  };

  OWP.mentions = { segments, mentionsMe, suggest, activeQuery, attach, handleKeydown, close };
})();
