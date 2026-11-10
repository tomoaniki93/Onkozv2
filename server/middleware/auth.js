'use strict';
const jwt = require('jsonwebtoken');

const SECRET = () => {
  const s = process.env.JWT_SECRET;
  if (!s) {
    if (process.env.NODE_ENV === 'production') {
      // Ne jamais signer/vérifier avec un secret public en production
      throw new Error('[SECURITY] JWT_SECRET non défini en production');
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

  let payload;
  try {
    payload = verifyToken(token);
  } catch {
    return res.status(401).json({ error: 'Token invalide ou expiré' });
  }

  // Le token seul ne suffit pas : le compte doit toujours exister, et le rôle
  // appliqué est celui de la base (un compte supprimé ou rétrogradé perd ses
  // droits immédiatement, sans attendre l'expiration du token à 30 jours).
  const { getDb } = require('../db/database');
  const u = getDb().prepare(
    'SELECT id, username, role, is_ephemeral, expires_at FROM users WHERE id = ?'
  ).get(payload.id);
  if (!u) return res.status(401).json({ error: 'Compte introuvable' });
  if (u.is_ephemeral && u.expires_at && u.expires_at < Math.floor(Date.now() / 1000)) {
    return res.status(401).json({ error: 'Compte éphémère expiré', expired: true });
  }

  req.user = { ...payload, id: u.id, username: u.username, role: u.role };
  next();
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
