import { Router } from 'express';
import { translateBatch } from '../services/translateToEn.js';
import { getDb } from '../db.js';

const router = Router();
const MAX_LENGTH = 2000;
const cache = new Map();
const CACHE_TTL_MS = 10 * 60 * 1000;
const db = getDb();

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

function hasCJK(s) {
  return typeof s === 'string' && /[\u4e00-\u9fff\u3040-\u30ff]/.test(s);
}

function extractText(out) {
  if (!out || typeof out !== 'string') return null;
  let s = out.trim();
  if (s.startsWith('```')) {
    const end = s.indexOf('```', 3);
    if (end > 3) s = s.slice(3, end).trim();
    s = s.replace(/^json/i, '').trim();
  }
  // 去掉常见前缀，取第一行，避免多话
  s = s.replace(/^(?:translation|english|result|here is[^:]*):\s*/i, '').trim();
  s = (s.split(/\n/)[0] || '').trim();
  return s || null;
}

async function callDeepSeekToEn(text) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    console.warn('[translate] DEEPSEEK_API_KEY not set');
    return null;
  }
  const doCall = async (prompt) => {
    const body = {
      model: 'deepseek-chat',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 500,
      temperature: 0.2,
    };
    const resp = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
    });
    const rawBody = await resp.text().catch(() => '');
    if (!resp.ok) {
      console.warn('[translate] DeepSeek non-200', resp.status, rawBody?.slice(0, 220));
      return null;
    }
    let data = {};
    try { data = JSON.parse(rawBody || '{}'); } catch (_) {}
    const out = extractText(data.choices?.[0]?.message?.content);
    if (!out) return null;
    if (hasCJK(out)) return null;
    return out;
  };

  // 两次尝试：第二次更强约束输出必须是英文且无 CJK
  const p1 = `Translate the following Chinese or Japanese text into English. Output only the English translation, no explanation.\n\n${text}`;
  const first = await doCall(p1);
  if (first) return first;
  const p2 = `Translate the following text into English.\nRules:\n- Output ONLY the English translation.\n- Do NOT include Chinese/Japanese characters.\n- Do NOT use markdown or code fences.\n\n${text}`;
  return await doCall(p2);
}

router.post('/', async (req, res) => {
  try {
    const { text } = req.body || {};
    const raw = typeof text === 'string' ? text.trim() : '';
    if (!raw) {
      return res.json({ ok: false, message: 'Missing text' });
    }
    if (!process.env.DEEPSEEK_API_KEY) {
      return res.json({ ok: false, message: 'Translation not configured (DEEPSEEK_API_KEY)' });
    }
    if (raw.length > MAX_LENGTH) {
      return res.json({ ok: false, message: 'Text too long' });
    }
    if (!hasCJK(raw)) {
      return res.json({ ok: true, translated: raw });
    }
    const key = `en:${raw}`;
    const cached = cache.get(key);
    if (cached && Date.now() < cached.exp) {
      return res.json({ ok: true, translated: cached.val });
    }
    const dbCached = readDbCache(key);
    if (dbCached && !hasCJK(dbCached)) {
      cache.set(key, { val: dbCached, exp: Date.now() + CACHE_TTL_MS });
      return res.json({ ok: true, translated: dbCached });
    }
    const translated = await callDeepSeekToEn(raw);
    if (translated) {
      cache.set(key, { val: translated, exp: Date.now() + CACHE_TTL_MS });
      writeDbCache(key, translated);
      return res.json({ ok: true, translated });
    }
    res.json({ ok: false, message: 'Translation failed' });
  } catch (e) {
    res.status(500).json({ ok: false, message: e?.message || 'Server error' });
  }
});

// 批量翻译：减少英文模式下的请求次数/外部调用次数
router.post('/batch', async (req, res) => {
  try {
    const { texts } = req.body || {};
    if (!Array.isArray(texts)) {
      return res.json({ ok: false, message: 'Missing texts' });
    }
    if (!process.env.DEEPSEEK_API_KEY) {
      return res.json({ ok: false, message: 'Translation not configured (DEEPSEEK_API_KEY)' });
    }
    if (texts.length > 200) {
      return res.json({ ok: false, message: 'Too many texts' });
    }
    const norm = texts.map((t) => (typeof t === 'string' ? t.trim() : ''));
    for (const t of norm) {
      if (t && t.length > MAX_LENGTH) return res.json({ ok: false, message: 'Text too long' });
    }
    // 先用 DB / 内存缓存命中，剩下的再批量走外部翻译
    const keys = norm.map((t) => `en:${t}`);
    const out = norm.slice();
    const toAsk = [];
    const idxMap = [];
    norm.forEach((t, i) => {
      if (!t || !hasCJK(t)) return;
      const key = keys[i];
      const mem = cache.get(key);
      if (mem && Date.now() < mem.exp && mem.val && !hasCJK(mem.val)) {
        out[i] = mem.val;
        return;
      }
      const dbVal = readDbCache(key);
      if (dbVal && !hasCJK(dbVal)) {
        out[i] = dbVal;
        cache.set(key, { val: dbVal, exp: Date.now() + CACHE_TTL_MS });
        return;
      }
      toAsk.push(t);
      idxMap.push(i);
    });
    if (toAsk.length === 0) return res.json({ ok: true, translated: out });

    const asked = await translateBatch(toAsk);
    asked.forEach((v, j) => {
      const i = idxMap[j];
      const key = keys[i];
      const val = typeof v === 'string' ? v.trim() : '';
      if (val && !hasCJK(val)) {
        out[i] = val;
        cache.set(key, { val, exp: Date.now() + CACHE_TTL_MS });
        writeDbCache(key, val);
      }
    });
    return res.json({ ok: true, translated: out });
  } catch (e) {
    return res.status(500).json({ ok: false, message: e?.message || 'Server error' });
  }
});

export default router;
