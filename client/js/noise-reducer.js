/* ── NoiseReducer ─────────────────────────────────────────────────────────────
   Chaîne de traitement audio temps réel pour réduire les bruits ambiants.

   Pipeline :
   MediaStreamSource
     → HighPassFilter  (coupe < 80 Hz  : bourdonnements, vibrations bureau)
     → LowPassFilter   (coupe > 8000 Hz: sifflements, parasites HF)
     → DynamicsCompressor (lisse les pics soudains)
     → NoiseGate       (ScriptProcessor : silence en dessous du seuil)
     → GainNode        (compensation de volume)
     → MediaStreamDestination  →  piste envoyée à mediasoup

   Niveaux d'intensité (0 = désactivé, 1 = léger, 2 = modéré, 3 = agressif)
   ─────────────────────────────────────────────────────────────────────────── */
const NoiseReducer = (() => {

  const KEY_ENABLED   = 'onkoz_nr_enabled';
  const KEY_INTENSITY = 'onkoz_nr_intensity';

  // Paramètres par niveau d'intensité
  const PRESETS = {
    0: null, // désactivé
    1: {     // Léger — sibilances et haut-parleur distant
      highPassFreq:  80,
      lowPassFreq:   7500,
      compThreshold: -24,
      compRatio:     3,
      compAttack:    0.003,
      compRelease:   0.15,
      gateThreshold: 0.008,  // ~-42 dB
      outputGain:    1.2,
    },
    2: {     // Modéré — clavier, télé en fond
      highPassFreq:  100,
      lowPassFreq:   6500,
      compThreshold: -30,
      compRatio:     6,
      compAttack:    0.002,
      compRelease:   0.10,
      gateThreshold: 0.018,  // ~-35 dB
      outputGain:    1.4,
    },
    3: {     // Agressif — environnement très bruyant
      highPassFreq:  120,
      lowPassFreq:   5500,
      compThreshold: -36,
      compRatio:     10,
      compAttack:    0.001,
      compRelease:   0.08,
      gateThreshold: 0.030,  // ~-30 dB
      outputGain:    1.6,
    },
  };

  let audioCtx    = null;
  let destination = null;
  let sourceNode  = null;
  let gateNode    = null;   // ScriptProcessorNode
  let isActive    = false;

  // ── Getters de configuration ───────────────────────────────────────────────
  function isEnabled()    { return localStorage.getItem(KEY_ENABLED)   !== 'false'; }
  function getIntensity() { return parseInt(localStorage.getItem(KEY_INTENSITY) || '2'); }

  // ── Traiter un MediaStream et retourner le stream traité ───────────────────
  async function process(rawStream) {
    const intensity = getIntensity();
    const preset    = PRESETS[intensity];

    // Désactivé ou pas de preset → retourner le stream brut avec contraintes natives
    if (!isEnabled() || !preset) {
      return applyNativeConstraints(rawStream, false);
    }

    // Appliquer d'abord les contraintes natives du navigateur
    const stream = await applyNativeConstraints(rawStream, true);

    // Créer le contexte audio
    audioCtx    = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 48000 });
    destination = audioCtx.createMediaStreamDestination();
    sourceNode  = audioCtx.createMediaStreamSource(stream);

    // ── 1. Filtre passe-haut (coupe les basses fréquences) ──
    const highPass = audioCtx.createBiquadFilter();
    highPass.type            = 'highpass';
    highPass.frequency.value = preset.highPassFreq;
    highPass.Q.value         = 0.7;

    // ── 2. Filtre passe-bas (coupe les fréquences parasites hautes) ──
    const lowPass = audioCtx.createBiquadFilter();
    lowPass.type            = 'lowpass';
    lowPass.frequency.value = preset.lowPassFreq;
    lowPass.Q.value         = 0.7;

    // ── 3. Compresseur dynamique (lisse les pics) ──
    const compressor = audioCtx.createDynamicsCompressor();
    compressor.threshold.value = preset.compThreshold;
    compressor.knee.value      = 10;
    compressor.ratio.value     = preset.compRatio;
    compressor.attack.value    = preset.compAttack;
    compressor.release.value   = preset.compRelease;

    // ── 4. Noise gate (ScriptProcessor — coupe en dessous du seuil) ──
    const bufferSize = 2048;
    gateNode = audioCtx.createScriptProcessor(bufferSize, 1, 1);
    const threshold = preset.gateThreshold;
    let smoothedLevel = 0;

    gateNode.onaudioprocess = (e) => {
      const input  = e.inputBuffer.getChannelData(0);
      const output = e.outputBuffer.getChannelData(0);

      // Calculer le niveau RMS du buffer
      let sum = 0;
      for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
      const rms = Math.sqrt(sum / input.length);

      // Lissage exponentiel pour éviter les clics
      smoothedLevel = smoothedLevel * 0.85 + rms * 0.15;

      if (smoothedLevel > threshold) {
        // Au-dessus du seuil : laisser passer avec fondu doux
        const alpha = Math.min(1, (smoothedLevel - threshold) / threshold);
        for (let i = 0; i < input.length; i++) output[i] = input[i] * alpha;
      } else {
        // En dessous : silence
        for (let i = 0; i < input.length; i++) output[i] = 0;
      }
    };

    // ── 5. Gain de compensation ──
    const gainNode = audioCtx.createGain();
    gainNode.gain.value = preset.outputGain;

    // ── Connecter la chaîne ──
    sourceNode
      .connect(highPass)
      .connect(lowPass)
      .connect(compressor)
      .connect(gateNode)
      .connect(gainNode)
      .connect(destination);

    isActive = true;
    console.log(`[NoiseReducer] Actif — intensité ${intensity}, gate=${threshold}, hp=${preset.highPassFreq}Hz`);

    return destination.stream;
  }

  // ── Contraintes natives du navigateur ─────────────────────────────────────
  async function applyNativeConstraints(stream, enhanced) {
    const track       = stream.getAudioTracks()[0];
    const constraints = {
      echoCancellation: { ideal: true },
      noiseSuppression: { ideal: enhanced },
      autoGainControl:  { ideal: enhanced },
    };
    try {
      await track.applyConstraints(constraints);
    } catch (e) {
      console.warn('[NoiseReducer] applyConstraints:', e.message);
    }
    return stream;
  }

  // ── Libérer les ressources ─────────────────────────────────────────────────
  function dispose() {
    if (gateNode)   { gateNode.onaudioprocess = null; gateNode.disconnect(); }
    if (sourceNode) { try { sourceNode.disconnect(); } catch {} }
    if (audioCtx)   { try { audioCtx.close(); } catch {} }
    audioCtx = destination = sourceNode = gateNode = null;
    isActive = false;
  }

  // ── Getters d'état ─────────────────────────────────────────────────────────
  function getActive()   { return isActive; }

  return { process, dispose, isEnabled, getIntensity, isActive: getActive };
})();
