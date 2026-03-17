/**
 * 从 Tabelog + Wikidata 米其林爬取餐厅，写入 recommendations_best。
 * - 主数据源：米其林官网（Wikidata SPARQL）+ Tabelog 高评
 * - 保留已有数据：手动封面、历史 restaurant_media_best 继续保留
 * - 补图：沿用 Tabelog/Wikidata/Yelp，拉到后本地化保存
 * - 城市：8 主城 + other（横滨/埼玉/千叶/仙台/广岛等）
 *
 * 用法：
 *   cd backend && node scripts/refresh-from-crawlers.js
 *   node scripts/refresh-from-crawlers.js --city=tokyo
 *   node scripts/refresh-from-crawlers.js --dry-run
 *
 * crontab 每周：0 3 * * 0 cd /path/to/backend && node scripts/refresh-from-crawlers.js
 */
import 'dotenv/config';
import {
  writeBestRecommendations,
  readBestRecommendations,
  getCityZh,
  filterListByCityKey,
  filterOtherCityList,
  applyBestMediaOverlay,
  isFallbackImage,
} from '../services/recommendationsStore.js';
import { clearRecommendationsCache } from '../routes/recommendations.js';
import { crawlTabelogCity, crawlTabelogOther } from '../services/crawlers/tabelog.js';
import { queryMichelinRestaurantsJapan } from '../services/crawlers/wikidata-michelin.js';
import { resolveRestaurantMediaBatch } from '../services/resolveRestaurantMedia.js';

const JP_CITIES = ['tokyo', 'osaka', 'kyoto', 'nagoya', 'kobe', 'hokkaido', 'okinawa', 'kyushu', 'other'];
const TARGET = 10;

function normName(name) {
  return String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function normalizeKey(s) {
  return String(s || '').trim().replace(/\s*[\(（][^\)）]*[\)）]\s*/g, ' ').replace(/\s{2,}/g, ' ').trim();
}

/** 合并：已有（含手动/好图）优先，再补新爬取，去重按名 */
function mergeWithExisting(existing, crawled, cityKey, cityZh) {
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
  return sorted.map(({ _priority, ...r }) => r).slice(0, TARGET);
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const cityArg = args.find((a) => a.startsWith('--city='));
  const cities = cityArg ? [cityArg.split('=')[1]] : JP_CITIES;

  console.log('[refresh] 开始，城市:', cities.join(', '), dryRun ? '(dry-run)' : '');

  // 1) Wikidata 米其林（一次性拉取，按 cityKey 分组）
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
    if (!JP_CITIES.includes(cityKey)) {
      console.log('[refresh] 跳过', cityKey);
      continue;
    }
    try {
      const cityZh = getCityZh(cityKey);

      // 2) 爬取：Tabelog（8 城用 crawlTabelogCity，other 用 crawlTabelogOther）
      let crawled = [];
      if (cityKey === 'other') {
        crawled = await crawlTabelogOther(TARGET + 5);
      } else {
        crawled = await crawlTabelogCity(cityKey, TARGET + 5);
      }

      // 3) 合并 Wikidata 米其林（同城）
      const michelinList = michelinByCity[cityKey] || [];
      const nameSet = new Set(crawled.map((r) => normName(r.name)));
      for (const m of michelinList) {
        const n = normName(m.name);
        if (!n || nameSet.has(n)) continue;
        nameSet.add(n);
        crawled.push({
          name: m.name,
          phone: m.phone || '',
          address: m.address || '',
          city: m.city || cityZh,
          cityKey,
          wikidata_id: m.wikidata_id || '',
          feature: m.feature || '米其林指南',
          call_lang: 'ja',
        });
      }

      if (crawled.length === 0) {
        console.log('[refresh]', cityKey, '无新数据');
        continue;
      }

      let list = crawled.map((r) => ({
        id: `${cityKey}-${normName(r.name).slice(0, 20)}`,
        country: 'jp',
        cityKey,
        name: r.name,
        city: r.city || cityZh,
        phone: r.phone || '',
        address: r.address || '',
        feature: r.feature || '高评价餐厅',
        call_lang: r.call_lang || 'ja',
        image: '',
        tabelog_url: r.tabelog_url || '',
        wikidata_id: r.wikidata_id || '',
      }));

      list = filterListByCityKey(list, cityKey);
      if (cityKey === 'other') list = filterOtherCityList(list);

      // 4) 补图（含本地化）
      try {
        const mediaMap = await resolveRestaurantMediaBatch({
          cityZh,
          restaurants: list,
          budgetMs: 12000,
        });
        for (const r of list) {
          const m = mediaMap.get(normalizeKey(r.name));
          if (m?.image_url && !isFallbackImage(m.image_url)) r.image = m.image_url;
          if (m?.tabelog_url && !r.tabelog_url) r.tabelog_url = m.tabelog_url;
        }
      } catch (e) {
        console.warn('[refresh] 补图失败', cityKey, e?.message);
      }

      // 5) 合并已有：保留手动封面、历史好图
      const best = readBestRecommendations({ country: 'jp', cityKey });
      const existing = best?.restaurants ? applyBestMediaOverlay({ restaurants: best.restaurants, cityZh }) : [];
      const merged = mergeWithExisting(existing, list, cityKey, cityZh);

      const final = merged.slice(0, TARGET);
      allResults.push({ cityKey, count: final.length, total: list.length });

      if (!dryRun && final.length > 0) {
        writeBestRecommendations({ country: 'jp', cityKey, cityZh, restaurants: final });
        console.log('[refresh]', cityKey, '写入', final.length, '家');
      } else {
        console.log('[refresh]', cityKey, '将写入', final.length, '家', dryRun ? '(dry-run)' : '');
      }

      await new Promise((r) => setTimeout(r, 3000));
    } catch (e) {
      console.error('[refresh]', cityKey, 'error:', e?.message);
    }
  }

  if (!dryRun && allResults.some((r) => r.count > 0)) {
    clearRecommendationsCache();
    console.log('[refresh] 已清理内存缓存，前端将读取最新数据');
  }
  console.log('[refresh] 完成', allResults);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
