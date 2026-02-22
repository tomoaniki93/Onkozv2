/* ── Chat Module ─────────────────────────────────────────────────────────── */
const Chat = (() => {
  let socket = null;
  let currentTextChannel = null;
  let dmPartnerId   = null;
  let dmPartnerName = null;

  function init(s) { socket = s; }

  // ── Salon texte ────────────────────────────────────────────────────────────
  async function joinTextChannel(channelId, channelName) {
    if (currentTextChannel) socket.emit('chat:leave', currentTextChannel);
    currentTextChannel = channelId;
    socket.emit('chat:join', channelId);

    const area = document.getElementById('content-area');
    area.innerHTML = '<p class="text-center text-onkoz-text-muted text-sm py-4">Chargement...</p>';

    const messages = await API.getMessages(channelId);
    area.innerHTML = '';
    messages.forEach(msg => appendMessage(msg, area, false));
    area.scrollTop = area.scrollHeight;

    document.getElementById('message-input-area').style.display = 'block';
    document.getElementById('message-input').focus();
  }

  function appendMessage(msg, area, scroll = true) {
    const isMod = Auth.isMod() || Auth.isAdmin();
    const me    = Auth.getUser();

    const div = document.createElement('div');
    div.dataset.msgId = msg.id;
    div.className = 'group flex gap-3 px-2 py-1 rounded-md hover:bg-onkoz-hover/50 transition-colors relative';

    const av = UI.makeAvatar(msg.username);

    const body = document.createElement('div');
    body.className = 'flex-1 min-w-0';

    const header = document.createElement('div');
    header.className = 'flex items-baseline gap-2 mb-0.5';

    const author = document.createElement('span');
    author.className = `msg-author font-bold text-[0.9rem] ${msg.role}`;
    author.textContent = msg.username;

    const time = document.createElement('span');
    time.className = 'text-[0.72rem] text-onkoz-text-muted';
    time.textContent = UI.formatTime(msg.created_at);

    header.append(author, time);

    const content = document.createElement('div');
    content.className = 'text-[0.9rem] text-onkoz-text leading-relaxed break-words';
    content.textContent = msg.content;

    // Zone réactions
    const reactionsEl = document.createElement('div');
    reactionsEl.id = `reactions-${msg.id}`;
    reactionsEl.className = 'flex flex-wrap gap-1 mt-1';
    renderReactions(reactionsEl, msg.reactions || [], msg.id, me);

    body.append(header, content, reactionsEl);
    div.append(av, body);

    // Barre d'actions au survol
    const actions = document.createElement('div');
    actions.className = 'absolute right-2 top-1 hidden group-hover:flex items-center gap-1 bg-onkoz-surface border border-onkoz-border rounded-md shadow-sm px-1 py-0.5';

    const emojiBtn = document.createElement('button');
    emojiBtn.className = 'w-7 h-7 flex items-center justify-center rounded hover:bg-onkoz-hover transition-colors text-onkoz-text-muted hover:text-onkoz-text text-base';
    emojiBtn.textContent = '😊';
    emojiBtn.title = 'Ajouter une réaction';
    emojiBtn.addEventListener('click', e => {
      e.stopPropagation();
      EmojiPicker.open(emojiBtn, emoji => {
        socket.emit('reaction:toggle', { messageId: msg.id, emoji, channelId: currentTextChannel });
      });
    });
    actions.appendChild(emojiBtn);

    if (isMod) {
      const delBtn = document.createElement('button');
      delBtn.className = 'w-7 h-7 flex items-center justify-center rounded hover:bg-onkoz-danger/20 transition-colors text-onkoz-text-muted hover:text-onkoz-danger text-sm';
      delBtn.textContent = '🗑';
      delBtn.title = 'Supprimer';
      delBtn.addEventListener('click', () => socket.emit('chat:delete', { messageId: msg.id, channelId: currentTextChannel }));
      actions.appendChild(delBtn);
    }

    div.appendChild(actions);
    area.appendChild(div);
    if (scroll) area.scrollTop = area.scrollHeight;
  }

  function renderReactions(container, reactions, msgId, me) {
    container.innerHTML = '';
    reactions.forEach(({ emoji, count, users }) => {
      const iReacted = users.some(u => u.userId === me?.id);
      const btn = document.createElement('button');
      btn.className = `inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-sm transition-colors ${
        iReacted ? 'bg-onkoz-accent/20 border-onkoz-accent text-onkoz-accent-lt' : 'bg-onkoz-hover border-onkoz-border text-onkoz-text hover:border-onkoz-accent'
      }`;
      btn.innerHTML = `<span>${emoji}</span><span class="text-[0.72rem] font-bold">${count}</span>`;
      btn.title = users.map(u => u.username).join(', ');
      btn.addEventListener('click', () => {
        socket.emit('reaction:toggle', { messageId: msgId, emoji, channelId: currentTextChannel });
      });
      container.appendChild(btn);
    });
  }

  function onReactionUpdate({ messageId, reactions }) {
    const container = document.getElementById(`reactions-${messageId}`);
    if (!container) return;
    renderReactions(container, reactions, messageId, Auth.getUser());
  }

  function onMessage(msg) {
    if (msg.channel_id != currentTextChannel) return;
    appendMessage(msg, document.getElementById('content-area'), true);
  }

  function onDeleted({ messageId }) {
    document.querySelector(`[data-msg-id="${messageId}"]`)?.remove();
  }

  function sendMessage() {
    const input = document.getElementById('message-input');
    const content = input.value.trim();
    if (!content) return;
    socket.emit('chat:message', { channelId: currentTextChannel, content });
    input.value = '';
  }

  // ── DM ────────────────────────────────────────────────────────────────────
  async function openDM(partnerId, partnerName) {
    dmPartnerId = partnerId;
    dmPartnerName = partnerName;

    document.getElementById('dm-partner-name').textContent = partnerName;
    const panel = document.getElementById('dm-panel');
    panel.classList.remove('hidden');
    panel.classList.add('flex');

    const msgs = await API.getDMHistory(partnerId);
    const area = document.getElementById('dm-messages');
    area.innerHTML = '';
    const me = Auth.getUser();
    msgs.forEach(m => appendDMMessage(m, me.id));
    area.scrollTop = area.scrollHeight;
    document.getElementById('dm-input').focus();
  }

  function appendDMMessage(msg, myId) {
    const area = document.getElementById('dm-messages');
    const mine = msg.from_id === myId;

    const div = document.createElement('div');
    div.className = `flex flex-col max-w-[85%] ${mine ? 'self-end items-end' : 'self-start items-start'}`;

    const meta = document.createElement('div');
    meta.className = 'text-[0.7rem] text-onkoz-text-muted mb-0.5 px-1';
    meta.textContent = `${mine ? 'Moi' : msg.from_username} · ${UI.formatTime(msg.created_at)}`;

    const bubble = document.createElement('div');
    bubble.className = `px-3 py-1.5 rounded-lg text-[0.88rem] leading-relaxed ${mine ? 'bg-onkoz-accent text-white' : 'bg-onkoz-hover text-onkoz-text'}`;
    bubble.textContent = msg.content;

    div.append(meta, bubble);
    area.appendChild(div);
  }

  function onDMMessage(msg) {
    const me = Auth.getUser();
    const panel = document.getElementById('dm-panel');
    if (!panel.classList.contains('hidden') && (msg.from_id === dmPartnerId || msg.to_id === dmPartnerId)) {
      appendDMMessage(msg, me.id);
      const area = document.getElementById('dm-messages');
      area.scrollTop = area.scrollHeight;
    } else if (msg.from_id !== me.id) {
      App.showUnreadBadge(msg.from_id);
    }
  }

  function sendDM() {
    const input = document.getElementById('dm-input');
    const content = input.value.trim();
    if (!content || !dmPartnerId) return;
    socket.emit('dm:send', { toId: dmPartnerId, content });
    input.value = '';
  }

  function closeDM() {
    const panel = document.getElementById('dm-panel');
    panel.classList.add('hidden');
    panel.classList.remove('flex');
    dmPartnerId = dmPartnerName = null;
  }

  // ── Texte éphémère ────────────────────────────────────────────────────────
  function setupEphemeralText(socket, eid) {
    document.getElementById('message-input-area').style.display = 'block';
    const input = document.getElementById('message-input');
    const sendBtn = document.getElementById('send-btn');

    const doSend = () => {
      const c = input.value.trim();
      if (!c) return;
      socket.emit('ephemeral:message', { eid, content: c });
      input.value = '';
    };

    sendBtn.onclick = doSend;
    input.onkeydown = e => { if (e.key === 'Enter') doSend(); };

    socket.on('ephemeral:message', ({ eid: msgEid, username, role, content }) => {
      if (msgEid !== eid) return;
      const area = document.getElementById('content-area');
      let chat = document.getElementById('eph-chat');
      if (!chat) {
        chat = document.createElement('div');
        chat.id = 'eph-chat';
        chat.className = 'mt-4 w-full max-w-lg max-h-48 overflow-y-auto bg-onkoz-surface rounded-xl p-3 flex flex-col gap-1';
        area.appendChild(chat);
      }
      const msg = document.createElement('div');
      msg.innerHTML = `<span class="msg-author font-bold text-sm ${role}">${username}</span> <span class="text-sm text-onkoz-text">${content}</span>`;
      chat.appendChild(msg);
      chat.scrollTop = chat.scrollHeight;
    });
  }

  return { init, joinTextChannel, onMessage, onDeleted, onReactionUpdate, sendMessage, openDM, onDMMessage, sendDM, closeDM, setupEphemeralText };
})();
