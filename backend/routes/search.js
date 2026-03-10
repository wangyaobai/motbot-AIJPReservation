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

// 从文本中提取国际电话号码（美国/欧洲等，包含国家区号优先）
function extractInternationalPhone(text) {
  if (!text || typeof text !== 'string') return null;
  // 优先匹配带国家区号的号码，如 +1-212-555-1234 / +44 20 1234 5678
  const patterns = [
    /\+\d{1,3}[-\s]?\d{1,4}[-\s]?\d{3,4}[-\s]?\d{3,4}/,
    /\(\d{2,4}\)\s*\d{3,4}[-\s]?\d{3,4}/,
    /\d{3}[-\s]?\d{3}[-\s]?\d{4}/,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) return m[0].replace(/\s+/g, ' ').trim();
  }
  return null;
}

// 用 DeepSeek 从给定文本中提取电话（snippets 或直接问模型）
async function extractPhoneWithDeepSeek(query, snippetsText, options = {}) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return null;

  const isDirect = options.direct === true;
  const mode = options.mode === 'intl' ? 'intl' : 'jp';
  const emphasizeReservation = options.reservation === true;

  const reservationGuard = emphasizeReservation
    ? `重要：你必须返回“订位/预约/Reservation/Booking”的电话，且必须是该餐厅门店的对客电话。
- 严禁返回任何标注为 Corporate Office / Headquarters / Head Office / Office / Main Office / Media / PR / Investor Relations / Customer Service / Customer Support 等“集团/总机/办公室/客服”性质的号码。
- 若你看到多个号码：优先选择标注为 Reservations / Book a table / Reserve / For reservations / Reservation line 的号码；其次选择餐厅官网或 Google Maps 中明确用于订位的号码。
- 如果搜索结果中只出现上述“Corporate Office/Headquarters/Office/Customer Service”等非订位号码，而没有订位电话，则认为“未找到”，不要返回这些集团/总机号码。
`
    : '';

  const prompt = isDirect
    ? (mode === 'intl'
      ? `请根据你的知识回答：有一家餐厅叫「${query}」，它的预订或订位联系电话是多少？
${reservationGuard}
只返回一个电话号码。优先返回带国家区号的号码（如 +1-212-xxx-xxxx、+44-20-xxxx-xxxx 等），但如果你只能确定本地号码（如 (213) 514-5724 或 213-514-5724），也可以返回本地号码。
如果不知道或不确定，只返回：未找到。不要解释，不要其他内容。`
      : `请根据你的知识回答：日本有一家餐厅叫「${query}」，它的订位/予約/予約受付 电话是多少？
${reservationGuard}
只返回一个电话号码（格式如 03-1234-5678 或 +81-3-1234-5678）。如果不知道或不确定，只返回：未找到。不要解释，不要其他内容。`)
    : (mode === 'intl'
      ? `从以下与「${query}」相关的搜索结果中，找出该餐厅的订位/预约/Reservation 电话（包括美国/欧洲等地区）。
${reservationGuard}
只返回一个电话号码。优先带国家区号（如 +1-212-xxx-xxxx、+44-20-xxxx-xxxx 等）；如果只出现本地号码（如 (213) 514-5724 / 213-514-5724），也可以返回本地号码。若没有找到任何电话，只返回：未找到。
不要解释，不要其他内容。

搜索结果：
${(snippetsText || '').slice(0, 6000)}`
      : `从以下与「${query}」相关的搜索结果中，找出该日本餐厅的订位/予約/予約受付 电话。
${reservationGuard}
只返回一个电话号码（格式如 03-1234-5678 或 +81-3-1234-5678）。若没有找到任何电话，只返回：未找到。
不要解释，不要其他内容。

搜索结果：
${(snippetsText || '').slice(0, 6000)}`);

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
    const extracted = mode === 'intl' ? extractInternationalPhone(text) : extractJapanesePhone(text);
    if (extracted) return extracted;
    if (text.length <= 40 && /\d{2,4}[-\d\s]{4,}/.test(text)) return text.replace(/\s+/g, ' ').trim();
    return null;
  } catch (e) {
    console.error('DeepSeek request failed', e.message);
    return null;
  }
}

// 判断某品牌某号码是“reservation”（订位电话）还是“corporate”（集团/办公室等），只在有 DeepSeek 时使用
async function classifyPhoneRole(brand, phone) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return 'unknown';
  const prompt = `你是一个电话角色识别助手，请判断下列电话号码是餐厅订位电话还是集团/总部/办公室电话。

品牌或餐厅名称：${brand}
电话号码：${phone}

请在理解以下规则后再回答：
- 如果该号码主要用于 Reservation / Book a table / Reserve / For reservations / Reservations line 等订位用途，请回答：reservation
- 如果该号码主要用于 Corporate Office / Headquarters / Head Office / Office / Main Office / Customer Service / Customer Support / Media / PR / Investor Relations 等集团、总部或客服等非订位用途，请回答：corporate
- 如果你无法判断或两种用途都同时存在，请回答：unknown

严格只返回一个单词：reservation / corporate / unknown。不要添加其他任何文字。`;

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
        max_tokens: 5,
        temperature: 0,
      }),
    });
    if (!resp.ok) {
      const err = await resp.text();
      console.error('DeepSeek classifyPhoneRole error', resp.status, err);
      return 'unknown';
    }
    const data = await resp.json();
    const text = (data.choices?.[0]?.message?.content || '').trim().toLowerCase();
    if (text.includes('reservation')) return 'reservation';
    if (text.includes('corporate') || text.includes('office') || text.includes('headquarter')) return 'corporate';
    if (text.includes('unknown')) return 'unknown';
    return 'unknown';
  } catch (e) {
    console.error('classifyPhoneRole failed', e.message);
    return 'unknown';
  }
}

// 从 DuckDuckGo HTML 提取片段（多种可能的 class 结构）
async function getSnippetsFromDuckDuckGo(query) {
  try {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
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
    // DuckDuckGo 在部分网络环境（如国内）可能无法访问，这里静默降级为无片段，
    // 后续会直接走 DeepSeek 知识库或兜底搜索链接，不影响主流程。
    console.warn('[search] DuckDuckGo not reachable, skip HTML snippets fallback');
    return [];
  }
}

// 网页搜索：Serper 或 DuckDuckGo 获取片段，再用 DeepSeek 或正则提取电话
async function searchRestaurantJapan(query) {
  const q = `${query.trim()} 日本 電話`;
  const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(q + ' 予約')}`;
  let snippets = [];
  let firstLink = null;

  const deepseekKey = process.env.DEEPSEEK_API_KEY;
  let phone = null;

  // 0) 优先：只要有 DeepSeek，先直接问模型（更适合国内网络环境）
  if (deepseekKey) {
    phone = await extractPhoneWithDeepSeek(query, null, { direct: true, mode: 'jp', reservation: true });
  }

  // 1) 次优先：用 Serper 获取结构化结果
  const serperKey = process.env.SERPER_API_KEY;
  if (!phone && serperKey) {
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

  // 2) 无 Serper 时用 DuckDuckGo HTML（可能在国内不可用）
  if (!phone && snippets.length === 0) {
    snippets = await getSnippetsFromDuckDuckGo(q);
  }

  const combinedText = snippets.map((s) => `${s.title} ${s.snippet}`).join('\n');

  // 3) 有搜索片段时：先用 DeepSeek 从片段提取，再用正则
  if (!phone && combinedText.length >= 10) {
    if (deepseekKey) {
      phone = await extractPhoneWithDeepSeek(query, combinedText, { mode: 'jp', reservation: true });
    }
    if (!phone) {
      phone = extractJapanesePhone(combinedText);
    }
  }

  // 4) 兜底：若有 DeepSeek，再问一次（避免偶发失误）
  if (!phone && deepseekKey) phone = await extractPhoneWithDeepSeek(query, null, { direct: true, mode: 'jp', reservation: true });

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
      const addr = await fetchRestaurantAddress(p.name, p.phone, { lang: 'ja' });
      if (addr) p.address = addr;
    } catch (e) {
      console.error('[search] fetchRestaurantAddress', p.name, e.message);
    }
  }

  return { places, searchUrl };
}

async function searchRestaurantIntl(query) {
  const q = `${query.trim()} restaurant phone number`;
  const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(q + ' reservation')}`;
  let snippets = [];
  let firstLink = null;

  const deepseekKey = process.env.DEEPSEEK_API_KEY;
  let phone = null;

  // 0) 优先：只要有 DeepSeek，先直接问模型（更适合国内网络环境）
  if (deepseekKey) {
    phone = await extractPhoneWithDeepSeek(query, null, { direct: true, mode: 'intl', reservation: true });
  }

  const serperKey = process.env.SERPER_API_KEY;
  if (!phone && serperKey) {
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

  if (!phone && snippets.length === 0) {
    snippets = await getSnippetsFromDuckDuckGo(q + ' reservation');
  }

  const combinedText = snippets.map((s) => `${s.title} ${s.snippet}`).join('\n');

  if (!phone && combinedText.length >= 10) {
    if (deepseekKey) {
      phone = await extractPhoneWithDeepSeek(query, combinedText, { mode: 'intl', reservation: true });
    }
    if (!phone) {
      phone = extractInternationalPhone(combinedText);
    }
  }

  // 兜底：若有 DeepSeek，再问一次（避免偶发失误）
  if (!phone && deepseekKey) phone = await extractPhoneWithDeepSeek(query, null, { direct: true, mode: 'intl', reservation: true });

  // 对国际餐厅：如果拿到了电话号码且 DeepSeek 可用，再做一次“订位 vs 集团”角色判断
  if (phone && deepseekKey) {
    const role = await classifyPhoneRole(query, phone);
    if (role === 'corporate') {
      console.warn('[search:intl] phone classified as corporate, drop it', query, phone);
      phone = null;
    }
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
      const p = extractInternationalPhone(`${s.title} ${s.snippet}`);
      if (p) places.push({ name: s.title || query, phone: p, address: (s.snippet || '').slice(0, 80), url: s.link || searchUrl });
    }
  }

  // 对国际餐厅也尝试用 DeepSeek 补全地址（不区分国家）
  for (const p of places.slice(0, 5)) {
    try {
      const addr = await fetchRestaurantAddress(p.name, p.phone, { lang: 'en' });
      if (addr) p.address = addr;
    } catch (e) {
      console.error('[search:intl] fetchRestaurantAddress', p.name, e.message);
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
  const lang = (req.query.lang || 'ja').toString().toLowerCase();

  try {
    const { places } = lang === 'en'
      ? await searchRestaurantIntl(query)
      : await searchRestaurantJapan(query);

    if (places.length > 0) {
      return res.json({ ok: true, places });
    }

    const fallbackQ = lang === 'en'
      ? `${query} restaurant phone reservation`
      : `${query} 日本 電話 予約`;
    const url = `https://www.google.com/search?q=${encodeURIComponent(fallbackQ)}`;
    res.json({
      ok: true,
      places: [],
      searchUrl: url,
      message: '未解析到电话，可打开下方链接在浏览器中查找后手动填写',
    });
  } catch (e) {
    console.error(e);
    const fallbackQ = lang === 'en'
      ? `${query} restaurant phone reservation`
      : `${query} 日本 電話 予約`;
    const url = `https://www.google.com/search?q=${encodeURIComponent(fallbackQ)}`;
    res.json({
      ok: true,
      places: [],
      searchUrl: url,
      message: e.message || '搜索失败，可打开下方链接自行搜索',
    });
  }
});

export default router;
