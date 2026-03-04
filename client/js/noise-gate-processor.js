/* ── NoiseGateProcessor (AudioWorklet) ───────────────────────────────────────
   Gate avec attaque rapide et relâchement progressif.
   - threshold : amplitude RMS en dessous de laquelle le son est coupé
   - smoothing  : coefficient de lissage du gain (1 = aucun changement)
                  0.97 ≈ 10ms de réaction, 0.99 ≈ 50ms
   ─────────────────────────────────────────────────────────────────────────── */
class NoiseGateProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'threshold', defaultValue: 0.015, minValue: 0, maxValue: 1 },
      { name: 'smoothing',  defaultValue: 0.980, minValue: 0, maxValue: 0.9999 },
    ];
  }

  constructor() {
    super();
    this._gain = 0.0; // commence fermé
  }

  process(inputs, outputs, parameters) {
    const inp = inputs[0]?.[0];
    const out = outputs[0]?.[0];
    if (!inp || !out) return true;

    const threshold = parameters.threshold[0];
    const smoothing  = parameters.smoothing[0];

    // Calcul RMS sur le bloc
    let sum = 0;
    for (let i = 0; i < inp.length; i++) sum += inp[i] * inp[i];
    const rms = Math.sqrt(sum / inp.length);

    // Cible : ouvert si RMS > seuil, fermé sinon
    const targetGain = rms > threshold ? 1.0 : 0.0;

    // Lissage asymétrique : ouverture rapide, fermeture plus douce
    // → évite de couper net au milieu d'un mot
    const coeff = targetGain > this._gain
      ? (1 - smoothing) * 3  // ouverture 3x plus rapide
      : (1 - smoothing);     // fermeture normale

    for (let i = 0; i < inp.length; i++) {
      this._gain += (targetGain - this._gain) * coeff;
      this._gain  = Math.max(0, Math.min(1, this._gain));
      out[i] = inp[i] * this._gain;
    }

    return true;
  }
}

registerProcessor('noise-gate-processor', NoiseGateProcessor);
