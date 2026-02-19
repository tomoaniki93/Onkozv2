'use strict';
const express = require('express');
const { getDb } = require('../db/database');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// ── Liste tous les salons (avec catégorie) ────────────────────────────────────
router.get('/', requireAuth, (req, res) => {
  const db = getDb();
  const channels = db.prepare(`
    SELECT c.*, u.username as creator_name, cat.name as category_name
    FROM channels c
    JOIN users u ON c.created_by = u.id
    LEFT JOIN categories cat ON c.category_id = cat.id
    ORDER BY cat.position NULLS LAST, cat.name NULLS LAST, c.type, c.position, c.name
  `).all();
  res.json(channels);
});

// ── Créer un salon (admin) ────────────────────────────────────────────────────
router.post('/', requireAuth, requireRole('moderator'), (req, res) => {
  const db = getDb();
  const { name, type, position, category_id } = req.body;

  if (!name || !type) return res.status(400).json({ error: 'Nom et type requis' });
  if (!['text', 'voice'].includes(type)) return res.status(400).json({ error: 'Type invalide (text|voice)' });
  if (name.length < 1 || name.length > 32) return res.status(400).json({ error: 'Nom 1-32 caractères' });

  // Vérifier catégorie si fournie
  if (category_id) {
    const cat = db.prepare('SELECT id FROM categories WHERE id = ?').get(category_id);
    if (!cat) return res.status(400).json({ error: 'Catégorie introuvable' });
  }

  const info = db.prepare(
    'INSERT INTO channels (name, type, created_by, position, category_id) VALUES (?, ?, ?, ?, ?)'
  ).run(
    name.toLowerCase().replace(/\s+/g, '-'),
    type, req.user.id, position || 0,
    category_id || null
  );

  const channel = db.prepare(`
    SELECT c.*, cat.name as category_name
    FROM channels c LEFT JOIN categories cat ON c.category_id = cat.id
    WHERE c.id = ?
  `).get(info.lastInsertRowid);

  res.status(201).json(channel);
});

// ── Supprimer un salon (admin) ────────────────────────────────────────────────
router.delete('/:id', requireAuth, requireRole('moderator'), (req, res) => {
  const db = getDb();
  const channel = db.prepare('SELECT * FROM channels WHERE id = ?').get(req.params.id);
  if (!channel) return res.status(404).json({ error: 'Salon introuvable' });
  db.prepare('DELETE FROM channels WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ── Messages d'un salon texte ─────────────────────────────────────────────────
router.get('/:id/messages', requireAuth, (req, res) => {
  const db      = getDb();
  const channel = db.prepare('SELECT * FROM channels WHERE id = ? AND type = ?').get(req.params.id, 'text');
  if (!channel) return res.status(404).json({ error: 'Salon texte introuvable' });

  const limit  = Math.min(parseInt(req.query.limit) || 50, 100);
  const before = req.query.before ? parseInt(req.query.before) : null;

  const messages = before
    ? db.prepare(`SELECT m.*, u.username, u.role FROM messages m JOIN users u ON m.user_id = u.id WHERE m.channel_id = ? AND m.id < ? ORDER BY m.id DESC LIMIT ?`).all(req.params.id, before, limit)
    : db.prepare(`SELECT m.*, u.username, u.role FROM messages m JOIN users u ON m.user_id = u.id WHERE m.channel_id = ? ORDER BY m.id DESC LIMIT ?`).all(req.params.id, limit);

  res.json(messages.reverse());
});

module.exports = router;
