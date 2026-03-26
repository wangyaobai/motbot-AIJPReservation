/**
 * OpenStreetMap / Overpass API — 免费开源 POI，无需 API Key。
 * 环境变量（可选）：
 *   OVERPASS_API_URL — 默认 https://overpass-api.de/api/interpreter
 */

const DEFAULT_OVERPASS = 'https://overpass-api.de/api/interpreter';

/** south, west, north, east（十进制度） */
export const CITY_BBOX = {
  tokyo: [35.52, 139.38, 35.82, 139.92],
  osaka: [34.45, 135.25, 34.78, 135.65],
  kyoto: [34.92, 135.62, 35.12, 135.88],
  nagoya: [35.05, 136.82, 35.25, 137.05],
  hokkaido: [42.85, 140.95, 43.35, 141.55],
  kobe: [34.62, 135.05, 34.82, 135.35],
  okinawa: [26.15, 127.55, 26.45, 127.85],
  kyushu: [33.45, 130.15, 33.75, 130.55],
};

const USER_AGENT = 'RestaurantBookingBot/1.0 (OSM Overpass; contact: admin)';

function overpassUrl() {
  return (process.env.OVERPASS_API_URL || DEFAULT_OVERPASS).replace(/\/$/, '');
}

function normName(name) {
  return String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function buildAddress(tags) {
  if (!tags) return '';
  if (tags['addr:full']) return String(tags['addr:full']).trim();
  const line = [tags['addr:street'], tags['addr:housenumber']].filter(Boolean).join(' ');
  const city = tags['addr:city'] || tags['addr:province'] || '';
  const parts = [line, city, tags['addr:postcode']].filter(Boolean);
  return parts.join(', ').trim();
}

function buildPhone(tags) {
  if (!tags) return '';
  return (
    tags['contact:phone'] ||
    tags.phone ||
    tags['contact:mobile'] ||
    tags['phone:mobile'] ||
    ''
  ).trim();
}

/** wikimedia_commons 常为 "File:xxx.jpg" */
function imageFromTags(tags) {
  if (!tags) return '';
  const direct = tags.image || tags['image:0'] || '';
  if (direct && /^https?:\/\//i.test(String(direct).trim())) return String(direct).trim();
  const commons = tags.wikimedia_commons || tags.image;
  if (commons && String(commons).startsWith('File:')) {
    const fn = String(commons).replace(/^File:/i, '');
    return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(fn)}?width=800`;
  }
  if (commons && /\.(jpe?g|png|webp)$/i.test(commons)) {
    return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(commons)}?width=800`;
  }
  return '';
}

function coordsFromElement(el) {
  if (el.type === 'node' && el.lat != null && el.lon != null) return { lat: el.lat, lon: el.lon };
  if (el.center && el.center.lat != null) return { lat: el.center.lat, lon: el.center.lon };
  return { lat: null, lon: null };
}

function scoreTags(tags) {
  let s = 0;
  if (buildPhone(tags)) s += 3;
  if (tags.opening_hours) s += 3;
  if (buildAddress(tags)) s += 2;
  if (imageFromTags(tags)) s += 2;
  if (tags.cuisine) s += 1;
  const n = String(tags.name || '').toLowerCase();
  if (tags.amenity === 'fast_food' || /マクドナルド|mcdonald|スターバックス|starbucks|ケンタッキー|kfc|すき家|松屋|吉野家/.test(n)) s -= 4;
  return s;
}

function elementToRestaurant(el, cityKey) {
  const tags = el.tags || {};
  const name = String(tags.name || '').trim();
  if (!name) return null;
  const { lat, lon } = coordsFromElement(el);
  const osmId = el.type === 'relation' ? el.id : el.id;
  const osmType = el.type || 'node';
  return {
    id: `osm_${osmType}_${osmId}`,
    name,
    address: buildAddress(tags),
    phone: buildPhone(tags),
    opening_hours: String(tags.opening_hours || '').trim(),
    image: imageFromTags(tags),
    feature: tags.cuisine ? String(tags.cuisine) : '',
    call_lang: 'ja',
    source: 'osm',
    osm_type: osmType,
    osm_id: String(osmId),
    lat,
    lon,
    google_place_id: '',
    google_rating: 0,
    _score: scoreTags(tags),
  };
}

/** Overpass name~ 正则中的特殊字符转义 */
function escapeOverpassRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 在城市 bbox 内按店名子串搜索餐厅（Overpass name~，不区分大小写）。
 * 返回按「有电话优先、再按完整度」排序的列表，最多 limit 条。
 */
export async function searchRestaurantOSM(restaurantName, cityKey, limit = 10) {
  const bbox = CITY_BBOX[cityKey];
  const raw = String(restaurantName || '').trim().replace(/"/g, '');
  if (!bbox || raw.length < 2) return [];

  const slice = raw.slice(0, 48);
  const pattern = `.*${escapeOverpassRegex(slice)}.*`;
  const [south, west, north, east] = bbox;
  const query = `
[out:json][timeout:45];
(
  node["amenity"="restaurant"]["name"~"${pattern}",i](${south},${west},${north},${east});
  way["amenity"="restaurant"]["name"~"${pattern}",i](${south},${west},${north},${east});
);
out center tags 25;
`.trim();

  try {
    const data = await runOverpass(query);
    const elements = data.elements || [];
    const byNorm = new Map();
    for (const el of elements) {
      const r = elementToRestaurant(el, cityKey);
      if (!r) continue;
      const k = normName(r.name);
      const prev = byNorm.get(k);
      if (!prev || r._score > prev._score || (r.phone && !prev.phone)) byNorm.set(k, r);
    }
    const list = [...byNorm.values()].sort((a, b) => {
      const ap = a.phone ? 1 : 0;
      const bp = b.phone ? 1 : 0;
      if (bp !== ap) return bp - ap;
      return b._score - a._score;
    });
    return list.slice(0, Math.max(limit, 1)).map(({ _score, ...rest }) => rest);
  } catch (e) {
    console.warn('[osm] searchRestaurantOSM failed:', e?.message);
    return [];
  }
}

export async function runOverpass(query) {
  const url = overpassUrl();
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 120000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        'User-Agent': USER_AGENT,
      },
      body: `data=${encodeURIComponent(query)}`,
      signal: controller.signal,
    });
    clearTimeout(t);
    if (!res.ok) throw new Error(`Overpass HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    clearTimeout(t);
    throw e;
  }
}

function poolFromElements(elements, cityKey, maxCount) {
  const byNorm = new Map();
  for (const el of elements) {
    const r = elementToRestaurant(el, cityKey);
    if (!r) continue;
    const k = normName(r.name);
    const prev = byNorm.get(k);
    if (!prev || r._score > prev._score) byNorm.set(k, r);
  }
  const list = [...byNorm.values()].sort((a, b) => b._score - a._score);
  const cap = Math.min(list.length, Math.max(maxCount || 400, 1));
  return list.slice(0, cap).map(({ _score, ...rest }) => rest);
}

/**
 * 拉取城市内 OSM 餐厅池（去重、按完整度排序），供米其林匹配 + 列表填充共用。
 */
export async function fetchOsmRestaurantPool(cityKey, maxCount = 400) {
  const bbox = CITY_BBOX[cityKey];
  if (!bbox) {
    console.warn('[osm] unknown cityKey', cityKey);
    return [];
  }
  const [south, west, north, east] = bbox;
  const query = `
[out:json][timeout:90];
(
  node["amenity"="restaurant"](${south},${west},${north},${east});
  way["amenity"="restaurant"](${south},${west},${north},${east});
  relation["amenity"="restaurant"](${south},${west},${north},${east});
);
out center tags;
`.trim();

  console.log(`[osm] Overpass ${cityKey} bbox…`);
  const data = await runOverpass(query);
  const elements = data.elements || [];
  const pool = poolFromElements(elements, cityKey, maxCount);
  console.log(`[osm] ${cityKey}: ${elements.length} elements -> pool ${pool.length}`);
  return pool;
}

/**
 * 在城市 bbox 内查询餐厅，按完整度打分、去重，返回最多 limit 条。
 */
export async function crawlCityViaOsm(cityKey, limit = 20) {
  const pool = await fetchOsmRestaurantPool(cityKey, 400);
  return pool.slice(0, Math.max(limit, 0));
}

/** 按规范化店名查找 OSM 记录（用于合并米其林） */
export function indexOsmByName(osmList) {
  const map = new Map();
  for (const r of osmList || []) {
    const k = normName(r.name);
    if (!k) continue;
    const prev = map.get(k);
    if (!prev || (r.phone && !prev.phone)) map.set(k, r);
  }
  return map;
}

/** 尝试用 OSM 补全米其林条目（店名精确或互相包含） */
export function findOsmMatchForMichelin(michelinName, osmList) {
  const target = normName(michelinName);
  if (!target) return null;
  const idx = indexOsmByName(osmList);
  if (idx.has(target)) return idx.get(target);
  for (const r of osmList || []) {
    const n = normName(r.name);
    if (!n || n.length < 4 || target.length < 4) continue;
    if (target.includes(n) || n.includes(target)) return r;
  }
  return null;
}
