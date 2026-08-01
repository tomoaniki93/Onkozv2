/* ── Whisper Module (chuchotement texte) ──────────────────────────────────────
   Mini-fenêtres flottantes empilables pour envoyer des messages privés rapides,
   sans quitter le salon courant. S'appuie sur la plomberie DM existante :
     - envoi    : socket.emit('dm:send', { toId, content })
     - réception: événement 'dm:message' (routé ici par Chat.onDMMessage → Whisper.receive)
     - historique: API.getDMHistory(partnerId)

   Aucune modification serveur. Purement client.

   Dépendances : window.Chat (accès socket), API.getDMHistory, Auth.getUser,
                 UI.formatTime, App.showUnreadBadge (optionnel)
   ─────────────────────────────────────────────────────────────────────────── */
const Whisper = (() => {

  const MAX_OPEN = 3;                 // nb max de fenêtres simultanées
  const W        = 300;              // largeur d'une fenêtre (px)
  const GAP      = 12;               // espace entre fenêtres
  const RIGHT0   = 16;              // marge droite de la première

  let socket = null;
  const wins = new Map();            // partnerId -> { el, body, input, name, unread }

  // ═══════════════════════════════════════════════════════════════════════════
  //  INIT — appelé depuis Chat.init() avec le socket
  // ═══════════════════════════════════════════════════════════════════════════
  function init(sock) {
    socket = sock;
    bindMemberTriggers();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  DÉCLENCHEURS — clic droit sur un membre de la liste
  // ═══════════════════════════════════════════════════════════════════════════
  function bindMemberTriggers() {
    // Délégation : marche même pour les membres rendus après coup
    document.addEventListener('contextmenu', e => {
      const li = e.target.closest('[data-user-id]');
      if (!li) return;
      const me = Auth.getUser?.();
      const id = parseInt(li.dataset.userId, 10);
      if (!id || (me && id === me.id)) return;      // pas de chuchotement à soi-même

      e.preventDefault();
      const name = li.querySelector('.truncate.font-medium, span.font-medium')?.textContent
                 || li.querySelector('span')?.textContent
                 || 'Membre';
      open(id, name.trim());
    });
  }

  /** Point d'entrée public : ouvrir une fenêtre de chuchotement. */
  async function open(partnerId, partnerName) {
    partnerId = parseInt(partnerId, 10);
    if (wins.has(partnerId)) { focusWin(partnerId); return; }

    // Limite : ferme la plus ancienne si on dépasse
    if (wins.size >= MAX_OPEN) {
      const oldest = wins.keys().next().value;
      close(oldest);
    }

    const win = build(partnerId, partnerName);
    wins.set(partnerId, win);
    relayout();

    // Charger l'historique
    try {
      const msgs = await API.getDMHistory(partnerId);
      const me   = Auth.getUser();
      win.body.innerHTML = '';
      msgs.forEach(m => append(partnerId, m, me.id));
      scrollBottom(partnerId);
    } catch (_) {
      win.body.innerHTML = '<p class="text-[0.7rem] text-onkoz-text-muted text-center py-4">Historique indisponible</p>';
    }

    win.input.focus();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  CONSTRUCTION D'UNE FENÊTRE
  // ═══════════════════════════════════════════════════════════════════════════
  function build(partnerId, partnerName) {
    const el = document.createElement('div');
    el.className =
      'fixed bottom-4 w-[300px] h-[380px] bg-onkoz-surface border border-onkoz-border ' +
      'rounded-xl shadow-dm flex flex-col z-50 overflow-hidden transition-all';
    el.dataset.whisper = partnerId;

    // En-tête
    const head = document.createElement('div');
    head.className =
      'flex items-center gap-2 px-3 py-2 border-b border-onkoz-border ' +
      'bg-onkoz-bg/40 shrink-0 cursor-default select-none';
    head.innerHTML = `
      <span class="text-onkoz-accent text-sm">💬</span>
      <span class="flex-1 min-w-0 truncate text-[0.82rem] font-semibold text-onkoz-text"></span>
      <button class="wsp-close w-5 h-5 flex items-center justify-center rounded
              text-onkoz-text-muted hover:bg-onkoz-hover hover:text-onkoz-text
              transition-colors text-xs shrink-0" title="Fermer">✕</button>`;
    head.querySelector('span.flex-1').textContent = partnerName;

    // Corps (messages)
    const body = document.createElement('div');
    body.className = 'flex-1 min-h-0 overflow-y-auto flex flex-col gap-1.5 p-2.5';

    // Zone de saisie
    const foot = document.createElement('div');
    foot.className = 'flex items-center gap-1.5 p-2 border-t border-onkoz-border shrink-0';
    const input = document.createElement('input');
    input.type = 'text';
    input.maxLength = 2000;
    input.placeholder = 'Chuchoter…';
    input.className =
      'flex-1 min-w-0 bg-onkoz-bg border border-onkoz-border rounded-full px-3 py-1.5 ' +
      'text-[0.82rem] text-onkoz-text placeholder:text-onkoz-text-muted ' +
      'focus:outline-none focus:border-onkoz-accent transition-colors';
    const sendBtn = document.createElement('button');
    sendBtn.className =
      'w-7 h-7 flex items-center justify-center bg-onkoz-accent hover:bg-onkoz-accent-dk ' +
      'text-white rounded-full transition-colors shrink-0 text-sm';
    sendBtn.textContent = '↑';
    foot.append(input, sendBtn);

    el.append(head, body, foot);
    document.body.appendChild(el);

    const win = { el, body, input, name: partnerName, unread: false };

    // Interactions
    head.querySelector('.wsp-close').addEventListener('click', () => close(partnerId));
    sendBtn.addEventListener('click', () => send(partnerId));
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(partnerId); }
      if (e.key === 'Escape') close(partnerId);
    });
    el.addEventListener('mousedown', () => clearUnread(partnerId));

    return win;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  DISPOSITION — empile les fenêtres de la droite vers la gauche
  // ═══════════════════════════════════════════════════════════════════════════
  function relayout() {
    let i = 0;
    for (const win of wins.values()) {
      win.el.style.right = `${RIGHT0 + i * (W + GAP)}px`;
      i++;
    }
  }

  function focusWin(partnerId) {
    const win = wins.get(partnerId);
    win?.input.focus();
    clearUnread(partnerId);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  ENVOI / RÉCEPTION
  // ═══════════════════════════════════════════════════════════════════════════
  function send(partnerId) {
    const win = wins.get(partnerId);
    if (!win) return;
    const content = win.input.value.trim();
    if (!content) return;
    socket.emit('dm:send', { toId: partnerId, content });
    win.input.value = '';
    win.input.focus();
  }

  /**
   * Appelé depuis Chat.onDMMessage pour chaque 'dm:message'.
   * Retourne true si le message a été absorbé par une fenêtre de chuchotement
   * (permet à Chat.onDMMessage de ne pas le traiter deux fois).
   */
  function receive(msg) {
    const me = Auth.getUser();
    // Interlocuteur concerné = l'autre bout de la conversation
    const other = msg.from_id === me.id ? msg.to_id : msg.from_id;
    const win = wins.get(other);
    if (!win) return false;

    append(other, msg, me.id);
    scrollBottom(other);
    if (msg.from_id !== me.id && document.activeElement !== win.input) {
      markUnread(other);
    }
    return true;
  }

  function append(partnerId, msg, myId) {
    const win = wins.get(partnerId);
    if (!win) return;
    const mine = msg.from_id === myId;

    const row = document.createElement('div');
    row.className = `flex flex-col max-w-[85%] ${mine ? 'self-end items-end' : 'self-start items-start'}`;

    const meta = document.createElement('div');
    meta.className = 'text-[0.62rem] text-onkoz-text-muted mb-0.5 px-1';
    meta.textContent = `${mine ? 'Moi' : (msg.from_username || win.name)} · ${UI.formatTime(msg.created_at)}`;

    const bubble = document.createElement('div');
    bubble.className =
      `px-2.5 py-1 rounded-lg text-[0.8rem] leading-relaxed break-words ` +
      (mine ? 'bg-onkoz-accent text-white' : 'bg-onkoz-hover text-onkoz-text');
    bubble.textContent = msg.content;

    row.append(meta, bubble);
    win.body.appendChild(row);
  }

  function scrollBottom(partnerId) {
    const win = wins.get(partnerId);
    if (win) win.body.scrollTop = win.body.scrollHeight;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  NON-LUS
  // ═══════════════════════════════════════════════════════════════════════════
  function markUnread(partnerId) {
    const win = wins.get(partnerId);
    if (!win || win.unread) return;
    win.unread = true;
    win.el.classList.add('ring-2', 'ring-onkoz-accent');
  }
  function clearUnread(partnerId) {
    const win = wins.get(partnerId);
    if (!win || !win.unread) return;
    win.unread = false;
    win.el.classList.remove('ring-2', 'ring-onkoz-accent');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  FERMETURE
  // ═══════════════════════════════════════════════════════════════════════════
  function close(partnerId) {
    const win = wins.get(partnerId);
    if (!win) return;
    win.el.remove();
    wins.delete(partnerId);
    relayout();
  }

  function closeAll() {
    for (const id of [...wins.keys()]) close(id);
  }

  // ── API publique ────────────────────────────────────────────────────────────
  return { init, open, receive, close, closeAll };

})();
