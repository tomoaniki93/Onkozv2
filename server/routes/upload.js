'use strict';
/* ── /server/routes/upload.js ────────────────────────────────────────────────
   Upload d'images dans les canaux texte.
   - POST /api/upload  → reçoit un fichier, retourne l'URL publique
   - Fichiers servis depuis /uploads/ (static Express)
   ─────────────────────────────────────────────────────────────────────────── */
const express = require('express');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const crypto  = require('crypto');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// Dossier de stockage
const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// Types autorisés
const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
const MAX_SIZE = 10 * 1024 * 1024; // 10 Mo

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename:    (req, file, cb) => {
    const ext  = path.extname(file.originalname).toLowerCase() || '.jpg';
    const name = crypto.randomBytes(16).toString('hex') + ext;
    cb(null, name);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_SIZE },
  fileFilter: (req, file, cb) => {
    if (ALLOWED.has(file.mimetype)) return cb(null, true);
    cb(new Error('Type de fichier non autorisé. Formats acceptés : JPG, PNG, GIF, WEBP.'));
  },
});

// POST /api/upload
router.post('/', requireAuth, upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Aucun fichier reçu.' });
  const url = `/uploads/${req.file.filename}`;
  res.json({ url, filename: req.file.filename });
});

// Gestion erreurs multer
router.use((err, req, res, next) => {
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'Fichier trop lourd (max 10 Mo).' });
  }
  res.status(400).json({ error: err.message || 'Erreur upload.' });
});

module.exports = router;
