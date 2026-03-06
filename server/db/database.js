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

  // Migration runtime : colonnes éphémères (DB existantes sans ces colonnes)
  const userCols = db.pragma('table_info(users)').map(c => c.name);
  if (!userCols.includes('is_ephemeral')) {
    db.exec('ALTER TABLE users ADD COLUMN is_ephemeral INTEGER NOT NULL DEFAULT 0');
    console.log('[DB] Migration : is_ephemeral ajouté');
  }
  if (!userCols.includes('expires_at')) {
    db.exec('ALTER TABLE users ADD COLUMN expires_at INTEGER DEFAULT NULL');
    console.log('[DB] Migration : expires_at ajouté');
  }

  // Créer l'index expires_at seulement une fois la colonne présente
  db.exec('CREATE INDEX IF NOT EXISTS idx_users_expires ON users(expires_at)');

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

// Nettoyer les messages > 7 jours (DMs + salons texte, appelé au démarrage et toutes les heures)
function cleanOldDMs(db) {
  // Supprimer les comptes éphémères expirés
  const now = Math.floor(Date.now() / 1000);
  const expiredResult = db.prepare(
    'DELETE FROM users WHERE is_ephemeral = 1 AND expires_at IS NOT NULL AND expires_at < ?'
  ).run(now);
  if (expiredResult.changes > 0)
    console.log(`[DB] Comptes éphémères expirés supprimés : ${expiredResult.changes}`);

  const cutoff = now - 7 * 24 * 3600;

  const dmResult = db.prepare('DELETE FROM direct_messages WHERE created_at < ?').run(cutoff);
  if (dmResult.changes > 0)
    console.log(`[DB] Nettoyage DM : ${dmResult.changes} messages supprimés (> 7 jours)`);

  const msgResult = db.prepare('DELETE FROM messages WHERE created_at < ? AND pinned = 0').run(cutoff);
  if (msgResult.changes > 0)
    console.log(`[DB] Nettoyage salons : ${msgResult.changes} messages supprimés (> 7 jours)`);
}

module.exports = { getDb, cleanOldDMs };
