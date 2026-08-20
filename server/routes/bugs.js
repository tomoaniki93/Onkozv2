'use strict';

/* ── Bug Tracker natif ONKOZ ────────────────────────────────────────────────
   Réutilise l'authentification ONKOZ, y compris les comptes temporaires 24 h.
   Les pseudos sont figés dans reporter_name / author_name : un rapport reste
   lisible même si le compte temporaire disparaît ensuite.
   ─────────────────────────────────────────────────────────────────────────── */

const express = require('express');
const { getDb } = require('../db/database');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

const PROJECTS = {
  TomoMod: {
    label: 'TomoMod',
    tagline: 'UI overhaul complet',
    modules: [
      'UnitFrames', 'Nameplates', 'Castbars', 'ActionBars', 'RaidFrames',
      'PartyFrames', 'CooldownForge', 'ResourceBars', 'BagSkin', 'Minimap',
      'Compass', 'ObjectiveTracker', 'ChatFrame', 'TooltipSkin',
      'ConsumableBar', 'LevelingBar', 'FriendsFrame', 'Loots', 'RareAlert',
      'QOL', 'Config / GUI', 'Installer', 'Profils / Presets', 'Autre',
    ],
  },
  TomoBoss: {
    label: 'TomoBoss',
    tagline: 'Alertes de boss',
    modules: ['Alertes / Warnings', 'Timers', 'Pack vocal', 'Nameplates', 'Encounters', 'Config / GUI', 'Autre'],
  },
  TomoDamageMeter: {
    label: 'TomoDamageMeter',
    tagline: 'Meter de dégâts',
    modules: ['Affichage / Barres', 'Calculs / Données', 'Segments', 'Détails / Breakdown', 'Config / GUI', 'Autre'],
  },
  TomoHDV: {
    label: 'TomoHDV',
    tagline: 'Hôtel des ventes',
    modules: ['Recherche', 'Achats', 'Ventes / Postage', 'Favoris', 'Config / GUI', 'Autre'],
  },
  TomoPorter: {
    label: 'TomoPorter',
    tagline: 'Téléportations',
    modules: ['Téléports', 'Interface', 'Config / GUI', 'Autre'],
  },
  TomoModMini: {
    label: 'TomoModMini',
    tagline: 'Version allégée',
    modules: ['UnitFrames', 'Nameplates', 'ActionBars', 'Config / GUI', 'Autre'],
  },
  Suite: {
    label: 'Suite / Autre',
    tagline: 'Conflit entre addons, question générale',
    modules: ['Conflit entre addons', 'Installation', 'Performance', 'Traduction / Locale', 'Autre'],
  },
};

const SEVERITIES = ['Critical', 'High', 'Medium', 'Low'];
const STATUSES = ['Open', 'Confirmed', 'InProgress', 'NeedsInfo', 'Resolved', 'Closed', 'Duplicate', 'Rejected'];
const ACTIVE_STATUSES = ['Open', 'Confirmed', 'InProgress', 'NeedsInfo'];
const MAX_TITLE = 200;
const MAX_DESCRIPTION = 50000;
const MAX_REPRO = 20000;
const MAX_LOGS = 1000000; // Transition vers Long Reports prévue ensuite.
const MAX_COMMENT = 20000;

function str(value, max) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/\r\n?/g, '\n').slice(0, max);
}

function optional(value, max) {
  const s = str(value, max).trim();
  return s || null;
}

function isProject(value) { return Object.prototype.hasOwnProperty.call(PROJECTS, value); }
function isSeverity(value) { return SEVERITIES.includes(value); }
function isStatus(value) { return STATUSES.includes(value); }
function isModule(project, value) {
  if (!value) return true;
  return isProject(project) && PROJECTS[project].modules.includes(value);
}

function cleanScreenshot(url) {
  if (!url) return null;
  const s = String(url);
  return /^\/uploads\/[a-f0-9]{16,64}\.(?:jpg|png|gif|webp)$/i.test(s) ? s : null;
}

function getBugOr404(db, id, res) {
  const bug = db.prepare(`
    SELECT b.*,
           au.username AS assignee_name,
           (SELECT COUNT(*) FROM bug_votes v WHERE v.bug_id = b.id) AS votes
      FROM bug_reports b
 LEFT JOIN users au ON au.id = b.assignee_user_id
     WHERE b.id = ?
  `).get(id);
  if (!bug) res.status(404).json({ error: 'Bug introuvable' });
  return bug;
}

function computeStats(db, project) {
  return db.prepare(`
    SELECT COUNT(*) AS total,
           SUM(CASE WHEN status = 'Open' THEN 1 ELSE 0 END) AS open,
           SUM(CASE WHEN status IN ('Confirmed','InProgress','NeedsInfo') THEN 1 ELSE 0 END) AS in_progress,
           SUM(CASE WHEN status = 'Resolved' THEN 1 ELSE 0 END) AS resolved,
           SUM(CASE WHEN status = 'Closed' THEN 1 ELSE 0 END) AS closed,
           SUM(CASE WHEN severity = 'Critical' AND status IN ('Open','Confirmed','InProgress','NeedsInfo') THEN 1 ELSE 0 END) AS critical_active,
           SUM(CASE WHEN status IN ('Open','Confirmed','InProgress','NeedsInfo') THEN 1 ELSE 0 END) AS active
      FROM bug_reports
     WHERE project = ?
  `).get(project);
}

router.use(requireAuth);

// Métadonnées du moteur : le client n'embarque pas une deuxième copie de la config.
router.get('/meta', (req, res) => {
  res.json({ projects: PROJECTS, severities: SEVERITIES, statuses: STATUSES, activeStatuses: ACTIVE_STATUSES });
});

// Petit endpoint destiné au badge de la sidebar.
router.get('/sidebar', (req, res) => {
  const project = isProject(req.query.project) ? req.query.project : 'TomoMod';
  const stats = computeStats(getDb(), project);
  res.json({ project, active: stats.active || 0, critical: stats.critical_active || 0 });
});

// Liste + statistiques.
router.get('/', (req, res) => {
  const db = getDb();
  const project = isProject(req.query.project) ? req.query.project : 'TomoMod';
  const where = ['b.project = ?'];
  const args = [project];

  const status = String(req.query.status || 'active');
  if (status === 'active') {
    where.push("b.status IN ('Open','Confirmed','InProgress','NeedsInfo')");
  } else if (status !== 'all' && isStatus(status)) {
    where.push('b.status = ?');
    args.push(status);
  }

  const severity = String(req.query.severity || 'all');
  if (severity !== 'all' && isSeverity(severity)) {
    where.push('b.severity = ?');
    args.push(severity);
  }

  const category = str(req.query.category, 100).trim();
  if (category && category !== 'all' && isModule(project, category)) {
    where.push('b.category = ?');
    args.push(category);
  }

  const search = str(req.query.search, 200).trim();
  if (search) {
    where.push(`(
      b.title LIKE ? ESCAPE '\\' OR
      b.description LIKE ? ESCAPE '\\' OR
      b.logs LIKE ? ESCAPE '\\' OR
      CAST(b.id AS TEXT) = ?
    )`);
    const escaped = search.replace(/[\\%_]/g, '\\$&');
    const like = `%${escaped}%`;
    args.push(like, like, like, search.replace(/^#/, ''));
  }

  const sort = String(req.query.sort || 'recent');
  const order = sort === 'oldest'
    ? 'b.created_at ASC'
    : sort === 'popular'
      ? 'votes DESC, b.updated_at DESC'
      : `b.pinned DESC,
         CASE b.status WHEN 'Open' THEN 0 WHEN 'Confirmed' THEN 1 WHEN 'InProgress' THEN 2 WHEN 'NeedsInfo' THEN 3 ELSE 4 END,
         b.updated_at DESC`;

  const items = db.prepare(`
    SELECT b.id, b.project, b.title, b.status, b.severity, b.category,
           b.addon_version, b.wow_version, b.reporter_name, b.reporter_is_temporary,
           b.pinned, b.created_at, b.updated_at,
           (SELECT COUNT(*) FROM bug_votes v WHERE v.bug_id = b.id) AS votes,
           (SELECT COUNT(*) FROM bug_comments c WHERE c.bug_id = b.id) AS comments
      FROM bug_reports b
     WHERE ${where.join(' AND ')}
     ORDER BY ${order}
     LIMIT 200
  `).all(...args);

  res.json({ project, stats: computeStats(db, project), items });
});

router.get('/:id(\\d+)', (req, res) => {
  const db = getDb();
  const bug = getBugOr404(db, Number(req.params.id), res);
  if (!bug) return;

  const comments = db.prepare(`
    SELECT id, author_user_id, author_name, author_role, content, created_at
      FROM bug_comments
     WHERE bug_id = ?
     ORDER BY created_at ASC, id ASC
  `).all(bug.id);

  const voted = Boolean(db.prepare('SELECT 1 FROM bug_votes WHERE bug_id = ? AND user_id = ?').get(bug.id, req.user.id));
  res.json({ ...bug, comments, voted });
});

router.post('/', (req, res) => {
  const db = getDb();
  const b = req.body || {};
  const project = isProject(b.project) ? b.project : 'TomoMod';
  const title = str(b.title, MAX_TITLE).trim();
  const description = str(b.description, MAX_DESCRIPTION).trim();
  const reproduction = optional(b.reproduction_steps, MAX_REPRO);
  const logs = optional(b.logs, MAX_LOGS);
  const severity = isSeverity(b.severity) ? b.severity : 'Medium';
  const category = optional(b.category, 100);

  if (title.length < 6) return res.status(400).json({ error: 'Le titre doit faire au moins 6 caractères.' });
  if (description.length < 15) return res.status(400).json({ error: 'La description doit faire au moins 15 caractères.' });
  if (!isModule(project, category)) return res.status(400).json({ error: 'Module invalide pour ce projet.' });

  const info = db.prepare(`
    INSERT INTO bug_reports (
      project, title, description, reproduction_steps, logs, severity, status,
      category, wow_version, addon_version, reporter_user_id, reporter_name,
      reporter_is_temporary, screenshot_url, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'Open', ?, ?, ?, ?, ?, ?, ?, unixepoch(), unixepoch())
  `).run(
    project, title, description, reproduction, logs, severity, category,
    optional(b.wow_version, 50), optional(b.addon_version, 50),
    req.user.id, str(req.user.username, 50), req.user.role === 'temporary' ? 1 : 0,
    cleanScreenshot(b.screenshot_url)
  );

  const bug = getBugOr404(db, Number(info.lastInsertRowid), res);
  res.status(201).json(bug);
});

router.post('/:id(\\d+)/comments', (req, res) => {
  const db = getDb();
  const bug = getBugOr404(db, Number(req.params.id), res);
  if (!bug) return;

  const content = str(req.body?.content, MAX_COMMENT).trim();
  if (content.length < 2) return res.status(400).json({ error: 'Commentaire vide.' });

  const info = db.prepare(`
    INSERT INTO bug_comments (bug_id, author_user_id, author_name, author_role, content, created_at)
    VALUES (?, ?, ?, ?, ?, unixepoch())
  `).run(bug.id, req.user.id, str(req.user.username, 50), req.user.role, content);

  db.prepare('UPDATE bug_reports SET updated_at = unixepoch() WHERE id = ?').run(bug.id);
  const comment = db.prepare('SELECT * FROM bug_comments WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(comment);
});

router.post('/:id(\\d+)/vote', (req, res) => {
  const db = getDb();
  const bug = getBugOr404(db, Number(req.params.id), res);
  if (!bug) return;

  const existing = db.prepare('SELECT id FROM bug_votes WHERE bug_id = ? AND user_id = ?').get(bug.id, req.user.id);
  if (existing) {
    db.prepare('DELETE FROM bug_votes WHERE id = ?').run(existing.id);
  } else {
    db.prepare('INSERT INTO bug_votes (bug_id, user_id, created_at) VALUES (?, ?, unixepoch())').run(bug.id, req.user.id);
  }

  const votes = db.prepare('SELECT COUNT(*) AS n FROM bug_votes WHERE bug_id = ?').get(bug.id).n;
  res.json({ votes, voted: !existing });
});

// Modérateur/Admin : statut, sévérité, module, version corrigée, assignation, épinglage.
router.patch('/:id(\\d+)', requireRole('moderator'), (req, res) => {
  const db = getDb();
  const bug = getBugOr404(db, Number(req.params.id), res);
  if (!bug) return;

  const b = req.body || {};
  const patch = {};
  if (b.status !== undefined) {
    if (!isStatus(b.status)) return res.status(400).json({ error: 'Statut invalide.' });
    patch.status = b.status;
  }
  if (b.severity !== undefined) {
    if (!isSeverity(b.severity)) return res.status(400).json({ error: 'Sévérité invalide.' });
    patch.severity = b.severity;
  }
  if (b.category !== undefined) {
    const category = optional(b.category, 100);
    if (!isModule(bug.project, category)) return res.status(400).json({ error: 'Module invalide.' });
    patch.category = category;
  }
  if (b.resolved_version !== undefined) patch.resolved_version = optional(b.resolved_version, 50);
  if (b.pinned !== undefined) patch.pinned = b.pinned ? 1 : 0;
  if (b.assignee_user_id !== undefined) {
    const id = b.assignee_user_id === null || b.assignee_user_id === '' ? null : Number(b.assignee_user_id);
    if (id !== null) {
      const user = db.prepare("SELECT id FROM users WHERE id = ? AND role IN ('admin','moderator')").get(id);
      if (!user) return res.status(400).json({ error: 'Assignation invalide.' });
    }
    patch.assignee_user_id = id;
  }

  const keys = Object.keys(patch);
  if (keys.length) {
    const sets = keys.map(k => `${k} = ?`).join(', ');
    db.prepare(`UPDATE bug_reports SET ${sets}, updated_at = unixepoch() WHERE id = ?`).run(...keys.map(k => patch[k]), bug.id);
  }

  res.json(getBugOr404(db, bug.id, res));
});

// Modérateur/Admin : supprimer un commentaire du Bug Tracker.
router.delete('/:id(\\d+)/comments/:commentId(\\d+)', requireRole('moderator'), (req, res) => {
  const db = getDb();
  const bug = getBugOr404(db, Number(req.params.id), res);
  if (!bug) return;

  const result = db.prepare('DELETE FROM bug_comments WHERE id = ? AND bug_id = ?')
    .run(Number(req.params.commentId), bug.id);
  if (!result.changes) return res.status(404).json({ error: 'Commentaire introuvable' });

  db.prepare('UPDATE bug_reports SET updated_at = unixepoch() WHERE id = ?').run(bug.id);
  res.json({ ok: true });
});

router.delete('/:id(\\d+)', requireRole('moderator'), (req, res) => {
  const db = getDb();
  const result = db.prepare('DELETE FROM bug_reports WHERE id = ?').run(Number(req.params.id));
  if (!result.changes) return res.status(404).json({ error: 'Bug introuvable' });
  res.json({ ok: true });
});

module.exports = router;
