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

  // Index expires_at pour le nettoyage des comptes éphémères
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
  // Les messages et DM référencent users(id) sans ON DELETE CASCADE : on les
  // supprime d'abord (DML uniquement, aucun changement de schéma), sinon le
  // DELETE échoue sur la clé étrangère. Un échec ne doit jamais arrêter le serveur.
  try {
    const expired = "SELECT id FROM users WHERE is_ephemeral = 1 AND expires_at IS NOT NULL AND expires_at < ?";
    const purge = db.transaction(() => {
      db.prepare(`DELETE FROM messages WHERE user_id IN (${expired})`).run(now);
      db.prepare(`DELETE FROM direct_messages WHERE from_id IN (${expired}) OR to_id IN (${expired})`).run(now, now);
      return db.prepare(
        'DELETE FROM users WHERE is_ephemeral = 1 AND expires_at IS NOT NULL AND expires_at < ?'
      ).run(now);
    });
    const expiredResult = purge();
    if (expiredResult.changes > 0)
      console.log(`[DB] Comptes éphémères expirés supprimés : ${expiredResult.changes}`);
  } catch (err) {
    console.error('[DB] Suppression des comptes éphémères expirés impossible :', err.message);
  }

  const cutoff = now - 7 * 24 * 3600;

  const dmResult = db.prepare('DELETE FROM direct_messages WHERE created_at < ?').run(cutoff);
  if (dmResult.changes > 0)
    console.log(`[DB] Nettoyage DM : ${dmResult.changes} messages supprimés (> 7 jours)`);

  const msgResult = db.prepare('DELETE FROM messages WHERE created_at < ? AND pinned = 0').run(cutoff);
  if (msgResult.changes > 0)
    console.log(`[DB] Nettoyage salons : ${msgResult.changes} messages supprimés (> 7 jours)`);
}

module.exports = { getDb, cleanOldDMs };
