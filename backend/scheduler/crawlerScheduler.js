/**
 * 每周自动执行爬虫调度器。
 * 数据源：Wikidata 米其林 + OpenStreetMap（Overpass API，免费）。
 * 爬取数据只写入 recommendations_crawled，不自动合并到 recommendations_best。
 * 需管理员在后台审核后手动确认才进入前端展示。
 *
 * 可通过 DISABLE_CRAWLER_SCHEDULER=1 关闭。
 * 可通过 CRAWLER_SCHEDULE_DAY=0-6 设置星期几（0=周日，默认0）。
 * 可通过 CRAWLER_SCHEDULE_HOUR=0-23 设置几点（默认3）。
 * 可选 OVERPASS_API_URL、OVERPASS_MAX_RETRIES、CRAWLER_TARGET_PER_CITY（默认每城最多 15 条）。
 */
import { ensureSchema } from '../db.js';
import { writeCrawledRecommendations } from '../services/recommendationsStore.js';
import { JP_CRAWLER_CITIES, buildCrawledListForCity, getCrawlerTargetPerCity } from '../services/crawlerMergeJob.js';

const CHECK_INTERVAL_MS = 30 * 60 * 1000;

export const crawlerState = {
  running: false,
  lastRunAt: null,
  lastResult: null,
  lastError: null,
  scheduledDay: parseInt(process.env.CRAWLER_SCHEDULE_DAY, 10) || 0,
  scheduledHour: parseInt(process.env.CRAWLER_SCHEDULE_HOUR, 10) || 3,
};

let lastScheduledDate = null;

export async function runCrawlerJob() {
  if (crawlerState.running) {
    console.log('[crawler-scheduler] 爬虫正在运行中，跳过');
    return { ok: false, message: '爬虫正在运行中' };
  }
  crawlerState.running = true;
  crawlerState.lastError = null;
  const startedAt = new Date().toISOString();
  const targetCap = getCrawlerTargetPerCity();
  console.log(`[crawler-scheduler] 开始执行爬虫（Wikidata + OSM，每城最多 ${targetCap} 条）…`);

  try {
    ensureSchema();

    const { queryMichelinRestaurantsJapan } = await import('../services/crawlers/wikidata-michelin.js');

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

    for (const cityKey of JP_CRAWLER_CITIES) {
      try {
        const { list, cityZh } = await buildCrawledListForCity({
          cityKey,
          michelinByCity,
          logPrefix: '[crawler-scheduler]',
        });

        if (list.length === 0) {
          allResults.push({ cityKey, count: 0 });
          continue;
        }

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
