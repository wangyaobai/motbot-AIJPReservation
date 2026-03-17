/**
 * 批量翻译，优先命中 SQLite 持久缓存，未命中再调 DeepSeek。
 * 供 recommendations 等路由在返回前预翻译，实现英文模式秒开。
 */
import { getDb } from '../db.js';
import { translateBatch } from './translateToEn.js';

const db = getDb();
const memCache = new Map();
const CACHE_TTL_MS = 10 * 60 * 60 * 1000;

function hasCJK(s) {
  return typeof s === 'string' && /[\u4e00-\u9fff\u3040-\u30ff]/.test(s);
}

function readDbCache(key) {
  try {
    const row = db.prepare('SELECT translated FROM translate_cache WHERE cache_key = ?').get(key);
    const v = row?.translated ? String(row.translated).trim() : '';
    return v || null;
  } catch {
    return null;
  }
}

function writeDbCache(key, val) {
  try {
    db.prepare(
      `INSERT INTO translate_cache (cache_key, translated, updated_at)
       VALUES (?, ?, datetime('now'))
       ON CONFLICT(cache_key) DO UPDATE SET translated = excluded.translated, updated_at = datetime('now')`
    ).run(key, val);
  } catch {
    // ignore
  }
}

/**
 * @param {string[]} texts - 待翻译文本（去重后）
 * @returns {Promise<string[]>} 与 texts 同序的翻译结果
 */
export async function batchTranslateWithPersistentCache(texts) {
  const norm = texts.map((t) => (typeof t === 'string' ? t.trim() : ''));
  const keys = norm.map((t) => `en:${t}`);
  const out = norm.slice();

  const toAsk = [];
  const idxMap = [];
  norm.forEach((t, i) => {
    if (!t || !hasCJK(t)) return;
    const key = keys[i];
    const mem = memCache.get(key);
    if (mem && Date.now() < mem.exp && mem.val && !hasCJK(mem.val)) {
      out[i] = mem.val;
      return;
    }
    const dbVal = readDbCache(key);
    if (dbVal && !hasCJK(dbVal)) {
      out[i] = dbVal;
      memCache.set(key, { val: dbVal, exp: Date.now() + CACHE_TTL_MS });
      return;
    }
    toAsk.push(t);
    idxMap.push(i);
  });

  if (toAsk.length === 0) return out;

  const asked = await translateBatch(toAsk);
  asked.forEach((v, j) => {
    const i = idxMap[j];
    const key = keys[i];
    const val = typeof v === 'string' ? v.trim() : '';
    if (val && !hasCJK(val)) {
      out[i] = val;
      memCache.set(key, { val, exp: Date.now() + CACHE_TTL_MS });
      writeDbCache(key, val);
    }
  });
  return out;
}
