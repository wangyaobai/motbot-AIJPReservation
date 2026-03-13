import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ensureSchema, getDb } from '../db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

function main() {
  ensureSchema();
  const db = getDb();

  // manual_covers.json 默认放在项目根目录：../..
  const rootDir = path.join(__dirname, '..', '..');
  const jsonPath = path.join(rootDir, 'manual_covers.json');

  if (!fs.existsSync(jsonPath)) {
    console.error(`manual_covers.json not found at: ${jsonPath}`);
    process.exit(1);
  }

  const txt = fs.readFileSync(jsonPath, 'utf8');
  let list;
  try {
    list = JSON.parse(txt);
  } catch (e) {
    console.error('Failed to parse manual_covers.json:', e);
    process.exit(1);
  }

  if (!Array.isArray(list) || list.length === 0) {
    console.log('manual_covers.json is empty or not an array, nothing to import.');
    return;
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
      const cityHint = norm(item.city_hint);
      const restaurantName = normalizeRestaurantName(item.restaurant_name);
      const manualUrl = norm(item.manual_image_url);
      if (!cityHint || !restaurantName || !manualUrl) continue;

      const cache_key = bestKey(cityHint, restaurantName);
      const row = selectDataJson.get(cache_key);
      const data_json = row?.data_json || '{}';
      const manual_enabled =
        typeof item.manual_enabled === 'number' ? (item.manual_enabled ? 1 : 0) : 1;

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

  console.log(`Imported/updated manual covers: ${count}`);
}

main();

