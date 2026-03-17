/**
 * Wikidata SPARQL：查询日本米其林餐厅。
 * P166 (award received) + Q20824563 (Michelin star) 或 Q166798/Q166799/Q166800 (1/2/3星)
 */
const WIKIDATA_SPARQL = 'https://query.wikidata.org/sparql';

const MICHELIN_STAR_QS = ['Q20824563', 'Q166798', 'Q166799', 'Q166800']; // 米其林星 / 1/2/3星

/** 日本都道府县 -> 我们 8 城 + other 的映射 */
const PREF_TO_CITY = {
  北海道: 'hokkaido',
  東京都: 'tokyo',
  東京: 'tokyo',
  大阪府: 'osaka',
  大阪: 'osaka',
  愛知県: 'nagoya',
  名古屋: 'nagoya',
  京都府: 'kyoto',
  京都: 'kyoto',
  兵庫県: 'kobe',
  神戸: 'kobe',
  沖縄県: 'okinawa',
  沖縄: 'okinawa',
  那覇: 'okinawa',
  福岡県: 'kyushu',
  福岡: 'kyushu',
  博多: 'kyushu',
  九州: 'kyushu',
};

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

function inferCityKey(prefLabel, addrLabel) {
  const s = String(prefLabel || addrLabel || '').trim();
  for (const [pref, key] of Object.entries(PREF_TO_CITY)) {
    if (s.includes(pref)) return key;
  }
  return 'other';
}

/**
 * 从 Wikidata 查询日本米其林餐厅
 * @param {number} limit - 最多返回数量
 * @returns {Promise<Array<{name,address,phone,city,cityKey,wikidata_id}>>}
 */
export async function queryMichelinRestaurantsJapan(limit = 100) {
  const starFilter = MICHELIN_STAR_QS.map((q) => `wd:${q}`).join(' ');
  const query = `
SELECT ?item ?itemLabel ?addr ?phone ?prefLabel WHERE {
  ?item wdt:P31 wd:Q11707 .
  ?item wdt:P166 ?award .
  VALUES ?award { ${starFilter} }
  ?item wdt:P131* wd:Q17 .
  OPTIONAL { ?item wdt:P969 ?addr }
  OPTIONAL { ?item wdt:P1329 ?phone }
  OPTIONAL {
    ?item wdt:P131 ?pref .
    ?pref rdfs:label ?prefLabel . FILTER(LANG(?prefLabel) = "ja")
  }
  ?item rdfs:label ?itemLabel . FILTER(LANG(?itemLabel) = "ja" || LANG(?itemLabel) = "en")
} LIMIT ${Math.min(limit, 200)}
`.trim();

  const url = `${WIKIDATA_SPARQL}?query=${encodeURIComponent(query)}&format=json`;
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 25000);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'RestaurantBookingBot/1.0 (https://github.com/wangyaobai/motbot-AIJPReservation)' },
      signal: controller.signal,
    });
    clearTimeout(t);
    if (!res.ok) return [];
    const data = await res.json();
    const bindings = data?.results?.bindings || [];
    const out = [];
    const seen = new Set();
    for (const b of bindings) {
      const name = b.itemLabel?.value?.trim();
      if (!name || seen.has(name)) continue;
      seen.add(name);
      const addr = b.addr?.value || '';
      const phone = b.phone?.value || '';
      const pref = b.prefLabel?.value || '';
      const cityKey = inferCityKey(pref, addr);
      const cityZh = CITY_ZH[cityKey] || pref || '日本';
      const id = b.item?.value?.replace('http://www.wikidata.org/entity/', '') || '';
      out.push({
        name,
        address: addr,
        phone,
        city: cityZh,
        cityKey,
        wikidata_id: id,
        feature: '米其林指南',
        call_lang: 'ja',
      });
    }
    return out;
  } catch {
    clearTimeout(t);
    return [];
  }
}
