/* ── NoiseGateProcessor v3 (AudioWorklet) ────────────────────────────────────
   Gate avec suppression de transitoires corrigée.

   Problème v2 : la fenêtre RMS de 256 samples (~5ms) était trop courte.
   Un début de parole (montée sur ~50-200ms) était confondu avec un clic
   → le gate coupait les voix douces au début des mots.

   Fix v3 :
   - Fenêtre RMS longue (2048 samples = ~42ms) → voix détectée comme telle
   - Fenêtre RMS courte (64 samples = ~1.3ms) → clics/transitoires seulement
   - Ratio entre les deux : clic = court >> long ; voix = court ≈ long
   - Hold réduit à 30ms max (assez pour couvrir un clic, pas pour couper la voix)
   ─────────────────────────────────────────────────────────────────────────── */

class NoiseGateProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'threshold',         defaultValue: 0.015, minValue: 0,    maxValue: 1      },
      { name: 'smoothing',         defaultValue: 0.980, minValue: 0,    maxValue: 0.9999 },
      { name: 'transientSuppress', defaultValue: 1,     minValue: 0,    maxValue: 1      },
      { name: 'holdMs',            defaultValue: 30,    minValue: 0,    maxValue: 200    },
    ];
  }

  constructor() {
    super();
    this._gain      = 0.0;
    this._holdSamps = 0;

    // Fenêtre COURTE ~1.3ms — capture les transitoires impulsifs (clics)
    this._shortWin  = new Float32Array(64).fill(0);
    this._shortIdx  = 0;
    this._shortSum  = 0;

    // Fenêtre LONGUE ~42ms — représente le niveau moyen (voix, bruit fond)
    this._longWin   = new Float32Array(2048).fill(0);
    this._longIdx   = 0;
    this._longSum   = 0;
  }

  process(inputs, outputs, parameters) {
    const inp = inputs[0]?.[0];
    const out = outputs[0]?.[0];
    if (!inp || !out) return true;

    const threshold         = parameters.threshold[0];
    const smoothing         = parameters.smoothing[0];
    const transientSuppress = parameters.transientSuppress[0] > 0.5;
    const holdMs            = parameters.holdMs[0];
    const holdSampsMax      = Math.floor((holdMs / 1000) * sampleRate);

    // ── RMS du bloc courant ───────────────────────────────────────────────────
    let sum = 0;
    for (let i = 0; i < inp.length; i++) sum += inp[i] * inp[i];
    const rmsNow = Math.sqrt(sum / inp.length);

    // ── Mise à jour fenêtre courte ────────────────────────────────────────────
    this._shortSum -= this._shortWin[this._shortIdx];
    this._shortWin[this._shortIdx] = rmsNow * rmsNow;
    this._shortSum += this._shortWin[this._shortIdx];
    this._shortIdx = (this._shortIdx + 1) % this._shortWin.length;
    const rmsShort = Math.sqrt(Math.max(0, this._shortSum / this._shortWin.length));

    // ── Mise à jour fenêtre longue ────────────────────────────────────────────
    this._longSum -= this._longWin[this._longIdx];
    this._longWin[this._longIdx] = rmsNow * rmsNow;
    this._longSum += this._longWin[this._longIdx];
    this._longIdx = (this._longIdx + 1) % this._longWin.length;
    const rmsLong = Math.sqrt(Math.max(0, this._longSum / this._longWin.length));

    // ── Détection transitoire ─────────────────────────────────────────────────
    // Clic/frappe  : rmsShort >> rmsLong (pic très bref, fond encore silencieux)
    // Début de voix: rmsShort ≈ rmsLong  (montée progressive sur 50-200ms)
    // Ratio > 8 = très improbable pour de la voix normale
    let isTransient = false;
    if (transientSuppress) {
      const ratio = rmsLong > 0.0001 ? rmsShort / rmsLong : 0;
      // Transitoire seulement si : ratio très élevé ET niveau court faible
      // (voix forte a un ratio modéré car la fenêtre longue monte aussi)
      isTransient = (ratio > 8.0) && (rmsLong < threshold * 3);
    }

    // ── Décision gate ─────────────────────────────────────────────────────────
    let targetGain;
    if (isTransient) {
      targetGain      = 0.0;
      this._holdSamps = holdSampsMax;
    } else if (this._holdSamps > 0) {
      this._holdSamps -= inp.length;
      // Pendant le hold : laisser passer si la voix est forte
      // (évite de couper les gens qui parlent au moment d'un clic)
      targetGain = rmsLong > threshold * 4 ? 1.0 : 0.0;
    } else {
      // Gate normal basé sur la fenêtre longue (plus stable que l'instantané)
      targetGain = rmsLong > threshold ? 1.0 : 0.0;
    }

    // ── Lissage asymétrique ───────────────────────────────────────────────────
    const coeff = targetGain > this._gain
      ? (1 - smoothing) * 4   // ouverture rapide
      : (1 - smoothing);      // fermeture douce

    for (let i = 0; i < inp.length; i++) {
      this._gain += (targetGain - this._gain) * coeff;
      this._gain  = Math.max(0, Math.min(1, this._gain));
      out[i] = inp[i] * this._gain;
    }

    return true;
  }
}

registerProcessor('noise-gate-processor', NoiseGateProcessor);
