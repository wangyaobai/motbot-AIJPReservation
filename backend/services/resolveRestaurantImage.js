/**
 * 特色/菜名自动找图：先 Wikidata（餐厅名）→ 再 DeepSeek（餐厅名+城市+特色/菜名）返回一张图 URL。
 * 成功率受限于：Wikidata 覆盖率、DeepSeek 返回 URL 是否可访问；可改进为多关键词、HEAD 校验、或接入图片搜索 API。
 */
const cache = new Map();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function normalizeName(name) {
  const s = String(name || '').trim();
  if (!s) return '';
  // 去掉括号里的英文/别名，避免影响 Wikidata 搜索（支持半角/全角括号）
  return s
    .replace(/\s*[\(（][^\)）]*[\)）]\s*/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

async function fetchJsonWithTimeout(url, timeoutMs = 5000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { signal: controller.signal });
    const data = await resp.json().catch(() => ({}));
    return { ok: resp.ok, status: resp.status, data };
  } finally {
    clearTimeout(t);
  }
}

function commonsFilePath(filename, width = 960) {
  const f = String(filename || '').trim();
  if (!f) return '';
  // Special:FilePath 会 302 到真实图片地址，支持 width 参数生成缩略图
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(f)}?width=${width}`;
}

function isHttpUrl(s) {
  try {
    const u = new URL(String(s));
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function extractFirstHttpUrl(s) {
  const m = String(s || '').match(/https?:\/\/[^\s"'<>]+/);
  return m?.[0] || '';
}

async function wikidataSearch(name, lang) {
  const url = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(name)}&language=${encodeURIComponent(lang)}&format=json&limit=8&origin=*`;
  const { ok, status, data } = await fetchJsonWithTimeout(url, 4500);
  if (!ok) return [];
  return Array.isArray(data.search) ? data.search : [];
}

async function wikidataGetP18(entityId) {
  const id = String(entityId || '').trim();
  if (!id) return '';
  const url = `https://www.wikidata.org/wiki/Special:EntityData/${encodeURIComponent(id)}.json`;
  const { ok, data } = await fetchJsonWithTimeout(url, 4500);
  if (!ok) return '';
  const entity = data?.entities?.[id];
  const claims = entity?.claims;
  const p18 = claims?.P18?.[0]?.mainsnak?.datavalue?.value;
  return typeof p18 === 'string' ? p18 : '';
}

/**
 * 自动找图流程（提升成功率可考虑）：
 * 1. 先用餐厅名查 Wikidata/Wikimedia Commons（日文+英文），命中则用 P18 图片。
 * 2. 未命中则用「餐厅名 + 城市 + 特色/菜名」调 DeepSeek 返回一个图片 URL。
 * 提升方向：补充更具体的菜名/料理类型；对 DeepSeek 结果做 HEAD 校验或重试；接入 Google/Bing 图片搜索 API。
 */
async function deepSeekImageByDish({ name, feature, hintCity } = {}) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return '';

  const n = normalizeName(name);
  const city = String(hintCity || '').trim();
  const dish = String(feature || '').trim();
  const dishHint = dish || `餐厅：${n}`;

  const prompt = `你是一个帮我找配图的助手。

现在有一家餐厅以及它的菜品/推荐特色描述，请你根据这些信息，在公开网络上帮我找一张「真实食物照片或餐厅相关照片」的图片 URL，要求：
- 一定要是可以直接访问的 http(s) 图片链接（jpg/jpeg/png/webp 等静态图片）
- 不要返回任何示例域名（例如 example.com）、占位图、素材站的通用 banner
- 如果有多张图，只选最能代表这家餐厅菜品特色的一张
- 只输出一个 URL，不要输出任何解释文本

餐厅名称：${n || '（名称未知）'}
城市/区域：${city || '（未知城市）'}
菜品/推荐特色：${dishHint}`;

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 8000);
  try {
    const resp = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 256,
        temperature: 0.3,
      }),
    });
    const body = await resp.text().catch(() => '');
    if (!resp.ok) {
      console.warn('[resolveRestaurantImage] DeepSeek image non-200', resp.status, body?.slice(0, 200));
      return '';
    }
    let candidate = '';
    try {
      const data = JSON.parse(body || '{}');
      const content = data?.choices?.[0]?.message?.content || '';
      candidate = extractFirstHttpUrl(content);
    } catch {
      candidate = extractFirstHttpUrl(body);
    }
    return isHttpUrl(candidate) ? candidate : '';
  } catch (e) {
    console.warn('[resolveRestaurantImage] DeepSeek image error', e?.name || e?.message);
    return '';
  } finally {
    clearTimeout(t);
  }
}

/**
 * 基于 Wikidata/Wikimedia Commons 尝试为餐厅名解析封面图。
 * - 无需 Google API key
 * - 命中率取决于餐厅是否有 Wikidata 条目/图片
 */
export async function resolveRestaurantImage({ name, hintCity, feature } = {}) {
  const n = normalizeName(name);
  if (!n) return '';
  const key = `img:${n}|${String(hintCity || '').trim()}`;
  const cached = cache.get(key);
  if (cached && Date.now() < cached.exp) return cached.val;

  // 先用日文搜索，再用英文搜索（日本餐厅更容易命中 ja）
  const langs = ['ja', 'en'];
  let bestFile = '';

  for (const lang of langs) {
    const results = await wikidataSearch(n, lang);
    for (const r of results) {
      const file = await wikidataGetP18(r.id);
      if (file) {
        bestFile = file;
        break;
      }
    }
    if (bestFile) break;
  }

  let url = bestFile ? commonsFilePath(bestFile, 960) : '';

  // 若基于 Wikidata 未命中，则退而求其次：用餐厅特色里的菜名做模糊搜索，请 DeepSeek 帮忙找一张合适的图片
  if (!url) {
    const dishImage = await deepSeekImageByDish({ name: n, feature, hintCity });
    if (dishImage) url = dishImage;
  }

  cache.set(key, { val: url, exp: Date.now() + CACHE_TTL_MS });
  return url;
}

export function clearRestaurantImageCache() {
  cache.clear();
}

