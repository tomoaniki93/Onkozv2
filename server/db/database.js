'use strict';
const Database = require('better-sqlite3');
const fs       = require('fs');
const path     = require('path');

let db;

function getDb() {
  if (db) return db;

  const dbPath = process.env.DB_PATH || './data/onkoz.db';
  const dir    = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Appliquer le schéma
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  db.exec(schema);

  // Créer le compte admin par défaut s'il n'existe pas
  ensureAdmin(db);

  return db;
}

function ensureAdmin(db) {
  const bcrypt  = require('bcryptjs');
  const existing = db.prepare('SELECT id FROM users WHERE role = ?').get('admin');
  if (!existing) {
    // L'admin sera créé lors du premier appel à /api/auth/setup
    console.log('[DB] Aucun admin trouvé. Un compte admin sera créé via /api/auth/setup');
  }
}

// Nettoyer les messages privés > 7 jours (appelé au démarrage et toutes les heures)
function cleanOldDMs(db) {
  const cutoff = Math.floor(Date.now() / 1000) - 7 * 24 * 3600;
  const result = db.prepare('DELETE FROM direct_messages WHERE created_at < ?').run(cutoff);
  if (result.changes > 0) {
    console.log(`[DB] Nettoyage DM : ${result.changes} messages supprimés (> 7 jours)`);
  }
}

module.exports = { getDb, cleanOldDMs };
