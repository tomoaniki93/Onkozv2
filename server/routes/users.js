'use strict';
const express = require('express');
const { getDb } = require('../db/database');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// ── Liste des utilisateurs ────────────────────────────────────────────────────
router.get('/', requireAuth, (req, res) => {
  const db    = getDb();
  const users = db.prepare('SELECT id, username, role, last_seen FROM users ORDER BY username').all();
  res.json(users);
});

// ── Changer le rôle d'un utilisateur (admin) ──────────────────────────────────
router.patch('/:id/role', requireAuth, requireRole('admin'), (req, res) => {
  const db   = getDb();
  const { role } = req.body;
  if (!['admin', 'moderator', 'user'].includes(role)) return res.status(400).json({ error: 'Rôle invalide' });
  if (req.params.id == req.user.id) return res.status(400).json({ error: 'Impossible de changer son propre rôle' });

  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'Utilisateur introuvable' });

  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, req.params.id);
  res.json({ success: true });
});

// ── Supprimer un utilisateur (admin) ─────────────────────────────────────────
router.delete('/:id', requireAuth, requireRole('admin'), (req, res) => {
  const db = getDb();
  if (req.params.id == req.user.id) return res.status(400).json({ error: 'Impossible de se supprimer soi-même' });
  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'Utilisateur introuvable' });
  db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ── Messages privés (DM) ──────────────────────────────────────────────────────

// Conversations (liste des gens avec qui on a échangé)
router.get('/dm/conversations', requireAuth, (req, res) => {
  const db  = getDb();
  const uid = req.user.id;

  const convs = db.prepare(`
    SELECT
      CASE WHEN from_id = ? THEN to_id ELSE from_id END AS partner_id,
      u.username AS partner_username,
      u.role     AS partner_role,
      MAX(dm.created_at) AS last_at,
      SUM(CASE WHEN dm.to_id = ? AND dm.read = 0 THEN 1 ELSE 0 END) AS unread
    FROM direct_messages dm
    JOIN users u ON u.id = CASE WHEN from_id = ? THEN to_id ELSE from_id END
    WHERE from_id = ? OR to_id = ?
    GROUP BY partner_id
    ORDER BY last_at DESC
  `).all(uid, uid, uid, uid, uid);

  res.json(convs);
});

// Historique DM avec un utilisateur
router.get('/dm/:partnerId', requireAuth, (req, res) => {
  const db      = getDb();
  const uid     = req.user.id;
  const partner = parseInt(req.params.partnerId);
  const limit   = Math.min(parseInt(req.query.limit) || 50, 100);

  const messages = db.prepare(`
    SELECT dm.*, uf.username AS from_username, ut.username AS to_username
    FROM direct_messages dm
    JOIN users uf ON dm.from_id = uf.id
    JOIN users ut ON dm.to_id   = ut.id
    WHERE (dm.from_id = ? AND dm.to_id = ?) OR (dm.from_id = ? AND dm.to_id = ?)
    ORDER BY dm.id DESC LIMIT ?
  `).all(uid, partner, partner, uid, limit);

  // Marquer comme lus
  db.prepare('UPDATE direct_messages SET read = 1 WHERE to_id = ? AND from_id = ?').run(uid, partner);

  res.json(messages.reverse());
});

// Nombre de DM non lus (tous partenaires)
router.get('/dm/unread/count', requireAuth, (req, res) => {
  const db  = getDb();
  const row = db.prepare('SELECT COUNT(*) AS count FROM direct_messages WHERE to_id = ? AND read = 0').get(req.user.id);
  res.json({ count: row.count });
});

module.exports = router;
