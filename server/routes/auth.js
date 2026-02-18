'use strict';
const express = require('express');
const bcrypt  = require('bcryptjs');
const { getDb }     = require('../db/database');
const { signToken, requireAuth } = require('../middleware/auth');

const router = express.Router();

// ── Vérification pseudo disponible ───────────────────────────────────────────
router.get('/check-username/:username', (req, res) => {
  const db   = getDb();
  const user = db.prepare('SELECT id FROM users WHERE username = ?').get(req.params.username);
  res.json({ available: !user });
});

// ── Setup admin (première installation) ──────────────────────────────────────
router.post('/setup', (req, res) => {
  const db = getDb();
  const existing = db.prepare("SELECT id FROM users WHERE role = 'admin'").get();
  if (existing) return res.status(400).json({ error: 'Admin déjà configuré' });

  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Champs requis' });
  if (username.length < 2 || username.length > 20) return res.status(400).json({ error: 'Pseudo 2-20 caractères' });
  if (password.length < 6) return res.status(400).json({ error: 'Mot de passe min 6 caractères' });

  const hash = bcrypt.hashSync(password, 12);
  const info = db.prepare('INSERT INTO users (username, password, role) VALUES (?, ?, ?)').run(username, hash, 'admin');
  const token = signToken({ id: info.lastInsertRowid, username, role: 'admin' });
  res.json({ token, user: { id: info.lastInsertRowid, username, role: 'admin' } });
});

// ── Inscription (première connexion : choix pseudo + mdp) ────────────────────
router.post('/register', (req, res) => {
  const db = getDb();
  const { username, password } = req.body;

  if (!username || !password) return res.status(400).json({ error: 'Champs requis' });
  if (username.length < 2 || username.length > 20) return res.status(400).json({ error: 'Pseudo 2-20 caractères' });
  if (!/^[a-zA-Z0-9_-]+$/.test(username)) return res.status(400).json({ error: 'Pseudo : lettres, chiffres, _ et - uniquement' });
  if (password.length < 6) return res.status(400).json({ error: 'Mot de passe min 6 caractères' });

  const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (exists) return res.status(409).json({ error: 'Ce pseudo est déjà pris' });

  const hash = bcrypt.hashSync(password, 12);
  const info = db.prepare('INSERT INTO users (username, password, role) VALUES (?, ?, ?)').run(username, hash, 'user');
  const token = signToken({ id: info.lastInsertRowid, username, role: 'user' });
  res.status(201).json({ token, user: { id: info.lastInsertRowid, username, role: 'user' } });
});

// ── Connexion ─────────────────────────────────────────────────────────────────
router.post('/login', (req, res) => {
  const db = getDb();
  const { username, password } = req.body;

  if (!username || !password) return res.status(400).json({ error: 'Champs requis' });

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: 'Pseudo ou mot de passe incorrect' });
  }

  db.prepare('UPDATE users SET last_seen = ? WHERE id = ?').run(Math.floor(Date.now() / 1000), user.id);
  const token = signToken({ id: user.id, username: user.username, role: user.role });
  res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
});

// ── Profil courant ────────────────────────────────────────────────────────────
router.get('/me', requireAuth, (req, res) => {
  const db   = getDb();
  const user = db.prepare('SELECT id, username, role, created_at FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'Utilisateur introuvable' });
  res.json(user);
});

module.exports = router;
