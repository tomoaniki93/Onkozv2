/* ── Jeu DoomBeat intégré ────────────────────────────────────────────────────
   Troisième entrée de la section « Jeux » de la sidebar, sous SpeedG.

   Le jeu (page autonome, canvas 2D + Web Audio, fichier unique) est affiché
   dans une iframe same-origin servie par server/routes/doombeat.js. Il est
   purement local : réglages et records restent dans le navigateur du joueur.

   Dès qu'un salon, le Bug Tracker, un autre jeu ou le vocal réécrit la zone
   centrale, l'iframe disparaît (la partie s'arrête). La zone centrale n'est
   pas restylée en ligne : une classe CSS lui est ajoutée puis retirée, ce qui
   ne perturbe pas le style que les autres modules sauvegardent / restaurent.
   ─────────────────────────────────────────────────────────────────────────── */
const DoomBeat = (() => {
  const GAME_URL = '/jeux/doombeat/';
  const FRAME_ID = 'doombeat-frame';
  const ITEM_ID  = 'game-doombeat';
  const AREA_CLS = 'doombeat-open';
  let watcher = null;

  function ensureStyle() {
    if (document.getElementById('doombeat-style')) return;
    const st = document.createElement('style');
    st.id = 'doombeat-style';
    st.textContent = `#content-area.${AREA_CLS}{padding:0!important;overflow:hidden!important;display:flex!important;flex-direction:column!important}`;
    document.head.appendChild(st);
  }

  function setHeader(icon, name, category = '') {
    const values = [
      ['channel-icon', icon], ['channel-name', name], ['channel-category', category ? `— ${category}` : ''],
      ['mobile-ch-icon', icon], ['mobile-ch-name', name],
    ];
    values.forEach(([id, value]) => {
      const el = document.getElementById(id);
      if (el) el.textContent = value;
    });
  }

  function markActive() {
    document.querySelectorAll('.channel-item').forEach(el => el.classList.remove('bg-onkoz-active', 'text-onkoz-text'));
    document.getElementById(ITEM_ID)?.classList.add('bg-onkoz-active', 'text-onkoz-text');
  }

  // ── Sidebar ───────────────────────────────────────────────────────────────
  // Renvoie le <li> à ajouter à la liste de la section « Jeux ».
  function createSidebarItem() {
    const li = document.createElement('li');
    li.id = ITEM_ID;
    li.className = 'channel-item flex items-center gap-1.5 px-3 py-1 mx-1 rounded-md cursor-pointer transition-colors group text-onkoz-text-md hover:bg-onkoz-hover hover:text-onkoz-text';
    // La sidebar est reconstruite régulièrement : garder la surbrillance si le jeu est ouvert.
    if (document.getElementById(FRAME_ID)) li.classList.add('bg-onkoz-active', 'text-onkoz-text');
    li.innerHTML = `
      <span class="shrink-0 text-sm">🎸</span>
      <span class="flex-1 truncate text-[0.88rem]">DoomBeat</span>`;
    li.addEventListener('click', open);
    return li;
  }

  // ── Ouverture ─────────────────────────────────────────────────────────────
  function open() {
    const existing = document.getElementById(FRAME_ID);
    if (existing) {            // déjà ouvert : on redonne simplement le focus au jeu
      markActive();
      setHeader('🎸', 'DoomBeat', 'Jeux');
      existing.focus();
      return;
    }

    Chat.leaveTextChannelView?.();
    document.getElementById('message-input-area').style.display = 'none';
    document.getElementById('pinned-panel')?.classList.add('hidden');
    document.getElementById('btn-pinned')?.classList.add('hidden');
    markActive();
    setHeader('🎸', 'DoomBeat', 'Jeux');
    if (window.innerWidth <= 640) App.closeSidebar?.();

    ensureStyle();
    const area = document.getElementById('content-area');
    area.innerHTML = '';
    area.classList.add(AREA_CLS);

    const frame = document.createElement('iframe');
    frame.id = FRAME_ID;
    frame.src = GAME_URL;
    frame.title = 'DoomBeat';
    frame.allow = 'fullscreen; autoplay; gamepad';
    frame.style.cssText = 'flex:1 1 auto;width:100%;height:100%;min-height:0;border:0;display:block;background:#050000';
    frame.addEventListener('load', () => bridgeHotkeys(frame));
    area.appendChild(frame);
    frame.focus();

    watchLeave(area);
  }

  function watchLeave(area) {
    watcher?.disconnect();
    watcher = new MutationObserver(() => {
      if (document.getElementById(FRAME_ID)) return;
      watcher.disconnect();
      watcher = null;
      area.classList.remove(AREA_CLS);
      document.getElementById(ITEM_ID)?.classList.remove('bg-onkoz-active', 'text-onkoz-text');
    });
    watcher.observe(area, { childList: true });
  }

  // ── Push-to-talk pendant la partie ────────────────────────────────────────
  // Quand le focus est dans l'iframe, la fenêtre ONKOZ ne reçoit plus ses
  // keydown/keyup : hotkeys.js (push-to-talk, couper le micro) ne réagirait
  // plus. On relaie donc les touches et les boutons souris latéraux (≥ 3) vers
  // window, où Hotkeys écoute ; il ignore tout ce qui n'est pas un raccourci micro.
  function bridgeHotkeys(frame) {
    let win;
    try {
      win = frame.contentWindow;
      if (!win || win.__onkozHotkeys) return;
      win.__onkozHotkeys = true;
    } catch { return; }

    const typing = el => el && !el.readOnly
      && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);

    const relayKey = e => {
      if (e.type === 'keydown' && typing(e.target)) return;
      window.dispatchEvent(new KeyboardEvent(e.type, {
        code: e.code, key: e.key, location: e.location, repeat: e.repeat,
        ctrlKey: e.ctrlKey, altKey: e.altKey, shiftKey: e.shiftKey, metaKey: e.metaKey,
      }));
    };
    const relayMouse = e => {
      if (e.button < 3) return;
      window.dispatchEvent(new MouseEvent(e.type, {
        button: e.button, buttons: e.buttons,
        ctrlKey: e.ctrlKey, altKey: e.altKey, shiftKey: e.shiftKey, metaKey: e.metaKey,
      }));
    };

    win.addEventListener('keydown',   relayKey,   true);
    win.addEventListener('keyup',     relayKey,   true);
    win.addEventListener('mousedown', relayMouse, true);
    win.addEventListener('mouseup',   relayMouse, true);
  }

  return { createSidebarItem, open };
})();
