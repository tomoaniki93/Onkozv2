'use strict';
const express = require('express');
const { getDb } = require('../db/database');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// ── Lister toutes les catégories ──────────────────────────────────────────────
router.get('/', requireAuth, (req, res) => {
  const db = getDb();

  // On assemble en JS pour garantir l'ordre des salons par `position`
  // (json_group_array ne respecte pas l'ordre sans ORDER BY, indisponible ici).
  const categories = db.prepare('SELECT * FROM categories ORDER BY position, name').all();
  const channels   = db.prepare('SELECT * FROM channels ORDER BY position, name').all();

  const byCat = new Map(categories.map(c => [c.id, { ...c, channels: [] }]));
  const uncategorized = [];
  for (const ch of channels) {
    if (ch.category_id != null && byCat.has(ch.category_id)) {
      byCat.get(ch.category_id).channels.push(ch);
    } else {
      uncategorized.push(ch);
    }
  }

  res.json({ categories: [...byCat.values()], uncategorized });
});

// ── Réorganiser salons + catégories (admin/mod) ───────────────────────────────
//  Body : { channels: [{ id, position, category_id }], categories: [{ id, position }] }
//  Transaction DML (UPDATE uniquement) — aucun changement de schéma.
router.post('/reorder', requireAuth, requireRole('moderator'), (req, res) => {
  const db = getDb();
  const { channels = [], categories = [] } = req.body || {};

  const updChannel  = db.prepare('UPDATE channels SET position = ?, category_id = ? WHERE id = ?');
  const updCategory = db.prepare('UPDATE categories SET position = ? WHERE id = ?');

  const apply = db.transaction(() => {
    channels.forEach((c, i) => {
      updChannel.run(Number.isInteger(c.position) ? c.position : i, c.category_id ?? null, c.id);
    });
    categories.forEach((c, i) => {
      updCategory.run(Number.isInteger(c.position) ? c.position : i, c.id);
    });
  });

  try {
    apply();
    res.json({ success: true });
  } catch (err) {
    console.error('[reorder]', err.message);
    res.status(500).json({ error: 'Réorganisation échouée' });
  }
});

// ── Créer une catégorie (admin) ───────────────────────────────────────────────
router.post('/', requireAuth, requireRole('moderator'), (req, res) => {
  const db = getDb();
  const { name, position } = req.body;
  if (!name || name.trim().length === 0) return res.status(400).json({ error: 'Nom requis' });
  if (name.length > 32) return res.status(400).json({ error: 'Nom max 32 caractères' });

  const info = db.prepare(
    'INSERT INTO categories (name, position, created_by) VALUES (?, ?, ?)'
  ).run(name.trim().toUpperCase(), position || 0, req.user.id);

  const cat = db.prepare('SELECT * FROM categories WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ ...cat, channels: [] });
});

// ── Renommer une catégorie (admin) ────────────────────────────────────────────
router.patch('/:id', requireAuth, requireRole('moderator'), (req, res) => {
  const db = getDb();
  const { name, position } = req.body;
  const cat = db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id);
  if (!cat) return res.status(404).json({ error: 'Catégorie introuvable' });

  db.prepare('UPDATE categories SET name = ?, position = ? WHERE id = ?').run(
    name ? name.trim().toUpperCase() : cat.name,
    position !== undefined ? position : cat.position,
    req.params.id
  );
  res.json(db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id));
});

// ── Supprimer une catégorie (admin) ───────────────────────────────────────────
router.delete('/:id', requireAuth, requireRole('moderator'), (req, res) => {
  const db = getDb();
  const cat = db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id);
  if (!cat) return res.status(404).json({ error: 'Catégorie introuvable' });
  // Les salons passent à category_id = NULL (ON DELETE SET NULL)
  db.prepare('DELETE FROM categories WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ── Assigner un salon à une catégorie (admin) ─────────────────────────────────
router.post('/:id/channels/:channelId', requireAuth, requireRole('moderator'), (req, res) => {
  const db = getDb();
  const cat = db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id);
  if (!cat) return res.status(404).json({ error: 'Catégorie introuvable' });
  const ch = db.prepare('SELECT * FROM channels WHERE id = ?').get(req.params.channelId);
  if (!ch) return res.status(404).json({ error: 'Salon introuvable' });

  db.prepare('UPDATE channels SET category_id = ? WHERE id = ?').run(req.params.id, req.params.channelId);
  res.json({ success: true });
});

module.exports = router;
