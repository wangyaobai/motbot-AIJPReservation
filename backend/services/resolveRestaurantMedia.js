import { getDb } from '../db.js';

const cache = new Map();
const CACHE_TTL_MS_OK = 24 * 60 * 60 * 1000;
const CACHE_TTL_MS_EMPTY = 10 * 60 * 1000;
// “最佳结果”读缓存（热数据在内存；真实落地在 SQLite）
const bestMem = new Map();
const BEST_MEM_TTL_MS = 10 * 60 * 1000;

function norm(s) {
  return String(s || '').trim();
}

function isFallbackImage(url) {
  const u = norm(url);
  if (!u) return true;
  // 当前项目占位图
  if (u.includes('images.pexels.com/photos/4106483/')) return true;
  return false;
}

function bestKey(cityHint, name) {
  return `best:${norm(cityHint)}|${normalizeRestaurantName(name)}`;
}

export function getBestCachedMedia({ cityHint, name } = {}) {
  const key = bestKey(cityHint, name);
  const mem = bestMem.get(key);
  if (mem && Date.now() < mem.exp) return mem.val;
  if (mem) bestMem.delete(key);

  try {
    const db = getDb();
    const row = db.prepare('SELECT data_json, manual_image_url, manual_enabled FROM restaurant_media_best WHERE cache_key = ?').get(key);
    if (row?.data_json || row?.manual_image_url) {
      const val = row?.data_json ? JSON.parse(row.data_json) : {};
      if (row?.manual_image_url) val.manual_image_url = String(row.manual_image_url).trim();
      val.manual_enabled = row?.manual_enabled === 0 ? 0 : 1;
      bestMem.set(key, { val, exp: Date.now() + BEST_MEM_TTL_MS });
      return val;
    }

    // 回退：若本 cityHint 下没有手动图，但其他 cityHint 下该餐厅已手动过，则复用（避免“填过但不生效/后台仍要求填”）
    const n = normalizeRestaurantName(name);
    if (!n) return null;
    let any = db.prepare(
      `SELECT data_json, manual_image_url, manual_enabled
       FROM restaurant_media_best
       WHERE restaurant_name = ?
         AND manual_enabled != 0
         AND manual_image_url IS NOT NULL
         AND TRIM(manual_image_url) != ''
       ORDER BY updated_at DESC
       LIMIT 1`
    ).get(n);
    // 再回退：忽略空格（半角/全角），兼容 "スープカレーGARAKU" vs "スープカレー GARAKU"
    if (!any?.manual_image_url && !any?.data_json) {
      const nNoSpace = n.replace(/[ 　]/g, '');
      any = db.prepare(
        `SELECT data_json, manual_image_url, manual_enabled
         FROM restaurant_media_best
         WHERE REPLACE(REPLACE(restaurant_name, ' ', ''), '　', '') = ?
           AND manual_enabled != 0
           AND manual_image_url IS NOT NULL
           AND TRIM(manual_image_url) != ''
         ORDER BY updated_at DESC
         LIMIT 1`
      ).get(nNoSpace);
    }
    if (!any?.manual_image_url && !any?.data_json) return null;
    const val2 = any?.data_json ? JSON.parse(any.data_json) : {};
    if (any?.manual_image_url) val2.manual_image_url = String(any.manual_image_url).trim();
    val2.manual_enabled = any?.manual_enabled === 0 ? 0 : 1;
    bestMem.set(key, { val: val2, exp: Date.now() + BEST_MEM_TTL_MS });
    return val2;
  } catch {
    return null;
  }
}

export function setBestCachedMedia({ cityHint, name, val } = {}) {
  const key = bestKey(cityHint, name);
  bestMem.set(key, { val, exp: Date.now() + BEST_MEM_TTL_MS });
  try {
    const db = getDb();
    const existing = db.prepare('SELECT manual_image_url, manual_enabled FROM restaurant_media_best WHERE cache_key = ?').get(key);
    const manualUrl = existing?.manual_image_url ? String(existing.manual_image_url).trim() : null;
    const manualEnabled = existing?.manual_enabled === 0 ? 0 : 1;
    db.prepare(
      `INSERT INTO restaurant_media_best (cache_key, city_hint, restaurant_name, data_json, manual_image_url, manual_enabled, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(cache_key) DO UPDATE SET
         city_hint = excluded.city_hint,
         restaurant_name = excluded.restaurant_name,
         data_json = excluded.data_json,
         updated_at = datetime('now')`
    ).run(key, norm(cityHint), normalizeRestaurantName(name), JSON.stringify(val || {}), manualUrl, manualEnabled);
  } catch {}
}

function normalizeRestaurantName(name) {
  const s = norm(name);
  if (!s) return '';
  return s
    .replace(/\s*[\(（][^\)）]*[\)）]\s*/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function japaneseOnlyName(name) {
  // 仅保留中日文字符，提升 Tabelog/Wikipedia 搜索命中（例如 "Japanese Soba Noodles 蔦" -> "蔦"）
  const s = normalizeRestaurantName(name);
  if (!s) return '';
  const only = s.replace(/[^\u4e00-\u9fff\u3040-\u30ff]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
  return only;
}

function nameVariants(name) {
  const base = normalizeRestaurantName(name);
  if (!base) return [];
  const v = new Set();
  v.add(base);
  // 常见后缀去噪，提升搜索命中（本店/本館/本家/支店等）
  v.add(base.replace(/\s*(本店|本館|本馆|本家|支店|別館|别馆|本部)\s*/g, ' ').replace(/\s{2,}/g, ' ').trim());
  // 去掉空格（日文店名常无空格）
  v.add(base.replace(/\s+/g, ''));
  // 仅日文/汉字
  const jaOnly = japaneseOnlyName(base);
  if (jaOnly) {
    v.add(jaOnly);
    v.add(jaOnly.replace(/\s+/g, ''));
  }
  return Array.from(v).filter(Boolean);
}

function looksRelatedTitle(title, name) {
  const t = norm(title);
  const n = normalizeRestaurantName(name);
  if (!t || !n) return false;
  const t0 = t.replace(/\s+/g, '');
  const n0 = n.replace(/\s+/g, '');
  // 只要 title 包含店名的主体部分即可（避免“完全不相关词条”）
  if (n0.length >= 4 && t0.includes(n0)) return true;
  // 再给一个弱匹配：店名拆词后至少命中一个长 token
  const tokens = n.split(/\s+/).filter((x) => x.length >= 3);
  return tokens.some((tok) => t.includes(tok));
}

function isHttpUrl(s) {
  try {
    const u = new URL(String(s));
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function commonsFilePath(filename, width = 960) {
  const f = norm(filename);
  if (!f) return '';
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(f)}?width=${width}`;
}

async function fetchJson(url, timeoutMs = 6000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; RestaurantBookingBot/1.0)' },
    });
    const data = await resp.json().catch(() => ({}));
    return { ok: resp.ok, status: resp.status, data };
  } catch {
    return { ok: false, status: 0, data: {} };
  } finally {
    clearTimeout(t);
  }
}

async function wikidataGetP18(entityId, timeoutMs = 5000) {
  const id = norm(entityId);
  if (!/^Q\d+$/.test(id)) return '';
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const url = `https://www.wikidata.org/wiki/Special:EntityData/${encodeURIComponent(id)}.json`;
    const resp = await fetch(url, { signal: controller.signal });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) return '';
    const entity = data?.entities?.[id];
    const claims = entity?.claims;
    const p18 = claims?.P18?.[0]?.mainsnak?.datavalue?.value;
    return typeof p18 === 'string' ? p18 : '';
  } catch {
    return '';
  } finally {
    clearTimeout(t);
  }
}

async function wikipediaSearchTopTitle(lang, query) {
  const q = norm(query);
  if (!q) return '';
  const l = lang === 'en' ? 'en' : 'ja';
  const url = `https://${l}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&format=json&srlimit=5&origin=*`;
  const { ok, data } = await fetchJson(url, 5500);
  if (!ok) return '';
  const arr = Array.isArray(data?.query?.search) ? data.query.search : [];
  const title = arr[0]?.title;
  return typeof title === 'string' ? title : '';
}

async function wikipediaSummaryThumbnail(lang, title) {
  const t = norm(title);
  if (!t) return '';
  const l = lang === 'en' ? 'en' : 'ja';
  // REST summary 返回 thumbnail.source（无需 key）
  const url = `https://${l}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(t)}`;
  const { ok, data } = await fetchJson(url, 5500);
  if (!ok) return '';
  const src = data?.thumbnail?.source;
  return isHttpUrl(src) ? src : '';
}

function stripCodeFence(s) {
  let out = norm(s);
  if (!out.startsWith('```')) return out;
  const end = out.lastIndexOf('```');
  if (end > 3) {
    out = out.slice(3, end).trim();
    out = out.replace(/^json/i, '').trim();
  }
  return out;
}

function tryParseJsonArray(s) {
  const txt = stripCodeFence(s);
  const first = txt.indexOf('[');
  const last = txt.lastIndexOf(']');
  if (first === -1 || last === -1 || last <= first) return null;
  const slice = txt.slice(first, last + 1);
  try {
    const arr = JSON.parse(slice);
    return Array.isArray(arr) ? arr : null;
  } catch {
    return null;
  }
}

async function fetchText(url, timeoutMs = 7000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: {
        // 轻量 UA，降低被当成机器人直接拦截的概率
        'User-Agent': 'Mozilla/5.0 (compatible; RestaurantBookingBot/1.0)',
        'Accept-Language': 'ja,en;q=0.8,zh-CN;q=0.6',
        // 某些站点会校验 Referer
        Referer: 'https://tabelog.com/',
        Accept: 'text/html,application/xhtml+xml',
      },
    });
    const text = await resp.text().catch(() => '');
    return { ok: resp.ok, status: resp.status, text };
  } finally {
    clearTimeout(t);
  }
}

function extractFirstTabelogStoreUrl(html) {
  const s = String(html || '');
  // 典型店铺链接形如 https://tabelog.com/tokyo/A1317/A131701/13007941/
  const reAbs = /https?:\/\/tabelog\.com\/[a-z]+\/A\d+\/A\d+\/\d+\/?/ig;
  const mAbs = s.match(reAbs);
  if (mAbs && mAbs[0]) return mAbs[0].replace(/^http:/, 'https:');
  const reRel = /href=["'](\/[a-z]+\/A\d+\/A\d+\/\d+\/?)["']/i;
  const mRel = s.match(reRel);
  if (mRel?.[1]) return `https://tabelog.com${mRel[1]}`;
  return '';
}

function extractTabelogStoreUrls(html) {
  const s = String(html || '');
  const out = new Set();
  const reAbs = /https?:\/\/tabelog\.com\/[a-z]+\/A\d+\/A\d+\/\d+\/?/ig;
  for (const m of s.matchAll(reAbs)) out.add(String(m[0]).replace(/^http:/, 'https:'));
  const reRel = /href=["'](\/[a-z]+\/A\d+\/A\d+\/\d+\/?)["']/ig;
  for (const m of s.matchAll(reRel)) out.add(`https://tabelog.com${m[1]}`);
  return Array.from(out);
}

function tabelogSearchQuery(name, address) {
  const n = norm(name);
  const a = norm(address);
  if (!n && !a) return '';
  // 店名 + 地址 一起搜索，提升命中与去噪
  return [n, a].filter(Boolean).join(' ');
}

async function tabelogFindStoreUrlBySearch(name, address, timeoutMs = 6500) {
  const q = tabelogSearchQuery(name, address);
  if (!q) return '';
  const url = `https://tabelog.com/rstLst/?sw=${encodeURIComponent(q)}`;
  const { ok, text } = await fetchText(url, timeoutMs);
  if (!ok) return '';
  return extractFirstTabelogStoreUrl(text);
}

async function tabelogFindStoreUrlBySearchInArea(areaSlug, name, address, timeoutMs = 6500) {
  const area = norm(areaSlug).toLowerCase();
  const q = tabelogSearchQuery(name, address);
  if (!q) return '';
  if (!/^[a-z]+$/.test(area)) return '';
  // 例如 https://tabelog.com/tokyo/rstLst/?sw=xxx
  const url = `https://tabelog.com/${area}/rstLst/?sw=${encodeURIComponent(q)}`;
  const { ok, text } = await fetchText(url, timeoutMs);
  if (!ok) return '';
  const urls = extractTabelogStoreUrls(text);
  const found = urls.find((u) => u.includes(`https://tabelog.com/${area}/`));
  return found || '';
}

function extractFirstYelpBizUrl(html) {
  const s = String(html || '');
  // Yelp 商户页通常包含 /biz/<slug>
  const m = s.match(/href=["'](\/biz\/[^"'?#]+)["']/i);
  if (m?.[1]) return `https://www.yelp.com${m[1]}`;
  const m2 = s.match(/https?:\/\/www\.yelp\.com\/biz\/[^"'?#\s]+/i);
  return m2?.[0] ? m2[0].replace(/^http:/, 'https:') : '';
}

async function yelpFindBizUrlBySearch(name, timeoutMs = 6500) {
  const q = norm(name);
  if (!q) return '';
  const url = `https://www.yelp.com/search?find_desc=${encodeURIComponent(q)}`;
  const { ok, text } = await fetchText(url, timeoutMs);
  if (!ok) return '';
  return extractFirstYelpBizUrl(text);
}

function tabelogUrlMatchesArea(areaSlug, url) {
  const area = norm(areaSlug).toLowerCase();
  const u = norm(url);
  if (!area || !u) return true;
  if (!u.includes('tabelog.com/')) return true;
  return u.includes(`tabelog.com/${area}/`);
}

function extractMetaImage(html) {
  const s = String(html || '');
  const pick = (re) => {
    const m = s.match(re);
    if (!m?.[1]) return '';
    // 解码常见 HTML 实体，避免返回 &amp; 导致图片 URL 不可用
    return norm(m[1])
      .replace(/&amp;/g, '&')
      .replace(/&#38;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>');
  };
  // og:image / twitter:image
  return (
    pick(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["'][^>]*>/i) ||
    pick(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["'][^>]*>/i) ||
    pick(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["'][^>]*>/i) ||
    pick(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["'][^>]*>/i) ||
    ''
  );
}

function extractFirstTabelogImageFromHtml(html) {
  const s = String(html || '');
  // 1) 优先使用图片区域的 original?id=... 原图入口（例如 /imgview/original?id=r10037122046104）
  const reOrigAbs = /https?:\/\/tabelog\.com\/imgview\/original\?id=[^"'>\s]+/i;
  const mOrigAbs = s.match(reOrigAbs);
  if (mOrigAbs?.[0]) {
    return String(mOrigAbs[0]).replace(/^http:/, 'https:').replace(/&amp;/g, '&').trim();
  }
  const reOrigRel = /href=["'](\/imgview\/original\?id=[^"'>\s]+)["']/i;
  const mOrigRel = s.match(reOrigRel);
  if (mOrigRel?.[1]) {
    return `https://tabelog.com${String(mOrigRel[1]).replace(/&amp;/g, '&').trim()}`;
  }

  // 2) 其次兜底到常见图片 CDN（tblg.k-img.com）
  const re = /https?:\/\/tblg\.k-img\.com\/[^"'\s>]+?\.(?:jpg|jpeg|png)(?:\?[^"'\s>]*)?/i;
  const m = s.match(re);
  if (!m?.[0]) return '';
  return String(m[0]).replace(/^http:/, 'https:').replace(/&amp;/g, '&').trim();
}

async function ogImageFromPage(url) {
  if (!isHttpUrl(url)) return '';
  const isTabelog = String(url).includes('tabelog.com/');
  const normalizeTabelogBase = (u) => {
    const s = String(u || '').trim();
    if (!s) return '';
    return s.endsWith('/') ? s : `${s}/`;
  };

  const tryExtract = async (pageUrl) => {
    const { ok, text } = await fetchText(pageUrl);
    if (!ok) return '';
    let img = extractMetaImage(text);
    if (!img && isTabelog) img = extractFirstTabelogImageFromHtml(text);
    return img || '';
  };

  // 先尝试原页面
  let img = await tryExtract(url);
  // Tabelog 兜底：抓图片列表页（店铺主页可能反爬/不含图片）
  if (!img && isTabelog) {
    const photoUrl = `${normalizeTabelogBase(url)}dtlphotolst/`;
    img = await tryExtract(photoUrl);
  }
  if (!img) return '';
  // 处理相对路径
  try {
    const abs = new URL(img, url).toString();
    return abs;
  } catch {
    return isHttpUrl(img) ? img : '';
  }
}

async function deepSeekFindLinksBatch({ cityZh, names }) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return null;

  const list = names.map((n) => `- ${n}`).join('\n');
  const prompt = `你是一个信息检索助手。请为下面这些餐厅，尽量找到它们的：\n- Tabelog URL（tabelog_url）\n- Yelp URL（yelp_url）\n- 官网 URL（official_url）\n- Wikidata 条目 ID（wikidata_id，形如 \"Q12345\"；不确定就留空）\n- Wikipedia 条目 URL（wikipedia_url；不确定就留空）\n- 其他可信的图片页面 URL（image_page_url，优先能在页面 meta 里找到 og:image 的页面）\n\n约束：\n- 你只能输出 JSON 数组，不要输出任何解释文字。\n- 数组元素字段必须包含 name、tabelog_url、yelp_url、official_url、wikidata_id、wikipedia_url、image_page_url（没有就输出空字符串）。\n- URL 必须以 http:// 或 https:// 开头（优先 https）。\n- 如果无法确定，就留空字符串，不要编造。\n\n城市/区域提示：${cityZh}\n餐厅列表：\n${list}`;

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 9000);
  try {
    const resp = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 1600,
        temperature: 0.2,
      }),
    });
    const body = await resp.text().catch(() => '');
    if (!resp.ok) {
      console.warn('[resolveRestaurantMedia] DeepSeek non-200', resp.status, body?.slice(0, 200));
      return null;
    }
    let data = {};
    try { data = JSON.parse(body || '{}'); } catch (_) {}
    const out = data.choices?.[0]?.message?.content || '';
    return tryParseJsonArray(out);
  } catch (e) {
    console.warn('[resolveRestaurantMedia] DeepSeek error', e?.name || e?.message);
    return null;
  } finally {
    clearTimeout(t);
  }
}

/**
 * 通过 DeepSeek 提供候选链接，再从页面抽取 og:image 作为封面图。
 * 只在 Wikidata 没命中时作为补充策略。
 */
export async function resolveRestaurantMediaBatch({ cityZh, restaurants, budgetMs = 6500 } = {}) {
  const cityHint = norm(cityZh);
  // 尽量从中文城市提示推断 Tabelog 区域（只做常用映射，不命中则回退全站搜）
  const areaSlug = /东京/.test(cityHint) ? 'tokyo'
    : /大阪/.test(cityHint) ? 'osaka'
      : /京都/.test(cityHint) ? 'kyoto'
        : /名古屋/.test(cityHint) ? 'aichi'
          : /北海道|札幌/.test(cityHint) ? 'hokkaido'
            : /神户|兵库/.test(cityHint) ? 'hyogo'
              : /冲绳|那霸|沖縄|那覇/.test(cityHint) ? 'okinawa'
                : '';
  const items = Array.isArray(restaurants) ? restaurants : [];
  const names = items.map((r) => normalizeRestaurantName(r?.name)).filter(Boolean);
  if (names.length === 0) return new Map();
  const startedAt = Date.now();
  const softBudgetMs = Math.max(1000, Math.min(15000, parseInt(budgetMs, 10) || 6500));

  const missing = [];
  for (const r of items) {
    const name = normalizeRestaurantName(r?.name);
    if (!name) continue;
    // 已有持久化最佳图则跳过（避免重复抓取）
    const best = getBestCachedMedia({ cityHint, name });
    if (best?.image_url && !isFallbackImage(best.image_url)) continue;
    const key = `media:${cityHint}|${name}`;
    const cached = cache.get(key);
    if (cached && Date.now() < cached.exp) continue;
    missing.push(name);
  }

  // DeepSeek 辅助：只做“补链接”，不阻塞出图（短超时，拿不到就跳过）
  const batchNames = missing.slice(0, 10);
  const linkArr = batchNames.length
    ? await Promise.race([
      deepSeekFindLinksBatch({ cityZh: cityHint, names: batchNames }),
      new Promise((resolve) => setTimeout(() => resolve(null), 1200)),
    ])
    : null;
  const byName = new Map();
  if (Array.isArray(linkArr)) {
    for (const row of linkArr) {
      const name = norm(row?.name);
      if (!name) continue;
      const wikidata_id = /^Q\d+$/.test(norm(row?.wikidata_id)) ? norm(row.wikidata_id) : '';
      const wikipedia_url = isHttpUrl(row?.wikipedia_url) ? row.wikipedia_url : '';
      const official_url = isHttpUrl(row?.official_url) ? row.official_url : '';
      const tabelog_url = isHttpUrl(row?.tabelog_url) ? row.tabelog_url : '';
      const yelp_url = isHttpUrl(row?.yelp_url) ? row.yelp_url : '';
      const image_page_url = isHttpUrl(row?.image_page_url) ? row.image_page_url : '';
      byName.set(name, { wikidata_id, wikipedia_url, official_url, tabelog_url, yelp_url, image_page_url });
    }
  }

  const result = new Map();
  for (const r of items) {
    const outOfBudget = Date.now() - startedAt > softBudgetMs;
    const name = normalizeRestaurantName(r?.name);
    if (!name) continue;
    const key = `media:${cityHint}|${name}`;
    const cached = cache.get(key);
    if (cached && Date.now() < cached.exp) {
      result.set(name, cached.val);
      continue;
    }

    const links = byName.get(name) || { wikidata_id: '', wikipedia_url: '', official_url: '', tabelog_url: '', yelp_url: '', image_page_url: '' };
    // 优先级（全局统一）：Tabelog -> Yelp -> 官网 ->（手动图由上层应用）-> 都没有则留空给上层兜底
    let image_url = '';
    try {
      // 若当前有区域约束，丢弃不在该区域下的 tabelog_url（避免 LLM 给错县/市）
      if (areaSlug && links.tabelog_url && !tabelogUrlMatchesArea(areaSlug, links.tabelog_url)) {
        links.tabelog_url = '';
      }

      // 预算耗尽：只做“补 URL”与缓存，避免拖慢接口
      if (outOfBudget) {
        if (!links.tabelog_url) {
          const foundInArea = areaSlug ? await tabelogFindStoreUrlBySearchInArea(areaSlug, name, r?.address, 2200) : '';
          const foundGlobal = foundInArea ? '' : await tabelogFindStoreUrlBySearch(name, r?.address, 2200);
          const found = foundInArea || foundGlobal;
          if (found && (!areaSlug || tabelogUrlMatchesArea(areaSlug, found))) links.tabelog_url = found;
        }
        if (!links.yelp_url) {
          const found = await yelpFindBizUrlBySearch(name, 2200);
          if (found) links.yelp_url = found;
        }
      } else {
      // 若还没有 tabelog_url，尝试用 Tabelog 站内搜索定位店铺页（比 LLM 更稳定）
      if (!links.tabelog_url) {
        const foundInArea = areaSlug ? await tabelogFindStoreUrlBySearchInArea(areaSlug, name, r?.address, 4500) : '';
        let found = foundInArea;
        if (!found) {
          // 全站搜索时也做区域过滤：若当前是 tokyo，则只接受 /tokyo/ 的店铺页
          const searchQ = tabelogSearchQuery(name, r?.address);
          const globalUrl = `https://tabelog.com/rstLst/?sw=${encodeURIComponent(searchQ || name)}`;
          const { ok, text } = await fetchText(globalUrl, 4500);
          if (ok) {
            const urls = extractTabelogStoreUrls(text);
            if (areaSlug) {
              found = urls.find((u) => u.includes(`https://tabelog.com/${areaSlug}/`)) || '';
            } else {
              found = urls[0] || '';
            }
          }
        }
        if (found) links.tabelog_url = found;
      }
      if (links.tabelog_url) {
        image_url = (await ogImageFromPage(links.tabelog_url)) || '';
      }

      // Yelp：无 key 站内搜索 + 抓 og:image
      if (!image_url) {
        if (!links.yelp_url) {
          const found = await yelpFindBizUrlBySearch(name, 4500);
          if (found) links.yelp_url = found;
        }
        if (links.yelp_url) {
          image_url = (await ogImageFromPage(links.yelp_url)) || '';
        }
      }

      // 官网：优先于 Wiki
      if (!image_url && links.official_url) {
        image_url = (await ogImageFromPage(links.official_url)) || '';
      }

      // 不再使用 Wiki/DeepSeek 找图：让“手动图”作为最后一层（在上层 recommendations 里应用）
      }
    } catch {
      image_url = '';
    }

    // 最终兜底校验：有区域约束时绝不输出跨区 Tabelog 链接
    if (areaSlug && links.tabelog_url && !tabelogUrlMatchesArea(areaSlug, links.tabelog_url)) {
      links.tabelog_url = '';
    }

    const val = {
      wikidata_id: links.wikidata_id || '',
      wikipedia_url: links.wikipedia_url || '',
      official_url: links.official_url || '',
      tabelog_url: links.tabelog_url || '',
      yelp_url: links.yelp_url || '',
      image_page_url: links.image_page_url || '',
      image_url: isHttpUrl(image_url) ? image_url : '',
    };
    const ttl = val.image_url ? CACHE_TTL_MS_OK : CACHE_TTL_MS_EMPTY;
    cache.set(key, { val, exp: Date.now() + ttl });

    // 只要拿到过一次“非兜底图”，就写入 bestCache；下次优先直接复用，加速首页加载
    if (val.image_url && !isFallbackImage(val.image_url)) {
      setBestCachedMedia({ cityHint, name, val });
    }
    result.set(name, val);
  }

  return result;
}

export function clearRestaurantMediaCache() {
  cache.clear();
  bestMem.clear();
}

