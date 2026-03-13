/**
 * 为每个城市凑够最多 10 家「有封面图」的餐厅（历史 + 精修 + DeepSeek 新拉），并写入 recommendations_best 作为冷启动预加载数据。
 */
import {
  readBestRecommendations,
  writeBestRecommendations,
  applyBestMediaOverlay,
  filterOtherCityList,
  isFallbackImage,
  getCityZh,
} from './recommendationsStore.js';
import { resolveRestaurantImage } from './resolveRestaurantImage.js';
import { setBestCachedMedia } from './resolveRestaurantMedia.js';

const JP_CITIES = ['hokkaido', 'tokyo', 'osaka', 'nagoya', 'kyoto', 'kobe', 'okinawa', 'kyushu', 'other'];

const TARGET = 10;

function normName(name) {
  return String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function baseUrl(portOrBase) {
  if (typeof portOrBase === 'number') return `http://127.0.0.1:${portOrBase}`;
  const s = String(portOrBase || '').trim();
  return s.replace(/\/$/, '');
}

/**
 * 单城市：从历史 + 精修 + 新拉接口凑够最多 10 家有封面图的店并写库。
 * @param portOrBase - 端口（数字）或完整 base URL（如 https://xxx.railway.app）
 */
export async function buildCityPreload(portOrBase, country = 'jp', cityKey) {
  const cityZh = getCityZh(cityKey);

  // 1) 历史：读出现有预加载，套 overlay（含人工配图）
  const best = readBestRecommendations({ country, cityKey });
  const existing = best?.restaurants ?? [];
  const withOverlay = applyBestMediaOverlay({ restaurants: existing, cityZh });

  let withCover = withOverlay.filter((r) => r && !isFallbackImage(r?.image));
  const withoutCover = withOverlay.filter((r) => r && isFallbackImage(r?.image));

  // 2) 精修：对历史里仍无图的店用「特色/菜名」模糊搜图
  for (const r of withoutCover) {
    if (withCover.length >= TARGET) break;
    try {
      const img = await resolveRestaurantImage({
        name: r.name,
        hintCity: r.city || cityZh,
        feature: r.feature,
      });
      if (img && !isFallbackImage(img)) {
        r.image = img;
        setBestCachedMedia({ cityHint: cityZh, name: r.name, val: { image_url: img } });
        withCover.push(r);
      }
    } catch {
      // ignore
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  if (withCover.length >= TARGET) {
    let final = withCover.filter((r) => r && !isFallbackImage(r?.image)).slice(0, TARGET);
    if (cityKey === 'other') final = filterOtherCityList(final).slice(0, TARGET);
    writeBestRecommendations({ country, cityKey, cityZh, restaurants: final });
    return { cityKey, count: final.length, source: 'history+refine' };
  }

  // 3) 新拉：调推荐接口（DeepSeek + 补图），取有封面图的与当前列表去重合并至 10
  const base = baseUrl(portOrBase);
  let newList = [];
  try {
    const url = `${base}/api/recommendations?country=${encodeURIComponent(country)}&city=${encodeURIComponent(cityKey)}&clear_cache=1&warm_media=0`;
    const resp = await fetch(url);
    const data = await resp.json().catch(() => ({}));
    if (data?.ok && Array.isArray(data.restaurants)) newList = data.restaurants;
  } catch {
    // ignore
  }

  const nameSet = new Set(withCover.map((r) => normName(r?.name)));
  for (const r of newList) {
    if (withCover.length >= TARGET) break;
    if (!r?.name || !r?.image || isFallbackImage(r.image)) continue;
    const n = normName(r.name);
    if (nameSet.has(n)) continue;
    nameSet.add(n);
    withCover.push(r);
  }

  let final = withCover.filter((r) => r && !isFallbackImage(r?.image)).slice(0, TARGET);
  if (cityKey === 'other') final = filterOtherCityList(final).slice(0, TARGET);
  writeBestRecommendations({ country, cityKey, cityZh, restaurants: final });
  return { cityKey, count: final.length, source: 'history+refine+deepseek' };
}

/**
 * 所有城市各跑一遍 buildCityPreload，间隔 2s，避免压爆接口。
 * @param portOrBase - 端口（数字）或完整 base URL
 */
export async function runBuildPreloadAll(portOrBase) {
  const results = [];
  for (const cityKey of JP_CITIES) {
    try {
      const r = await buildCityPreload(portOrBase, 'jp', cityKey);
      results.push(r);
    } catch (e) {
      results.push({ cityKey, error: e?.message });
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  return results;
}
