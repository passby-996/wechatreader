const axios = require('axios');
const Parser = require('rss-parser');
const crypto = require('crypto');

const parser = new Parser({ timeout: 15000 });

function detectFeedUrl(source) {
  if (source.feed_url) return source.feed_url;
  if (source.wechat_id) {
    return `https://wechat2rss.xlab.app/feed/${encodeURIComponent(source.wechat_id)}`;
  }
  return null;
}

function mapItem(source, item) {
  const title = item.title || 'Untitled';
  const description = item.contentSnippet || item.summary || '';
  const link = item.link || source.profile_url || '#';
  const updateTime = item.isoDate || item.pubDate || new Date().toISOString();
  const category = (item.categories && item.categories[0]) || 'Uncategorized';
  const authorName = item.creator || item.author || source.name;
  const idSeed = `${source.id}|${link}|${title}`;
  const id = crypto.createHash('sha1').update(idSeed).digest('hex');

  return {
    id,
    source_id: source.id,
    title,
    description,
    category,
    link,
    update_time: new Date(updateTime).toISOString(),
    author_name: authorName
  };
}

async function syncSource(db, source) {
  const feedUrl = detectFeedUrl(source);
  if (!feedUrl) {
    return { sourceId: source.id, synced: 0, skipped: true, reason: 'No feed URL or wechat_id' };
  }

  const feed = await parser.parseURL(feedUrl);
  const items = feed.items || [];
  const insertStmt = db.prepare(`
    INSERT INTO articles (id, source_id, title, description, category, link, update_time, author_name)
    VALUES (@id, @source_id, @title, @description, @category, @link, @update_time, @author_name)
    ON CONFLICT(id) DO UPDATE SET
      title=excluded.title,
      description=excluded.description,
      category=excluded.category,
      link=excluded.link,
      update_time=excluded.update_time,
      author_name=excluded.author_name
  `);

  const tx = db.transaction((rows) => {
    let synced = 0;
    for (const row of rows) {
      insertStmt.run(row);
      synced += 1;
    }
    return synced;
  });

  const normalized = items.map((item) => mapItem(source, item));
  const synced = tx(normalized);

  return { sourceId: source.id, synced, skipped: false };
}

async function searchPublicAccounts(query) {
  const url = `https://weixin.sogou.com/weixin?type=1&query=${encodeURIComponent(query)}`;
  const res = await axios.get(url, {
    timeout: 10000,
    headers: {
      'User-Agent': 'Mozilla/5.0',
      Referer: 'https://weixin.sogou.com/'
    }
  });

  const cheerio = require('cheerio');
  const $ = cheerio.load(res.data);
  const results = [];

  $('.news-box ul.news-list2 li').each((_, el) => {
    const name = $(el).find('.txt-box h3 a').text().trim();
    const profilePath = $(el).find('.txt-box h3 a').attr('href') || '';
    const wechatId = $(el).find('.s-p').text().replace('微信号：', '').trim();
    const description = $(el).find('.txt-info').text().trim();
    const profileUrl = profilePath.startsWith('http') ? profilePath : `https://weixin.sogou.com${profilePath}`;

    if (name) {
      results.push({
        id: crypto.createHash('sha1').update(`${name}|${wechatId}|${profileUrl}`).digest('hex').slice(0, 24),
        name,
        wechat_id: wechatId,
        description,
        profile_url: profileUrl,
        feed_url: wechatId ? `https://wechat2rss.xlab.app/feed/${encodeURIComponent(wechatId)}` : null
      });
    }
  });

  return results.slice(0, 20);
}

module.exports = {
  syncSource,
  searchPublicAccounts
};
