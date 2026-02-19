'use strict';
const express = require('express');
const { getDb } = require('../db/database');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// ── Lister toutes les catégories ──────────────────────────────────────────────
router.get('/', requireAuth, (req, res) => {
  const db = getDb();
  const cats = db.prepare(`
    SELECT cat.*, 
           json_group_array(
             json_object(
               'id', c.id, 'name', c.name, 'type', c.type,
               'position', c.position, 'category_id', c.category_id
             )
           ) as channels_json
    FROM categories cat
    LEFT JOIN channels c ON c.category_id = cat.id
    GROUP BY cat.id
    ORDER BY cat.position, cat.name
  `).all();

  // Parser le JSON des salons
  const result = cats.map(cat => ({
    ...cat,
    channels: JSON.parse(cat.channels_json).filter(c => c.id !== null),
  }));
  delete result.forEach(r => delete r.channels_json);

  // Salons sans catégorie
  const uncategorized = db.prepare(`
    SELECT * FROM channels WHERE category_id IS NULL ORDER BY type, position, name
  `).all();

  res.json({ categories: result, uncategorized });
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
