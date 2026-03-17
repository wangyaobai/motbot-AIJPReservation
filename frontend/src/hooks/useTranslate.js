import { useCallback, useRef } from 'react';

const cache = new Map();
const inflight = new Map();

const LS_KEY = 'motbot_translate_en_v1';
const LS_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30d
const LS_MAX = 3000;

function safeReadLS() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return { t: Date.now(), m: {} };
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object') return { t: Date.now(), m: {} };
    const t = typeof data.t === 'number' ? data.t : Date.now();
    const m = data.m && typeof data.m === 'object' ? data.m : {};
    if (Date.now() - t > LS_TTL_MS) return { t: Date.now(), m: {} };
    return { t, m };
  } catch {
    return { t: Date.now(), m: {} };
  }
}

function safeWriteLS(payload) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(payload));
  } catch {
    // ignore
  }
}

export function hasCJK(s) {
  return typeof s === 'string' && /[\u4e00-\u9fff\u3040-\u30ff]/.test(s);
}

/**
 * 调用后端翻译接口，将中文/日文翻成英文。带内存缓存。
 * @param {string} apiBase - 如 '/api'
 * @returns { (text: string) => Promise<string> } translateToEn(text) 返回翻译结果，无 CJK 或失败时返回原文
 */
export function useTranslate(apiBase) {
  const base = (typeof apiBase === 'string' ? apiBase.replace(/\/$/, '') : '') || '/api';
  const lsRef = useRef(null);
  if (!lsRef.current && typeof window !== 'undefined') {
    lsRef.current = safeReadLS();
  }

  const translateToEn = useCallback(
    async (text) => {
      const raw = typeof text === 'string' ? text.trim() : '';
      if (!raw) return raw;
      if (!hasCJK(raw)) return raw;
      const key = `en:${raw}`;
      if (cache.has(key)) return cache.get(key);
      const ls = lsRef.current;
      const fromLs = ls?.m?.[key];
      if (typeof fromLs === 'string' && fromLs && !hasCJK(fromLs)) {
        cache.set(key, fromLs);
        return fromLs;
      }
      if (inflight.has(key)) return inflight.get(key);
      try {
        const url = `${base}/translate`;
        const p = fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: raw }),
        })
          .then(async (res) => {
            if (!res.ok) {
              const t = await res.text().catch(() => '');
              console.warn('[useTranslate] non-200', res.status, t?.slice(0, 180));
              return null;
            }
            const data = await res.json().catch(() => ({}));
            if (!data?.ok) {
              console.warn('[useTranslate] translate failed', data?.message || data);
              return null;
            }
            const out = data.translated ? String(data.translated).trim() : null;
            if (out && !hasCJK(out)) {
              cache.set(key, out);
              if (lsRef.current) {
                const m = lsRef.current.m || {};
                m[key] = out;
                // 简单控量：超过上限就重置（避免 localStorage 过大）
                if (Object.keys(m).length > LS_MAX) {
                  lsRef.current = { t: Date.now(), m: { [key]: out } };
                } else {
                  lsRef.current.t = Date.now();
                  lsRef.current.m = m;
                }
                safeWriteLS(lsRef.current);
              }
              return out;
            }
            return null;
          })
          .finally(() => inflight.delete(key));
        inflight.set(key, p);
        return await p;
      } catch {
        inflight.delete(key);
        return null;
      }
    },
    [base]
  );

  const translateBatchToEn = useCallback(
    async (texts) => {
      if (!Array.isArray(texts) || texts.length === 0) return [];
      const norm = texts.map((t) => (typeof t === 'string' ? t.trim() : ''));
      const keys = norm.map((t) => `en:${t}`);
      const out = norm.map((t) => t);

      const toAsk = [];
      const idxMap = [];
      norm.forEach((t, i) => {
        if (!t || !hasCJK(t)) return;
        const key = keys[i];
        const mem = cache.get(key);
        if (typeof mem === 'string' && mem && !hasCJK(mem)) {
          out[i] = mem;
          return;
        }
        const ls = lsRef.current;
        const fromLs = ls?.m?.[key];
        if (typeof fromLs === 'string' && fromLs && !hasCJK(fromLs)) {
          cache.set(key, fromLs);
          out[i] = fromLs;
          return;
        }
        toAsk.push(t);
        idxMap.push(i);
      });

      if (toAsk.length === 0) return out;

      try {
        const url = `${base}/translate/batch`;
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ texts: toAsk }),
        });
        if (!res.ok) return out;
        const data = await res.json().catch(() => ({}));
        if (!data?.ok || !Array.isArray(data.translated)) return out;
        data.translated.forEach((t, j) => {
          const i = idxMap[j];
          const key = keys[i];
          const val = typeof t === 'string' ? t.trim() : '';
          if (val && !hasCJK(val)) {
            out[i] = val;
            cache.set(key, val);
            if (lsRef.current) {
              const m = lsRef.current.m || {};
              m[key] = val;
              if (Object.keys(m).length > LS_MAX) {
                lsRef.current = { t: Date.now(), m: { [key]: val } };
              } else {
                lsRef.current.t = Date.now();
                lsRef.current.m = m;
              }
              safeWriteLS(lsRef.current);
            }
          }
        });
        return out;
      } catch {
        return out;
      }
    },
    [base]
  );

  return { translateToEn, translateBatchToEn };
}
