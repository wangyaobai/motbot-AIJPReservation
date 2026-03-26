/**
 * Wikidata SPARQL：查询日本米其林餐厅。
 * P166 (award received) + Q20824563 (Michelin star) 或 Q166798/Q166799/Q166800 (1/2/3星)
 *
 * 限流：WDQS 对高频/匿名请求会返回 403「Too Many Reqs」。请配置可联系到的 User-Agent 片段，
 * 并依赖内置重试；生产勿在短时间内多次手动跑同一查询。
 *
 * 环境变量（可选）：
 * - WIKIDATA_SPARQL_URL — 默认 https://query.wikidata.org/sparql
 * - WIKIDATA_USER_AGENT_CONTACT — 建议填运维邮箱或项目 URL，写入 User-Agent（符合 WM 政策）
 * - WIKIDATA_MAX_RETRIES — 默认 6
 * - WIKIDATA_RETRY_BASE_MS — 首次等待基数毫秒，默认 12000（指数退避）
 * - WIKIDATA_REQUEST_TIMEOUT_MS — 单次请求超时，默认 55000
 */
const DEFAULT_SPARQL = 'https://query.wikidata.org/sparql';

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

function sparqlEndpoint() {
  const u = String(process.env.WIKIDATA_SPARQL_URL || '').trim();
  const base = (u || DEFAULT_SPARQL).replace(/\/$/, '');
  return base;
}

/** @see https://meta.wikimedia.org/wiki/User-Agent_policy */
function wikidataUserAgent() {
  const contact =
    String(process.env.WIKIDATA_USER_AGENT_CONTACT || '').trim() ||
    'https://github.com/wangyaobai/motbot-AIJPReservation';
  const ver = '1.0';
  const node = process.version.replace(/^v/, '');
  return `motbot-AIJPReservation/${ver} (${contact}) node/${node}`;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** @param {Response} res */
function retryAfterMs(res) {
  const ra = res.headers?.get?.('retry-after');
  if (!ra) return null;
  const sec = parseInt(ra, 10);
  if (Number.isFinite(sec) && sec >= 0) return sec * 1000;
  const t = Date.parse(ra);
  if (Number.isFinite(t)) return Math.max(0, t - Date.now());
  return null;
}

/**
 * WDQS 对 403/429/5xx 做退避重试，降低「Too Many Reqs」导致米其林条数为 0 的概率。
 * @returns {Promise<object|null>} SPARQL JSON 的顶层对象，失败为 null
 */
async function fetchSparqlJson(url) {
  const maxRetries = Math.min(10, Math.max(1, parseInt(process.env.WIKIDATA_MAX_RETRIES, 10) || 6));
  const baseMs = Math.max(3000, parseInt(process.env.WIKIDATA_RETRY_BASE_MS, 10) || 12000);
  const timeoutMs = Math.max(20000, parseInt(process.env.WIKIDATA_REQUEST_TIMEOUT_MS, 10) || 55000);

  const headers = {
    Accept: 'application/sparql-results+json, application/json;q=0.9',
    'User-Agent': wikidataUserAgent(),
  };

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { headers, signal: controller.signal });
      clearTimeout(timer);

      if (res.ok) {
        return await res.json();
      }

      const retryable =
        res.status === 403 ||
        res.status === 429 ||
        res.status === 502 ||
        res.status === 503 ||
        res.status === 504;

      console.warn('[wikidata] HTTP', res.status, res.statusText, attempt + 1, '/', maxRetries);

      if (!retryable || attempt === maxRetries - 1) {
        return null;
      }

      const fromHeader = retryAfterMs(res);
      const backoff = fromHeader ?? baseMs * Math.pow(2, attempt) + Math.floor(Math.random() * 2500);
      const wait = Math.min(backoff, 180000);
      console.warn('[wikidata] 等待', Math.round(wait / 1000), 's 后重试…');
      await sleep(wait);
    } catch (e) {
      clearTimeout(timer);
      console.warn('[wikidata] 请求异常:', e?.message || e, attempt + 1, '/', maxRetries);
      if (attempt === maxRetries - 1) return null;
      const backoff = baseMs * Math.pow(2, attempt) + Math.floor(Math.random() * 2500);
      await sleep(Math.min(backoff, 180000));
    }
  }
  return null;
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
  { ?item wdt:P17 wd:Q17 } UNION { ?item wdt:P131* wd:Q17 }
  OPTIONAL { ?item wdt:P969 ?addr }
  OPTIONAL { ?item wdt:P1329 ?phone }
  OPTIONAL {
    ?item wdt:P131 ?pref .
    ?pref rdfs:label ?prefLabel . FILTER(LANG(?prefLabel) = "ja")
  }
  ?item rdfs:label ?itemLabel . FILTER(LANG(?itemLabel) = "ja" || LANG(?itemLabel) = "en")
} LIMIT ${Math.min(limit, 200)}
`.trim();

  const endpoint = sparqlEndpoint();
  const urlFinal = `${endpoint}?query=${encodeURIComponent(query)}&format=json`;

  try {
    const data = await fetchSparqlJson(urlFinal);
    if (!data) return [];
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
  } catch (e) {
    console.warn('[wikidata] 解析失败:', e?.message || e);
    return [];
  }
}
