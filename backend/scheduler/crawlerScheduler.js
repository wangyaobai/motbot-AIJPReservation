/**
 * 每周自动执行爬虫调度器。
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
const JP_CITIES = ['tokyo', 'osaka', 'kyoto', 'nagoya', 'kobe', 'hokkaido', 'okinawa', 'kyushu', 'other'];
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

function normalizeKey(s) {
  return String(s || '').trim().replace(/\s*[\(（][^\)）]*[\)）]\s*/g, ' ').replace(/\s{2,}/g, ' ').trim();
}

export async function runCrawlerJob() {
  if (crawlerState.running) {
    console.log('[crawler-scheduler] 爬虫正在运行中，跳过');
    return { ok: false, message: '爬虫正在运行中' };
  }
  crawlerState.running = true;
  crawlerState.lastError = null;
  const startedAt = new Date().toISOString();
  console.log('[crawler-scheduler] 开始执行爬虫（仅写入 crawled，需后台确认后进入前端）…');

  try {
    ensureSchema();

    const { crawlTabelogCity, crawlTabelogOther } = await import('../services/crawlers/tabelog.js');
    const { queryMichelinRestaurantsJapan } = await import('../services/crawlers/wikidata-michelin.js');
    const { resolveRestaurantMediaBatch } = await import('../services/resolveRestaurantMedia.js');

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
        let crawled = [];
        if (cityKey === 'other') {
          crawled = await crawlTabelogOther(TARGET);
        } else {
          crawled = await crawlTabelogCity(cityKey, TARGET);
        }

        const michelinList = michelinByCity[cityKey] || [];
        const nameSet = new Set(crawled.map((r) => normName(r.name)));
        for (const m of michelinList) {
          const n = normName(m.name);
          if (!n || nameSet.has(n)) continue;
          nameSet.add(n);
          crawled.push({
            name: m.name, phone: m.phone || '', address: m.address || '',
            city: m.city || cityZh, cityKey, wikidata_id: m.wikidata_id || '',
            feature: m.feature || '米其林指南', call_lang: 'ja',
          });
        }

        if (crawled.length === 0) { allResults.push({ cityKey, count: 0 }); continue; }

        let list = crawled.map((r) => ({
          id: `${cityKey}-${normName(r.name).slice(0, 20)}`,
          country: 'jp', cityKey, name: r.name, city: r.city || cityZh,
          phone: r.phone || '', address: r.address || '',
          feature: r.feature || '高评价餐厅', call_lang: r.call_lang || 'ja',
          image: '', tabelog_url: r.tabelog_url || '', wikidata_id: r.wikidata_id || '',
        }));

        list = filterListByCityKey(list, cityKey);
        if (cityKey === 'other') list = filterOtherCityList(list);

        try {
          const mediaMap = await resolveRestaurantMediaBatch({ cityZh, restaurants: list, budgetMs: 12000 });
          for (const r of list) {
            const m = mediaMap.get(normalizeKey(r.name));
            if (m?.image_url && !isFallbackImage(m.image_url)) r.image = m.image_url;
            if (m?.tabelog_url && !r.tabelog_url) r.tabelog_url = m.tabelog_url;
          }
        } catch (e) {
          console.warn('[crawler-scheduler] 补图失败', cityKey, e?.message);
        }

        writeCrawledRecommendations({ country: 'jp', cityKey, cityZh, restaurants: list });
        allResults.push({ cityKey, crawled: list.length });
        console.log('[crawler-scheduler]', cityKey, '爬取', list.length, '家 -> 已入库 crawled');

        await new Promise((r) => setTimeout(r, 3000));
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
