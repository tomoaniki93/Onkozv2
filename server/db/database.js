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

  // ── Migration : support comptes éphémères ────────────────────────────────
  const userCols = db.pragma('table_info(users)').map(c => c.name);

  // 1. Ajouter colonnes manquantes (DB < éphémère)
  if (!userCols.includes('is_ephemeral')) {
    db.exec('ALTER TABLE users ADD COLUMN is_ephemeral INTEGER NOT NULL DEFAULT 0');
    console.log('[DB] Migration : is_ephemeral ajouté');
  }
  if (!userCols.includes('expires_at')) {
    db.exec('ALTER TABLE users ADD COLUMN expires_at INTEGER DEFAULT NULL');
    console.log('[DB] Migration : expires_at ajouté');
  }

  // 2. Récupérer un état cassé (migration précédente interrompue)
  //    _users_old existe mais users n'existe pas → rollback
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name);
  if (tables.includes('_users_old') && !tables.includes('users')) {
    console.log('[DB] Récupération : migration interrompue détectée, rollback…');
    db.pragma('foreign_keys = OFF');
    db.exec('ALTER TABLE _users_old RENAME TO users');
    db.pragma('foreign_keys = ON');
    console.log('[DB] Récupération : table users restaurée ✓');
  }

  // 3. Vérifier si le CHECK constraint bloque 'temporary'
  //    SQLite ne supporte pas ALTER COLUMN → on recrée via transaction
  const tableSQL = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'").get()?.sql || '';
  if (tableSQL && !tableSQL.includes("'temporary'") && !tableSQL.includes('"temporary"')) {
    console.log('[DB] Migration : mise à jour du CHECK constraint (ajout temporary)…');

    // Récupérer les colonnes existantes pour le INSERT SELECT dynamique
    const cols = db.pragma('table_info(users)').map(c => c.name);
    const hasEphemeral = cols.includes('is_ephemeral');
    const hasExpires   = cols.includes('expires_at');

    const migrate = db.transaction(() => {
      db.pragma('foreign_keys = OFF');

      db.exec('ALTER TABLE users RENAME TO _users_old');

      db.exec(`CREATE TABLE users (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        username     TEXT    NOT NULL UNIQUE COLLATE NOCASE,
        password     TEXT    NOT NULL,
        role         TEXT    NOT NULL DEFAULT 'user'
                     CHECK(role IN ('admin','moderator','user','temporary')),
        created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
        last_seen    INTEGER,
        bio          TEXT    DEFAULT NULL,
        status       TEXT    DEFAULT NULL,
        avatar_url   TEXT    DEFAULT NULL,
        banner_url   TEXT    DEFAULT NULL,
        is_ephemeral INTEGER NOT NULL DEFAULT 0,
        expires_at   INTEGER DEFAULT NULL
      )`);

      const ephCol     = hasEphemeral ? 'is_ephemeral' : '0';
      const expCol     = hasExpires   ? 'expires_at'   : 'NULL';
      db.exec(`INSERT INTO users
        (id, username, password, role, created_at, last_seen,
         bio, status, avatar_url, banner_url, is_ephemeral, expires_at)
        SELECT id, username, password, role, created_at, last_seen,
               bio, status, avatar_url, banner_url,
               COALESCE(${ephCol}, 0), ${expCol}
        FROM _users_old`);

      db.exec('DROP TABLE _users_old');
      db.pragma('foreign_keys = ON');
    });

    migrate();
    console.log('[DB] Migration : CHECK constraint mis à jour ✓');
  }

  // 3. Index expires_at (créé après que la colonne existe)
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
