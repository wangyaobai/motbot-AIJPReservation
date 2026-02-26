/**
 * 通过 DeepSeek 根据餐厅名称或电话查询营业时间，并计算「下次开始营业」的 UTC 时间。
 * 用于 AI 拨打状态：餐厅尚未营业时，预计在营业时间内首次尝试拨打。
 */

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 内存缓存：key = restaurantKey( name, phone )，value = { open, close, fetchedAt } */
const cache = new Map();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 小时

function restaurantKey(name, phone) {
  const n = (name || '').trim().slice(0, 100);
  const p = (phone || '').replace(/\D/g, '').slice(-10);
  return `${n}|${p}`;
}

/**
 * 调用 DeepSeek 获取日本餐厅营业时间（日本时间 JST）。
 * @returns {{ open: string, close: string }} 如 { open: '11:00', close: '22:00' }，默认 11:00-22:00
 */
export async function fetchBusinessHours(restaurantName, restaurantPhone) {
  const key = restaurantKey(restaurantName, restaurantPhone);
  const cached = cache.get(key);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return { open: cached.open, close: cached.close };
  }

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    const def = { open: '11:00', close: '22:00' };
    cache.set(key, { ...def, fetchedAt: Date.now() });
    return def;
  }

  const namePart = (restaurantName || '').trim() ? `餐厅名「${String(restaurantName).trim().slice(0, 80)}」` : '';
  const phonePart = (restaurantPhone || '').trim() ? `或电话 ${String(restaurantPhone).trim()}` : '';
  const prompt = `请根据日本餐厅信息，推断其通常的营业时间（日本时间 JST）。
${namePart} ${phonePart}
只返回一个 JSON，不要其他内容。格式：{"open":"HH:mm","close":"HH:mm"}
例如：{"open":"11:00","close":"22:00"} 或 {"open":"17:00","close":"23:00"}
若无法推断，请返回：{"open":"11:00","close":"22:00"}`;

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
        max_tokens: 80,
        temperature: 0.1,
      }),
    });
    if (!resp.ok) {
      console.error('[businessHours] DeepSeek error', resp.status);
      const def = { open: '11:00', close: '22:00' };
      cache.set(key, { ...def, fetchedAt: Date.now() });
      return def;
    }
    const data = await resp.json();
    const text = (data.choices?.[0]?.message?.content || '').trim();
    const match = text.match(/\{\s*"open"\s*:\s*"(\d{1,2}:\d{2})"\s*,\s*"close"\s*:\s*"(\d{1,2}:\d{2})"\s*\}/);
    const open = match ? match[1] : '11:00';
    const close = match ? match[2] : '22:00';
    const result = { open: open.length === 4 ? '0' + open : open, close: close.length === 4 ? '0' + close : close };
    cache.set(key, { ...result, fetchedAt: Date.now() });
    return result;
  } catch (e) {
    console.error('[businessHours]', e.message);
    const def = { open: '11:00', close: '22:00' };
    cache.set(key, { ...def, fetchedAt: Date.now() });
    return def;
  }
}

/**
 * 根据营业时间（JST 的 open/close）计算「下次开始营业」的 UTC 时间。
 * 若当前日本时间已在营业内，返回 null（表示已营业，可用排队逻辑）。
 * @param {{ open: string, close: string }} hours - 如 { open: '11:00', close: '22:00' }
 * @param {Date} fromUtc - 基准时间（UTC）
 * @returns {Date|null} 下次开门的 UTC 时间，若当前在营业中则返回 null
 */
export function getNextOpenUtc(hours, fromUtc = new Date()) {
  if (!hours || !hours.open || !hours.close) return null;
  const [openH, openM] = hours.open.split(':').map((s) => parseInt(s, 10) || 0);
  const [closeH, closeM] = hours.close.split(':').map((s) => parseInt(s, 10) || 0);

  const nowUtc = fromUtc.getTime();
  const nowJst = new Date(nowUtc + JST_OFFSET_MS);
  const jstYear = nowJst.getUTCFullYear();
  const jstMonth = nowJst.getUTCMonth();
  const jstDate = nowJst.getUTCDate();
  const currentJstMinutes = nowJst.getUTCHours() * 60 + nowJst.getUTCMinutes();
  const openMinutes = openH * 60 + openM;
  const closeMinutes = closeH * 60 + closeM;

  if (currentJstMinutes >= openMinutes && currentJstMinutes < closeMinutes) {
    return null;
  }
  const utcHour = openH - 9;
  if (currentJstMinutes < openMinutes) {
    return new Date(Date.UTC(jstYear, jstMonth, jstDate, utcHour, openM, 0, 0));
  }
  return new Date(Date.UTC(jstYear, jstMonth, jstDate + 1, utcHour, openM, 0, 0));
}
