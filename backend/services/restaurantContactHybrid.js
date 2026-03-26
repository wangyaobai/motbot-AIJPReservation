/**
 * 餐厅联系信息混合查询：OSM（Overpass 按店名）优先，无电话时再尝试 Google Places API。
 * Google 需配置 GOOGLE_PLACES_API_KEY；未配置时仅 OSM。
 */
import { searchRestaurantOSM } from './crawlers/openStreetMap.js';

function fromOsmRow(r) {
  if (!r) return null;
  return {
    phone: r.phone || '',
    address: r.address || '',
    opening_hours: r.opening_hours || '',
    image: r.image || '',
    name: r.name || '',
    google_place_id: '',
    google_rating: 0,
    google_maps_url: '',
    osm_type: r.osm_type || '',
    osm_id: r.osm_id || '',
  };
}

function mergeOsmAndGoogle(osmPartial, g) {
  if (!g && !osmPartial) return null;
  if (!g) return fromOsmRow(osmPartial);
  if (!osmPartial) {
    return {
      phone: g.phone || '',
      address: g.address || '',
      opening_hours: g.opening_hours || '',
      image: g.image || '',
      name: g.name || '',
      google_place_id: g.google_place_id || '',
      google_rating: g.google_rating || 0,
      google_maps_url: g.google_maps_url || '',
      osm_type: '',
      osm_id: '',
    };
  }
  return {
    phone: g.phone || osmPartial.phone || '',
    address: osmPartial.address || g.address || '',
    opening_hours: osmPartial.opening_hours || g.opening_hours || '',
    image: osmPartial.image || g.image || '',
    name: g.name || osmPartial.name || '',
    google_place_id: g.google_place_id || '',
    google_rating: g.google_rating || 0,
    google_maps_url: g.google_maps_url || '',
    osm_type: osmPartial.osm_type || '',
    osm_id: osmPartial.osm_id || '',
  };
}

/**
 * @param {{ name: string, cityKey: string }} param0
 * @returns {Promise<object|null>} 联系信息片段，供与米其林/OSM 池结果合并
 */
export async function enrichRestaurantContact({ name, cityKey }) {
  if (!String(name || '').trim() || !cityKey) return null;

  const osmHits = await searchRestaurantOSM(String(name).trim(), cityKey, 10);
  const osmWithPhone = osmHits.find((r) => String(r.phone || '').trim());

  if (osmWithPhone) {
    return fromOsmRow(osmWithPhone);
  }

  const osmPartial = osmHits[0] || null;

  if (!process.env.GOOGLE_PLACES_API_KEY) {
    return fromOsmRow(osmPartial);
  }

  try {
    const { searchRestaurantGoogleByName } = await import('./crawlers/googlePlaces.js');
    const g = await searchRestaurantGoogleByName(cityKey, name);
    return mergeOsmAndGoogle(osmPartial, g);
  } catch (e) {
    console.warn('[restaurantContactHybrid] Google:', e?.message);
    return fromOsmRow(osmPartial);
  }
}
