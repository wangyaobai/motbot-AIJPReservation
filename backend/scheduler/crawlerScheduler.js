/**
 * 每周自动执行爬虫调度器。
 * 数据源：Wikidata 米其林 + OpenStreetMap（Overpass API，免费）。
 * 爬取数据只写入 recommendations_crawled，不自动合并到 recommendations_best。
 * 需管理员在后台审核后手动确认才进入前端展示。
 *
 * 可通过 DISABLE_CRAWLER_SCHEDULER=1 关闭。
 * 可通过 CRAWLER_SCHEDULE_DAY=0-6 设置星期几（0=周日，默认0）。
 * 可通过 CRAWLER_SCHEDULE_HOUR=0-23 设置几点（默认3）。
 * 可选 OVERPASS_API_URL 指定 Overpass 实例。
 */
import { ensureSchema } from '../db.js';
import {
  getCityZh,
  filterListByCityKey,
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
  console.log('[crawler-scheduler] 开始执行爬虫（Wikidata 米其林 + OpenStreetMap）…');

  try {
    ensureSchema();

    const { queryMichelinRestaurantsJapan } = await import('../services/crawlers/wikidata-michelin.js');
    const { fetchOsmRestaurantPool, findOsmMatchForMichelin } = await import('../services/crawlers/openStreetMap.js');

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

        let osmPool = [];
        try {
          osmPool = await fetchOsmRestaurantPool(cityKey, 400);
        } catch (e) {
          console.warn(`[crawler-scheduler] OSM pool ${cityKey}:`, e?.message);
        }

        // 米其林餐厅排前面 (source: "michelin")，用 OSM 同店名匹配补电话/地址/营业时间/图
        const michelinList = michelinByCity[cityKey] || [];
        for (const m of michelinList) {
          const n = normName(m.name);
          if (!n || nameSet.has(n)) continue;
          nameSet.add(n);

          const match = findOsmMatchForMichelin(m.name, osmPool);
          let image = '';
          let phone = m.phone || '';
          let address = m.address || '';
          let opening_hours = '';
          if (match) {
            phone = match.phone || phone;
            address = match.address || address;
            opening_hours = match.opening_hours || '';
            image = match.image || '';
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
            google_place_id: '',
            google_rating: 0,
            opening_hours,
            osm_type: match?.osm_type || '',
            osm_id: match?.osm_id || '',
          });
        }

        // OSM 餐厅按完整度排序填充剩余名额 (source: "osm")
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
