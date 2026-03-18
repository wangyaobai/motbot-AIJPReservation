/**
 * 首句预生成缓存：发起外呼时预生成 LLM 首句 + TTS，接听后快速响应，避免 502。
 * 键：order_no，值：{ text_ja, ttsUrl, lang }，5 分钟过期。
 */
const cache = new Map();
const TTL_MS = 5 * 60 * 1000;

export function set(orderNo, data) {
  cache.set(orderNo, { ...data, expiresAt: Date.now() + TTL_MS });
}

export function get(orderNo) {
  const entry = cache.get(orderNo);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(orderNo);
    return null;
  }
  return { text_ja: entry.text_ja, ttsUrl: entry.ttsUrl, lang: entry.lang };
}

export function remove(orderNo) {
  cache.delete(orderNo);
}
