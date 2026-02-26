const axios = require('axios');
const { getApiBase, getFetchSize, getHeaders } = require('./config');

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
  const size = getFetchSize();
  let begin = 0;

  while (true) {
    // eslint-disable-next-line no-await-in-loop
    const res = await axios.get(`${getApiBase()}/article`, {
      headers: getHeaders(),
      params: { fakeid: source.id, size, begin },
      timeout: 20000
    });

    if (res.data?.base_resp?.ret !== 0) {
      throw new Error(res.data?.base_resp?.err_msg || 'article sync failed');
    }

    const batch = res.data.articles || [];
    all.push(...batch);

    if (!batch.length || batch.length < size) break;
    begin += batch.length;
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
