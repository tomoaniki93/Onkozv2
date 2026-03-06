'use strict';
const jwt = require('jsonwebtoken');

const SECRET = () => {
  const s = process.env.JWT_SECRET;
  if (!s) {
    if (process.env.NODE_ENV === 'production') {
      console.error('[SECURITY] JWT_SECRET non défini en production ! Définissez-le dans .env');
    }
    return 'onkoz_dev_secret';
  }
  return s;
};

function signToken(payload) {
  return jwt.sign(payload, SECRET(), { expiresIn: '30d' });
}

function verifyToken(token) {
  return jwt.verify(token, SECRET());
}

// Middleware Express
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Token manquant' });

  try {
    req.user = verifyToken(token);

    // Vérifier si le compte éphémère est expiré
    if (req.user.role === 'temporary') {
      const { getDb } = require('../db/database');
      const db = getDb();
      const u  = db.prepare('SELECT expires_at, is_ephemeral FROM users WHERE id = ?').get(req.user.id);
      if (u && u.is_ephemeral && u.expires_at && u.expires_at < Math.floor(Date.now() / 1000)) {
        return res.status(401).json({ error: 'Compte éphémère expiré', expired: true });
      }
    }

    next();
  } catch {
    return res.status(401).json({ error: 'Token invalide ou expiré' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    const userRole = req.user?.role;
    // Admin a toujours tous les droits
    if (userRole === 'admin') return next();
    if (!roles.includes(userRole)) {
      return res.status(403).json({ error: 'Permission insuffisante' });
    }
    next();
  };
}

// Vérif socket.io
function verifySocketToken(token) {
  try { return verifyToken(token); }
  catch { return null; }
}

module.exports = { signToken, requireAuth, requireRole, verifySocketToken };
