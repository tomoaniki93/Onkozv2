'use strict';

/* ── Jeu Zero-Gravity intégré à ONKOZ ───────────────────────────────────────
   Reprend le serveur autonome du jeu (serveur.js) à l'intérieur d'ONKOZ :
     - sert les pages du jeu depuis jeux/zero-gravity/ (accueil + niveaux)
     - tient le classement dans un fichier texte, au même format qu'avant :

         niveau;indicatif;essais;secteurs;total_s;temps_par_secteur_s;date

       Une ligne par joueur et par niveau (meilleure traversée seulement).
       Le fichier se modifie à la main, serveur lancé : il est relu dès qu'il
       change (supprimer une ligne retire le joueur).

   Différence avec la version autonome : l'API exige le token ONKOZ et
   l'indicatif est le pseudo du compte (tiré du token), jamais une saisie
   libre. Aucune table SQLite : rien à migrer.
   ─────────────────────────────────────────────────────────────────────────── */

const express = require('express');
const fs      = require('fs');
const path    = require('path');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

const GAME_DIR = path.join(__dirname, '..', '..', 'jeux', 'zero-gravity');
// Même convention que DB_PATH : relatif au dossier de lancement (à côté de onkoz.db).
const DB = path.resolve(process.env.ZG_CLASSEMENT || './data/zero-gravity-classement.txt');

const MAX_ROWS = 5000, MAX_SECTORS = 40, MAX_POST_PER_MIN = 60;
const LEVEL_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

/* ---------- Classement : base texte ---------- */
const HEADER = '# Zero-Gravity · classement (une ligne par joueur et par niveau, meilleure traversée)\n'
  + '# niveau;indicatif;essais;secteurs;total_s;temps_par_secteur_s;date\n';
let rows  = new Map(); // "niveau\tINDICATIF" → { niveau, indicatif, essais, temps, date }
let mtime = -1;

// Indicatif affiché dans le jeu : majuscules, 12 caractères (le « _ » des pseudos ONKOZ est gardé).
const cleanName = (s) => String(s == null ? '' : s).normalize('NFC').toUpperCase()
  .replace(/[^A-Z0-9_À-ÖØ-Þ .'-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 12);
const indicatifOf = (user) => cleanName(user && user.username) || cleanName(`PILOTE-${user && user.id}`);

const done    = (t) => (t ? t.filter((x) => x != null).length : -1);
const total   = (t) => (t ? Math.round(t.reduce((a, x) => a + (x || 0), 0) * 10) / 10 : 0);
const better  = (a, b) => done(a) > done(b) || (done(a) === done(b) && total(a) < total(b));
const fmtTime = (t) => (t ? t.map((x) => (x == null ? '-' : x.toFixed(1))).join('|') : '');
const mmss    = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

// Un niveau = une page du jeu (panne-noire.html, nuit-profonde.html…).
const levelExists = (niveau) => LEVEL_RE.test(niveau) && niveau !== 'index'
  && fs.existsSync(path.join(GAME_DIR, `${niveau}.html`));

/* Temps reçus : secteurs franchis dans l'ordre, chacun entre 0 et 10 h, arrondis au dixième. */
function cleanTimes(t) {
  if (!Array.isArray(t) || t.length === 0 || t.length > MAX_SECTORS) return null;
  const out = [];
  let open = true;
  for (const x of t) {
    const ok = open && typeof x === 'number' && isFinite(x) && x > 0 && x < 36000;
    if (!ok) open = false;
    out.push(ok ? Math.round(x * 10) / 10 : null);
  }
  return out;
}

function parseLine(line) {
  const f = line.split(';').map((s) => s.trim());
  if (f.length < 7 || !LEVEL_RE.test(f[0])) return null;
  const indicatif = cleanName(f[1]);
  if (!indicatif) return null;
  let temps = null;
  if (f[5]) {
    temps = f[5].split('|').map((x) => (x === '-' || x === '' ? null : Number(x)));
    if (!temps.every((x) => x === null || (isFinite(x) && x > 0))) temps = null;
  }
  return { niveau: f[0], indicatif, essais: Math.max(0, parseInt(f[2], 10) || 0), temps, date: f[6] || '' };
}

function load() {
  try {
    const st = fs.statSync(DB);
    if (st.mtimeMs === mtime) return;
    const m = new Map();
    for (const line of fs.readFileSync(DB, 'utf8').split(/\r?\n/)) {
      if (!line.trim() || line.startsWith('#')) continue;
      const r = parseLine(line);
      if (r) m.set(`${r.niveau}\t${r.indicatif}`, r);
    }
    rows = m; mtime = st.mtimeMs;
  } catch (e) {
    if (e.code !== 'ENOENT') console.error(`[Zero-Gravity] Lecture de ${DB} impossible : ${e.message}`);
  }
}

let writing = Promise.resolve();
function save() {
  const list = [...rows.values()].sort((a, b) => a.niveau.localeCompare(b.niveau)
    || (a.temps && b.temps ? (better(a.temps, b.temps) ? -1 : better(b.temps, a.temps) ? 1 : 0) : a.temps ? -1 : b.temps ? 1 : 0)
    || a.indicatif.localeCompare(b.indicatif));
  const txt = HEADER + list.map((r) => [
    r.niveau, r.indicatif, r.essais,
    r.temps ? done(r.temps) : '', r.temps ? total(r.temps).toFixed(1) : '', fmtTime(r.temps), r.date,
  ].join(';')).join('\n') + '\n';
  // Écriture atomique (fichier temporaire puis renommage), une à la fois.
  writing = writing.then(async () => {
    await fs.promises.mkdir(path.dirname(DB), { recursive: true });
    const tmp = `${DB}.tmp`;
    await fs.promises.writeFile(tmp, txt, 'utf8');
    await fs.promises.rename(tmp, DB);
    mtime = (await fs.promises.stat(DB)).mtimeMs;
  }).catch((e) => console.error(`[Zero-Gravity] Écriture de ${DB} impossible : ${e.message}`));
  return writing;
}

function rowFor(niveau, indicatif) {
  const k = `${niveau}\t${indicatif}`;
  let r = rows.get(k);
  if (!r) {
    if (rows.size >= MAX_ROWS) throw Object.assign(new Error('Classement plein'), { status: 507 });
    r = { niveau, indicatif, essais: 0, temps: null, date: '' };
    rows.set(k, r);
  }
  return r;
}

function board(niveau, user) {
  return {
    niveau,
    moi: indicatifOf(user), // le jeu verrouille son champ INDICATIF sur cette valeur
    joueurs: [...rows.values()].filter((r) => r.niveau === niveau)
      .map((r) => ({ indicatif: r.indicatif, essais: r.essais, temps: r.temps, date: r.date })),
  };
}

/* Limite simple : 60 écritures par minute et par compte. */
const hits = new Map();
function limited(req, res, next) {
  const now = Date.now(), key = String(req.user.id), h = hits.get(key) || { n: 0, t: now };
  if (now - h.t > 60000) { h.n = 0; h.t = now; }
  h.n++; hits.set(key, h);
  if (hits.size > 10000) hits.clear();
  if (h.n > MAX_POST_PER_MIN) return res.status(429).json({ error: 'Trop de requêtes, réessaie dans une minute' });
  next();
}

function fail(res, e) {
  if (!e.status) console.error('[Zero-Gravity]', e);
  res.status(e.status || 500).json({ error: e.message || 'Erreur serveur' });
}

/* ---------- API (appelée par les pages du jeu : api/classement, api/essai, api/resultat) ---------- */
const api = express.Router();
api.use(requireAuth);

api.get('/classement', (req, res) => {
  load();
  const niveau = String(req.query.niveau || '');
  if (!levelExists(niveau)) return res.status(400).json({ error: 'Niveau invalide' });
  res.set('Cache-Control', 'no-store').json(board(niveau, req.user));
});

api.post('/essai', limited, async (req, res) => {
  try {
    load();
    const niveau = String((req.body && req.body.niveau) || '');
    if (!levelExists(niveau)) return res.status(400).json({ error: 'Niveau invalide' });
    const r = rowFor(niveau, indicatifOf(req.user));
    r.essais++;
    await save();
    res.set('Cache-Control', 'no-store').json(board(niveau, req.user));
  } catch (e) { fail(res, e); }
});

api.post('/resultat', limited, async (req, res) => {
  try {
    load();
    const niveau = String((req.body && req.body.niveau) || '');
    if (!levelExists(niveau)) return res.status(400).json({ error: 'Niveau invalide' });
    const temps = cleanTimes(req.body && req.body.temps);
    if (!temps) return res.status(400).json({ error: 'Temps invalides' });
    const indicatif = indicatifOf(req.user);
    const r = rowFor(niveau, indicatif);
    if (r.essais < 1) r.essais = 1;
    const record = !r.temps || better(temps, r.temps);
    if (record) {
      r.temps = temps;
      r.date = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
      const n = done(temps);
      if (n > 0) console.log(`[Zero-Gravity] Record · ${niveau} · ${indicatif} · ${n} ${n > 1 ? 'secteurs' : 'secteur'} en ${mmss(total(temps))}`);
    }
    await save();
    res.set('Cache-Control', 'no-store').json(Object.assign({ record }, board(niveau, req.user)));
  } catch (e) { fail(res, e); }
});

api.use((req, res) => res.status(404).json({ error: 'Route inconnue' }));

/* ---------- Montage : /jeux/zero-gravity ---------- */
router.use('/api', api);
router.use(express.static(GAME_DIR, {
  index: 'index.html',
  dotfiles: 'ignore',
  setHeaders: (res, file) => { if (file.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache'); },
}));
// Jamais de repli sur l'app ONKOZ ici : sinon une page manquante chargerait
// ONKOZ entier dans l'iframe du jeu (second socket pour le même compte).
router.use((req, res) => res.status(404).type('text/plain').send('Introuvable'));

module.exports = router;
