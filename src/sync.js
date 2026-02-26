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
  const cheerio = require('cheerio');
  const decodeSogouUrl = (value = '') => {
    if (!value) return '';
    try {
      const parsed = new URL(value, 'https://weixin.sogou.com');
      const jump = parsed.searchParams.get('url') || parsed.searchParams.get('k') || '';
      return jump ? decodeURIComponent(jump) : parsed.toString();
    } catch (_error) {
      return value;
    }
  };

  const normalize = (raw = '') => raw
    .replace(/\s+/g, ' ')
    .replace(/^微信号\s*[：:]\s*/u, '')
    .trim();

  const parseFromHtml = (html) => {
    const $ = cheerio.load(html);
    const results = [];
    const seen = new Set();

    const cards = [
      '.news-box ul.news-list li',
      '.news-box ul.news-list2 li',
      '.gzh-box2 .gzh-box2-list li',
      '.results .txt-box',
      'li[class*="news-list"]',
      '.wx-rb'
    ].join(',');

    $(cards).each((_, el) => {
      const root = $(el);
      const nameLink = root.find('.txt-box h3 a, h3 a, .tit a, a[data-z]')
        .filter((_, a) => Boolean($(a).text().trim()))
        .first();

      const name = normalize(nameLink.text());
      const wechatId = normalize(root.find('.s-p, .info label, p.info, .account').text());
      const description = normalize(root.find('.txt-info, .s-p2, .intro, .sp-txt').text());
      const rawProfile = nameLink.attr('href') || root.find('a[href*="/gzh?"]').attr('href') || '';
      const profileUrl = decodeSogouUrl(rawProfile);

      if (!name) return;

      const id = crypto.createHash('sha1').update(`${name}|${wechatId}|${profileUrl}`).digest('hex').slice(0, 24);
      if (seen.has(id)) return;
      seen.add(id);

      results.push({
        id,
        name,
        wechat_id: wechatId,
        description,
        profile_url: profileUrl,
        feed_url: wechatId ? `https://wechat2rss.xlab.app/feed/${encodeURIComponent(wechatId)}` : null
      });
    });

    return results;
  };

  const urls = [
    `https://weixin.sogou.com/weixin?type=1&ie=utf8&query=${encodeURIComponent(query)}`,
    `https://weixin.sogou.com/weixinwap?ie=utf8&type=1&query=${encodeURIComponent(query)}`
  ];

  const commonHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    Referer: 'https://weixin.sogou.com/',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9'
  };

  for (const url of urls) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const res = await axios.get(url, {
        timeout: 12000,
        maxRedirects: 5,
        headers: commonHeaders
      });

      const list = parseFromHtml(res.data);
      if (list.length) return list.slice(0, 20);
    } catch (_error) {
      // Try next source.
    }
  }

  throw new Error('No public account results from upstream search pages');
}

module.exports = {
  syncSource,
  searchPublicAccounts
};
