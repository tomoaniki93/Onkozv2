-- ==========================================
-- ONKOZ - Schéma de base de données SQLite
-- ==========================================

PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

-- Utilisateurs
CREATE TABLE IF NOT EXISTS users (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  username    TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  password    TEXT    NOT NULL,
  role        TEXT    NOT NULL DEFAULT 'user' CHECK(role IN ('admin','moderator','user')),
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  last_seen   INTEGER
);

-- Catégories de salons
CREATE TABLE IF NOT EXISTS categories (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL,
  position    INTEGER NOT NULL DEFAULT 0,
  created_by  INTEGER NOT NULL REFERENCES users(id),
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Salons permanents (créés par admin)
CREATE TABLE IF NOT EXISTS channels (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL,
  type        TEXT    NOT NULL CHECK(type IN ('text','voice')),
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  created_by  INTEGER NOT NULL REFERENCES users(id),
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  position    INTEGER NOT NULL DEFAULT 0
);

-- Messages textuels
CREATE TABLE IF NOT EXISTS messages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id  INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  content     TEXT    NOT NULL,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Messages privés
CREATE TABLE IF NOT EXISTS direct_messages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  from_id     INTEGER NOT NULL REFERENCES users(id),
  to_id       INTEGER NOT NULL REFERENCES users(id),
  content     TEXT    NOT NULL,
  read        INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Index
CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel_id, created_at);
CREATE INDEX IF NOT EXISTS idx_dm_users ON direct_messages(from_id, to_id, created_at);
CREATE INDEX IF NOT EXISTS idx_dm_unread ON direct_messages(to_id, read);
CREATE INDEX IF NOT EXISTS idx_channels_category ON channels(category_id, position);
