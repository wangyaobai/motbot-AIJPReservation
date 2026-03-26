/**
 * 爬虫「每城合并」共用逻辑：Wikidata 米其林 + OSM 池匹配 + 无电话补全 + OSM 填充，总量不超过 TARGET。
 * 供 crawlerScheduler 与 refresh-from-crawlers 共用。
 */
import {
  getCityZh,
  filterListByCityKey,
} from './recommendationsStore.js';
import { fetchOsmRestaurantPool, findOsmMatchForMichelin } from './crawlers/openStreetMap.js';
import { enrichRestaurantContact } from './restaurantContactHybrid.js';

/** 含「日本其他地区」other，与 Wikidata 无法归入 8 城的米其林对应 */
export const JP_CRAWLER_CITIES = [
  'tokyo', 'osaka', 'kyoto', 'nagoya', 'kobe', 'hokkaido', 'okinawa', 'kyushu', 'other',
];

/** 每城写入 crawled 的最大条数（米其林优先，余量 OSM 补足） */
export function getCrawlerTargetPerCity() {
  const n = parseInt(process.env.CRAWLER_TARGET_PER_CITY, 10);
  if (Number.isFinite(n) && n >= 5 && n <= 50) return n;
  return 15;
}

function normName(name) {
  return String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * @param {{ cityKey: string, michelinByCity: Record<string, Array<object>>, enrichDelayMs?: number, logPrefix?: string }} opts
 * @returns {Promise<{ list: object[], cityZh: string }>}
 */
export async function buildCrawledListForCity({
  cityKey,
  michelinByCity,
  enrichDelayMs = 400,
  logPrefix = '[crawler-merge]',
} = {}) {
  const TARGET = getCrawlerTargetPerCity();
  const cityZh = getCityZh(cityKey);
  const nameSet = new Set();
  const combined = [];

  let osmPool = [];
  try {
    osmPool = await fetchOsmRestaurantPool(cityKey, 400);
  } catch (e) {
    console.warn(`${logPrefix} OSM pool ${cityKey}:`, e?.message);
  }

  const michelinList = michelinByCity[cityKey] || [];
  for (const m of michelinList) {
    if (combined.length >= TARGET) break;
    const n = normName(m.name);
    if (!n || nameSet.has(n)) continue;
    nameSet.add(n);

    const match = findOsmMatchForMichelin(m.name, osmPool);
    let image = '';
    let phone = m.phone || '';
    let address = m.address || '';
    let opening_hours = '';
    let google_place_id = '';
    let google_rating = 0;
    let osm_type = match?.osm_type || '';
    let osm_id = match?.osm_id || '';
    if (match) {
      phone = match.phone || phone;
      address = match.address || address;
      opening_hours = match.opening_hours || '';
      image = match.image || '';
    }

    if (!String(phone || '').trim()) {
      const extra = await enrichRestaurantContact({ name: m.name, cityKey });
      if (extra) {
        phone = extra.phone || phone;
        if (!address) address = extra.address || '';
        if (!opening_hours) opening_hours = extra.opening_hours || '';
        if (!image) image = extra.image || '';
        if (extra.google_place_id) {
          google_place_id = extra.google_place_id;
          google_rating = extra.google_rating || 0;
        }
        if (extra.osm_id && !osm_id) {
          osm_type = extra.osm_type || '';
          osm_id = extra.osm_id || '';
        }
      }
      await new Promise((r) => setTimeout(r, enrichDelayMs));
    }

    combined.push({
      id: `m_${m.wikidata_id || n.slice(0, 20)}`,
      country: 'jp',
      cityKey,
      name: m.name,
      city: m.city || cityZh,
      phone,
      address,
      image,
      feature: m.feature || '米其林指南',
      call_lang: 'ja',
      source: 'michelin',
      wikidata_id: m.wikidata_id || '',
      google_place_id,
      google_rating,
      opening_hours,
      osm_type,
      osm_id,
    });
  }

  for (const r of osmPool) {
    if (combined.length >= TARGET) break;
    const n = normName(r.name);
    if (!n || nameSet.has(n)) continue;
    nameSet.add(n);
    combined.push({
      ...r,
      country: 'jp',
      cityKey,
      city: cityZh,
    });
  }

  const list = filterListByCityKey(combined, cityKey);
  return { list, cityZh };
}
