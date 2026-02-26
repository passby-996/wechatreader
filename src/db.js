const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'wechatreader.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  fakeid TEXT,
  name TEXT NOT NULL,
  wechat_id TEXT,
  alias TEXT,
  description TEXT,
  profile_url TEXT,
  avatar_url TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS articles (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  title TEXT NOT NULL,
  digest TEXT,
  category TEXT,
  link TEXT NOT NULL,
  update_time INTEGER NOT NULL,
  author_name TEXT,
  FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_articles_source_update ON articles(source_id, update_time DESC);
CREATE INDEX IF NOT EXISTS idx_articles_category ON articles(category);
`);

const articleColumns = db.prepare('PRAGMA table_info(articles)').all().map((r) => r.name);
if (!articleColumns.includes('digest')) {
  db.exec('ALTER TABLE articles ADD COLUMN digest TEXT DEFAULT \"\"');
}
if (!articleColumns.includes('update_time')) {
  db.exec('ALTER TABLE articles ADD COLUMN update_time INTEGER DEFAULT 0');
}

const sourceColumns = db.prepare('PRAGMA table_info(sources)').all().map((r) => r.name);
if (!sourceColumns.includes('fakeid')) db.exec('ALTER TABLE sources ADD COLUMN fakeid TEXT');
if (!sourceColumns.includes('alias')) db.exec('ALTER TABLE sources ADD COLUMN alias TEXT');
if (!sourceColumns.includes('avatar_url')) db.exec('ALTER TABLE sources ADD COLUMN avatar_url TEXT');

db.exec(`
CREATE VIRTUAL TABLE IF NOT EXISTS articles_fts USING fts5(
  title,
  digest,
  content='articles',
  content_rowid='rowid'
);

CREATE TRIGGER IF NOT EXISTS articles_ai AFTER INSERT ON articles BEGIN
  INSERT INTO articles_fts(rowid, title, digest) VALUES (new.rowid, new.title, COALESCE(new.digest, ''));
END;

CREATE TRIGGER IF NOT EXISTS articles_ad AFTER DELETE ON articles BEGIN
  INSERT INTO articles_fts(articles_fts, rowid, title, digest) VALUES('delete', old.rowid, old.title, COALESCE(old.digest, ''));
END;

CREATE TRIGGER IF NOT EXISTS articles_au AFTER UPDATE ON articles BEGIN
  INSERT INTO articles_fts(articles_fts, rowid, title, digest) VALUES('delete', old.rowid, old.title, COALESCE(old.digest, ''));
  INSERT INTO articles_fts(rowid, title, digest) VALUES (new.rowid, new.title, COALESCE(new.digest, ''));
END;
`);

module.exports = db;
