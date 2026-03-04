/* ── NoiseReducer ─────────────────────────────────────────────────────────────
   Pipeline audio optimisé pour la voix :

   MediaStreamSource
     → HighPassFilter  (coupe < 80 Hz seulement — garde les basses de la voix)
     → DynamicsCompressor (doux, lisse les pics sans coloration)
     → NoiseGateWorklet   (AudioWorklet — gate rapide et propre)
     → MediaStreamDestination → mediasoup

   SUPPRESSION du LowPassFilter : il coupait les harmoniques hautes de la voix
   (s → ch → f), ce qui donnait l'effet "voix dans un bocal".
   Le navigateur (echoCancellation + noiseSuppression natifs) s'occupe déjà
   des fréquences parasites hautes.
   ─────────────────────────────────────────────────────────────────────────── */
const NoiseReducer = (() => {

  const KEY_ENABLED   = 'onkoz_nr_enabled';
  const KEY_INTENSITY = 'onkoz_nr_intensity';

  // Paramètres par niveau — calibrés pour ne pas dégrader la voix
  const PRESETS = {
    0: null, // désactivé — stream brut

    1: {     // Léger — open space calme
      highPassFreq:  80,    // coupe bourdonnements électriques
      compThreshold: -20,   // seuil doux
      compRatio:     2,     // compression légère
      compAttack:    0.005,
      compRelease:   0.20,
      gateThreshold: 0.005, // ~-46 dB — seuil très bas, clavier fort uniquement
      gateSmoothing: 0.985, // ouverture rapide (~30ms)
      outputGain:    1.0,
    },

    2: {     // Modéré — clavier, ventilateur, TV en fond
      highPassFreq:  80,
      compThreshold: -26,
      compRatio:     4,
      compAttack:    0.003,
      compRelease:   0.15,
      gateThreshold: 0.015, // ~-36 dB
      gateSmoothing: 0.980, // ouverture en ~20ms
      outputGain:    1.1,
    },

    3: {     // Agressif — environnement très bruyant
      highPassFreq:  100,
      compThreshold: -32,
      compRatio:     7,
      compAttack:    0.002,
      compRelease:   0.10,
      gateThreshold: 0.025, // ~-32 dB
      gateSmoothing: 0.970, // ouverture en ~10ms — réagit vite aux bruits brefs
      outputGain:    1.2,
    },
  };

  let audioCtx    = null;
  let destination = null;
  let sourceNode  = null;
  let isActive    = false;

  function isEnabled()    { return localStorage.getItem(KEY_ENABLED) !== 'false'; }
  function getIntensity() { return parseInt(localStorage.getItem(KEY_INTENSITY) || '2'); }

  // ── Traiter un MediaStream ─────────────────────────────────────────────────
  async function process(rawStream) {
    const intensity = getIntensity();
    const preset    = PRESETS[intensity];

    // Désactivé → stream natif seulement
    if (!isEnabled() || !preset) {
      return applyNativeConstraints(rawStream, false);
    }

    // Contraintes natives d'abord (echo cancel + noise suppression navigateur)
    const stream = await applyNativeConstraints(rawStream, true);

    try {
      audioCtx    = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 48000 });
      destination = audioCtx.createMediaStreamDestination();
      sourceNode  = audioCtx.createMediaStreamSource(stream);

      // 1. Filtre passe-haut doux (coupe uniquement < 80-100 Hz)
      //    → supprime bourdonnements, ventilateurs basses fréquences
      //    → NE touche PAS aux fréquences de la voix (300-8000 Hz)
      const highPass = audioCtx.createBiquadFilter();
      highPass.type            = 'highpass';
      highPass.frequency.value = preset.highPassFreq;
      highPass.Q.value         = 0.707; // Butterworth — pas de résonance

      // 2. Compresseur doux — lisse les pics sans "pompage"
      const compressor = audioCtx.createDynamicsCompressor();
      compressor.threshold.value = preset.compThreshold;
      compressor.knee.value      = 15;   // transition douce
      compressor.ratio.value     = preset.compRatio;
      compressor.attack.value    = preset.compAttack;
      compressor.release.value   = preset.compRelease;

      // 3. Gain de sortie
      const gainNode = audioCtx.createGain();
      gainNode.gain.value = preset.outputGain;

      // 4. Noise gate via AudioWorklet (thread dédié → pas de glitch)
      let lastNode = compressor;
      try {
        await audioCtx.audioWorklet.addModule('/js/noise-gate-processor.js');
        const gateNode = new AudioWorkletNode(audioCtx, 'noise-gate-processor');
        gateNode.parameters.get('threshold').value = preset.gateThreshold;
        gateNode.parameters.get('smoothing').value  = preset.gateSmoothing;
        compressor.connect(gateNode);
        lastNode = gateNode;
        console.log('[NoiseReducer] Gate AudioWorklet actif');
      } catch (e) {
        console.warn('[NoiseReducer] AudioWorklet indisponible :', e.message);
      }

      // Chaîne : source → highpass → compressor → [gate] → gain → destination
      sourceNode
        .connect(highPass)
        .connect(compressor);

      lastNode.connect(gainNode);
      gainNode.connect(destination);

      isActive = true;
      console.log(`[NoiseReducer] Actif — intensité ${intensity}`);
      return destination.stream;

    } catch (err) {
      console.error('[NoiseReducer] Erreur :', err);
      dispose();
      return stream; // fallback stream brut
    }
  }

  // ── Contraintes natives navigateur ────────────────────────────────────────
  async function applyNativeConstraints(stream, enhanced) {
    const track = stream.getAudioTracks()[0];
    if (!track) return stream;
    try {
      await track.applyConstraints({
        echoCancellation: { ideal: true },
        noiseSuppression: { ideal: enhanced },
        autoGainControl:  { ideal: enhanced },
      });
    } catch (e) {
      console.warn('[NoiseReducer] applyConstraints :', e.message);
    }
    return stream;
  }

  // ── Libérer les ressources ─────────────────────────────────────────────────
  function dispose() {
    try { sourceNode?.disconnect(); } catch {}
    try { audioCtx?.close(); }       catch {}
    audioCtx = destination = sourceNode = null;
    isActive = false;
  }

  return { process, dispose, isEnabled, getIntensity };
})();
