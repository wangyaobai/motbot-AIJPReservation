/**
 * 将外部图片 URL 下载并保存到服务器本地，返回本地 URL。
 * 供 Tabelog/Wikidata/Yelp 拉图后本地化，避免外链失效。
 */
import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const manualCoversDir = path.join(__dirname, '..', 'public', 'manual-covers');

let sharpPromise = null;
async function loadSharp() {
  if (!sharpPromise) {
    sharpPromise = import('sharp').then((m) => m?.default || m).catch(() => null);
  }
  return sharpPromise;
}

/**
 * @param {string} imageUrl - 外部图片 URL
 * @param {string} cacheKey - 用于生成稳定文件名，如 best:东京|すし
 * @returns {Promise<string>} 本地 URL 或原 URL（失败时）
 */
export async function localizeImageUrl(imageUrl, cacheKey) {
  const url = String(imageUrl || '').trim();
  if (!url || !url.startsWith('http')) return url;

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 12000);
  let buf;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; RestaurantBookingBot/1.0)' },
      signal: controller.signal,
    });
    clearTimeout(t);
    if (!res?.ok) return url;
    buf = Buffer.from(await res.arrayBuffer());
  } catch {
    clearTimeout(t);
    return url;
  }

  const key = String(cacheKey || url);
  const digest = createHash('sha1').update(key).digest('hex').slice(0, 16);
  const filename = `crawled-${digest}.webp`;
  const filepath = path.join(manualCoversDir, filename);
  if (!fs.existsSync(manualCoversDir)) fs.mkdirSync(manualCoversDir, { recursive: true });

  try {
    const sharpMod = await loadSharp();
    if (sharpMod) {
      await sharpMod(buf)
        .rotate()
        .resize({ width: 900, withoutEnlargement: true })
        .webp({ quality: 78 })
        .toFile(filepath);
    } else {
      fs.writeFileSync(filepath, buf);
    }
    return `/api/manual-covers/${filename}`;
  } catch {
    try {
      fs.writeFileSync(filepath, buf);
      return `/api/manual-covers/${filename}`;
    } catch {
      return url;
    }
  }
}
