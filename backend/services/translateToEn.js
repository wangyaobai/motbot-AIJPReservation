const cache = new Map();
const CACHE_TTL_MS = 10 * 60 * 1000;

export function clearTranslateCache() {
  cache.clear();
}

export function hasCJK(s) {
  return typeof s === 'string' && /[\u4e00-\u9fff\u3040-\u30ff]/.test(s);
}

function extractTranslationText(out) {
  if (!out || typeof out !== 'string') return '';
  let s = out.trim();
  if (s.startsWith('```')) {
    const end = s.indexOf('```', 3);
    if (end > 3) s = s.slice(3, end).trim();
  }
  const prefix = /^(?:translation|english|result|here is[^:]*):\s*/i;
  if (prefix.test(s)) s = s.replace(prefix, '').trim();
  // 取第一行或第一段，避免模型多话
  const firstLine = s.split(/\n/)[0]?.trim() || s;
  return firstLine;
}

export async function translateToEnglish(text) {
  const raw = typeof text === 'string' ? text.trim() : '';
  if (!raw) return '';
  if (!hasCJK(raw)) return raw;
  const key = `en:${raw}`;
  const cached = cache.get(key);
  if (cached && Date.now() < cached.exp) return cached.val;
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    console.warn('[translateToEn] DEEPSEEK_API_KEY not set, skipping translation');
    return raw;
  }
  const content = `Translate the following Chinese or Japanese text into English. Output only the English translation, no explanation.\n\n${raw}`;
  try {
    const resp = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [{ role: 'user', content }],
        max_tokens: 500,
        temperature: 0.2,
      }),
    });
    const body = await resp.text();
    if (!resp.ok) {
      console.warn('[translateToEn] API error', resp.status, body?.slice(0, 200));
      return raw;
    }
    const data = JSON.parse(body || '{}');
    const out = data.choices?.[0]?.message?.content?.trim() || '';
    const result = extractTranslationText(out);
    if (result && !hasCJK(result)) {
      cache.set(key, { val: result, exp: Date.now() + CACHE_TTL_MS });
      return result;
    }
    if (out && !result) console.warn('[translateToEn] empty extraction, raw response:', out.slice(0, 120));
  } catch (e) {
    console.warn('[translateToEn]', e?.message);
  }
  return raw;
}

/**
 * 批量翻译多段文本，一次 API 调用，减少限流与失败
 * @param {string[]} texts - 待翻译文本（可含空串，空串原样返回）
 * @returns {Promise<string[]>} 与 texts 同序的翻译结果，失败或仍含 CJK 的项为原样
 */
export async function translateBatch(texts) {
  const trim = (s) => (typeof s === 'string' ? s.trim() : '');
  const needTranslate = texts.map(trim).map((t, i) => ({ text: t, i }));
  const toTranslate = needTranslate.filter(({ text }) => text && hasCJK(text));
  if (toTranslate.length === 0) return texts.map(trim);

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    console.warn('[translateToEn] DEEPSEEK_API_KEY not set, batch skip');
    return texts.map(trim);
  }

  const list = toTranslate.map(({ text }) => text).join('\n');
  const content = `Translate each of the following lines from Chinese/Japanese to English. Output exactly one translation per line, in the same order. No numbering, no extra text.\n\n${list}`;
  try {
    const resp = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [{ role: 'user', content }],
        max_tokens: 2048,
        temperature: 0.2,
      }),
    });
    const body = await resp.text();
    if (!resp.ok) {
      console.warn('[translateToEn] batch API error', resp.status, body?.slice(0, 200));
      return texts.map(trim);
    }
    const data = JSON.parse(body || '{}');
    let out = data.choices?.[0]?.message?.content?.trim() || '';
    if (out.startsWith('```')) {
      const end = out.indexOf('```', 3);
      if (end > 3) out = out.slice(3, end).trim();
    }
    const lines = out.split(/\n/).map((l) => l.replace(/^\d+[.)]\s*/, '').trim()).filter(Boolean);
    const result = texts.map(trim);
    toTranslate.forEach(({ text, i }, idx) => {
      const translated = lines[idx];
      if (translated && !hasCJK(translated)) result[i] = translated;
    });
    return result;
  } catch (e) {
    console.warn('[translateToEn] batch', e?.message);
    return texts.map(trim);
  }
}
