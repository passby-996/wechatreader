const path = require('path');
const Database = require('better-sqlite3');

const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'wechatreader.db');
require('fs').mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  wechat_id TEXT,
  description TEXT,
  profile_url TEXT,
  feed_url TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS articles (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  category TEXT,
  link TEXT NOT NULL,
  update_time TEXT NOT NULL,
  author_name TEXT,
  FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_articles_source_update ON articles(source_id, update_time DESC);
CREATE INDEX IF NOT EXISTS idx_articles_category ON articles(category);

CREATE VIRTUAL TABLE IF NOT EXISTS articles_fts USING fts5(
  title,
  description,
  content='articles',
  content_rowid='rowid'
);

CREATE TRIGGER IF NOT EXISTS articles_ai AFTER INSERT ON articles BEGIN
  INSERT INTO articles_fts(rowid, title, description) VALUES (new.rowid, new.title, COALESCE(new.description, ''));
END;

CREATE TRIGGER IF NOT EXISTS articles_ad AFTER DELETE ON articles BEGIN
  INSERT INTO articles_fts(articles_fts, rowid, title, description) VALUES('delete', old.rowid, old.title, COALESCE(old.description, ''));
END;

CREATE TRIGGER IF NOT EXISTS articles_au AFTER UPDATE ON articles BEGIN
  INSERT INTO articles_fts(articles_fts, rowid, title, description) VALUES('delete', old.rowid, old.title, COALESCE(old.description, ''));
  INSERT INTO articles_fts(rowid, title, description) VALUES (new.rowid, new.title, COALESCE(new.description, ''));
END;
`);

module.exports = db;
