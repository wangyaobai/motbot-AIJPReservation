import { getDb } from '../db.js';

/**
 * 导出当前 SQLite 中所有“手动封面图”配置。
 *
 * 使用方式（在 backend 目录）：
 *   node scripts/export-manual-covers.js > manual_covers.json
 *
 * 输出示例（JSON 数组）：
 * [
 *   {
 *     "city_hint": "osaka",
 *     "restaurant_name": "自由轩",
 *     "manual_image_url": "https://.....jpg",
 *     "manual_enabled": 1,
 *     "updated_at": "2025-02-20 12:34:56"
 *   }
 * ]
 */
function main() {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT city_hint, restaurant_name, manual_image_url, manual_enabled, updated_at
       FROM restaurant_media_best
       WHERE manual_image_url IS NOT NULL
         AND TRIM(manual_image_url) != ''
       ORDER BY city_hint, restaurant_name, updated_at DESC`
    )
    .all();

  // 去重：同一个 city_hint + restaurant_name 只保留一条（最新的）
  const map = new Map();
  for (const r of rows) {
    const key = `${r.city_hint || ''}|${r.restaurant_name || ''}`;
    if (!map.has(key)) {
      map.set(key, r);
    }
  }

  const list = Array.from(map.values());
  process.stdout.write(JSON.stringify(list, null, 2));
}

main();

