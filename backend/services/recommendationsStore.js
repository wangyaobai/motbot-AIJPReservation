/**
 * 推荐列表的读写与 overlay，供 recommendations 路由与 buildPreload 共用。
 */
import { getDb } from '../db.js';
import { getBestCachedMedia } from './resolveRestaurantMedia.js';

const FALLBACK = 'https://images.pexels.com/photos/4106483/pexels-photo-4106483.jpeg';

export function isFallbackImage(url) {
  const u = String(url || '').trim();
  return !u || u.includes('images.pexels.com/photos/4106483/');
}

/** 检测图片 URL 是否因防盗链等原因在用户浏览器端无法显示 */
export function isLikelyBrokenImage(url) {
  const u = String(url || '').trim();
  if (!u) return false;
  try {
    const host = new URL(u).hostname || '';
    if (host.includes('tblg.k-img.com')) return true;
    if (host.includes('tabelog.com')) return true;
  } catch {}
  return false;
}

/** 用户实际能看到图片 = 非兜底图 且 非防盗链图 */
export function isVisibleCover(url) {
  return !isFallbackImage(url) && !isLikelyBrokenImage(url);
}

export function filterToListWithCover(restaurants) {
  const list = Array.isArray(restaurants) ? restaurants : [];
  return list.filter((r) => r && isVisibleCover(r?.image));
}

function recoCacheKey(country, city) {
  return `reco:${String(country || '').toLowerCase()}|${String(city || '').toLowerCase()}`;
}

export const CITY_LABEL_MAP = {
  hokkaido: '北海道',
  tokyo: '东京',
  osaka: '大阪',
  nagoya: '名古屋',
  kyoto: '京都',
  kobe: '神户',
  okinawa: '冲绳',
  kyushu: '九州',
  other: '日本其他地区',
};

/** 与前端 8 个独立 Tab 对应：北海道/东京/大阪/名古屋/京都/神户/冲绳/九州。用于「其他」中排除这 8 城。福冈属九州，冲绳·那霸属冲绳。 */
const MAIN_8_CITY_PREFIXES = [
  '北海道', '札幌',
  '东京', '東京',
  '大阪',
  '名古屋',
  '京都',
  '神户',
  '冲绳', '那霸', '沖縄', '那覇',
  '九州', '福冈', '福岡', '博多',
];

export function isInMain8Cities(cityStr) {
  const s = String(cityStr || '').trim();
  return MAIN_8_CITY_PREFIXES.some((p) => s.startsWith(p));
}

/** 仅保留不属于 8 个主城的餐厅（用于 city=other） */
export function filterOtherCityList(restaurants) {
  const list = Array.isArray(restaurants) ? restaurants : [];
  return list.filter((r) => r && !isInMain8Cities(r?.city));
}

/** 每个城市只允许的 r.city 前缀：福冈/博多→九州，冲绳/那霸→冲绳。含简繁/日文变体。 */
const CITY_KEY_PREFIXES = {
  hokkaido: ['北海道', '札幌'],
  tokyo: ['东京', '東京'],
  osaka: ['大阪'],
  nagoya: ['名古屋'],
  kyoto: ['京都'],
  kobe: ['神户'],
  okinawa: ['冲绳', '那霸', '沖縄', '那覇'],
  kyushu: ['九州', '福冈', '福岡', '博多'],
};

/** 只保留属于该 cityKey 的餐厅（按 r.city 前缀），防止串城 */
export function filterListByCityKey(restaurants, cityKey) {
  const list = Array.isArray(restaurants) ? restaurants : [];
  const key = String(cityKey || '').toLowerCase();
  if (key === 'other') return filterOtherCityList(list);
  const prefixes = CITY_KEY_PREFIXES[key];
  if (!prefixes || !prefixes.length) return list;
  return list.filter((r) => {
    const cityStr = String(r?.city || '').trim();
    return cityStr && prefixes.some((p) => cityStr.startsWith(p));
  });
}

/** 已知图片无法展示的店名（含即匹配），从推荐列表排除，仅作为后台「需人工填图」候选。含简繁/日文变体 */
const NEED_MANUAL_IMAGE_KEYWORDS = ['自由轩', '自由軒'];

export function isNeedManualImageOnly(restaurant) {
  const name = String(restaurant?.name || '').trim();
  return NEED_MANUAL_IMAGE_KEYWORDS.some((keyword) => name.includes(keyword));
}

/** 从推荐列表中排除「仅人工填图」的店，避免前端展示裂图 */
export function excludeNeedManualImageOnly(restaurants) {
  const list = Array.isArray(restaurants) ? restaurants : [];
  return list.filter((r) => r && !isNeedManualImageOnly(r));
}

export function getCityZh(cityKey) {
  return CITY_LABEL_MAP[String(cityKey || '').toLowerCase()] || cityKey || '东京';
}

export function readBestRecommendations({ country, cityKey } = {}) {
  try {
    const db = getDb();
    const key = recoCacheKey(country, cityKey);
    const row = db
      .prepare('SELECT restaurants_json, city_zh, updated_at FROM recommendations_best WHERE cache_key = ?')
      .get(key);
    if (!row?.restaurants_json) return null;
    const arr = JSON.parse(row.restaurants_json);
    if (!Array.isArray(arr) || arr.length === 0) return null;
    return {
      restaurants: arr,
      cityZh: typeof row.city_zh === 'string' ? row.city_zh : getCityZh(cityKey),
      updatedAt: row.updated_at || '',
    };
  } catch {
    return null;
  }
}

export function writeBestRecommendations({ country, cityKey, cityZh, restaurants } = {}) {
  try {
    const db = getDb();
    const key = recoCacheKey(country, cityKey);
    const payload = Array.isArray(restaurants) ? restaurants : [];
    const zh = String(cityZh || getCityZh(cityKey)).trim();
    db.prepare(
      `INSERT INTO recommendations_best (cache_key, country, city_key, city_zh, restaurants_json, updated_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(cache_key) DO UPDATE SET
         country = excluded.country,
         city_key = excluded.city_key,
         city_zh = excluded.city_zh,
         restaurants_json = excluded.restaurants_json,
         updated_at = datetime('now')`
    ).run(key, String(country || '').toLowerCase(), String(cityKey || '').toLowerCase(), zh, JSON.stringify(payload));
  } catch {}
}

export function applyBestMediaOverlay({ restaurants, cityZh } = {}) {
  const list = Array.isArray(restaurants) ? restaurants : [];
  const cityHint = String(cityZh || '').trim();
  const out = list.map((r) => ({ ...r }));
  for (const r of out) {
    const best = getBestCachedMedia({ cityHint, name: r?.name });
    if (best?.image_url && !isFallbackImage(best.image_url)) r.image = best.image_url;
    if (best?.manual_image_url && best.manual_enabled !== 0) r.image = best.manual_image_url;
    if (best?.tabelog_url && !r.tabelog_url) r.tabelog_url = best.tabelog_url;
    if (best?.yelp_url && !r.yelp_url) r.yelp_url = best.yelp_url;
    if (best?.official_url && !r.official_url) r.official_url = best.official_url;
    if (best?.wikipedia_url && !r.wikipedia_url) r.wikipedia_url = best.wikipedia_url;
    if (best?.manual_image_url && !r.manual_image_url) r.manual_image_url = best.manual_image_url;
    if (typeof best?.manual_enabled !== 'undefined' && typeof r.manual_enabled === 'undefined') r.manual_enabled = best.manual_enabled;
  }
  return out;
}

/** 冲绳·那霸均属冲绳（含日文 沖縄/那覇） */
const OKINAWA_PREFIXES = ['冲绳', '那霸', '沖縄', '那覇'];

function isOkinawaRestaurant(r) {
  const s = String(r?.city || '').trim();
  return OKINAWA_PREFIXES.some((p) => s.startsWith(p));
}

function normNameForDedup(name) {
  return String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * 从 other 的预加载列表中移出冲绳餐厅，写入 okinawa 的预加载列表；other 只保留非冲绳。
 * @returns {{ moved: number, otherLeft: number, okinawaTotal: number }}
 */
export function moveOkinawaFromOtherToOkinawa() {
  const db = getDb();
  const otherKey = recoCacheKey('jp', 'other');
  const okinawaKey = recoCacheKey('jp', 'okinawa');
  const otherRow = db.prepare('SELECT restaurants_json, city_zh FROM recommendations_best WHERE cache_key = ?').get(otherKey);
  if (!otherRow?.restaurants_json) return { moved: 0, otherLeft: 0, okinawaTotal: 0 };

  let otherList = [];
  try {
    otherList = JSON.parse(otherRow.restaurants_json);
  } catch {
    return { moved: 0, otherLeft: 0, okinawaTotal: 0 };
  }
  if (!Array.isArray(otherList)) return { moved: 0, otherLeft: 0, okinawaTotal: 0 };

  const okinawaInOther = otherList.filter((r) => r && isOkinawaRestaurant(r));
  const otherRest = otherList.filter((r) => r && !isOkinawaRestaurant(r));
  const moved = okinawaInOther.length;
  if (moved === 0) {
    return { moved: 0, otherLeft: otherRest.length, okinawaTotal: 0 };
  }

  writeBestRecommendations({
    country: 'jp',
    cityKey: 'other',
    cityZh: otherRow.city_zh || getCityZh('other'),
    restaurants: otherRest,
  });

  const okinawaRow = db.prepare('SELECT restaurants_json, city_zh FROM recommendations_best WHERE cache_key = ?').get(okinawaKey);
  let okinawaList = [];
  if (okinawaRow?.restaurants_json) {
    try {
      okinawaList = JSON.parse(okinawaRow.restaurants_json);
    } catch {}
  }
  if (!Array.isArray(okinawaList)) okinawaList = [];
  const existingNames = new Set(okinawaList.map((r) => normNameForDedup(r?.name)));
  for (const r of okinawaInOther) {
    if (!r?.name) continue;
    if (existingNames.has(normNameForDedup(r.name))) continue;
    existingNames.add(normNameForDedup(r.name));
    okinawaList.push(r);
  }
  const okinawaFinal = okinawaList.slice(0, 10);
  writeBestRecommendations({
    country: 'jp',
    cityKey: 'okinawa',
    cityZh: okinawaRow?.city_zh || getCityZh('okinawa'),
    restaurants: okinawaFinal,
  });

  return { moved, otherLeft: otherRest.length, okinawaTotal: okinawaFinal.length };
}

/** 备份 recommendations_best 到 recommendations_fallback（兜底数据） */
export function backupToFallback() {
  const db = getDb();
  const rows = db.prepare(
    'SELECT cache_key, country, city_key, city_zh, restaurants_json FROM recommendations_best WHERE country = ?'
  ).all('jp');
  let count = 0;
  for (const r of rows) {
    db.prepare(
      `INSERT INTO recommendations_fallback (cache_key, country, city_key, city_zh, restaurants_json, updated_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(cache_key) DO UPDATE SET
         country = excluded.country,
         city_key = excluded.city_key,
         city_zh = excluded.city_zh,
         restaurants_json = excluded.restaurants_json,
         updated_at = datetime('now')`
    ).run(r.cache_key, r.country, r.city_key, r.city_zh, r.restaurants_json);
    count += 1;
  }
  return count;
}

/** 写入爬取数据到 recommendations_crawled，并标记每家的 has_cover */
export function writeCrawledRecommendations({ country, cityKey, cityZh, restaurants } = {}) {
  const db = getDb();
  const key = recoCacheKey(country || 'jp', cityKey);
  const list = Array.isArray(restaurants) ? restaurants : [];
  const withCoverFlag = list.map((r) => ({
    ...r,
    has_cover: !!(r?.image && !isFallbackImage(r.image)),
  }));
  const zh = String(cityZh || getCityZh(cityKey)).trim();
  db.prepare(
    `INSERT INTO recommendations_crawled (cache_key, country, city_key, city_zh, restaurants_json, crawled_at, updated_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
     ON CONFLICT(cache_key) DO UPDATE SET
       city_zh = excluded.city_zh,
       restaurants_json = excluded.restaurants_json,
       updated_at = datetime('now')`
  ).run(key, String(country || 'jp').toLowerCase(), String(cityKey || '').toLowerCase(), zh, JSON.stringify(withCoverFlag));
}

/** 读取兜底数据 */
export function readFallbackRecommendations({ country, cityKey } = {}) {
  try {
    const db = getDb();
    const key = recoCacheKey(country || 'jp', cityKey);
    const row = db
      .prepare('SELECT restaurants_json, city_zh, updated_at FROM recommendations_fallback WHERE cache_key = ?')
      .get(key);
    if (!row?.restaurants_json) return null;
    const arr = JSON.parse(row.restaurants_json);
    if (!Array.isArray(arr) || arr.length === 0) return null;
    return {
      restaurants: arr,
      cityZh: typeof row.city_zh === 'string' ? row.city_zh : getCityZh(cityKey),
      updatedAt: row.updated_at || '',
    };
  } catch {
    return null;
  }
}

function normalizeNameForMatch(name) {
  return String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

export function deleteFromBest({ country, cityKey, name } = {}) {
  const db = getDb();
  const key = recoCacheKey(country || 'jp', cityKey);
  const row = db.prepare('SELECT restaurants_json, city_zh FROM recommendations_best WHERE cache_key = ?').get(key);
  if (!row?.restaurants_json) return false;
  const arr = JSON.parse(row.restaurants_json);
  const target = normalizeNameForMatch(name);
  const filtered = arr.filter((r) => normalizeNameForMatch(r.name) !== target);
  if (filtered.length === arr.length) return false;
  db.prepare('UPDATE recommendations_best SET restaurants_json = ?, updated_at = datetime(\'now\') WHERE cache_key = ?')
    .run(JSON.stringify(filtered), key);
  return true;
}

export function deleteFromFallback({ country, cityKey, name } = {}) {
  const db = getDb();
  const key = recoCacheKey(country || 'jp', cityKey);
  const row = db.prepare('SELECT restaurants_json, city_zh FROM recommendations_fallback WHERE cache_key = ?').get(key);
  if (!row?.restaurants_json) return false;
  const arr = JSON.parse(row.restaurants_json);
  const target = normalizeNameForMatch(name);
  const filtered = arr.filter((r) => normalizeNameForMatch(r.name) !== target);
  if (filtered.length === arr.length) return false;
  db.prepare('UPDATE recommendations_fallback SET restaurants_json = ?, updated_at = datetime(\'now\') WHERE cache_key = ?')
    .run(JSON.stringify(filtered), key);
  return true;
}

export function deleteFromCrawled({ country, cityKey, name } = {}) {
  const db = getDb();
  const key = recoCacheKey(country || 'jp', cityKey);
  const row = db.prepare('SELECT restaurants_json FROM recommendations_crawled WHERE cache_key = ?').get(key);
  if (!row?.restaurants_json) return false;
  const arr = JSON.parse(row.restaurants_json);
  const target = normalizeNameForMatch(name);
  const filtered = arr.filter((r) => normalizeNameForMatch(r.name) !== target);
  if (filtered.length === arr.length) return false;
  db.prepare('UPDATE recommendations_crawled SET restaurants_json = ?, updated_at = datetime(\'now\') WHERE cache_key = ?')
    .run(JSON.stringify(filtered), key);
  return true;
}

/** 读取爬取数据 */
export function readCrawledRecommendations({ country, cityKey } = {}) {
  try {
    const db = getDb();
    const key = recoCacheKey(country || 'jp', cityKey);
    const row = db
      .prepare('SELECT restaurants_json, city_zh, crawled_at, updated_at FROM recommendations_crawled WHERE cache_key = ?')
      .get(key);
    if (!row?.restaurants_json) return null;
    const arr = JSON.parse(row.restaurants_json);
    if (!Array.isArray(arr)) return null;
    return {
      restaurants: arr,
      cityZh: typeof row.city_zh === 'string' ? row.city_zh : getCityZh(cityKey),
      crawledAt: row.crawled_at || '',
      updatedAt: row.updated_at || '',
    };
  } catch {
    return null;
  }
}
