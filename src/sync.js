const axios = require('axios');

function getApiBase() {
  return process.env.API_BASE || 'https://down.mptext.top/api/public/v1';
}

function getFetchSize() {
  return Number(process.env.FETCH_SIZE || 50);
}

function getAuthKey() {
  return process.env.X_AUTH_KEY || process.env.X_AUTH_TOKEN || process.env['X-Auth-Key'] || '';
}

function getHeaders() {
  const authKey = getAuthKey();
  if (!authKey) {
    throw new Error('Missing auth key in env (X_AUTH_KEY or X-Auth-Key)');
  }
  return { 'X-Auth-Key': authKey };
}

function normalizeCategory(rawCategory) {
  if (!rawCategory) return 'others';
  return String(rawCategory).trim() || 'others';
}

function normalizeSource(item) {
  return {
    id: item.fakeid,
    fakeid: item.fakeid,
    name: item.nickname,
    wechat_id: item.alias || '',
    alias: item.alias || '',
    description: item.signature || '',
    profile_url: `https://mp.weixin.qq.com/mp/profile_ext?action=home&__biz=${encodeURIComponent(item.fakeid)}`,
    avatar_url: item.round_head_img || ''
  };
}

function normalizeArticle(source, item) {
  const category = normalizeCategory(item?.appmsg_album_infos?.[0]?.title);
  const updateTimestamp = Number(item.update_time || item.create_time || Math.floor(Date.now() / 1000));

  return {
    id: item.aid,
    source_id: source.id,
    title: item.title || 'Untitled',
    digest: item.digest || '',
    category,
    link: item.link || '#',
    update_time: updateTimestamp,
    author_name: item.author_name || source.name
  };
}

async function searchPublicAccounts(keyword) {
  const res = await axios.get(`${getApiBase()}/account`, {
    headers: getHeaders(),
    params: { keyword, size: 20 },
    timeout: 15000
  });

  if (res.data?.base_resp?.ret !== 0) {
    throw new Error(res.data?.base_resp?.err_msg || 'account search failed');
  }

  return (res.data.list || []).map(normalizeSource);
}

async function fetchAllArticles(source) {
  const all = [];
  let begin = 0;

  while (true) {
    // eslint-disable-next-line no-await-in-loop
    const res = await axios.get(`${getApiBase()}/article`, {
      headers: getHeaders(),
      params: { fakeid: source.id, size: getFetchSize(), begin },
      timeout: 20000
    });

    if (res.data?.base_resp?.ret !== 0) {
      throw new Error(res.data?.base_resp?.err_msg || 'article sync failed');
    }

    const batch = res.data.articles || [];
    all.push(...batch);

    if (!batch.length || batch.length < getFetchSize()) break;
    if (!Number.isFinite(begin)) break;

    const nextBegin = begin + batch.length;
    if (nextBegin === begin) break;
    begin = nextBegin;

    if (begin > 5000) break;
  }

  return all;
}

async function syncSource(db, source) {
  const rawArticles = await fetchAllArticles(source);
  const articles = rawArticles.map((item) => normalizeArticle(source, item));

  const insertStmt = db.prepare(`
    INSERT INTO articles (id, source_id, title, digest, category, link, update_time, author_name)
    VALUES (@id, @source_id, @title, @digest, @category, @link, @update_time, @author_name)
    ON CONFLICT(id) DO UPDATE SET
      title=excluded.title,
      digest=excluded.digest,
      category=excluded.category,
      link=excluded.link,
      update_time=excluded.update_time,
      author_name=excluded.author_name,
      source_id=excluded.source_id
  `);

  const tx = db.transaction((rows) => {
    for (const row of rows) {
      insertStmt.run(row);
    }
    return rows.length;
  });

  const synced = tx(articles);
  return { sourceId: source.id, synced, skipped: false };
}

module.exports = {
  searchPublicAccounts,
  syncSource
};
