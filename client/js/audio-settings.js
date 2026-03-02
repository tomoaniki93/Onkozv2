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
  let isLoopbackActive = false;
  let loopbackStream   = null;
  let loopbackCtx      = null;

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
    stopAllTests();
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

          <!-- Bouton loopback (s'écouter) -->
          <button id="btn-loopback"
                  class="flex items-center justify-center gap-2 text-xs font-semibold py-2 px-3 rounded-md border border-onkoz-border text-onkoz-text-md hover:bg-onkoz-hover transition-colors">
            🔁 S'écouter (loopback)
          </button>

          <!-- Délai loopback -->
          <div id="loopback-controls" class="hidden flex-col gap-1.5">
            <div class="flex justify-between">
              <span class="text-[0.7rem] text-onkoz-text-muted">Délai d'écoute</span>
              <span id="loopback-delay-label" class="text-[0.7rem] text-onkoz-text-muted font-mono">200 ms</span>
            </div>
            <input id="loopback-delay-slider" type="range" min="0" max="500" value="200" step="10"
                   class="w-full accent-onkoz-accent cursor-pointer" />
            <p class="text-[0.65rem] text-onkoz-text-muted">Un léger délai évite l'effet larsen. Mettez 0 si vous utilisez un casque.</p>
          </div>

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

        <!-- ── ANNONCES VOCALES ── -->
        <div class="flex flex-col gap-3">
          <p class="text-[0.72rem] font-bold uppercase tracking-wider text-onkoz-text-muted">🔔 Annonces vocales</p>

          <div class="flex items-center justify-between">
            <div>
              <p class="text-sm text-onkoz-text font-medium">Annoncer les connexions</p>
              <p class="text-[0.68rem] text-onkoz-text-muted">« TomoAniki a rejoint le canal »</p>
            </div>
            <button id="announce-toggle"
                    class="relative w-11 h-6 rounded-full transition-colors duration-200 focus:outline-none shrink-0">
              <span id="announce-toggle-knob" class="absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200"></span>
            </button>
          </div>

          <!-- Volume annonces -->
          <div id="announce-volume-section" class="flex flex-col gap-1">
            <div class="flex justify-between items-center">
              <span class="text-[0.7rem] text-onkoz-text-muted">Volume des annonces</span>
              <span id="announce-volume-label" class="text-[0.7rem] font-mono text-onkoz-text-muted">80%</span>
            </div>
            <input id="announce-volume" type="range" min="0" max="100" value="80"
                   class="w-full accent-onkoz-accent cursor-pointer" />
          </div>
        </div>

        <div class="border-t border-onkoz-border"></div>

        <!-- ── RÉDUCTION DE BRUIT ── -->
        <div class="flex flex-col gap-3">
          <div class="flex items-center justify-between">
            <p class="text-[0.72rem] font-bold uppercase tracking-wider text-onkoz-text-muted">🔇 Réduction de bruit</p>
            <span id="nr-engine-badge" class="text-[0.65rem] font-bold px-2 py-0.5 rounded-full bg-onkoz-accent/20 text-onkoz-accent hidden">RNNoise IA</span>
          </div>

          <!-- Toggle activé/désactivé -->
          <div class="flex items-center justify-between">
            <div>
              <p class="text-sm text-onkoz-text font-medium">Filtrage actif</p>
              <p class="text-[0.68rem] text-onkoz-text-muted">Supprime bruits de fond, bras de micro, clavier</p>
            </div>
            <button id="nr-toggle"
                    class="relative w-11 h-6 rounded-full transition-colors duration-200 focus:outline-none shrink-0">
              <span id="nr-toggle-knob" class="absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200"></span>
            </button>
          </div>

          <!-- Choix du moteur -->
          <div id="nr-engine-section" class="flex flex-col gap-1.5">
            <span class="text-[0.7rem] text-onkoz-text-muted">Moteur de filtrage</span>
            <div class="grid grid-cols-2 gap-2">
              <button id="nr-engine-rnnoise"
                      class="flex flex-col items-center gap-0.5 px-2 py-2 rounded-md border text-xs font-semibold transition-colors">
                <span>🤖 RNNoise</span>
                <span class="text-[0.62rem] font-normal opacity-70">Deep learning</span>
              </button>
              <button id="nr-engine-gate"
                      class="flex flex-col items-center gap-0.5 px-2 py-2 rounded-md border text-xs font-semibold transition-colors">
                <span>⚙️ Noise gate</span>
                <span class="text-[0.62rem] font-normal opacity-70">Classique</span>
              </button>
            </div>
          </div>

          <!-- Slider intensité (affiché uniquement en mode gate) -->
          <div id="nr-intensity-section" class="flex flex-col gap-2">
            <div class="flex justify-between items-center">
              <span class="text-[0.7rem] text-onkoz-text-muted">Intensité</span>
              <span id="nr-intensity-label" class="text-[0.7rem] font-semibold text-onkoz-accent-lt"></span>
            </div>
            <input id="nr-intensity" type="range" min="1" max="3" step="1"
                   class="w-full accent-onkoz-accent cursor-pointer" />
            <div class="flex justify-between text-[0.65rem] text-onkoz-text-muted px-0.5">
              <span>Léger</span>
              <span>Modéré</span>
              <span>Agressif</span>
            </div>
          </div>

          <!-- Info -->
          <div class="bg-onkoz-deep border border-onkoz-border rounded-md px-3 py-2">
            <p class="text-[0.68rem] text-onkoz-text-muted leading-relaxed">
              ⓘ Les changements s'appliquent à la <strong>prochaine connexion</strong> vocale.
              Rejoins à nouveau un salon après modification.
            </p>
          </div>
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
    document.getElementById('btn-loopback').addEventListener('click', toggleLoopback);
    document.getElementById('btn-test-speaker').addEventListener('click', toggleSpeakerTest);

    // Init label délai loopback
    const delaySlider = document.getElementById('loopback-delay-slider');
    const delayLabel  = document.getElementById('loopback-delay-label');
    if (delaySlider && delayLabel) {
      delayLabel.textContent = `${delaySlider.value} ms`;
    }

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

    // ── Annonces vocales ──
    initAnnounceControls();

    // ── Réduction de bruit ──
    initNoiseReducerControls();

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

  // ── LOOPBACK (s'écouter) ─────────────────────────────────────────────────
  async function toggleLoopback() {
    isLoopbackActive ? stopLoopback() : await startLoopback();
  }

  async function startLoopback() {
    const micId      = document.getElementById('mic-select').value;
    const speakerId  = document.getElementById('speaker-select').value;
    const delayMs    = parseInt(document.getElementById('loopback-delay-slider')?.value || 200);
    const btn        = document.getElementById('btn-loopback');
    const controls   = document.getElementById('loopback-controls');
    const status     = document.getElementById('mic-status');

    try {
      loopbackStream = await navigator.mediaDevices.getUserMedia({
        audio: micId ? { deviceId: { exact: micId }, echoCancellation: false, noiseSuppression: false } : true,
        video: false,
      });

      loopbackCtx = new (window.AudioContext || window.webkitAudioContext)();
      const source = loopbackCtx.createMediaStreamSource(loopbackStream);

      // Nœud de délai pour éviter le larsen (utile sans casque)
      const delay = loopbackCtx.createDelay(1.0);
      delay.delayTime.value = delayMs / 1000;

      // Volume de sortie
      const gain = loopbackCtx.createGain();
      gain.gain.value = parseInt(document.getElementById('volume-slider')?.value || 100) / 100;

      source.connect(delay);
      delay.connect(gain);

      // Destination : casque sélectionné si possible (Chrome/Edge)
      if (speakerId && loopbackCtx.destination.setSinkId) {
        try { await loopbackCtx.destination.setSinkId(speakerId); } catch { /* pas supporté */ }
      }
      gain.connect(loopbackCtx.destination);

      isLoopbackActive = true;
      btn.textContent = '⏹ Arrêter l\'écoute';
      btn.classList.add('bg-onkoz-danger/20', 'border-onkoz-danger', 'text-onkoz-danger');
      controls.classList.remove('hidden');
      controls.classList.add('flex');
      status.textContent = '🎧 Loopback actif — vous vous entendez en temps réel';
      status.classList.remove('hidden');

      // Slider délai dynamique
      document.getElementById('loopback-delay-slider')?.addEventListener('input', function () {
        delay.delayTime.value = parseInt(this.value) / 1000;
        const lbl = document.getElementById('loopback-delay-label');
        if (lbl) lbl.textContent = `${this.value} ms`;
      });

    } catch (err) {
      const status = document.getElementById('mic-status');
      status.textContent = `❌ ${err.message}`;
      status.classList.remove('hidden');
    }
  }

  function stopLoopback() {
    loopbackStream?.getTracks().forEach(t => t.stop());
    loopbackCtx?.close();
    loopbackStream = loopbackCtx = null;
    isLoopbackActive = false;

    const btn      = document.getElementById('btn-loopback');
    const controls = document.getElementById('loopback-controls');
    const status   = document.getElementById('mic-status');
    if (btn) {
      btn.textContent = '🔁 S\'écouter (loopback)';
      btn.classList.remove('bg-onkoz-danger/20', 'border-onkoz-danger', 'text-onkoz-danger');
    }
    if (controls) { controls.classList.add('hidden'); controls.classList.remove('flex'); }
    if (status)   { status.classList.add('hidden'); }
  }

  // Arrêter le loopback si le panel se ferme
  function stopAllTests() {
    if (isTestingMic)     stopMicTest();
    if (isTestingSpeaker) stopSpeakerTest();
    if (isLoopbackActive) stopLoopback();
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

  // ── Contrôles annonces vocales ────────────────────────────────────────────
  function initAnnounceControls() {
    const toggle  = document.getElementById('announce-toggle');
    const knob    = document.getElementById('announce-toggle-knob');
    const volSldr = document.getElementById('announce-volume');
    const volLbl  = document.getElementById('announce-volume-label');
    const section = document.getElementById('announce-volume-section');
    if (!toggle) return;

    let enabled = localStorage.getItem('onkoz_voice_announce') !== 'false';
    const savedVol = Math.round(parseFloat(localStorage.getItem('onkoz_announce_volume') || '0.8') * 100);
    volSldr.value    = savedVol;
    volLbl.textContent = `${savedVol}%`;

    function updateToggleUI() {
      if (enabled) {
        toggle.classList.add('bg-onkoz-accent');
        toggle.classList.remove('bg-onkoz-border');
        knob.style.transform = 'translateX(20px)';
        section.classList.remove('opacity-40', 'pointer-events-none');
      } else {
        toggle.classList.remove('bg-onkoz-accent');
        toggle.classList.add('bg-onkoz-border');
        knob.style.transform = 'translateX(0)';
        section.classList.add('opacity-40', 'pointer-events-none');
      }
    }
    updateToggleUI();

    toggle.addEventListener('click', () => {
      enabled = !enabled;
      localStorage.setItem('onkoz_voice_announce', enabled ? 'true' : 'false');
      updateToggleUI();
    });

    volSldr.addEventListener('input', () => {
      const v = parseInt(volSldr.value);
      volLbl.textContent = `${v}%`;
      localStorage.setItem('onkoz_announce_volume', (v / 100).toFixed(2));
    });
  }

  // ── Contrôles réduction de bruit ─────────────────────────────────────────
  function initNoiseReducerControls() {
    const toggle         = document.getElementById('nr-toggle');
    const knob           = document.getElementById('nr-toggle-knob');
    const slider         = document.getElementById('nr-intensity');
    const label          = document.getElementById('nr-intensity-label');
    const intensitySection = document.getElementById('nr-intensity-section');
    const engineSection  = document.getElementById('nr-engine-section');
    const btnRNNoise     = document.getElementById('nr-engine-rnnoise');
    const btnGate        = document.getElementById('nr-engine-gate');
    const badge          = document.getElementById('nr-engine-badge');
    if (!toggle) return;

    const LABELS = { 1: 'Léger', 2: 'Modéré', 3: 'Agressif' };

    let enabled   = NoiseReducer.isEnabled();
    let intensity = NoiseReducer.getIntensity();
    let engine    = localStorage.getItem('onkoz_nr_engine') || 'rnnoise';

    function updateToggleUI() {
      if (enabled) {
        toggle.classList.add('bg-onkoz-accent');
        toggle.classList.remove('bg-onkoz-border');
        knob.style.transform = 'translateX(20px)';
        engineSection?.classList.remove('opacity-40', 'pointer-events-none');
      } else {
        toggle.classList.remove('bg-onkoz-accent');
        toggle.classList.add('bg-onkoz-border');
        knob.style.transform = 'translateX(0)';
        engineSection?.classList.add('opacity-40', 'pointer-events-none');
      }
    }

    function updateEngineUI() {
      const isRNN = engine === 'rnnoise';
      // Bouton RNNoise
      if (btnRNNoise) {
        btnRNNoise.className = `flex flex-col items-center gap-0.5 px-2 py-2 rounded-md border text-xs font-semibold transition-colors ${isRNN ? 'border-onkoz-accent bg-onkoz-accent/20 text-onkoz-accent' : 'border-onkoz-border text-onkoz-text-muted hover:bg-onkoz-hover'}`;
      }
      // Bouton Gate
      if (btnGate) {
        btnGate.className = `flex flex-col items-center gap-0.5 px-2 py-2 rounded-md border text-xs font-semibold transition-colors ${!isRNN ? 'border-onkoz-accent bg-onkoz-accent/20 text-onkoz-accent' : 'border-onkoz-border text-onkoz-text-muted hover:bg-onkoz-hover'}`;
      }
      // Badge moteur actif
      if (badge) {
        badge.textContent = isRNN ? '🤖 RNNoise IA' : '⚙️ Noise gate';
        badge.classList.toggle('hidden', !enabled);
      }
      // Slider intensité uniquement en mode gate
      if (intensitySection) {
        intensitySection.classList.toggle('hidden', isRNN);
      }
    }

    function updateSliderUI() {
      if (slider) slider.value = intensity;
      if (label) label.textContent = LABELS[intensity] || '';
    }

    // Init
    updateToggleUI();
    updateEngineUI();
    updateSliderUI();

    // Toggle activé/désactivé
    toggle.addEventListener('click', () => {
      enabled = !enabled;
      localStorage.setItem('onkoz_nr_enabled', enabled ? 'true' : 'false');
      updateToggleUI();
      updateEngineUI();
    });

    // Sélection moteur
    btnRNNoise?.addEventListener('click', () => {
      engine = 'rnnoise';
      localStorage.setItem('onkoz_nr_engine', 'rnnoise');
      updateEngineUI();
    });
    btnGate?.addEventListener('click', () => {
      engine = 'gate';
      localStorage.setItem('onkoz_nr_engine', 'gate');
      updateEngineUI();
    });

    // Slider intensité (noise gate)
    slider?.addEventListener('input', () => {
      intensity = parseInt(slider.value);
      localStorage.setItem('onkoz_nr_intensity', intensity);
      updateSliderUI();
    });
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
