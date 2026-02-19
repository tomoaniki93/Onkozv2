/* ── AudioSettings Module ────────────────────────────────────────────────────
   Panel de configuration audio :
   - Sélection microphone + vumètre en temps réel
   - Sélection casque/haut-parleur + test son
   - Préférences sauvegardées dans localStorage
   ─────────────────────────────────────────────────────────────────────────── */
const AudioSettings = (() => {

  const KEY_MIC     = 'onkoz_mic_deviceId';
  const KEY_SPEAKER = 'onkoz_speaker_deviceId';

  let vuAnimId   = null;
  let testStream = null;
  let audioCtx   = null;
  let analyser   = null;
  let testAudio  = null;   // élément Audio pour le test casque
  let isTestingMic     = false;
  let isTestingSpeaker = false;

  // ── API publique utilisée par voice.js ─────────────────────────────────────
  function getMicId()     { return localStorage.getItem(KEY_MIC)     || 'default'; }
  function getSpeakerId() { return localStorage.getItem(KEY_SPEAKER) || 'default'; }

  // ── Ouvrir / Fermer le panel ───────────────────────────────────────────────
  function toggle() {
    const existing = document.getElementById('audio-settings-panel');
    if (existing) { closePanel(); return; }
    openPanel();
  }

  function closePanel() {
    stopMicTest();
    stopSpeakerTest();
    document.getElementById('audio-settings-panel')?.remove();
  }

  async function openPanel() {
    const panel = document.createElement('div');
    panel.id = 'audio-settings-panel';
    panel.className = 'fixed bottom-16 left-2 z-[150] w-80 bg-onkoz-surface border border-onkoz-border rounded-xl shadow-dm flex flex-col overflow-hidden';

    panel.innerHTML = `
      <!-- En-tête -->
      <div class="flex items-center justify-between px-4 py-3 border-b border-onkoz-border shrink-0">
        <span class="font-bold text-sm text-onkoz-text">⚙️ Paramètres audio</span>
        <button id="close-audio-panel"
                class="w-6 h-6 flex items-center justify-center rounded text-onkoz-text-muted hover:bg-onkoz-hover hover:text-onkoz-text transition-colors text-xs">✕</button>
      </div>

      <div class="flex flex-col gap-5 p-4 overflow-y-auto">

        <!-- ── MICROPHONE ── -->
        <div class="flex flex-col gap-2">
          <p class="text-[0.72rem] font-bold uppercase tracking-wider text-onkoz-text-muted">🎤 Microphone</p>

          <select id="mic-select"
                  class="bg-onkoz-deep border border-onkoz-border rounded-md px-2.5 py-2 text-sm text-onkoz-text outline-none focus:border-onkoz-accent transition-colors cursor-pointer">
            <option value="">Chargement...</option>
          </select>

          <!-- Vumètre -->
          <div>
            <div class="flex justify-between mb-1">
              <span class="text-[0.7rem] text-onkoz-text-muted">Niveau d'entrée</span>
              <span id="vu-db" class="text-[0.7rem] text-onkoz-text-muted font-mono">— dB</span>
            </div>
            <div class="h-3 bg-onkoz-deep rounded-full overflow-hidden border border-onkoz-border">
              <div id="vu-bar" class="h-full rounded-full transition-none" style="width:0%;background:linear-gradient(90deg,#3ba55c 0%,#3ba55c 60%,#faa61a 80%,#ed4245 100%)"></div>
            </div>
          </div>

          <!-- Bouton test micro -->
          <button id="btn-test-mic"
                  class="flex items-center justify-center gap-2 text-xs font-semibold py-2 px-3 rounded-md border border-onkoz-border text-onkoz-text-md hover:bg-onkoz-hover transition-colors">
            🎙 Tester le microphone
          </button>
          <p id="mic-status" class="text-[0.72rem] text-center text-onkoz-text-muted hidden"></p>
        </div>

        <div class="border-t border-onkoz-border"></div>

        <!-- ── CASQUE / HAUT-PARLEUR ── -->
        <div class="flex flex-col gap-2">
          <p class="text-[0.72rem] font-bold uppercase tracking-wider text-onkoz-text-muted">🎧 Casque / Haut-parleur</p>

          <select id="speaker-select"
                  class="bg-onkoz-deep border border-onkoz-border rounded-md px-2.5 py-2 text-sm text-onkoz-text outline-none focus:border-onkoz-accent transition-colors cursor-pointer">
            <option value="">Chargement...</option>
          </select>

          <p id="speaker-note" class="text-[0.68rem] text-onkoz-text-muted hidden">
            ⓘ La sélection du haut-parleur n'est disponible que sur Chrome/Edge.
          </p>

          <!-- Volume de sortie -->
          <div>
            <div class="flex justify-between mb-1">
              <span class="text-[0.7rem] text-onkoz-text-muted">Volume de sortie</span>
              <span id="volume-label" class="text-[0.7rem] text-onkoz-text-muted font-mono">100%</span>
            </div>
            <input id="volume-slider" type="range" min="0" max="100" value="100"
                   class="w-full accent-onkoz-accent cursor-pointer" />
          </div>

          <!-- Bouton test casque -->
          <button id="btn-test-speaker"
                  class="flex items-center justify-center gap-2 text-xs font-semibold py-2 px-3 rounded-md border border-onkoz-border text-onkoz-text-md hover:bg-onkoz-hover transition-colors">
            🔊 Tester le casque
          </button>
          <p id="speaker-status" class="text-[0.72rem] text-center text-onkoz-text-muted hidden"></p>
        </div>

        <div class="border-t border-onkoz-border"></div>

        <!-- ── BOUTON SAUVEGARDER ── -->
        <button id="btn-save-audio"
                class="bg-onkoz-accent hover:bg-onkoz-accent-dk text-white font-semibold text-sm py-2 rounded-md transition-colors">
          ✅ Appliquer & Fermer
        </button>

      </div>`;

    document.body.appendChild(panel);

    // Événements
    document.getElementById('close-audio-panel').addEventListener('click', closePanel);
    document.getElementById('btn-save-audio').addEventListener('click', saveAndClose);
    document.getElementById('btn-test-mic').addEventListener('click', toggleMicTest);
    document.getElementById('btn-test-speaker').addEventListener('click', toggleSpeakerTest);

    document.getElementById('volume-slider').addEventListener('input', e => {
      document.getElementById('volume-label').textContent = `${e.target.value}%`;
      if (testAudio) testAudio.volume = e.target.value / 100;
      localStorage.setItem('onkoz_volume', e.target.value);
    });

    // Restaurer volume sauvegardé
    const savedVol = localStorage.getItem('onkoz_volume') || '100';
    document.getElementById('volume-slider').value = savedVol;
    document.getElementById('volume-label').textContent = `${savedVol}%`;

    // Charger les périphériques
    await loadDevices();

    // Fermer si clic extérieur
    setTimeout(() => {
      document.addEventListener('click', outsideClick);
    }, 100);
  }

  function outsideClick(e) {
    const panel = document.getElementById('audio-settings-panel');
    const btn   = document.getElementById('btn-audio-settings');
    if (panel && !panel.contains(e.target) && e.target !== btn) {
      closePanel();
      document.removeEventListener('click', outsideClick);
    }
  }

  // ── Charger la liste des périphériques ────────────────────────────────────
  async function loadDevices() {
    // Demander permission pour obtenir les labels
    try {
      const tmp = await navigator.mediaDevices.getUserMedia({ audio: true });
      tmp.getTracks().forEach(t => t.stop());
    } catch { /* permission refusée */ }

    const devices = await navigator.mediaDevices.enumerateDevices();

    const mics     = devices.filter(d => d.kind === 'audioinput');
    const speakers = devices.filter(d => d.kind === 'audiooutput');

    fillSelect('mic-select',     mics,     getMicId());
    fillSelect('speaker-select', speakers, getSpeakerId());

    // Chrome/Edge = setSinkId dispo ; Firefox non
    if (!HTMLAudioElement.prototype.setSinkId) {
      const sel  = document.getElementById('speaker-select');
      sel.disabled = true;
      document.getElementById('speaker-note').classList.remove('hidden');
    }

    // Changer micro → restart vumètre si actif
    document.getElementById('mic-select').addEventListener('change', () => {
      if (isTestingMic) { stopMicTest(); startMicTest(); }
    });
  }

  function fillSelect(id, devices, savedId) {
    const sel = document.getElementById(id);
    sel.innerHTML = '';

    if (devices.length === 0) {
      sel.innerHTML = '<option value="">Aucun périphérique détecté</option>';
      return;
    }

    devices.forEach((d, i) => {
      const opt   = document.createElement('option');
      opt.value   = d.deviceId;
      opt.textContent = d.label || `Périphérique ${i + 1}`;
      if (d.deviceId === savedId) opt.selected = true;
      sel.appendChild(opt);
    });
  }

  // ── TEST MICROPHONE (vumètre) ─────────────────────────────────────────────
  async function toggleMicTest() {
    isTestingMic ? stopMicTest() : await startMicTest();
  }

  async function startMicTest() {
    const micId  = document.getElementById('mic-select').value;
    const btn    = document.getElementById('btn-test-mic');
    const status = document.getElementById('mic-status');

    try {
      testStream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: micId ? { exact: micId } : undefined }
      });

      audioCtx  = new (window.AudioContext || window.webkitAudioContext)();
      analyser  = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      const source = audioCtx.createMediaStreamSource(testStream);
      source.connect(analyser);

      isTestingMic = true;
      btn.textContent = '⏹ Arrêter le test';
      btn.classList.add('bg-onkoz-danger/20', 'border-onkoz-danger', 'text-onkoz-danger');

      status.textContent = 'Parlez dans votre micro…';
      status.classList.remove('hidden');

      drawVU();
    } catch (err) {
      status.textContent = `❌ ${err.message}`;
      status.classList.remove('hidden');
    }
  }

  function stopMicTest() {
    cancelAnimationFrame(vuAnimId);
    testStream?.getTracks().forEach(t => t.stop());
    audioCtx?.close();
    testStream = audioCtx = analyser = null;
    isTestingMic = false;

    const btn = document.getElementById('btn-test-mic');
    if (btn) {
      btn.textContent = '🎙 Tester le microphone';
      btn.classList.remove('bg-onkoz-danger/20', 'border-onkoz-danger', 'text-onkoz-danger');
    }

    const bar = document.getElementById('vu-bar');
    if (bar) bar.style.width = '0%';
    const db = document.getElementById('vu-db');
    if (db) db.textContent = '— dB';
    document.getElementById('mic-status')?.classList.add('hidden');
  }

  function drawVU() {
    if (!analyser) return;
    const data = new Uint8Array(analyser.frequencyBinCount);

    const frame = () => {
      vuAnimId = requestAnimationFrame(frame);
      analyser.getByteFrequencyData(data);

      // RMS → pourcentage
      let sum = 0;
      for (const v of data) sum += v * v;
      const rms = Math.sqrt(sum / data.length);
      const pct = Math.min(100, (rms / 128) * 100 * 2.5);

      // dB approximatif
      const db  = rms > 0 ? Math.round(20 * Math.log10(rms / 128)) : -Infinity;

      const bar = document.getElementById('vu-bar');
      const lbl = document.getElementById('vu-db');
      if (bar) bar.style.width = `${pct}%`;
      if (lbl) lbl.textContent = isFinite(db) ? `${db} dB` : '— dB';
    };

    frame();
  }

  // ── TEST CASQUE (bip synthétique) ─────────────────────────────────────────
  async function toggleSpeakerTest() {
    isTestingSpeaker ? stopSpeakerTest() : await startSpeakerTest();
  }

  async function startSpeakerTest() {
    const speakerId = document.getElementById('speaker-select').value;
    const volume    = parseInt(document.getElementById('volume-slider').value) / 100;
    const btn       = document.getElementById('btn-test-speaker');
    const status    = document.getElementById('speaker-status');

    // Générer un bip via Web Audio API
    const ctx  = new (window.AudioContext || window.webkitAudioContext)();
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type      = 'sine';
    osc.frequency.value = 440; // La4
    gain.gain.value     = volume * 0.3;

    osc.connect(gain);
    gain.connect(ctx.destination);

    // Appliquer le périphérique de sortie si supporté
    if (ctx.setSinkId && speakerId && speakerId !== 'default') {
      try { await ctx.setSinkId(speakerId); } catch {}
    }

    osc.start();

    isTestingSpeaker = true;
    btn.textContent = '⏹ Arrêter le test';
    btn.classList.add('bg-onkoz-danger/20', 'border-onkoz-danger', 'text-onkoz-danger');
    status.textContent = '🔊 Vous devriez entendre un bip…';
    status.classList.remove('hidden');

    // Arrêt auto après 3 secondes
    testAudio = { _ctx: ctx, _osc: osc, volume };
    setTimeout(() => { if (isTestingSpeaker) stopSpeakerTest(); }, 3000);
  }

  function stopSpeakerTest() {
    if (testAudio?._ctx) {
      try { testAudio._osc.stop(); testAudio._ctx.close(); } catch {}
    }
    testAudio    = null;
    isTestingSpeaker = false;

    const btn = document.getElementById('btn-test-speaker');
    if (btn) {
      btn.textContent = '🔊 Tester le casque';
      btn.classList.remove('bg-onkoz-danger/20', 'border-onkoz-danger', 'text-onkoz-danger');
    }
    document.getElementById('speaker-status')?.classList.add('hidden');
  }

  // ── Sauvegarder & Fermer ──────────────────────────────────────────────────
  function saveAndClose() {
    const micId     = document.getElementById('mic-select')?.value;
    const speakerId = document.getElementById('speaker-select')?.value;
    if (micId)     localStorage.setItem(KEY_MIC,     micId);
    if (speakerId) localStorage.setItem(KEY_SPEAKER, speakerId);
    closePanel();

    // Petite notification
    showToast('✅ Paramètres audio sauvegardés');
  }

  // ── Toast notification ────────────────────────────────────────────────────
  function showToast(msg) {
    const t = document.createElement('div');
    t.className = 'fixed bottom-4 left-1/2 -translate-x-1/2 z-[300] bg-onkoz-surface border border-onkoz-border text-onkoz-text text-sm px-4 py-2.5 rounded-lg shadow-dm transition-opacity duration-500';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 500); }, 2500);
  }

  return { toggle, getMicId, getSpeakerId, showToast };
})();
