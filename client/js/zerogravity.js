/* ── Jeu Zero-Gravity intégré ────────────────────────────────────────────────
   Même principe que le Bug Tracker : une entrée dans la sidebar (section
   « Jeux », sous le Bug Tracker) et la zone centrale prend le relais.

   Le jeu (pages autonomes Babylon.js) est affiché dans une iframe same-origin
   servie par server/routes/zerogravity.js. Il lit lui-même le token ONKOZ :
   classement du serveur, indicatif = pseudo du compte.

   Dès qu'un salon, le Bug Tracker ou le vocal réécrit la zone centrale,
   l'iframe disparaît (la partie s'arrête) et la zone retrouve son style.
   ─────────────────────────────────────────────────────────────────────────── */
const ZeroGravity = (() => {
  const GAME_URL = '/jeux/zero-gravity/';
  const FRAME_ID = 'zg-frame';
  const ITEM_ID  = 'game-zero-gravity';
  let watcher = null;

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
  function createSidebarSection() {
    const section = document.createElement('div');
    section.id = 'games-section';
    section.className = 'mt-1 border-t border-onkoz-border pt-1';

    const header = document.createElement('div');
    header.className = 'flex items-center gap-1 px-2 py-1';
    header.innerHTML = '<span class="flex-1 text-[0.72rem] font-bold tracking-wider uppercase text-onkoz-text-muted">Jeux</span>';

    const list = document.createElement('ul');
    list.className = 'flex flex-col';

    const li = document.createElement('li');
    li.id = ITEM_ID;
    li.className = 'channel-item flex items-center gap-1.5 px-3 py-1 mx-1 rounded-md cursor-pointer transition-colors group text-onkoz-text-md hover:bg-onkoz-hover hover:text-onkoz-text';
    // La sidebar est reconstruite régulièrement : garder la surbrillance si le jeu est ouvert.
    if (document.getElementById(FRAME_ID)) li.classList.add('bg-onkoz-active', 'text-onkoz-text');
    li.innerHTML = `
      <span class="shrink-0 text-sm">🚀</span>
      <span class="flex-1 truncate text-[0.88rem]">Zero-Gravity</span>`;
    li.addEventListener('click', open);

    list.appendChild(li);
    section.append(header, list);
    return section;
  }

  // ── Ouverture ─────────────────────────────────────────────────────────────
  function open() {
    const existing = document.getElementById(FRAME_ID);
    if (existing) return backToLevels(existing);

    Chat.leaveTextChannelView?.();
    document.getElementById('message-input-area').style.display = 'none';
    document.getElementById('pinned-panel')?.classList.add('hidden');
    document.getElementById('btn-pinned')?.classList.add('hidden');
    markActive();
    setHeader('🚀', 'Zero-Gravity', 'Jeux');
    if (window.innerWidth <= 640) App.closeSidebar?.();

    // La zone centrale devient un cadre plein bord ; son style d'origine est
    // restauré par le watcher dès qu'un autre module la réécrit.
    const area = document.getElementById('content-area');
    const prevStyle = area.getAttribute('style');
    area.innerHTML = '';
    Object.assign(area.style, { padding: '0', overflow: 'hidden', display: 'flex', flexDirection: 'column' });

    const frame = document.createElement('iframe');
    frame.id = FRAME_ID;
    frame.src = GAME_URL;
    frame.title = 'Zero-Gravity';
    frame.allow = 'fullscreen; autoplay';
    frame.style.cssText = 'flex:1 1 auto;width:100%;height:100%;min-height:0;border:0;display:block;background:#0a1824';
    frame.addEventListener('load', () => bridgeHotkeys(frame));
    area.appendChild(frame);
    frame.focus();

    watchLeave(area, prevStyle);
  }

  // Re-clic sur l'entrée alors que le jeu est ouvert → retour au choix du niveau
  // (les pages de niveau n'ont pas de bouton « Précédent » dans une iframe).
  function backToLevels(frame) {
    let win = null;
    try { win = frame.contentWindow; } catch { /* rien */ }
    const onIndex = /\/zero-gravity\/(index\.html)?$/.test(win?.location?.pathname || '');
    if (!onIndex) {
      const state = win?.__zg?.G?.state;
      const running = state === 'playing' || state === 'paused';
      if (!running || confirm('Abandonner la traversée en cours et revenir au choix du niveau ?')) {
        try { win.location.assign(GAME_URL); } catch { frame.src = GAME_URL; }
      }
    }
    markActive();
    setHeader('🚀', 'Zero-Gravity', 'Jeux');
    frame.focus();
  }

  function watchLeave(area, prevStyle) {
    watcher?.disconnect();
    watcher = new MutationObserver(() => {
      if (document.getElementById(FRAME_ID)) return;
      watcher.disconnect();
      watcher = null;
      if (prevStyle == null) area.removeAttribute('style');
      else area.setAttribute('style', prevStyle);
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

  return { createSidebarSection, open };
})();
