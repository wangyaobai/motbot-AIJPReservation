import fs from 'fs';

function norm(s) {
  return String(s || '').trim();
}

function normalizeRestaurantName(name) {
  const s = norm(name);
  if (!s) return '';
  return s
    .replace(/\s*[\(（][^\)）]*[\)）]\s*/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function bestKey(cityHint, name) {
  return `best:${norm(cityHint)}|${normalizeRestaurantName(name)}`;
}

export function importManualCoversFromJsonFile({ db, jsonPath } = {}) {
  if (!db) throw new Error('Missing db');
  const p = norm(jsonPath);
  if (!p) throw new Error('Missing jsonPath');
  if (!fs.existsSync(p)) throw new Error(`manual_covers.json not found at: ${p}`);

  const txt = fs.readFileSync(p, 'utf8');
  let list;
  try {
    list = JSON.parse(txt);
  } catch (e) {
    throw new Error(`Failed to parse manual_covers.json: ${e?.message || e}`);
  }
  if (!Array.isArray(list) || list.length === 0) {
    return { imported: 0, total: Array.isArray(list) ? list.length : 0 };
  }

  const insert = db.prepare(
    `INSERT INTO restaurant_media_best (cache_key, city_hint, restaurant_name, data_json, manual_image_url, manual_enabled, updated_at)
     VALUES (@cache_key, @city_hint, @restaurant_name, @data_json, @manual_image_url, @manual_enabled, datetime('now'))
     ON CONFLICT(cache_key) DO UPDATE SET
       city_hint = excluded.city_hint,
       restaurant_name = excluded.restaurant_name,
       manual_image_url = excluded.manual_image_url,
       manual_enabled = excluded.manual_enabled,
       updated_at = excluded.updated_at`
  );

  const selectDataJson = db.prepare(
    'SELECT data_json FROM restaurant_media_best WHERE cache_key = ? LIMIT 1'
  );

  let count = 0;
  db.transaction(() => {
    for (const item of list) {
      const cityHint = norm(item?.city_hint);
      const restaurantName = normalizeRestaurantName(item?.restaurant_name);
      const manualUrl = norm(item?.manual_image_url);
      if (!cityHint || !restaurantName || !manualUrl) continue;

      const cache_key = bestKey(cityHint, restaurantName);
      const row = selectDataJson.get(cache_key);
      const data_json = row?.data_json || '{}';
      const manual_enabled =
        typeof item?.manual_enabled === 'number' ? (item.manual_enabled ? 1 : 0) : 1;

      insert.run({
        cache_key,
        city_hint: cityHint,
        restaurant_name: restaurantName,
        data_json,
        manual_image_url: manualUrl,
        manual_enabled,
      });
      count += 1;
    }
  })();

  return { imported: count, total: list.length };
}

