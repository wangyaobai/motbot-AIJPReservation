/**
 * 米其林联系信息补全：仅用 OpenStreetMap（Overpass 按店名在城市 bbox 内检索）。
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

/**
 * @param {{ name: string, cityKey: string }} param0
 * @returns {Promise<object|null>}
 */
export async function enrichRestaurantContact({ name, cityKey }) {
  if (!String(name || '').trim() || !cityKey) return null;

  const osmHits = await searchRestaurantOSM(String(name).trim(), cityKey, 10);
  const osmWithPhone = osmHits.find((r) => String(r.phone || '').trim());
  if (osmWithPhone) return fromOsmRow(osmWithPhone);

  return fromOsmRow(osmHits[0] || null);
}
