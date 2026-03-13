import { useCallback, useRef } from 'react';

const cache = new Map();

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

  const translateToEn = useCallback(
    async (text) => {
      const raw = typeof text === 'string' ? text.trim() : '';
      if (!raw) return raw;
      if (!hasCJK(raw)) return raw;
      const key = `en:${raw}`;
      if (cache.has(key)) return cache.get(key);
      try {
        const url = `${base}/translate`;
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: raw }),
        });
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
          return out;
        }
        return null;
      } catch {
        return null;
      }
    },
    [base]
  );

  return { translateToEn };
}
