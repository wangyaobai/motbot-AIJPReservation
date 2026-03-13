/**
 * 精修预加载数据：对 recommendations_best 里仍是兜底图的餐厅，
 * 用「特色/菜名」模糊搜图补上，并写回 SQLite。
 * 供 CLI 脚本与后台 POST /api/admin/refine-recommendation-images 共用。
 */
import { getDb } from '../db.js';
import { resolveRestaurantImage } from './resolveRestaurantImage.js';
import { setBestCachedMedia } from './resolveRestaurantMedia.js';

const FALLBACK = 'https://images.pexels.com/photos/4106483/pexels-photo-4106483.jpeg';

function isFallbackImage(url) {
  const u = String(url || '').trim();
  return !u || u.includes('images.pexels.com/photos/4106483/');
}

const JP_CITIES = ['hokkaido', 'tokyo', 'osaka', 'nagoya', 'kyoto', 'kobe', 'okinawa', 'kyushu', 'other'];

const CITY_ZH = {
  hokkaido: '北海道',
  tokyo: '东京',
  osaka: '大阪',
  nagoya: '名古屋',
  kyoto: '京都',
  kobe: '神户',
  okinawa: '冲绳',
  kyushu: '九州',
  other: '日本其他地区',
};

function recoCacheKey(country, city) {
  return `reco:${String(country || '').toLowerCase()}|${String(city || '').toLowerCase()}`;
}

/**
 * 执行一轮精修：遍历 recommendations_best 中仍是兜底图的餐厅，用特色/菜名模糊搜图并写回。
 * @returns {{ updated: number, cities: string[] }} 本次更新的餐厅数及涉及的城市
 */
export async function runRefineRecommendationImages() {
  const db = getDb();
  let totalUpdated = 0;
  const citiesTouched = [];

  for (const cityKey of JP_CITIES) {
    const key = recoCacheKey('jp', cityKey);
    const row = db
      .prepare('SELECT restaurants_json, city_zh FROM recommendations_best WHERE cache_key = ?')
      .get(key);
    if (!row?.restaurants_json) continue;

    let list;
    try {
      list = JSON.parse(row.restaurants_json);
    } catch {
      continue;
    }
    if (!Array.isArray(list) || list.length === 0) continue;

    const cityZh = row.city_zh || CITY_ZH[cityKey] || cityKey;
    let updated = 0;

    for (const r of list) {
      if (!r?.name) continue;
      if (!isFallbackImage(r.image)) continue;

      try {
        const img = await resolveRestaurantImage({
          name: r.name,
          hintCity: r.city || cityZh,
          feature: r.feature,
        });
        if (img && !isFallbackImage(img)) {
          r.image = img;
          setBestCachedMedia({
            cityHint: cityZh,
            name: r.name,
            val: { image_url: img },
          });
          updated += 1;
        }
      } catch {
        // ignore
      }
      await new Promise((r) => setTimeout(r, 300));
    }

    if (updated > 0) {
      db.prepare(
        'UPDATE recommendations_best SET restaurants_json = ?, updated_at = datetime(\'now\') WHERE cache_key = ?'
      ).run(JSON.stringify(list), key);
      totalUpdated += updated;
      citiesTouched.push(cityKey);
    }
  }

  return { updated: totalUpdated, cities: citiesTouched };
}
