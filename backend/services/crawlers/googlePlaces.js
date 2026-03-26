/**
 * 可选：Google Places API（需 GOOGLE_PLACES_API_KEY）。
 * 主爬虫已改为 Wikidata + OpenStreetMap；本文件保留供日后需要时接入。
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COVERS_DIR = path.resolve(__dirname, '../../public/manual-covers');

const API_KEY = () => process.env.GOOGLE_PLACES_API_KEY || '';

const CITY_QUERIES = {
  tokyo: { query: 'best restaurant Tokyo Japan', location: '35.6762,139.6503' },
  osaka: { query: 'best restaurant Osaka Japan', location: '34.6937,135.5023' },
  kyoto: { query: 'best restaurant Kyoto Japan', location: '35.0116,135.7681' },
  nagoya: { query: 'best restaurant Nagoya Japan', location: '35.1815,136.9066' },
  hokkaido: { query: 'best restaurant Sapporo Hokkaido Japan', location: '43.0618,141.3545' },
  kobe: { query: 'best restaurant Kobe Japan', location: '34.6901,135.1956' },
  okinawa: { query: 'best restaurant Okinawa Japan', location: '26.3344,127.8056' },
  kyushu: { query: 'best restaurant Fukuoka Japan', location: '33.5904,130.4017' },
};

const CITY_ZH = {
  hokkaido: '北海道', tokyo: '东京', osaka: '大阪',
  nagoya: '名古屋', kyoto: '京都', kobe: '神户',
  okinawa: '冲绳', kyushu: '九州',
};

async function fetchJson(url, timeout = 15000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(t);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    clearTimeout(t);
    throw e;
  }
}

/**
 * Text Search (New) — returns up to `limit` place_ids for a query.
 */
export async function searchRestaurants(cityKey, extraQuery, limit = 20) {
  const key = API_KEY();
  if (!key) throw new Error('GOOGLE_PLACES_API_KEY not set');

  const cityConf = CITY_QUERIES[cityKey] || { query: `best restaurant ${cityKey} Japan`, location: '' };
  const textQuery = extraQuery || cityConf.query;

  const url = new URL('https://maps.googleapis.com/maps/api/place/textsearch/json');
  url.searchParams.set('query', textQuery);
  url.searchParams.set('type', 'restaurant');
  url.searchParams.set('language', 'ja');
  url.searchParams.set('key', key);
  if (cityConf.location) {
    url.searchParams.set('location', cityConf.location);
    url.searchParams.set('radius', '30000');
  }

  const results = [];
  let nextPageToken = null;

  for (let page = 0; page < 3 && results.length < limit; page++) {
    if (nextPageToken) {
      url.searchParams.set('pagetoken', nextPageToken);
      await new Promise((r) => setTimeout(r, 2500));
    }
    const data = await fetchJson(url.toString());
    if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
      console.warn(`[googlePlaces] Text Search status=${data.status}`, data.error_message || '');
      break;
    }
    for (const r of data.results || []) {
      if (results.length >= limit) break;
      results.push({
        place_id: r.place_id,
        name: r.name,
        address: r.formatted_address || '',
        rating: r.rating || 0,
        photo_reference: r.photos?.[0]?.photo_reference || '',
      });
    }
    nextPageToken = data.next_page_token || null;
    if (!nextPageToken) break;
  }
  return results;
}

/**
 * Place Details — returns phone, address, opening_hours, photo_reference, rating
 */
export async function getPlaceDetails(placeId) {
  const key = API_KEY();
  if (!key) throw new Error('GOOGLE_PLACES_API_KEY not set');

  const url = new URL('https://maps.googleapis.com/maps/api/place/details/json');
  url.searchParams.set('place_id', placeId);
  url.searchParams.set('fields', 'name,formatted_phone_number,international_phone_number,formatted_address,opening_hours,photos,rating,url');
  url.searchParams.set('language', 'ja');
  url.searchParams.set('key', key);

  const data = await fetchJson(url.toString());
  if (data.status !== 'OK') {
    console.warn(`[googlePlaces] Details status=${data.status} for ${placeId}`);
    return null;
  }
  const r = data.result || {};
  const weekday = r.opening_hours?.weekday_text;
  return {
    name: r.name || '',
    phone: r.international_phone_number || r.formatted_phone_number || '',
    address: r.formatted_address || '',
    opening_hours: Array.isArray(weekday) ? weekday.join(' / ') : '',
    photo_reference: r.photos?.[0]?.photo_reference || '',
    rating: r.rating || 0,
    google_maps_url: r.url || '',
  };
}

/**
 * Download a Google Places photo to local disk. Returns the relative URL path.
 */
export async function downloadPhoto(photoReference, saveName) {
  const key = API_KEY();
  if (!key || !photoReference) return '';

  const url = `https://maps.googleapis.com/maps/api/place/photo?maxwidth=800&photo_reference=${photoReference}&key=${key}`;

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(t);
    if (!res.ok) {
      console.warn('[googlePlaces] Photo download failed', res.status);
      return '';
    }
    const ct = res.headers.get('content-type') || 'image/jpeg';
    const ext = ct.includes('png') ? '.png' : ct.includes('webp') ? '.webp' : '.jpg';
    const safeFilename = saveName.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80) + ext;

    if (!fs.existsSync(COVERS_DIR)) fs.mkdirSync(COVERS_DIR, { recursive: true });
    const filePath = path.join(COVERS_DIR, safeFilename);
    const buffer = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(filePath, buffer);
    return `/api/manual-covers/${safeFilename}`;
  } catch (e) {
    clearTimeout(t);
    console.warn('[googlePlaces] Photo download error:', e?.message);
    return '';
  }
}

/**
 * 按店名在城市内 Text Search → Place Details，取电话/地址/营业时间；有图则下载到本地。
 * 需 GOOGLE_PLACES_API_KEY；未配置时返回 null。
 */
export async function searchRestaurantGoogleByName(cityKey, restaurantName) {
  const key = API_KEY();
  if (!key || !String(restaurantName || '').trim()) return null;

  const cityZh = CITY_ZH[cityKey] || cityKey;
  const q = `${String(restaurantName).trim()} ${cityZh} Japan`;
  let hits;
  try {
    hits = await searchRestaurants(cityKey, q, 5);
  } catch (e) {
    console.warn('[googlePlaces] searchRestaurantGoogleByName search:', e?.message);
    return null;
  }
  if (!hits?.length) return null;

  const toRow = async (h, details) => {
    let imageUrl = '';
    const photoRef = details.photo_reference || h.photo_reference;
    if (photoRef) {
      try {
        imageUrl = await downloadPhoto(photoRef, `g_name_${cityKey}_${h.place_id}`);
      } catch (_) {}
    }
    return {
      name: details.name || h.name,
      phone: details.phone || '',
      address: details.address || h.address || '',
      opening_hours: details.opening_hours || '',
      image: imageUrl,
      google_place_id: h.place_id,
      google_rating: details.rating || h.rating || 0,
      google_maps_url: details.google_maps_url || '',
      source: 'google',
    };
  };

  let fallback = null;
  for (const h of hits) {
    let details;
    try {
      details = await getPlaceDetails(h.place_id);
    } catch (e) {
      continue;
    }
    if (!details) continue;
    if (details.phone) return toRow(h, details);
    if (!fallback) fallback = await toRow(h, details);
    await new Promise((r) => setTimeout(r, 200));
  }
  return fallback;
}

/**
 * Full pipeline: search restaurants in a city, get details + download photos.
 * Returns an array of restaurant objects ready for recommendations_crawled.
 */
export async function crawlCityViaGoogle(cityKey, limit = 20) {
  console.log(`[googlePlaces] crawling ${cityKey} (limit ${limit})…`);
  const basics = await searchRestaurants(cityKey, null, limit);
  console.log(`[googlePlaces] Text Search returned ${basics.length} for ${cityKey}`);

  const restaurants = [];
  for (const b of basics) {
    try {
      const details = await getPlaceDetails(b.place_id);
      if (!details) continue;

      let imageUrl = '';
      const photoRef = details.photo_reference || b.photo_reference;
      if (photoRef) {
        imageUrl = await downloadPhoto(photoRef, `google_${cityKey}_${b.place_id}`);
      }

      restaurants.push({
        id: `g_${b.place_id}`,
        name: details.name || b.name,
        address: details.address || b.address,
        phone: details.phone || '',
        image: imageUrl || '',
        feature: '',
        call_lang: 'ja',
        source: 'google',
        google_place_id: b.place_id,
        google_rating: details.rating || b.rating || 0,
        opening_hours: details.opening_hours || '',
        google_maps_url: details.google_maps_url || '',
      });

      await new Promise((r) => setTimeout(r, 300));
    } catch (e) {
      console.warn(`[googlePlaces] detail/photo error for ${b.name}:`, e?.message);
    }
  }
  console.log(`[googlePlaces] got ${restaurants.length} detailed restaurants for ${cityKey}`);
  return restaurants;
}

export { CITY_QUERIES, CITY_ZH };
