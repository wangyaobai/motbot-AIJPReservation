import { Router } from 'express';
import { fetchRestaurantAddress } from '../services/restaurantAddress.js';

const router = Router();

// 从文本中提取日本电话号码（常见格式）
function extractJapanesePhone(text) {
  if (!text || typeof text !== 'string') return null;
  const patterns = [
    /\d{2,4}-\d{2,4}-\d{4}/,
    /0\d{1,4}-\d{1,4}-\d{4}/,
    /\+81\s*-?\s*\d{1,4}[-\s]?\d{2,4}[-\s]?\d{4}/,
    /\(\d{2,4}\)\s*\d{2,4}-\d{4}/,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) return m[0].replace(/\s/g, '').trim();
  }
  return null;
}

// 用 DeepSeek 从给定文本中提取电话（snippets 或直接问模型）
async function extractPhoneWithDeepSeek(query, snippetsText, options = {}) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return null;

  const isDirect = options.direct === true;
  const prompt = isDirect
    ? `请根据你的知识回答：日本有一家餐厅叫「${query}」，它的预订或联系电话是多少？只返回一个电话号码（格式如 03-1234-5678 或 +81-3-1234-5678）。如果不知道或不确定，只返回：未找到。不要解释，不要其他内容。`
    : `从以下与「${query}」相关的搜索结果中，找出该日本餐厅的联系电话或预订电话。
只返回一个电话号码（格式如 03-1234-5678 或 +81-3-1234-5678）。若没有找到任何电话，只返回：未找到。
不要解释，不要其他内容。

搜索结果：
${(snippetsText || '').slice(0, 6000)}`;

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
        max_tokens: 150,
        temperature: 0.1,
      }),
    });
    if (!resp.ok) {
      const err = await resp.text();
      console.error('DeepSeek API error', resp.status, err);
      return null;
    }
    const data = await resp.json();
    const text = data.choices?.[0]?.message?.content?.trim() || '';
    if (!text || text.includes('未找到')) return null;
    // 先尝试从回复中正则提取，再接受简短纯数字串
    const extracted = extractJapanesePhone(text);
    if (extracted) return extracted;
    if (text.length <= 30 && /\d{2,4}[-\d]{4,}/.test(text)) return text.replace(/\s/g, '').trim();
    return null;
  } catch (e) {
    console.error('DeepSeek request failed', e.message);
    return null;
  }
}

// 从 DuckDuckGo HTML 提取片段（多种可能的 class 结构）
async function getSnippetsFromDuckDuckGo(query) {
  try {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query + ' 日本 電話')}`;
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/html',
      },
    });
    if (!resp.ok) return [];
    const html = await resp.text();
    const snippets = [];
    // 尝试多种常见结构
    const patterns = [
      /class="result__snippet"[^>]*>([\s\S]*?)<\/div>/gi,
      /class="[^"]*snippet[^"]*"[^>]*>([\s\S]*?)<\/div>/gi,
      /class="result__body"[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/gi,
    ];
    const titlePat = /class="result__title"[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/gi;
    const titles = [];
    let m;
    while ((m = titlePat.exec(html)) !== null) titles.push(m[1].replace(/<[^>]+>/g, '').trim());
    for (const re of patterns) {
      re.lastIndex = 0;
      let i = 0;
      while ((m = re.exec(html)) !== null && i < 10) {
        const text = m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        if (text.length > 10) snippets.push({ title: titles[i] || query, snippet: text });
        i++;
      }
      if (snippets.length > 0) break;
    }
    return snippets;
  } catch (e) {
    console.error('DuckDuckGo fetch failed', e.message);
    return [];
  }
}

// 网页搜索：Serper 或 DuckDuckGo 获取片段，再用 DeepSeek 或正则提取电话
async function searchRestaurant(query) {
  const q = `${query.trim()} 日本 電話`;
  const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(q + ' 予約')}`;
  let snippets = [];
  let firstLink = null;

  // 1) 优先用 Serper 获取结构化结果
  const serperKey = process.env.SERPER_API_KEY;
  if (serperKey) {
    try {
      const resp = await fetch('https://google.serper.dev/search', {
        method: 'POST',
        headers: { 'X-API-KEY': serperKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ q, num: 10 }),
      });
      if (resp.ok) {
        const data = await resp.json();
        const organic = data.organic || [];
        firstLink = organic[0]?.link || null;
        snippets = organic.slice(0, 10).map((o) => ({
          title: o.title || '',
          snippet: o.snippet || '',
          link: o.link || '',
        }));
      }
    } catch (e) {
      console.error('Serper failed', e.message);
    }
  }

  // 2) 无 Serper 时用 DuckDuckGo HTML
  if (snippets.length === 0) {
    snippets = await getSnippetsFromDuckDuckGo(query);
  }

  const combinedText = snippets.map((s) => `${s.title} ${s.snippet}`).join('\n');
  const deepseekKey = process.env.DEEPSEEK_API_KEY;
  let phone = null;

  // 3) 有搜索片段时：先用 DeepSeek 从片段提取，再用正则
  if (combinedText.length >= 10) {
    if (deepseekKey) {
      phone = await extractPhoneWithDeepSeek(query, combinedText);
    }
    if (!phone) {
      phone = extractJapanesePhone(combinedText);
    }
  }

  // 4) 无片段或未解析到电话：若有 DeepSeek，直接问模型（根据知识回答）
  if (!phone && deepseekKey) {
    phone = await extractPhoneWithDeepSeek(query, null, { direct: true });
  }

  const places = [];
  if (phone) {
    places.push({
      name: snippets[0]?.title || query,
      phone,
      address: snippets[0]?.snippet?.slice(0, 80) || '',
      url: firstLink || snippets[0]?.link || searchUrl,
    });
  } else {
    for (const s of snippets.slice(0, 5)) {
      const p = extractJapanesePhone(`${s.title} ${s.snippet}`);
      if (p) places.push({ name: s.title || query, phone: p, address: (s.snippet || '').slice(0, 80), url: s.link || searchUrl });
    }
  }

  // 用 DeepSeek 为每条结果补全店铺地址，便于展示并随订单存储
  for (const p of places.slice(0, 5)) {
    try {
      const addr = await fetchRestaurantAddress(p.name, p.phone);
      if (addr) p.address = addr;
    } catch (e) {
      console.error('[search] fetchRestaurantAddress', p.name, e.message);
    }
  }

  return { places, searchUrl };
}

router.get('/restaurant', async (req, res) => {
  const { q } = req.query;
  if (!q || typeof q !== 'string' || q.trim().length === 0) {
    return res.json({ ok: true, places: [] });
  }

  const query = q.trim();

  try {
    const { places, searchUrl } = await searchRestaurant(query);

    if (places.length > 0) {
      return res.json({ ok: true, places });
    }

    const url = `https://www.google.com/search?q=${encodeURIComponent(query + ' 日本 電話 予約')}`;
    res.json({
      ok: true,
      places: [],
      searchUrl: url,
      message: '未解析到电话，可打开下方链接在浏览器中查找后手动填写',
    });
  } catch (e) {
    console.error(e);
    const url = `https://www.google.com/search?q=${encodeURIComponent(query + ' 日本 電話 予約')}`;
    res.json({
      ok: true,
      places: [],
      searchUrl: url,
      message: e.message || '搜索失败，可打开下方链接自行搜索',
    });
  }
});

export default router;
