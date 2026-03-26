/**
 * 从 Wikidata 米其林 + 可选 Tabelog + OpenStreetMap（Overpass）爬取餐厅。
 * - 默认：备份 recommendations_best 到兜底表，爬取写入 recommendations_crawled，需后台确认后进入前端
 * - --auto-merge：自动合并到 recommendations_best（适合 crontab）
 * - --replace：与 --auto-merge 联用时完全覆盖，不保留旧数据
 *
 * 用法：
 *   cd backend && node scripts/refresh-from-crawlers.js
 *   node scripts/refresh-from-crawlers.js --city=tokyo
 *   node scripts/refresh-from-crawlers.js --dry-run
 *   node scripts/refresh-from-crawlers.js --auto-merge
 *   node scripts/refresh-from-crawlers.js --auto-merge --replace
 *
 * 可选环境变量：OVERPASS_*、CRAWLER_TARGET_PER_CITY、CRAWLER_INCLUDE_TABELOG、CRAWLER_DEEPSEEK_REFINE、DEEPSEEK_API_KEY
 */
import 'dotenv/config';
import { ensureSchema } from '../db.js';
import {
  writeBestRecommendations,
  readBestRecommendations,
  applyBestMediaOverlay,
  isFallbackImage,
  backupToFallback,
  writeCrawledRecommendations,
} from '../services/recommendationsStore.js';
import { clearRecommendationsCache } from '../routes/recommendations.js';
import { queryMichelinRestaurantsJapan } from '../services/crawlers/wikidata-michelin.js';
import {
  JP_CRAWLER_CITIES,
  buildCrawledListForCity,
  getCrawlerTargetPerCity,
} from '../services/crawlerMergeJob.js';

function normName(name) {
  return String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function mergeWithExisting(existing, crawled, cityKey, cityZh) {
  const cap = getCrawlerTargetPerCity();
  const byName = new Map();
  const existingList = Array.isArray(existing) ? existing : [];
  for (const r of existingList) {
    const n = normName(r?.name);
    if (!n) continue;
    const hasManual = r?.manual_image_url && r?.manual_enabled !== 0;
    const hasGoodCover = r?.image && !isFallbackImage(r.image);
    if (hasManual || hasGoodCover) byName.set(n, { ...r, _priority: 2 });
    else if (!byName.has(n)) byName.set(n, { ...r, _priority: 1 });
  }
  for (const r of crawled) {
    const n = normName(r?.name);
    if (!n || byName.has(n)) continue;
    byName.set(n, { ...r, _priority: 0 });
  }
  const sorted = [...byName.values()].sort((a, b) => (b._priority || 0) - (a._priority || 0));
  return sorted.map(({ _priority, ...r }) => r).slice(0, cap);
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const replace = args.includes('--replace');
  const autoMerge = args.includes('--auto-merge');
  const cityArg = args.find((a) => a.startsWith('--city='));
  const cities = cityArg ? [cityArg.split('=')[1]] : JP_CRAWLER_CITIES;
  const cap = getCrawlerTargetPerCity();

  ensureSchema();
  console.log('[refresh] 开始，城市:', cities.join(', '), dryRun ? '(dry-run)' : '', replace ? '(--replace)' : '', autoMerge ? '(--auto-merge)' : '', `(米其林+可选Tabelog+OSM, 每城≤${cap}条)`);

  if (!dryRun) {
    const backed = backupToFallback();
    console.log('[refresh] 已备份', backed, '城到兜底表');
  }

  let michelinByCity = {};
  try {
    const michelin = await queryMichelinRestaurantsJapan(150);
    for (const r of michelin) {
      const k = r.cityKey || 'other';
      if (!michelinByCity[k]) michelinByCity[k] = [];
      michelinByCity[k].push(r);
    }
    console.log('[refresh] Wikidata 米其林', michelin.length, '家');
  } catch (e) {
    console.warn('[refresh] Wikidata 失败', e?.message);
  }

  const allResults = [];

  for (const cityKey of cities) {
    if (!JP_CRAWLER_CITIES.includes(cityKey)) {
      console.log('[refresh] 跳过', cityKey);
      continue;
    }

    try {
      const { list, cityZh } = await buildCrawledListForCity({
        cityKey,
        michelinByCity,
        logPrefix: '[refresh]',
      });

      if (list.length === 0) {
        console.log('[refresh]', cityKey, '无新数据');
        continue;
      }

      if (!dryRun && list.length > 0) {
        writeCrawledRecommendations({ country: 'jp', cityKey, cityZh, restaurants: list });
        console.log('[refresh]', cityKey, '爬取', list.length, '家 -> 已入库 crawled');
      }

      let final;
      if (autoMerge) {
        if (replace) {
          final = list.slice(0, cap);
        } else {
          const best = readBestRecommendations({ country: 'jp', cityKey });
          const existing = best?.restaurants ? applyBestMediaOverlay({ restaurants: best.restaurants, cityZh }) : [];
          final = mergeWithExisting(existing, list, cityKey, cityZh);
        }
        allResults.push({ cityKey, count: final.length, total: list.length });
        if (!dryRun && final.length > 0) {
          writeBestRecommendations({ country: 'jp', cityKey, cityZh, restaurants: final });
          console.log('[refresh]', cityKey, '自动合并到前端', final.length, '家');
        }
      } else {
        allResults.push({ cityKey, count: 0, total: list.length });
        if (!dryRun) console.log('[refresh]', cityKey, '已入库，需后台确认后进入前端展示');
      }

      await new Promise((r) => setTimeout(r, 1500));
    } catch (e) {
      console.error('[refresh]', cityKey, 'error:', e?.message);
    }
  }

  if (!dryRun && autoMerge && allResults.some((r) => r.count > 0)) {
    clearRecommendationsCache();
    console.log('[refresh] 已清理内存缓存');
  }
  console.log('[refresh] 完成', allResults);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
