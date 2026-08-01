/* ── Hotkeys Module ───────────────────────────────────────────────────────────
   Raccourcis clavier / souris pour le micro :
     - Mode "Toggle"      : une touche coupe / réactive le micro
     - Mode "Push-to-talk": micro coupé par défaut, ouvert tant que la touche
                            est maintenue (avec un léger délai de fermeture)

   Portée :
     - Navigateur / Electron focus  → géré ici (keydown / keyup / mousedown)
     - Electron hors focus (en jeu) → géré par le main process, qui renvoie
       les évènements via window.ElectronAPI.onGlobalHotkey()

   Dépendances : Voice.setMuted / Voice.getMuted / Voice.getCurrentRoomId
   ─────────────────────────────────────────────────────────────────────────── */
const Hotkeys = (() => {

  // ── Clés localStorage ───────────────────────────────────────────────────────
  const K_MODE = 'onkoz_mic_mode';      // 'toggle' | 'ptt'
  const K_PTT  = 'onkoz_bind_ptt';
  const K_MUTE = 'onkoz_bind_mute';
  const K_TAIL = 'onkoz_ptt_tail';      // ms de maintien après relâchement

  // ── Binds par défaut ────────────────────────────────────────────────────────
  const DEF_PTT  = { type: 'key', code: 'ControlLeft', ctrl: false, alt: false,  shift: false };
  const DEF_MUTE = { type: 'key', code: 'KeyM',        ctrl: false, alt: true,   shift: false };
  const DEF_TAIL = 180;

  // Touches qui sont elles-mêmes des modificateurs → on ignore l'état des
  // modificateurs lors de la comparaison (sinon ControlLeft ne matche jamais).
  const MOD_CODES = new Set([
    'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight',
    'ShiftLeft', 'ShiftRight', 'MetaLeft', 'MetaRight',
  ]);

  // ── État interne ────────────────────────────────────────────────────────────
  let pttHeld      = false;
  let releaseTimer = null;
  let capturing    = null;   // { slot: 'ptt'|'mute', done: fn }
  let bound        = false;

  // ═══════════════════════════════════════════════════════════════════════════
  //  PERSISTANCE
  // ═══════════════════════════════════════════════════════════════════════════
  function getMode() { return localStorage.getItem(K_MODE) === 'ptt' ? 'ptt' : 'toggle'; }
  function getTail() { return parseInt(localStorage.getItem(K_TAIL), 10) || DEF_TAIL; }

  function getBind(slot) {
    try {
      const raw = localStorage.getItem(slot === 'ptt' ? K_PTT : K_MUTE);
      if (raw) return JSON.parse(raw);
    } catch (_) { /* JSON cassé → défaut */ }
    return slot === 'ptt' ? { ...DEF_PTT } : { ...DEF_MUTE };
  }

  function setBind(slot, desc) {
    localStorage.setItem(slot === 'ptt' ? K_PTT : K_MUTE, JSON.stringify(desc));
    syncElectron();
  }

  function setMode(mode) {
    localStorage.setItem(K_MODE, mode === 'ptt' ? 'ptt' : 'toggle');
    applyMode();
    syncElectron();
  }

  function setTail(ms) {
    localStorage.setItem(K_TAIL, String(ms));
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  AFFICHAGE D'UN BIND
  // ═══════════════════════════════════════════════════════════════════════════
  function label(desc) {
    if (!desc) return '—';
    if (desc.type === 'mouse') return `Souris ${desc.button + 1}`;

    const parts = [];
    if (desc.ctrl)  parts.push('Ctrl');
    if (desc.alt)   parts.push('Alt');
    if (desc.shift) parts.push('Maj');

    let name = desc.code || '';
    if (name.startsWith('Key'))          name = name.slice(3);
    else if (name.startsWith('Digit'))   name = name.slice(5);
    else if (name.startsWith('Numpad'))  name = 'Pavé ' + name.slice(6);
    else if (name === 'ControlLeft')     name = 'Ctrl G';
    else if (name === 'ControlRight')    name = 'Ctrl D';
    else if (name === 'AltLeft')         name = 'Alt G';
    else if (name === 'AltRight')        name = 'Alt D';
    else if (name === 'ShiftLeft')       name = 'Maj G';
    else if (name === 'ShiftRight')      name = 'Maj D';
    else if (name === 'Space')           name = 'Espace';

    parts.push(name);
    return parts.join(' + ');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  MATCHING
  // ═══════════════════════════════════════════════════════════════════════════
  function isTypingTarget(el) {
    if (!el) return false;
    const tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
  }

  function matchKey(desc, e) {
    if (!desc || desc.type !== 'key') return false;
    if (e.code !== desc.code) return false;
    if (MOD_CODES.has(desc.code)) return true;      // bind = modificateur seul
    return e.ctrlKey  === !!desc.ctrl
        && e.altKey   === !!desc.alt
        && e.shiftKey === !!desc.shift;
  }

  function matchMouse(desc, e) {
    return desc && desc.type === 'mouse' && e.button === desc.button;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  ACTIONS MICRO
  // ═══════════════════════════════════════════════════════════════════════════
  function inVoice() {
    return !!(window.Voice && Voice.getCurrentRoomId && Voice.getCurrentRoomId());
  }

  function toggleMute() {
    if (!inVoice()) return;
    Voice.setMuted(!Voice.getMuted());
  }

  function pttDown() {
    if (!inVoice()) return;
    if (releaseTimer) { clearTimeout(releaseTimer); releaseTimer = null; }
    if (pttHeld) return;
    pttHeld = true;
    Voice.setMuted(false);
  }

  function pttUp() {
    if (!pttHeld) return;
    pttHeld = false;
    if (releaseTimer) clearTimeout(releaseTimer);
    // Petit délai : évite de couper la fin des mots
    releaseTimer = setTimeout(() => {
      releaseTimer = null;
      if (!pttHeld && getMode() === 'ptt') Voice.setMuted(true);
    }, getTail());
  }

  /** Applique l'état correct au micro selon le mode courant. */
  function applyMode() {
    pttHeld = false;
    if (releaseTimer) { clearTimeout(releaseTimer); releaseTimer = null; }
    if (!inVoice()) return;
    if (getMode() === 'ptt') Voice.setMuted(true);   // PTT → fermé au repos
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  LISTENERS GLOBAUX (fenêtre focus)
  // ═══════════════════════════════════════════════════════════════════════════
  function onKeyDown(e) {
    if (capturing) { captureFromKey(e); return; }
    if (e.repeat) return;
    if (isTypingTarget(e.target)) return;

    if (getMode() === 'ptt' && matchKey(getBind('ptt'), e)) {
      e.preventDefault();
      pttDown();
      return;
    }
    if (matchKey(getBind('mute'), e)) {
      e.preventDefault();
      toggleMute();
    }
  }

  function onKeyUp(e) {
    if (capturing) return;
    if (getMode() !== 'ptt') return;
    const b = getBind('ptt');
    if (b.type === 'key' && e.code === b.code) pttUp();
  }

  function onMouseDown(e) {
    if (capturing) { captureFromMouse(e); return; }
    if (e.button < 3) return;                    // on ne vole pas clic G/D/milieu
    if (getMode() === 'ptt' && matchMouse(getBind('ptt'), e)) { e.preventDefault(); pttDown(); }
    else if (matchMouse(getBind('mute'), e))     { e.preventDefault(); toggleMute(); }
  }

  function onMouseUp(e) {
    if (capturing) return;
    if (getMode() === 'ptt' && matchMouse(getBind('ptt'), e)) pttUp();
  }

  /** Sécurité : si la fenêtre perd le focus touche enfoncée, on referme. */
  function onBlur() {
    if (pttHeld) { pttHeld = false; if (getMode() === 'ptt' && inVoice()) Voice.setMuted(true); }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  CAPTURE D'UN NOUVEAU BIND
  // ═══════════════════════════════════════════════════════════════════════════
  function startCapture(slot, onDone) {
    capturing = { slot, done: onDone };
  }

  function stopCapture(desc) {
    const c = capturing;
    capturing = null;
    if (!c) return;
    if (desc) setBind(c.slot, desc);
    c.done?.(desc || getBind(c.slot));
  }

  function captureFromKey(e) {
    e.preventDefault();
    e.stopPropagation();
    if (e.code === 'Escape') { stopCapture(null); return; }
    stopCapture({
      type:  'key',
      code:  e.code,
      ctrl:  MOD_CODES.has(e.code) ? false : e.ctrlKey,
      alt:   MOD_CODES.has(e.code) ? false : e.altKey,
      shift: MOD_CODES.has(e.code) ? false : e.shiftKey,
    });
  }

  function captureFromMouse(e) {
    if (e.button < 3) return;      // clics normaux → on laisse annuler autrement
    e.preventDefault();
    e.stopPropagation();
    stopCapture({ type: 'mouse', button: e.button });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  PONT ELECTRON (raccourcis globaux, hors focus)
  // ═══════════════════════════════════════════════════════════════════════════
  function syncElectron() {
    window.ElectronAPI?.setHotkeys?.({
      mode: getMode(),
      ptt:  getBind('ptt'),
      mute: getBind('mute'),
    });
  }

  function bindElectron() {
    if (!window.ElectronAPI?.onGlobalHotkey) return;
    window.ElectronAPI.onGlobalHotkey(({ action, state }) => {
      if (action === 'mute') return toggleMute();
      if (action === 'ptt')  return state === 'down' ? pttDown() : pttUp();
    });
    syncElectron();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  INIT
  // ═══════════════════════════════════════════════════════════════════════════
  function init() {
    if (bound) return;
    bound = true;
    window.addEventListener('keydown',   onKeyDown,   true);
    window.addEventListener('keyup',     onKeyUp,     true);
    window.addEventListener('mousedown', onMouseDown, true);
    window.addEventListener('mouseup',   onMouseUp,   true);
    window.addEventListener('blur',      onBlur);
    // Bloque le menu contextuel pendant une capture souris
    window.addEventListener('contextmenu', e => { if (capturing) e.preventDefault(); });
    bindElectron();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  UI — section injectée dans le panneau Paramètres audio
  // ═══════════════════════════════════════════════════════════════════════════
  function mountSection(container) {
    const sec = document.createElement('div');
    sec.className = 'space-y-2.5';
    sec.innerHTML = `
      <p class="text-[0.72rem] font-bold uppercase tracking-wider text-onkoz-text-muted">🎙️ Mode micro</p>

      <div class="grid grid-cols-2 gap-2">
        <button id="hk-mode-toggle" class="flex flex-col items-center gap-0.5 px-2 py-2 rounded-md border text-xs font-semibold transition-colors">
          <span>🔁</span><span>Bascule</span>
        </button>
        <button id="hk-mode-ptt" class="flex flex-col items-center gap-0.5 px-2 py-2 rounded-md border text-xs font-semibold transition-colors">
          <span>🎯</span><span>Push-to-talk</span>
        </button>
      </div>

      <div class="flex items-center justify-between gap-2">
        <span class="text-[0.7rem] text-onkoz-text-muted">Couper / activer</span>
        <button id="hk-bind-mute" class="px-2 py-1 rounded border border-onkoz-border text-[0.7rem] font-mono hover:bg-onkoz-hover transition-colors min-w-[90px]"></button>
      </div>

      <div id="hk-ptt-row" class="flex items-center justify-between gap-2">
        <span class="text-[0.7rem] text-onkoz-text-muted">Touche push-to-talk</span>
        <button id="hk-bind-ptt" class="px-2 py-1 rounded border border-onkoz-border text-[0.7rem] font-mono hover:bg-onkoz-hover transition-colors min-w-[90px]"></button>
      </div>

      <div id="hk-tail-row" class="space-y-1">
        <div class="flex justify-between">
          <span class="text-[0.7rem] text-onkoz-text-muted">Délai de fermeture</span>
          <span id="hk-tail-label" class="text-[0.7rem] text-onkoz-text-muted font-mono"></span>
        </div>
        <input id="hk-tail" type="range" min="0" max="600" step="20" class="w-full accent-onkoz-accent">
      </div>

      <p class="text-[0.65rem] text-onkoz-text-muted leading-relaxed">
        ⓘ Clique sur un raccourci puis appuie sur la touche voulue (Échap pour annuler).
        Hors de l'application, les raccourcis ne fonctionnent que sur le client Electron.
      </p>`;

    container.appendChild(sec);

    const btnT   = sec.querySelector('#hk-mode-toggle');
    const btnP   = sec.querySelector('#hk-mode-ptt');
    const bMute  = sec.querySelector('#hk-bind-mute');
    const bPtt   = sec.querySelector('#hk-bind-ptt');
    const pttRow = sec.querySelector('#hk-ptt-row');
    const tRow   = sec.querySelector('#hk-tail-row');
    const tail   = sec.querySelector('#hk-tail');
    const tLabel = sec.querySelector('#hk-tail-label');

    const ON  = 'border-onkoz-accent bg-onkoz-accent/20 text-onkoz-accent';
    const OFF = 'border-onkoz-border text-onkoz-text-muted hover:bg-onkoz-hover';

    function refresh() {
      const ptt = getMode() === 'ptt';
      btnT.className = `flex flex-col items-center gap-0.5 px-2 py-2 rounded-md border text-xs font-semibold transition-colors ${ptt ? OFF : ON}`;
      btnP.className = `flex flex-col items-center gap-0.5 px-2 py-2 rounded-md border text-xs font-semibold transition-colors ${ptt ? ON : OFF}`;
      pttRow.style.display = ptt ? '' : 'none';
      tRow.style.display   = ptt ? '' : 'none';
      bMute.textContent = label(getBind('mute'));
      bPtt.textContent  = label(getBind('ptt'));
      tail.value = getTail();
      tLabel.textContent = `${getTail()} ms`;
    }

    function bindBtn(btn, slot) {
      btn.addEventListener('click', () => {
        btn.textContent = 'Appuie…';
        btn.classList.add('border-onkoz-accent', 'text-onkoz-accent');
        startCapture(slot, () => {
          btn.classList.remove('border-onkoz-accent', 'text-onkoz-accent');
          refresh();
        });
      });
    }

    btnT.addEventListener('click', () => { setMode('toggle'); refresh(); });
    btnP.addEventListener('click', () => { setMode('ptt');    refresh(); });
    bindBtn(bMute, 'mute');
    bindBtn(bPtt,  'ptt');
    tail.addEventListener('input', e => {
      setTail(parseInt(e.target.value, 10));
      tLabel.textContent = `${e.target.value} ms`;
    });

    refresh();
  }

  // ── API publique ────────────────────────────────────────────────────────────
  return { init, applyMode, mountSection, getMode, getBind, label };

})();
