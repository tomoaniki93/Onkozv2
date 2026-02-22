'use strict';
/**
 * Migration : ajout des catégories + présence dans les salons
 * À exécuter une seule fois sur la DB existante.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH || './data/onkoz.db';
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  -- Catégories
  CREATE TABLE IF NOT EXISTS categories (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    position    INTEGER NOT NULL DEFAULT 0,
    created_by  INTEGER NOT NULL REFERENCES users(id),
    created_at  INTEGER NOT NULL DEFAULT (unixepoch())
  );

  -- Colonne category_id sur channels (nullable → salon sans catégorie)
  -- SQLite ne supporte pas ADD COLUMN IF NOT EXISTS, on vérifie via pragma
`);

// Ajouter category_id si absent
const cols = db.pragma('table_info(channels)').map(c => c.name);
if (!cols.includes('category_id')) {
  db.exec(`ALTER TABLE channels ADD COLUMN category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL`);
  console.log('[migrate] category_id ajouté à channels');
}

console.log('[migrate] Migration terminée ✓');
db.close();

// Migration: table reactions
try {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS reactions (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      emoji      TEXT    NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE(message_id, user_id, emoji)
    );
    CREATE INDEX IF NOT EXISTS idx_reactions_message ON reactions(message_id);
  `);
  console.log('[migrate] Table reactions OK');
} catch(e) { console.log('[migrate] reactions:', e.message); }
