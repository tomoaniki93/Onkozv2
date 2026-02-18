'use strict';
const express = require('express');
const { getDb } = require('../db/database');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// ── Liste tous les salons ─────────────────────────────────────────────────────
router.get('/', requireAuth, (req, res) => {
  const db = getDb();
  const channels = db.prepare(`
    SELECT c.*, u.username as creator_name
    FROM channels c JOIN users u ON c.created_by = u.id
    ORDER BY c.type, c.position, c.name
  `).all();
  res.json(channels);
});

// ── Créer un salon (admin seulement) ─────────────────────────────────────────
router.post('/', requireAuth, requireRole('admin'), (req, res) => {
  const db = getDb();
  const { name, type, position } = req.body;

  if (!name || !type) return res.status(400).json({ error: 'Nom et type requis' });
  if (!['text', 'voice'].includes(type)) return res.status(400).json({ error: 'Type invalide (text|voice)' });
  if (name.length < 1 || name.length > 32) return res.status(400).json({ error: 'Nom 1-32 caractères' });

  const info = db.prepare('INSERT INTO channels (name, type, created_by, position) VALUES (?, ?, ?, ?)').run(
    name.toLowerCase().replace(/\s+/g, '-'), type, req.user.id, position || 0
  );
  const channel = db.prepare('SELECT * FROM channels WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(channel);
});

// ── Supprimer un salon (admin) ────────────────────────────────────────────────
router.delete('/:id', requireAuth, requireRole('admin'), (req, res) => {
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
