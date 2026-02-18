/* ── Chat Module ─────────────────────────────────────────────────────────────
   Gère les messages des salons texte + DM.
   ─────────────────────────────────────────────────────────────────────────── */
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

    // Charger l'historique
    const area = document.getElementById('content-area');
    area.innerHTML = '<div class="loading-msgs" style="color:var(--text-muted);padding:1rem;text-align:center">Chargement...</div>';

    const messages = await API.getMessages(channelId);
    renderMessages(area, messages);

    // Afficher input
    document.getElementById('message-input-area').style.display = 'block';
    document.getElementById('message-input').focus();
  }

  function renderMessages(area, messages) {
    area.innerHTML = '';
    for (const msg of messages) appendMessage(msg, area, false);
    area.scrollTop = area.scrollHeight;
  }

  function appendMessage(msg, area, scroll = true) {
    const user = Auth.getUser();
    const isMod = Auth.isMod();

    const div = document.createElement('div');
    div.className = 'message';
    div.dataset.msgId = msg.id;

    const av = UI.makeAvatar(msg.username, 36);
    const body = document.createElement('div');
    body.className = 'msg-body';

    const header = document.createElement('div');
    header.className = 'msg-header';

    const author = document.createElement('span');
    author.className = `msg-author ${msg.role}`;
    author.textContent = msg.username;

    const time = document.createElement('span');
    time.className = 'msg-time';
    time.textContent = UI.formatTime(msg.created_at);

    header.append(author, time);

    const content = document.createElement('div');
    content.className = 'msg-content';
    content.textContent = msg.content;

    body.append(header, content);
    div.append(av, body);

    // Bouton supprimer (mod/admin)
    if (isMod) {
      const delBtn = document.createElement('button');
      delBtn.className = 'msg-del-btn';
      delBtn.textContent = '🗑';
      delBtn.title = 'Supprimer';
      delBtn.addEventListener('click', () => {
        socket.emit('chat:delete', { messageId: msg.id, channelId: currentTextChannel });
      });
      div.append(delBtn);
    }

    area.appendChild(div);
    if (scroll) area.scrollTop = area.scrollHeight;
  }

  function onMessage(msg) {
    if (msg.channel_id != currentTextChannel) return;
    const area = document.getElementById('content-area');
    appendMessage(msg, area, true);
  }

  function onDeleted({ messageId }) {
    document.querySelector(`[data-msg-id="${messageId}"]`)?.remove();
  }

  function sendMessage() {
    const input   = document.getElementById('message-input');
    const content = input.value.trim();
    if (!content) return;
    socket.emit('chat:message', { channelId: currentTextChannel, content });
    input.value = '';
  }

  // ── DM ────────────────────────────────────────────────────────────────────
  async function openDM(partnerId, partnerName) {
    dmPartnerId   = partnerId;
    dmPartnerName = partnerName;

    document.getElementById('dm-partner-name').textContent = partnerName;
    document.getElementById('dm-panel').classList.remove('hidden');

    const msgs = await API.getDMHistory(partnerId);
    const area = document.getElementById('dm-messages');
    area.innerHTML = '';

    const me = Auth.getUser();
    for (const m of msgs) appendDMMessage(m, me.id);
    area.scrollTop = area.scrollHeight;

    document.getElementById('dm-input').focus();
  }

  function appendDMMessage(msg, myId) {
    const area = document.getElementById('dm-messages');
    const div  = document.createElement('div');
    const mine = msg.from_id === myId;

    div.className = `dm-msg ${mine ? 'mine' : 'theirs'}`;
    div.innerHTML = `
      <div class="dm-meta">${mine ? 'Moi' : msg.from_username} · ${UI.formatTime(msg.created_at)}</div>
      ${msg.content}`;
    area.appendChild(div);
  }

  function onDMMessage(msg) {
    const me = Auth.getUser();
    // Si la fenêtre DM est ouverte et concerne ce partenaire
    if (
      document.getElementById('dm-panel').classList.contains('hidden') === false &&
      (msg.from_id === dmPartnerId || msg.to_id === dmPartnerId)
    ) {
      appendDMMessage(msg, me.id);
      const area = document.getElementById('dm-messages');
      area.scrollTop = area.scrollHeight;
    } else if (msg.from_id !== me.id) {
      // Notification non lue
      App.showUnreadBadge(msg.from_id);
    }
  }

  function sendDM() {
    const input   = document.getElementById('dm-input');
    const content = input.value.trim();
    if (!content || !dmPartnerId) return;
    socket.emit('dm:send', { toId: dmPartnerId, content });
    input.value = '';
  }

  function closeDM() {
    document.getElementById('dm-panel').classList.add('hidden');
    dmPartnerId = dmPartnerName = null;
  }

  return {
    init, joinTextChannel, onMessage, onDeleted, sendMessage,
    openDM, onDMMessage, sendDM, closeDM,
  };
})();
