/**
 * Tabelog 爬虫：按评分排序抓取高评价餐厅，解析电话+地址。
 * 使用稳定 URL 模板：https://tabelog.com/{area}/rstLst/?SrtT=rt（按评分排序）
 * 频率控制：每页间隔 3–5 秒，User-Agent 伪装浏览器。
 */
const DELAY_MS = 4000;
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/** 城市 key -> Tabelog 区域 slug（8 主城） */
export const TABELOG_AREA = {
  tokyo: 'tokyo',
  osaka: 'osaka',
  kyoto: 'kyoto',
  nagoya: 'aichi',
  kobe: 'hyogo',
  hokkaido: 'hokkaido',
  okinawa: 'okinawa',
  kyushu: 'fukuoka',
};

/** 8 城之外的区域 -> 归入 other，用于爬取横滨/埼玉/千叶/仙台等 */
export const TABELOG_OTHER_AREAS = [
  { area: 'kanagawa', cityZh: '横滨' },
  { area: 'saitama', cityZh: '埼玉' },
  { area: 'chiba', cityZh: '千叶' },
  { area: 'miyagi', cityZh: '仙台' },
  { area: 'hiroshima', cityZh: '广岛' },
];

/**
 * 生成 Tabelog 列表页 URL（按评分排序，高评价优先）
 * @param {string} area - 区域 slug（tokyo/osaka/kyoto 等）
 * @param {number} page - 页码（1-based）
 */
export function buildTabelogListUrl(area, page = 1) {
  const base = 'https://tabelog.com';
  const path = page <= 1 ? `/${area}/rstLst/` : `/${area}/rstLst/${page}/`;
  const params = '?SrtT=rt&Srt=D'; // ランキング、降順
  return base + path + params;
}

/**
 * 从列表页 HTML 提取餐厅链接（店铺详情页，非 dtlrvwlst）
 */
export function extractRestaurantLinksFromList(html, area) {
  const links = new Set();
  // 匹配店铺页：https://tabelog.com/tokyo/A1314/A131401/13136847/ 或 .../13136847/dtlrvwlst/（取前者）
  const re = new RegExp(`https?://tabelog\\.com/(${area}/A\\d+/A\\d+/\\d+)(?:/|$)`, 'gi');
  const reRel = new RegExp(`href=["']/(${area}/A\\d+/A\\d+/\\d+)(?:/|["'])`, 'gi');
  let m;
  while ((m = re.exec(html)) !== null) links.add(`https://tabelog.com/${m[1]}`);
  while ((m = reRel.exec(html)) !== null) links.add(`https://tabelog.com/${m[1]}`);
  return [...links];
}

/**
 * 从列表页 HTML 提取餐厅名（与链接顺序对应较难，这里用简单策略：按块解析）
 * 列表结构：### 数字 店名 后跟链接。我们改为从详情页再取店名。
 */
export function extractNamesFromList(html) {
  const names = [];
  const re = /###\s*\d+\s*([^\n]+?)(?:\s|$)/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const name = m[1].trim();
    if (name && name.length < 100) names.push(name);
  }
  return names;
}

/**
 * 从详情页 HTML 提取电话、地址、店名
 */
export function extractDetailFromHtml(html) {
  const out = { phone: '', address: '', name: '' };
  // 电话：03-xxxx-xxxx, 06-xxxx-xxxx, +81-3-xxxx 等
  const phoneRe = /(?:電話|TEL|tel)[\s:：]*([0-9\-+\(\)\s]{10,20})/i;
  const phoneRe2 = /["']([0-9]{2,4}-[0-9]{2,4}-[0-9]{4})["']/;
  let m = html.match(phoneRe) || html.match(phoneRe2);
  if (m) out.phone = (m[1] || m[0]).replace(/\s/g, '').trim();

  // 地址：都道府県
  const addrRe = /(?:住所|address)[\s:：]*([^\s<"']+[都道府県][^\s<"']{5,80})/i;
  const addrRe2 = /["']([^"']*[都道府県][^"']{5,80})["']/;
  m = html.match(addrRe) || html.match(addrRe2);
  if (m) out.address = (m[1] || '').trim();

  // 店名：og:title 或 meta
  const titleRe = /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i;
  const titleRe2 = /<title>([^<]+?)(?:\s*[-|]\s*[^<]*)?<\/title>/i;
  m = html.match(titleRe) || html.match(titleRe2);
  if (m) out.name = (m[1] || '').replace(/\s*[-|].*$/, '').trim();

  return out;
}

async function fetchWithRetry(url, opts = {}) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url, {
      ...opts,
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'ja,en;q=0.9',
        ...opts.headers,
      },
      signal: controller.signal,
    });
    clearTimeout(t);
    if (!res.ok) return null;
    return await res.text();
  } catch {
    clearTimeout(t);
    return null;
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * 爬取单个城市的高评价餐厅（最多 limit 家）
 * @param {string} cityKey - 城市 key（tokyo/osaka 等）
 * @param {number} limit - 最多抓取数量
 * @returns {Promise<Array<{name,phone,address,tabelog_url,city,cityKey,rating}>>}
 */
export async function crawlTabelogCity(cityKey, limit = 15) {
  const area = TABELOG_AREA[cityKey];
  if (!area) return [];

  const results = [];
  const seenUrls = new Set();
  const cityZhMap = {
    tokyo: '东京',
    osaka: '大阪',
    kyoto: '京都',
    nagoya: '名古屋',
    kobe: '神户',
    hokkaido: '北海道',
    okinawa: '冲绳',
    kyushu: '九州',
  };
  const cityZh = cityZhMap[cityKey] || cityKey;

  for (let page = 1; page <= 3; page++) {
    const listUrl = buildTabelogListUrl(area, page);
    const html = await fetchWithRetry(listUrl);
    if (!html) break;

    const links = extractRestaurantLinksFromList(html, area);
    for (const url of links) {
      if (results.length >= limit) break;
      const norm = url.replace(/\/$/, '');
      if (seenUrls.has(norm)) continue;
      seenUrls.add(norm);

      await sleep(DELAY_MS);
      const detailHtml = await fetchWithRetry(norm);
      if (!detailHtml) continue;

      const detail = extractDetailFromHtml(detailHtml);
      const name = detail.name || norm.split('/').pop() || '';
      if (!name || (!detail.phone && !detail.address)) continue;

      results.push({
        name: name.trim(),
        phone: detail.phone || '',
        address: detail.address || '',
        city: cityZh,
        cityKey,
        tabelog_url: norm,
        call_lang: 'ja',
        feature: 'Tabelog 高评价餐厅',
      });
    }
    await sleep(DELAY_MS);
  }
  return results;
}

/**
 * 爬取「其他」城市（8 城之外的横滨/埼玉/千叶/仙台/广岛等），归入 cityKey=other
 */
export async function crawlTabelogOther(limit = 15) {
  const results = [];
  const perArea = Math.max(2, Math.ceil(limit / TABELOG_OTHER_AREAS.length));
  for (const { area, cityZh } of TABELOG_OTHER_AREAS) {
    const listUrl = buildTabelogListUrl(area, 1);
    const html = await fetchWithRetry(listUrl);
    if (!html) continue;
    const links = extractRestaurantLinksFromList(html, area);
    let count = 0;
    for (const url of links) {
      if (count >= perArea || results.length >= limit) break;
      const norm = url.replace(/\/$/, '');
      await sleep(DELAY_MS);
      const detailHtml = await fetchWithRetry(norm);
      if (!detailHtml) continue;
      const detail = extractDetailFromHtml(detailHtml);
      const name = detail.name || norm.split('/').pop() || '';
      if (!name || (!detail.phone && !detail.address)) continue;
      results.push({
        name: name.trim(),
        phone: detail.phone || '',
        address: detail.address || '',
        city: cityZh,
        cityKey: 'other',
        tabelog_url: norm,
        call_lang: 'ja',
        feature: 'Tabelog 高评价餐厅',
      });
      count++;
    }
    await sleep(DELAY_MS);
  }
  return results;
}
