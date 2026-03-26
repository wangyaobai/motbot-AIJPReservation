/**
 * 从 Wikidata 米其林 + Google Places 爬取餐厅。
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
 */
import 'dotenv/config';
import { ensureSchema } from '../db.js';
import {
  writeBestRecommendations,
  readBestRecommendations,
  getCityZh,
  filterListByCityKey,
  applyBestMediaOverlay,
  isFallbackImage,
  backupToFallback,
  writeCrawledRecommendations,
} from '../services/recommendationsStore.js';
import { clearRecommendationsCache } from '../routes/recommendations.js';
import { queryMichelinRestaurantsJapan } from '../services/crawlers/wikidata-michelin.js';

const JP_CITIES = ['tokyo', 'osaka', 'kyoto', 'nagoya', 'kobe', 'hokkaido', 'okinawa', 'kyushu'];
const TARGET = 15;

function normName(name) {
  return String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

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
  const replace = args.includes('--replace');
  const autoMerge = args.includes('--auto-merge');
  const cityArg = args.find((a) => a.startsWith('--city='));
  const cities = cityArg ? [cityArg.split('=')[1]] : JP_CITIES;

  const useGoogle = !!process.env.GOOGLE_PLACES_API_KEY;

  ensureSchema();
  console.log('[refresh] 开始，城市:', cities.join(', '), dryRun ? '(dry-run)' : '', replace ? '(--replace)' : '', autoMerge ? '(--auto-merge)' : '', useGoogle ? '(Google Places)' : '(无 Google Key)');

  if (!dryRun) {
    const backed = backupToFallback();
    console.log('[refresh] 已备份', backed, '城到兜底表');
  }

  // 1. Wikidata 米其林
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

  let crawlCityViaGoogle = null;
  let getPlaceDetails = null;
  let downloadPhoto = null;
  let searchRestaurants = null;
  if (useGoogle) {
    const gp = await import('../services/crawlers/googlePlaces.js');
    crawlCityViaGoogle = gp.crawlCityViaGoogle;
    getPlaceDetails = gp.getPlaceDetails;
    downloadPhoto = gp.downloadPhoto;
    searchRestaurants = gp.searchRestaurants;
  }

  const allResults = [];

  for (const cityKey of cities) {
    if (!JP_CITIES.includes(cityKey)) { console.log('[refresh] 跳过', cityKey); continue; }

    try {
      const cityZh = getCityZh(cityKey);
      const nameSet = new Set();
      const combined = [];

      // 米其林排前
      const michelinList = michelinByCity[cityKey] || [];
      for (const m of michelinList) {
        const n = normName(m.name);
        if (!n || nameSet.has(n)) continue;
        nameSet.add(n);

        let image = '', phone = m.phone || '', address = m.address || '';
        let opening_hours = '', google_place_id = '', google_rating = 0;

        if (useGoogle) {
          try {
            const hits = await searchRestaurants(cityKey, `${m.name} restaurant ${cityZh}`, 1);
            if (hits.length > 0) {
              google_place_id = hits[0].place_id;
              const details = await getPlaceDetails(hits[0].place_id);
              if (details) {
                phone = details.phone || phone;
                address = details.address || address;
                opening_hours = details.opening_hours || '';
                google_rating = details.rating || 0;
                const photoRef = details.photo_reference || hits[0].photo_reference;
                if (photoRef) image = await downloadPhoto(photoRef, `michelin_${cityKey}_${hits[0].place_id}`);
              }
            }
          } catch (e) {
            console.warn(`[refresh] Google michelin ${m.name}:`, e?.message);
          }
        }

        combined.push({
          id: `m_${m.wikidata_id || n.slice(0, 20)}`,
          country: 'jp', cityKey, name: m.name, city: m.city || cityZh,
          phone, address, image, feature: m.feature || '米其林指南',
          call_lang: 'ja', source: 'michelin',
          wikidata_id: m.wikidata_id || '', google_place_id, google_rating, opening_hours,
        });
      }

      // Google Places 填充
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
              combined.push({ ...g, country: 'jp', cityKey, city: cityZh });
            }
          } catch (e) {
            console.warn(`[refresh] Google Places ${cityKey}:`, e?.message);
          }
        }
      }

      if (combined.length === 0) { console.log('[refresh]', cityKey, '无新数据'); continue; }

      let list = filterListByCityKey(combined, cityKey);

      if (!dryRun && list.length > 0) {
        writeCrawledRecommendations({ country: 'jp', cityKey, cityZh, restaurants: list });
        console.log('[refresh]', cityKey, '爬取', list.length, '家 -> 已入库 crawled');
      }

      let final;
      if (autoMerge) {
        if (replace) {
          final = list.slice(0, TARGET);
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

      await new Promise((r) => setTimeout(r, 1000));
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

main().catch((e) => { console.error(e); process.exit(1); });
