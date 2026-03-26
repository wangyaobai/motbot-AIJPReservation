/**
 * 每周自动执行爬虫调度器。
 * 数据源：Wikidata 米其林 + Google Places API（替代 Tabelog）。
 * 爬取数据只写入 recommendations_crawled，不自动合并到 recommendations_best。
 * 需管理员在后台审核后手动确认才进入前端展示。
 *
 * 可通过 DISABLE_CRAWLER_SCHEDULER=1 关闭。
 * 可通过 CRAWLER_SCHEDULE_DAY=0-6 设置星期几（0=周日，默认0）。
 * 可通过 CRAWLER_SCHEDULE_HOUR=0-23 设置几点（默认3）。
 */
import { ensureSchema } from '../db.js';
import {
  getCityZh,
  filterListByCityKey,
  filterOtherCityList,
  isFallbackImage,
  writeCrawledRecommendations,
} from '../services/recommendationsStore.js';

const CHECK_INTERVAL_MS = 30 * 60 * 1000;
const JP_CITIES = ['tokyo', 'osaka', 'kyoto', 'nagoya', 'kobe', 'hokkaido', 'okinawa', 'kyushu'];
const TARGET = 15;

export const crawlerState = {
  running: false,
  lastRunAt: null,
  lastResult: null,
  lastError: null,
  scheduledDay: parseInt(process.env.CRAWLER_SCHEDULE_DAY, 10) || 0,
  scheduledHour: parseInt(process.env.CRAWLER_SCHEDULE_HOUR, 10) || 3,
};

let lastScheduledDate = null;

function normName(name) {
  return String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

export async function runCrawlerJob() {
  if (crawlerState.running) {
    console.log('[crawler-scheduler] 爬虫正在运行中，跳过');
    return { ok: false, message: '爬虫正在运行中' };
  }
  crawlerState.running = true;
  crawlerState.lastError = null;
  const startedAt = new Date().toISOString();
  console.log('[crawler-scheduler] 开始执行爬虫（Wikidata 米其林 + Google Places）…');

  const useGoogle = !!process.env.GOOGLE_PLACES_API_KEY;

  try {
    ensureSchema();

    const { queryMichelinRestaurantsJapan } = await import('../services/crawlers/wikidata-michelin.js');

    let crawlCityViaGoogle = null;
    let getPlaceDetails = null;
    let downloadPhoto = null;
    if (useGoogle) {
      const gp = await import('../services/crawlers/googlePlaces.js');
      crawlCityViaGoogle = gp.crawlCityViaGoogle;
      getPlaceDetails = gp.getPlaceDetails;
      downloadPhoto = gp.downloadPhoto;
    }

    // 1. Wikidata 米其林餐厅名单
    let michelinByCity = {};
    try {
      const michelin = await queryMichelinRestaurantsJapan(150);
      for (const r of michelin) {
        const k = r.cityKey || 'other';
        if (!michelinByCity[k]) michelinByCity[k] = [];
        michelinByCity[k].push(r);
      }
      console.log('[crawler-scheduler] Wikidata 米其林', michelin.length, '家');
    } catch (e) {
      console.warn('[crawler-scheduler] Wikidata 失败', e?.message);
    }

    const allResults = [];

    for (const cityKey of JP_CITIES) {
      try {
        const cityZh = getCityZh(cityKey);
        const nameSet = new Set();
        const combined = [];

        // 米其林餐厅排前面 (source: "michelin")
        const michelinList = michelinByCity[cityKey] || [];
        for (const m of michelinList) {
          const n = normName(m.name);
          if (!n || nameSet.has(n)) continue;
          nameSet.add(n);

          let image = '';
          let phone = m.phone || '';
          let address = m.address || '';
          let opening_hours = '';
          let google_place_id = '';
          let google_rating = 0;

          // 用 Google Places 补充米其林餐厅的详细信息和照片
          if (useGoogle) {
            try {
              const { searchRestaurants } = await import('../services/crawlers/googlePlaces.js');
              const hits = await searchRestaurants(cityKey, `${m.name} restaurant ${cityZh}`, 1);
              if (hits.length > 0) {
                const hit = hits[0];
                google_place_id = hit.place_id;
                const details = await getPlaceDetails(hit.place_id);
                if (details) {
                  phone = details.phone || phone;
                  address = details.address || address;
                  opening_hours = details.opening_hours || '';
                  google_rating = details.rating || 0;
                  const photoRef = details.photo_reference || hit.photo_reference;
                  if (photoRef) {
                    image = await downloadPhoto(photoRef, `michelin_${cityKey}_${hit.place_id}`);
                  }
                }
              }
            } catch (e) {
              console.warn(`[crawler-scheduler] Google lookup for michelin ${m.name}:`, e?.message);
            }
          }

          combined.push({
            id: `m_${m.wikidata_id || normName(m.name).slice(0, 20)}`,
            country: 'jp', cityKey,
            name: m.name, city: m.city || cityZh,
            phone, address, image,
            feature: m.feature || '米其林指南',
            call_lang: 'ja',
            source: 'michelin',
            wikidata_id: m.wikidata_id || '',
            google_place_id,
            google_rating,
            opening_hours,
          });
        }

        // Google Places 高评分餐厅填充 (source: "google")
        if (useGoogle) {
          const remaining = Math.max(0, TARGET - combined.length);
          if (remaining > 0) {
            try {
              const googleList = await crawlCityViaGoogle(cityKey, remaining + 5);
              for (const g of googleList) {
                if (combined.length >= TARGET) break;
                const n = normName(g.name);
                if (nameSet.has(n)) continue;
                nameSet.add(n);
                combined.push({
                  ...g,
                  country: 'jp',
                  cityKey,
                  city: cityZh,
                });
              }
            } catch (e) {
              console.warn(`[crawler-scheduler] Google Places for ${cityKey}:`, e?.message);
            }
          }
        }

        if (combined.length === 0) {
          allResults.push({ cityKey, count: 0 });
          continue;
        }

        let list = filterListByCityKey(combined, cityKey);

        writeCrawledRecommendations({ country: 'jp', cityKey, cityZh, restaurants: list });
        allResults.push({ cityKey, crawled: list.length });
        console.log('[crawler-scheduler]', cityKey, '爬取', list.length, '家 -> 已入库 crawled');

        await new Promise((r) => setTimeout(r, 1000));
      } catch (e) {
        console.error('[crawler-scheduler]', cityKey, 'error:', e?.message);
        allResults.push({ cityKey, count: 0, error: e?.message });
      }
    }

    crawlerState.lastRunAt = startedAt;
    crawlerState.lastResult = allResults;
    crawlerState.running = false;
    console.log('[crawler-scheduler] 爬虫完成，等待后台审核确认', allResults);
    return { ok: true, results: allResults };
  } catch (e) {
    crawlerState.lastError = e?.message || String(e);
    crawlerState.running = false;
    console.error('[crawler-scheduler] 爬虫失败', e);
    return { ok: false, message: e?.message };
  }
}

export function startCrawlerScheduler() {
  console.log(`[crawler-scheduler] 已启动，计划每周${crawlerState.scheduledDay === 0 ? '日' : crawlerState.scheduledDay}凌晨${crawlerState.scheduledHour}:00 执行`);

  setInterval(() => {
    const now = new Date();
    const day = now.getDay();
    const hour = now.getHours();
    const dateStr = now.toISOString().slice(0, 10);

    if (day === crawlerState.scheduledDay && hour === crawlerState.scheduledHour && lastScheduledDate !== dateStr) {
      lastScheduledDate = dateStr;
      console.log('[crawler-scheduler] 定时触发爬虫');
      runCrawlerJob().catch((e) => console.error('[crawler-scheduler] job error', e));
    }
  }, CHECK_INTERVAL_MS);
}
