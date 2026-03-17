import { Router } from 'express';
import { getDb } from '../db.js';
import { clearTranslateCache } from '../services/translateToEn.js';
import { batchTranslateWithPersistentCache } from '../services/translateWithPersistentCache.js';
import { resolveRestaurantImage, clearRestaurantImageCache } from '../services/resolveRestaurantImage.js';
import { resolveRestaurantMediaBatch, getBestCachedMedia, clearRestaurantMediaCache } from '../services/resolveRestaurantMedia.js';
import {
  isFallbackImage,
  filterToListWithCover,
  readBestRecommendations,
  writeBestRecommendations,
  applyBestMediaOverlay,
  filterListByCityKey,
  excludeNeedManualImageOnly,
  CITY_LABEL_MAP,
} from '../services/recommendationsStore.js';

const router = Router();

// 简单内存缓存：按 country|city|uiLang 缓存，避免频繁调用 DeepSeek
const cache = new Map();
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const refreshInFlight = new Map(); // key -> true

/** 只清内存/媒体缓存，不删 recommendations_best，避免 buildPreload 等写好的预加载被清掉 */
export function clearRecommendationsCache() {
  cache.clear();
  clearTranslateCache();
  clearRestaurantImageCache();
  clearRestaurantMediaCache();
}

function hasCJK(s) {
  return typeof s === 'string' && /[\u4e00-\u9fff\u3040-\u30ff]/.test(s);
}

/** 为餐厅列表附加英文翻译字段，优先用 SQLite 缓存，实现英文模式秒开 */
async function attachEnFields(restaurants) {
  if (!Array.isArray(restaurants) || restaurants.length === 0) return restaurants;
  const names = [];
  const cities = [];
  const addresses = [];
  const features = [];
  const seen = { name: new Map(), city: new Map(), address: new Map(), feature: new Map() };
  for (const r of restaurants) {
    for (const [key, arr, map] of [
      ['name', names, seen.name],
      ['city', cities, seen.city],
      ['address', addresses, seen.address],
      ['feature', features, seen.feature],
    ]) {
      const t = (r[key] || '').trim();
      if (t && hasCJK(t) && !map.has(t)) {
        map.set(t, arr.length);
        arr.push(t);
      }
    }
  }
  const all = [...names, ...cities, ...addresses, ...features];
  if (all.length === 0) return restaurants;
  const translated = await batchTranslateWithPersistentCache(all);
  const nameMap = { name: new Map(), city: new Map(), address: new Map(), feature: new Map() };
  let idx = 0;
  for (const [arr, map] of [[names, nameMap.name], [cities, nameMap.city], [addresses, nameMap.address], [features, nameMap.feature]]) {
    for (const t of arr) {
      const v = translated[idx++];
      if (v && !hasCJK(v)) map.set(t, v);
    }
  }
  return restaurants.map((r) => ({
    ...r,
    name_en: nameMap.name.get((r.name || '').trim()) || r.name_en || (r.name && r.name.match(/\(([^)]+)\)/)?.[1]),
    city_en: nameMap.city.get((r.city || '').trim()) || r.city_en,
    address_en: nameMap.address.get((r.address || '').trim()) || r.address_en,
    feature_en: nameMap.feature.get((r.feature || '').trim()) || r.feature_en,
  }));
}

function stripFencesAndExtractArrayText(raw) {
  let content = String(raw || '').trim();
  if (!content) return '[]';
  if (content.startsWith('```')) {
    const endFence = content.lastIndexOf('```');
    if (endFence > 3) {
      let inner = content.slice(3, endFence).trim();
      inner = inner.replace(/^json/i, '').trim();
      content = inner || content;
    }
  }
  const first = content.indexOf('[');
  if (first !== -1) content = content.slice(first);
  return content;
}

/**
 * 从可能截断/带解释文字的内容里，尽量提取数组中已完整闭合的对象（{...}）。
 * 目标：永不因为“中途截断”导致整个接口失败。
 */
function parseRestaurantsBestEffort(rawContent) {
  const content = stripFencesAndExtractArrayText(rawContent);
  // 先尝试标准 JSON.parse（正常情况最快）
  try {
    const arr = JSON.parse(content);
    if (Array.isArray(arr)) return arr;
  } catch (_) {}

  // 兜底：逐字符扫描，收集数组里的完整对象子串，再逐个 JSON.parse
  const objects = [];
  let inString = false;
  let escape = false;
  let depth = 0; // 对象 { } 深度
  let started = false;
  let buf = '';

  for (let i = 0; i < content.length; i += 1) {
    const ch = content[i];
    if (!started) {
      if (ch === '{') {
        started = true;
        depth = 1;
        buf = '{';
      }
      continue;
    }

    buf += ch;

    if (escape) {
      escape = false;
      continue;
    }
    if (ch === '\\') {
      if (inString) escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (ch === '{') depth += 1;
    else if (ch === '}') depth -= 1;

    if (depth === 0) {
      objects.push(buf);
      started = false;
      buf = '';
    }
  }

  const arr = [];
  for (const objText of objects) {
    try {
      const obj = JSON.parse(objText);
      if (obj && typeof obj === 'object') arr.push(obj);
    } catch (_) {}
  }
  return arr;
}

router.get('/', async (req, res) => {
  const country = (req.query.country || 'jp').toString().toLowerCase();
  const city = (req.query.city || 'tokyo').toString().toLowerCase();
  const lang = (req.query.lang || 'zh').toString().toLowerCase();
  const wantEn = lang === 'en' || lang === 'en-us' || lang === 'en-gb';
  const key = `${country}|${city}`;
  const clearCache = req.query.clear_cache === '1' || req.query.clear_cache === 'true';
  // 默认每次访问都后台预热/更新；显式 warm_media=0 才关闭
  const warmMedia = !(req.query.warm_media === '0' || req.query.warm_media === 'false');
  // 默认给更充足的补媒体预算（已有请求级超时，不会再卡死）
  const mediaBudgetMs = Math.max(0, Math.min(8000, parseInt(req.query.media_budget_ms, 10) || 6500));

  const cityZh = CITY_LABEL_MAP[city] || city;

  const sendRestaurants = async (list, opts = {}) => {
    const { fromBestDb = false, fromCache = true } = opts;
    let out = filterToListWithCover(list);
    if (wantEn && out.length > 0) {
      out = await attachEnFields(out);
    }
    res.json({ ok: true, fromCache, fromBestDb, restaurants: out });
  };

  if (clearCache) {
    clearRecommendationsCache();
  }

  // 0) SQLite 持久缓存优先：用于“冷启动/重启后也能秒回上一份列表”
  if (!clearCache) {
    const best = readBestRecommendations({ country, cityKey: city });
    if (best?.restaurants?.length) {
      let snapshot = applyBestMediaOverlay({ restaurants: best.restaurants, cityZh: cityZh || best.cityZh });
      snapshot = filterListByCityKey(snapshot, city);
      snapshot = excludeNeedManualImageOnly(snapshot);
      cache.set(key, { restaurants: snapshot, fetchedAt: Date.now() });
      return sendRestaurants(snapshot, { fromBestDb: true });
    }
  }

  const cached = !clearCache && cache.get(key);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    // 每次命中缓存也重新套一遍 best-cache（包含你手动设置的图片），避免切换城市后“封面图消失”
    const snapshot = Array.isArray(cached.restaurants) ? cached.restaurants.map((r) => ({ ...r })) : [];
    for (const r of snapshot) {
      const best = getBestCachedMedia({ cityHint: cityZh, name: r.name });
      if (best?.image_url && !isFallbackImage(best.image_url)) r.image = best.image_url;
      if (best?.manual_image_url && best.manual_enabled !== 0) r.image = best.manual_image_url;
    }
    let filteredForCity = filterListByCityKey(snapshot, city);
    filteredForCity = excludeNeedManualImageOnly(filteredForCity);
    snapshot.length = 0;
    snapshot.push(...filteredForCity);

    if (warmMedia) {
      setImmediate(async () => {
        try {
          const targets = snapshot.filter((r) => isFallbackImage(r.image) && r.tabelog_url);
          if (targets.length > 0) {
            // 给更长预算后台补图（命中会写入 SQLite best-cache）
            await resolveRestaurantMediaBatch({ cityZh, restaurants: targets, budgetMs: 60000 });
            // 回填最新 best-cache 并更新内存缓存，让下次 fromCache 直接命中新图
            for (const r of snapshot) {
              if (!isFallbackImage(r.image)) continue;
              const best = getBestCachedMedia({ cityHint: cityZh, name: r.name });
              if (best?.image_url && !isFallbackImage(best.image_url)) r.image = best.image_url;
              if (best?.manual_image_url && best.manual_enabled !== 0) r.image = best.manual_image_url;
            }
            cache.set(key, { restaurants: snapshot, fetchedAt: Date.now() });
          }
          // 餐厅信息也做预加载：缓存较旧时后台刷新一次推荐列表（SWR，不阻塞）
          const ageMs = Date.now() - (cached.fetchedAt || 0);
          if (ageMs > 10 * 60 * 1000 && !refreshInFlight.get(key)) {
            refreshInFlight.set(key, true);
            try {
              const url = `http://localhost:${process.env.PORT || 3000}/api/recommendations?country=${encodeURIComponent(country)}&city=${encodeURIComponent(city)}&clear_cache=1`;
              const resp = await fetch(url).catch(() => null);
              const data = resp ? await resp.json().catch(() => ({})) : {};
              if (data?.ok && Array.isArray(data.restaurants)) {
                cache.set(key, { restaurants: data.restaurants, fetchedAt: Date.now() });
              }
            } catch {
              // ignore
            } finally {
              refreshInFlight.delete(key);
            }
          }
        } catch (e) {
          console.warn('[recommendations] warm_media(cache) failed', e?.message);
        }
      });
    }
    return sendRestaurants(snapshot);
  }

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ ok: false, message: 'DEEPSEEK_API_KEY 未配置，无法获取推荐餐厅' });
  }

  const countryZh = country === 'jp' ? '日本' : country;

  const promptZh = `你是一名餐厅推荐助手，请根据「${countryZh}${cityZh}」为中国游客推荐 10 家适合通过电话预约的热门餐厅。

要求：
1. 优先选择米其林指南餐厅、Tabelog 高分、Google 地图评价高、以及大众点评/携程/马蜂窝等平台上常被推荐的餐厅。
2. 需要覆盖多种类型：寿司、烤肉、居酒屋、拉面、咖啡甜品等，不要全部是同一类型。
3. 输出严格为 JSON 数组，每个元素包含字段：
   - "id": 英文小写 id（字母+数字），例如 "tokyo-sushi-1"
   - "name": 餐厅名称（日文 + 可选英文）
   - "city": 简短城市区域描述，例如 "东京・新宿"
   - "phone": 预约电话（含区号，如 03-xxxx-xxxx 或 +81-3-xxxx-xxxx）
   - "address": 日文详细地址
   - "feature": 1 句中文说明餐厅特色或推荐菜（尽量短，<= 16 个汉字）
   - "call_lang": "ja" 或 "en"（主要通话语言，普通日本餐厅用 "ja"，欧美餐厅用 "en"）
   - "image": 必须输出空字符串 ""（图片由服务端补全，不要输出示例 URL）

4. 只输出 JSON，不要添加任何解释文字，也不要使用注释。
5. 必须输出“单行紧凑 JSON”（不要换行/缩进/多余空格），以减少输出长度。
6. 必须输出完整的 10 条记录 JSON 数组，不要中途截断。`;

  // 始终用中文 prompt 返回中文列表；英文版由前端拿到后直接调用翻译再展示
  const prompt = promptZh;

  try {
    const resp = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 4096,
        temperature: 0.4,
      }),
    });
    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      console.error('[recommendations] DeepSeek error', resp.status, errText?.slice(0, 200));
      return res.status(500).json({ ok: false, message: '获取推荐餐厅失败，请稍后重试' });
    }
    const data = await resp.json().catch(() => ({}));
    const content = data.choices?.[0]?.message?.content || '[]';
    let restaurants = parseRestaurantsBestEffort(content);
    if (!Array.isArray(restaurants)) restaurants = [];
    if (restaurants.length === 0) {
      const preview = String(stripFencesAndExtractArrayText(content)).slice(0, 260);
      console.error('[recommendations] JSON parse failed, content=', preview);
    }

    restaurants = restaurants
      .filter((r) => r && typeof r.name === 'string')
      .map((r, idx) => ({
        id: r.id || `${city}-${idx + 1}`,
        country,
        cityKey: city,
        name: r.name,
        city: r.city || cityZh,
        phone: r.phone || '',
        address: r.address || '',
        feature: r.feature || '',
        call_lang: (r.call_lang || (country === 'jp' ? 'ja' : 'en')).toLowerCase(),
        // 始终忽略模型返回的 image（经常是 example.com 等无效/示例链接），由服务端统一补全
        image: '',
      }));

    // 补全封面图：优先 Wikidata/Wikimedia Commons；失败再用通用占位图
    const FALLBACK_IMAGE = 'https://images.pexels.com/photos/4106483/pexels-photo-4106483.jpeg';
    // 0) 优先使用“历史最佳图”（只要命中过一次非兜底图，就直接复用，显著加快首页加载）
    for (const r of restaurants) {
      const best = getBestCachedMedia({ cityHint: cityZh, name: r.name });
      if (best?.image_url) r.image = best.image_url;
      if (best?.tabelog_url && !r.tabelog_url) r.tabelog_url = best.tabelog_url;
      if (best?.yelp_url && !r.yelp_url) r.yelp_url = best.yelp_url;
      if (best?.official_url && !r.official_url) r.official_url = best.official_url;
      if (best?.wikipedia_url && !r.wikipedia_url) r.wikipedia_url = best.wikipedia_url;
      if (best?.manual_image_url) r.manual_image_url = best.manual_image_url;
      if (typeof best?.manual_enabled !== 'undefined') r.manual_enabled = best.manual_enabled;
    }

    // 1) 优先用 Tabelog/Yelp 补链接并抓图片（按你的要求优先第三方美食站点图片）
    const mediaMap = await resolveRestaurantMediaBatch({ cityZh, restaurants, budgetMs: mediaBudgetMs });
    const normalizeKey = (s) => String(s || '').trim().replace(/\s*[\(（][^\)）]*[\)）]\s*/g, ' ').replace(/\s{2,}/g, ' ').trim();
    for (const r of restaurants) {
      const m = mediaMap.get(normalizeKey(r.name));
      if (m) {
        // 可选：把链接返回给前端（用于“官网 / Tabelog”跳转）
        r.wikidata_id = m.wikidata_id || '';
        r.wikipedia_url = m.wikipedia_url || '';
        r.official_url = m.official_url || '';
        r.tabelog_url = m.tabelog_url || '';
        r.yelp_url = m.yelp_url || '';
        // 若拿到第三方图片，优先覆盖（即使之前有 Commons 图）
        if (m.image_url) r.image = m.image_url;
      } else {
        // 保证字段一致，便于前端渲染/调试
        r.wikidata_id = '';
        r.wikipedia_url = '';
        r.official_url = '';
        r.tabelog_url = '';
        r.yelp_url = '';
      }
      // 手动图：始终优先于 Tabelog/Yelp/官网/兜底，只要开启就覆盖
      if (r.manual_enabled !== 0 && r.manual_image_url) {
        r.image = r.manual_image_url;
      }
      if (!r.image) r.image = FALLBACK_IMAGE;
    }

    // 2) 最后兜底：仅对仍没有图片的餐厅尝试 Wikidata/Commons
    await Promise.all(
      restaurants.map(async (r) => {
        if (r.image && r.image !== FALLBACK_IMAGE) return;
        try {
          const img = await resolveRestaurantImage({ name: r.name, hintCity: r.city, feature: r.feature });
          if (img) r.image = img;
        } catch {}
      })
    );

    for (const r of restaurants) {
      if (!r.image) r.image = FALLBACK_IMAGE;
    }

    let listForResponse = filterListByCityKey(restaurants, city);
    listForResponse = excludeNeedManualImageOnly(listForResponse);
    cache.set(key, { restaurants: listForResponse, fetchedAt: Date.now() });
    const toStore = filterToListWithCover(listForResponse).slice(0, 10);
    writeBestRecommendations({ country, cityKey: city, cityZh, restaurants: toStore });
    return sendRestaurants(listForResponse, { fromCache: false });

    // 可选：后台预热（不阻塞响应）。用于把仍是占位图的餐厅继续补齐并持久化 best-cache
    if (warmMedia) {
      const snapshot = restaurants.map((r) => ({ ...r }));
      setImmediate(async () => {
        try {
          // 给更长预算，尽量把剩余占位图补齐（命中后会写入 SQLite best-cache）
          await resolveRestaurantMediaBatch({ cityZh, restaurants: snapshot, budgetMs: 60000 });
        } catch (e) {
          console.warn('[recommendations] warm_media failed', e?.message);
        }
      });
    }
  } catch (e) {
    console.error('[recommendations] request failed', e.message);
    res.status(500).json({ ok: false, message: '获取推荐餐厅失败，请稍后重试' });
  }
});

export default router;

