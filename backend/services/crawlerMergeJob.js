/**
 * 爬虫「每城合并」共用逻辑：Wikidata 米其林 + 可选 Tabelog 高分槽位 + OSM 池 + 无电话补全，总量不超过 TARGET。
 * 供 crawlerScheduler 与 refresh-from-crawlers 共用。
 */
import {
  getCityZh,
  filterListByCityKey,
} from './recommendationsStore.js';
import { fetchOsmRestaurantPool, findOsmMatchForMichelin } from './crawlers/openStreetMap.js';
import { enrichRestaurantContact } from './restaurantContactHybrid.js';
import { normalizeCrawledList, refineCrawledListWithDeepSeek } from './crawlDataNormalizer.js';

/** 含「日本其他地区」other，与 Wikidata 无法归入 8 城的米其林对应 */
export const JP_CRAWLER_CITIES = [
  'tokyo', 'osaka', 'kyoto', 'nagoya', 'kobe', 'hokkaido', 'okinawa', 'kyushu', 'other',
];

/** 每城写入 crawled 的最大条数（米其林优先，可选 Tabelog，余量 OSM） */
export function getCrawlerTargetPerCity() {
  const n = parseInt(process.env.CRAWLER_TARGET_PER_CITY, 10);
  if (Number.isFinite(n) && n >= 5 && n <= 50) return n;
  return 15;
}

function normName(name) {
  return String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

async function appendTabelogSlots({ cityKey, combined, nameSet, TARGET, logPrefix }) {
  if (process.env.CRAWLER_INCLUDE_TABELOG !== '1') return;
  const slots = Math.max(0, TARGET - combined.length);
  if (slots <= 0) return;

  const maxT = Math.min(5, slots);
  try {
    const { crawlTabelogCity, crawlTabelogOther } = await import('./crawlers/tabelog.js');
    const rows =
      cityKey === 'other'
        ? await crawlTabelogOther(maxT)
        : await crawlTabelogCity(cityKey, maxT);

    for (const row of rows || []) {
      if (combined.length >= TARGET) break;
      const n = normName(row.name);
      if (!n || nameSet.has(n)) continue;
      nameSet.add(n);
      combined.push({
        id: `t_${n.replace(/[^a-z0-9]/g, '').slice(0, 24) || 'x'}_${row.tabelog_url?.split('/').filter(Boolean).pop() || '0'}`,
        country: 'jp',
        cityKey,
        city: row.city || getCityZh(cityKey),
        name: row.name,
        phone: row.phone || '',
        address: row.address || '',
        image: '',
        opening_hours: '',
        feature: row.feature || 'Tabelog 高评价餐厅',
        recommend_reason: 'Tabelog 高评分口碑店',
        call_lang: 'ja',
        source: 'tabelog',
        source_platform: 'tabelog',
        tabelog_url: row.tabelog_url || '',
        rating_summary: 'Tabelog 收录',
        data_sources: ['Tabelog'],
        wikidata_id: '',
        google_place_id: '',
        google_rating: 0,
        osm_type: '',
        osm_id: '',
        review_snippet: '',
      });
    }
    console.log(`${logPrefix} Tabelog +${Math.min(rows?.length || 0, maxT)} 候选（实际入列以去重后为准）`);
  } catch (e) {
    console.warn(`${logPrefix} Tabelog 补充失败`, e?.message);
  }
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

    const feat = m.feature || '米其林指南';
    combined.push({
      id: `m_${m.wikidata_id || n.slice(0, 20)}`,
      country: 'jp',
      cityKey,
      name: m.name,
      city: m.city || cityZh,
      phone,
      address,
      image,
      feature: feat,
      recommend_reason: feat,
      review_snippet: '',
      call_lang: 'ja',
      source: 'michelin',
      source_platform: 'wikidata_michelin',
      data_sources: ['Wikidata', '米其林'],
      wikidata_id: m.wikidata_id || '',
      google_place_id,
      google_rating,
      opening_hours,
      osm_type,
      osm_id,
      rating_summary: michelinList.length ? '米其林指南收录' : '',
    });
  }

  await appendTabelogSlots({ cityKey, combined, nameSet, TARGET, logPrefix });

  for (const r of osmPool) {
    if (combined.length >= TARGET) break;
    const n = normName(r.name);
    if (!n || nameSet.has(n)) continue;
    nameSet.add(n);
    const cuisine = r.feature || '';
    const reason = cuisine ? `OpenStreetMap·${cuisine}` : 'OpenStreetMap 收录餐厅';
    combined.push({
      ...r,
      country: 'jp',
      cityKey,
      city: cityZh,
      source_platform: 'osm',
      recommend_reason: reason,
      review_snippet: r.review_snippet || '',
      rating_summary: r.google_rating ? `Google ${r.google_rating}` : '',
      data_sources: ['OpenStreetMap'],
    });
  }

  let list = filterListByCityKey(combined, cityKey);
  list = normalizeCrawledList(list);
  list = await refineCrawledListWithDeepSeek(list, cityZh);
  list = normalizeCrawledList(list);

  return { list, cityZh };
}
