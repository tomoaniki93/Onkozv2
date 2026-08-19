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
  role        TEXT    NOT NULL DEFAULT 'user' CHECK(role IN ('admin','moderator','user','temporary')),
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  last_seen   INTEGER,
  bio         TEXT    DEFAULT NULL,
  status      TEXT    DEFAULT NULL,
  avatar_url  TEXT    DEFAULT NULL,
  banner_url  TEXT    DEFAULT NULL,
  is_ephemeral INTEGER NOT NULL DEFAULT 0,
  expires_at  INTEGER DEFAULT NULL
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
  pinned      INTEGER NOT NULL DEFAULT 0,
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

-- Réactions aux messages
CREATE TABLE IF NOT EXISTS reactions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id  INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji       TEXT    NOT NULL,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(message_id, user_id, emoji)
);

-- Bug Tracker natif ONKOZ
CREATE TABLE IF NOT EXISTS bug_reports (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  project               TEXT NOT NULL DEFAULT 'TomoMod',
  title                 TEXT NOT NULL,
  description           TEXT NOT NULL,
  reproduction_steps    TEXT DEFAULT NULL,
  logs                  TEXT DEFAULT NULL,
  severity              TEXT NOT NULL DEFAULT 'Medium'
                        CHECK(severity IN ('Critical','High','Medium','Low')),
  status                TEXT NOT NULL DEFAULT 'Open'
                        CHECK(status IN ('Open','Confirmed','InProgress','NeedsInfo','Resolved','Closed','Duplicate','Rejected')),
  category              TEXT DEFAULT NULL,
  wow_version           TEXT DEFAULT NULL,
  addon_version         TEXT DEFAULT NULL,
  resolved_version      TEXT DEFAULT NULL,
  reporter_user_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reporter_name         TEXT NOT NULL,
  reporter_is_temporary INTEGER NOT NULL DEFAULT 0,
  assignee_user_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  screenshot_url        TEXT DEFAULT NULL,
  pinned                INTEGER NOT NULL DEFAULT 0,
  created_at            INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at            INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS bug_comments (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  bug_id         INTEGER NOT NULL REFERENCES bug_reports(id) ON DELETE CASCADE,
  author_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  author_name    TEXT NOT NULL,
  author_role    TEXT NOT NULL DEFAULT 'user',
  content        TEXT NOT NULL,
  created_at     INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS bug_votes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  bug_id     INTEGER NOT NULL REFERENCES bug_reports(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(bug_id, user_id)
);

-- Index
CREATE INDEX IF NOT EXISTS idx_reactions_message ON reactions(message_id);

-- Index
CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel_id, created_at);
CREATE INDEX IF NOT EXISTS idx_dm_users ON direct_messages(from_id, to_id, created_at);
CREATE INDEX IF NOT EXISTS idx_dm_unread ON direct_messages(to_id, read);
CREATE INDEX IF NOT EXISTS idx_channels_category ON channels(category_id, position);
CREATE INDEX IF NOT EXISTS idx_bug_reports_project_status ON bug_reports(project, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_bug_reports_category ON bug_reports(project, category);
CREATE INDEX IF NOT EXISTS idx_bug_comments_bug ON bug_comments(bug_id, created_at);
CREATE INDEX IF NOT EXISTS idx_bug_votes_bug ON bug_votes(bug_id);