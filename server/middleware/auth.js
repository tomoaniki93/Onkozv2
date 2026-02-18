'use strict';
const jwt = require('jsonwebtoken');

const SECRET = () => process.env.JWT_SECRET || 'onkoz_dev_secret';

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
    next();
  } catch {
    return res.status(401).json({ error: 'Token invalide ou expiré' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user?.role)) {
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
