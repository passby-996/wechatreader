const express = require('express');
const cron = require('node-cron');
const path = require('path');
const fs = require('fs');

function loadDotEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const raw = line.trim();
    if (!raw || raw.startsWith('#')) continue;
    const idx = raw.indexOf('=');
    if (idx <= 0) continue;
    const key = raw.slice(0, idx).trim();
    const value = raw.slice(idx + 1).trim().replace(/^"|"$/g, '');
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadDotEnv();

const db = require('./db');
const { syncSource, searchPublicAccounts } = require('./sync');

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

const sourceInsert = db.prepare(`
  INSERT INTO sources (id, fakeid, name, wechat_id, alias, description, profile_url, avatar_url)
  VALUES (@id, @fakeid, @name, @wechat_id, @alias, @description, @profile_url, @avatar_url)
  ON CONFLICT(id) DO UPDATE SET
    fakeid=excluded.fakeid,
    name=excluded.name,
    wechat_id=excluded.wechat_id,
    alias=excluded.alias,
    description=excluded.description,
    profile_url=excluded.profile_url,
    avatar_url=excluded.avatar_url
`);

app.get('/api/sources', (_req, res) => {
  const rows = db.prepare('SELECT * FROM sources ORDER BY created_at DESC').all();
  res.json(rows);
});

app.get('/api/sources/search', async (req, res) => {
  const q = (req.query.q || '').toString().trim();
  if (!q) return res.status(400).json({ error: 'query q is required' });

  try {
    const results = await searchPublicAccounts(q);
    res.json(results);
  } catch (error) {
    res.status(502).json({ error: error.message });
  }
});

app.post('/api/sources', (req, res) => {
  const payload = req.body || {};
  if (!payload.id || !payload.name) {
    return res.status(400).json({ error: 'id(fakeid) and name are required' });
  }
  sourceInsert.run(payload);
  res.json({ ok: true });
});

app.post('/api/sync', async (req, res) => {
  const { sourceId } = req.body || {};
  const sources = sourceId
    ? db.prepare('SELECT * FROM sources WHERE id = ?').all(sourceId)
    : db.prepare('SELECT * FROM sources').all();

  const results = [];
  for (const source of sources) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const synced = await syncSource(db, source);
      results.push({ source: source.name, ...synced });
    } catch (error) {
      results.push({ source: source.name, sourceId: source.id, synced: 0, error: error.message });
    }
  }

  res.json({ ok: true, results });
});

app.get('/api/categories', (req, res) => {
  const q = (req.query.q || '').toString().trim();
  const sourceId = (req.query.sourceId || '').toString().trim();

  let rows;
  if (q) {
    rows = db.prepare(`
      SELECT COALESCE(NULLIF(a.category, ''), 'others') AS category, COUNT(*) AS count
      FROM articles a
      JOIN articles_fts f ON a.rowid = f.rowid
      WHERE articles_fts MATCH ? ${sourceId ? 'AND a.source_id = ?' : ''}
      GROUP BY COALESCE(NULLIF(a.category, ''), 'others')
      ORDER BY count DESC
    `).all(sourceId ? [q, sourceId] : [q]);
  } else {
    rows = db.prepare(`
      SELECT COALESCE(NULLIF(category, ''), 'others') AS category, COUNT(*) AS count
      FROM articles
      ${sourceId ? 'WHERE source_id = ?' : ''}
      GROUP BY COALESCE(NULLIF(category, ''), 'others')
      ORDER BY count DESC
    `).all(sourceId ? [sourceId] : []);
  }

  res.json(rows);
});

app.get('/api/articles', (req, res) => {
  const category = (req.query.category || '').toString().trim();
  const sourceId = (req.query.sourceId || '').toString().trim();
  const q = (req.query.q || '').toString().trim();
  const page = Math.max(1, Number(req.query.page || 1));
  const pageSize = 30;
  const offset = (page - 1) * pageSize;

  const where = [];
  const params = [];
  let join = 'LEFT JOIN sources s ON s.id = a.source_id';

  if (category) {
    where.push("COALESCE(NULLIF(a.category, ''), 'others') = ?");
    params.push(category);
  }
  if (sourceId) {
    where.push('a.source_id = ?');
    params.push(sourceId);
  }
  if (q) {
    join += ' JOIN articles_fts f ON f.rowid = a.rowid';
    where.push('articles_fts MATCH ?');
    params.push(q);
  }

  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const total = db.prepare(`SELECT COUNT(*) AS count FROM articles a ${join} ${whereClause}`).get(...params).count;

  const rows = db.prepare(`
    SELECT a.*, s.name AS source_name
    FROM articles a
    ${join}
    ${whereClause}
    ORDER BY a.update_time DESC
    LIMIT ? OFFSET ?
  `).all(...params, pageSize, offset);

  res.json({
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    items: rows
  });
});

cron.schedule('0 3 * * *', async () => {
  const sources = db.prepare('SELECT * FROM sources').all();
  for (const source of sources) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await syncSource(db, source);
    } catch (err) {
      console.error(`Scheduled sync failed for ${source.name}`, err.message);
    }
  }
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
