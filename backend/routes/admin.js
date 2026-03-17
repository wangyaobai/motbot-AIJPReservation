import { Router } from 'express';
import { getDb } from '../db.js';
import { runRefineRecommendationImages } from '../services/refineRecommendationImages.js';
import { getBestCachedMedia } from '../services/resolveRestaurantMedia.js';
import { isNeedManualImageOnly, moveOkinawaFromOtherToOkinawa } from '../services/recommendationsStore.js';
import { clearRecommendationsCache } from './recommendations.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import multer from 'multer';
import { randomBytes, createHash } from 'crypto';
import { importManualCoversFromJsonFile } from '../services/manualCovers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const manualCoversDir = path.join(__dirname, '..', 'public', 'manual-covers');

const router = Router();

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (!fs.existsSync(manualCoversDir)) fs.mkdirSync(manualCoversDir, { recursive: true });
    cb(null, manualCoversDir);
  },
  filename: (req, file, cb) => {
    const ext = (file.mimetype === 'image/png' ? '.png' : file.mimetype === 'image/webp' ? '.webp' : '.jpg');
    cb(null, `${Date.now()}-${randomBytes(4).toString('hex')}${ext}`);
  },
});
const uploadCover = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } }).single('cover');
const db = getDb();

let refineInFlight = false;

function requireAdminToken(req, res) {
  const token = process.env.ADMIN_TOKEN;
  if (!token) {
    res.status(500).json({ ok: false, message: 'ADMIN_TOKEN not configured' });
    return false;
  }
  const got = String(req.headers['x-admin-token'] || '').trim();
  if (!got || got !== token) {
    res.status(401).json({ ok: false, message: 'Unauthorized' });
    return false;
  }
  return true;
}

function maskPhone(phone) {
  if (!phone || phone.length < 7) return phone;
  return phone.slice(0, 3) + '****' + phone.slice(-4);
}

/** 用户列表（脱敏），供后台按用户维度管理 */
router.get('/users', (req, res) => {
  try {
    const rows = db.prepare(
      'SELECT uid, phone, nickname, create_time, last_login_time, status FROM users ORDER BY create_time DESC'
    ).all();
    const list = rows.map((r) => ({ ...r, phone: maskPhone(r.phone) }));
    res.json({ ok: true, users: list });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, message: e.message || '查询失败' });
  }
});

function normalizeRestaurantName(name) {
  const s = String(name || '').trim();
  if (!s) return '';
  return s.replace(/\s*[\(（][^\)）]*[\)）]\s*/g, ' ').replace(/\s{2,}/g, ' ').trim();
}

function cityZhFromKey(cityKey) {
  const k = String(cityKey || '').toLowerCase();
  const map = {
    hokkaido: '北海道',
    tokyo: '东京',
    osaka: '大阪',
    nagoya: '名古屋',
    kyoto: '京都',
    kobe: '神户',
    okinawa: '冲绳',
    kyushu: '九州',
    other: '日本其他地区',
  };
  return map[k] || k || '东京';
}

function cityKeyFromZh(cityZh) {
  const z = String(cityZh || '').trim();
  const map = {
    北海道: 'hokkaido',
    东京: 'tokyo',
    大阪: 'osaka',
    名古屋: 'nagoya',
    京都: 'kyoto',
    神户: 'kobe',
    冲绳: 'okinawa',
    九州: 'kyushu',
    日本其他地区: 'other',
  };
  return map[z] || '';
}

const FALLBACK_IMAGE = 'https://images.pexels.com/photos/4106483/pexels-photo-4106483.jpeg';

function isFallbackImage(url) {
  const u = String(url || '').trim();
  return !u || u.includes('images.pexels.com/photos/4106483/');
}

function hostnameOf(url) {
  try {
    return new URL(String(url)).hostname || '';
  } catch {
    return '';
  }
}

// 这些图源在浏览器端常见“防盗链/Referrer 限制”，即使有 URL 也可能加载失败
function isLikelyFrontendBlockedImage(url) {
  const u = String(url || '').trim();
  if (!u) return false;
  const host = hostnameOf(u);
  if (!host) return false;
  if (host.includes('tblg.k-img.com')) return true;
  if (host.includes('tabelog.com')) return true;
  return false;
}

/** 后台一键：用特色/菜名模糊搜图补齐仍为兜底图的餐厅，写回 recommendations_best */
router.post('/refine-recommendation-images', async (req, res) => {
  if (refineInFlight) {
    return res.json({ ok: false, message: '正在补齐中，请稍后再试' });
  }
  refineInFlight = true;
  res.json({ ok: true, message: '已开始在后台用特色/菜名自动搜图补齐，约 1～2 分钟后请刷新本页查看剩余需手动填写的餐厅。' });
  setImmediate(async () => {
    try {
      const { updated, cities } = await runRefineRecommendationImages();
      console.log('[admin] refine-recommendation-images done, updated', updated, 'cities', cities?.join(', '));
    } catch (e) {
      console.warn('[admin] refine-recommendation-images error', e?.message);
    } finally {
      refineInFlight = false;
    }
  });
});

/** 手动触发一次：从仓库根目录 manual_covers.json 导入手动封面（无 Shell 时备用） */
router.post('/import-manual-covers', (req, res) => {
  if (!requireAdminToken(req, res)) return;
  try {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const jsonPath = path.join(__dirname, '..', '..', 'manual_covers.json');
    const { imported, total } = importManualCoversFromJsonFile({ db, jsonPath });
    res.json({ ok: true, imported, total, jsonPath });
  } catch (e) {
    res.status(500).json({ ok: false, message: e?.message || 'Server error' });
  }
});

const JP_CITY_KEYS = ['hokkaido', 'tokyo', 'osaka', 'nagoya', 'kyoto', 'kobe', 'okinawa', 'kyushu', 'other'];

/** 将 other 预加载列表中的冲绳餐厅迁移到 okinawa 预加载列表，并从 other 中移除 */
router.post('/move-okinawa-from-other', (req, res) => {
  try {
    const result = moveOkinawaFromOtherToOkinawa();
    clearRecommendationsCache();
    res.json({
      ok: true,
      message: `已从「其他」移出 ${result.moved} 家冲绳餐厅到「冲绳」预加载列表。其他剩余 ${result.otherLeft} 家，冲绳共 ${result.okinawaTotal} 家。`,
      ...result,
    });
  } catch (e) {
    res.status(500).json({ ok: false, message: e?.message || 'Server error' });
  }
});

/** 列出各城市可补充封面的餐厅；无预加载数据的城市也会列出并提示先访问首页或跑 warm */
router.get('/restaurants-without-cover', (req, res) => {
  try {
    const rows = db.prepare(
      'SELECT city_key, city_zh, restaurants_json FROM recommendations_best WHERE country = ?'
    ).all('jp');
    const byCity = {};
    for (const row of rows) {
      byCity[row.city_key] = row;
    }
    const items = [];
    for (const cityKey of JP_CITY_KEYS) {
      const row = byCity[cityKey];
      const cityZh = cityZhFromKey(cityKey);
      if (!row || !row.restaurants_json) {
        items.push({
          cityKey,
          cityZh,
          noData: true,
          message: '该城市暂无预加载数据。请先访问首页该城市 Tab 触发推荐，或运行 npm run warm 生成后再填写封面。',
          totalInCity: 0,
          withCoverCount: 0,
          needFill: true,
          restaurants: [],
        });
        continue;
      }
      let list = [];
      try {
        list = JSON.parse(row.restaurants_json || '[]');
      } catch {
        items.push({ cityKey, cityZh, noData: true, message: '数据解析失败', totalInCity: 0, withCoverCount: 0, needFill: true, restaurants: [] });
        continue;
      }
      if (!Array.isArray(list)) {
        items.push({ cityKey, cityZh, noData: true, message: '无餐厅列表', totalInCity: 0, withCoverCount: 0, needFill: true, restaurants: [] });
        continue;
      }
      // 后台尽量模拟“前端真实可展示数量”：
      // - 有效图：存在 image_url，且不是兜底图，也不是高风险防盗链图源
      // - 手动封面：附加统计，便于你了解已填多少
      let manualCount = 0;
      let displayableCount = 0;
      for (const r of list) {
        if (!r) continue;
        const best = getBestCachedMedia({ cityHint: cityZh, name: r.name });
        const manualUrl = best?.manual_image_url && best.manual_enabled !== 0 ? String(best.manual_image_url).trim() : '';
        if (manualUrl) manualCount += 1;
        const candidateUrl = manualUrl || String(r.image || '').trim();
        if (candidateUrl && !isFallbackImage(candidateUrl) && !isLikelyFrontendBlockedImage(candidateUrl)) {
          displayableCount += 1;
        }
      }
      const needFill = displayableCount < 10;

      const candidates = list.filter((r) => {
        if (!r) return false;
        const best = getBestCachedMedia({ cityHint: cityZh, name: r.name });
        const manualUrl = best?.manual_image_url && best.manual_enabled !== 0 ? String(best.manual_image_url).trim() : '';
        const imageUrl = String(r.image || '').trim();
        const finalUrl = manualUrl || imageUrl;

        const hasDisplayable =
          finalUrl && !isFallbackImage(finalUrl) && !isLikelyFrontendBlockedImage(finalUrl);

        // 若需补齐到 10：列出当前“实际不可展示”的店，供你优先补齐
        if (needFill) return !hasDisplayable;

        // 若已不需要补齐：只列出明显需要处理的（兜底/需人工/高概率前端失败图源）
        if (!hasDisplayable) return true;
        if (isNeedManualImageOnly(r)) return true;
        return false;
      });
      items.push({
        cityKey,
        cityZh: row.city_zh || cityZh,
        totalInCity: list.length,
        withCoverCount: manualCount,
        displayableCount,
        needFill,
        noData: false,
        restaurants: candidates.map((r) => {
          const reasons = [];
          if (needFill) reasons.push('补齐到10（按手动封面计数）');
          if (isFallbackImage(r?.image)) reasons.push('兜底图');
          if (isNeedManualImageOnly(r)) reasons.push('需人工图');
          if (isLikelyFrontendBlockedImage(r?.image)) reasons.push('图源可能加载失败');
          if (reasons.length === 0) reasons.push('未手动封面');
          return {
            id: r.id,
            name: r.name,
            address: r.address,
            feature: r.feature,
            image: r.image || FALLBACK_IMAGE,
            image_url: r.image || '',
            reasons,
          };
        }),
      });
    }
    res.json({ ok: true, items });
  } catch (e) {
    res.status(500).json({ ok: false, message: e?.message || 'Server error' });
  }
});

// 上传封面图到服务器本地，返回 /api/manual-covers/xxx 供保存为 manual_image_url
router.post('/media/upload-cover', (req, res) => {
  uploadCover(req, res, (err) => {
    if (err) {
      return res.status(400).json({ ok: false, message: err.message || '上传失败' });
    }
    if (!req.file || !req.file.filename) {
      return res.status(400).json({ ok: false, message: '未选择文件' });
    }
    res.json({ ok: true, url: `/api/manual-covers/${req.file.filename}` });
  });
});

let localizeJob = {
  running: false,
  total: 0,
  localized: 0,
  failed: 0,
  startedAt: null,
  finishedAt: null,
  lastError: '',
};

function getLocalizeStatus() {
  return { ok: true, ...localizeJob };
}

async function downloadAndReplaceCover({ cache_key, manual_image_url } = {}) {
  const src = String(manual_image_url || '').trim();
  if (!src || !src.startsWith('http')) throw new Error('invalid url');

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 10000);
  let resp;
  try {
    resp = await fetch(src, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; RestaurantBookingBot/1.0)' },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(t);
  }
  if (!resp?.ok) throw new Error(`fetch failed: ${resp?.status || 0}`);

  const contentType = resp.headers.get('content-type') || '';
  const ext = contentType.includes('png') ? '.png' : contentType.includes('webp') ? '.webp' : '.jpg';
  // 注意：cache_key 里包含中文/日文时，简单 replace 会导致大量餐厅同名（全变成下划线），从而互相覆盖。
  // 用 hash 作为文件名，保证稳定且不会冲突。
  const key = String(cache_key || '');
  const digest = createHash('sha1').update(key).digest('hex').slice(0, 16);
  const filename = `best-${digest}${ext}`;
  const filepath = path.join(manualCoversDir, filename);
  const buf = Buffer.from(await resp.arrayBuffer());
  fs.writeFileSync(filepath, buf);
  const localUrl = `/api/manual-covers/${filename}`;
  db.prepare(
    'UPDATE restaurant_media_best SET manual_image_url = ?, updated_at = datetime(\'now\') WHERE cache_key = ?'
  ).run(localUrl, cache_key);
  return localUrl;
}

async function runLocalizeJob() {
  localizeJob = {
    running: true,
    total: 0,
    localized: 0,
    failed: 0,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    lastError: '',
  };
  try {
    const rows = db.prepare(
      `SELECT cache_key, manual_image_url FROM restaurant_media_best
       WHERE manual_image_url IS NOT NULL AND TRIM(manual_image_url) != '' AND manual_image_url LIKE 'http%'`
    ).all();
    localizeJob.total = rows.length;
    if (!fs.existsSync(manualCoversDir)) fs.mkdirSync(manualCoversDir, { recursive: true });

    const concurrency = 4;
    for (let i = 0; i < rows.length; i += concurrency) {
      const chunk = rows.slice(i, i + concurrency);
      const results = await Promise.allSettled(chunk.map((r) => downloadAndReplaceCover(r)));
      for (const r of results) {
        if (r.status === 'fulfilled') localizeJob.localized += 1;
        else localizeJob.failed += 1;
      }
    }
  } catch (e) {
    localizeJob.lastError = e?.message || String(e);
  } finally {
    localizeJob.running = false;
    localizeJob.finishedAt = new Date().toISOString();
  }
}

// 将现有外链封面下载到服务器并改为本地链接（后台任务，避免超时；需 x-admin-token）
router.post('/media/localize-covers', (req, res) => {
  if (!requireAdminToken(req, res)) return;
  if (localizeJob.running) return res.json(getLocalizeStatus());
  res.json({ ok: true, started: true });
  setImmediate(() => {
    runLocalizeJob().catch(() => {});
  });
});

router.get('/media/localize-covers/status', (req, res) => {
  if (!requireAdminToken(req, res)) return;
  res.json(getLocalizeStatus());
});

// 查找重复的手动封面（用于排查 best________.webp 等被覆盖导致的串图问题；需 x-admin-token）
router.get('/media/duplicate-manual-covers', (req, res) => {
  if (!requireAdminToken(req, res)) return;
  try {
    const prefix = String(req.query?.prefix || '/api/manual-covers/best').trim();
    const url = String(req.query?.url || '').trim();
    const like = `${prefix}%`;

    const rows = db.prepare(
      `SELECT manual_image_url, COUNT(*) AS cnt
       FROM restaurant_media_best
       WHERE manual_image_url IS NOT NULL AND TRIM(manual_image_url) != ''
         AND (
           (? != '' AND manual_image_url = ?)
           OR (? = '' AND manual_image_url LIKE ?)
         )
       GROUP BY manual_image_url
       HAVING COUNT(*) > 1
       ORDER BY cnt DESC`
    ).all(url, url, url, like);

    const detail = db.prepare(
      `SELECT cache_key, city_hint, restaurant_name, manual_image_url, manual_enabled, updated_at
       FROM restaurant_media_best
       WHERE manual_image_url = ?
       ORDER BY updated_at DESC`
    );

    const groups = rows.map((r) => {
      const items = detail.all(r.manual_image_url).map((it) => ({
        cache_key: it.cache_key,
        city_hint: it.city_hint,
        cityKey: cityKeyFromZh(it.city_hint),
        restaurant_name: it.restaurant_name,
        manual_image_url: it.manual_image_url,
        manual_enabled: it.manual_enabled,
        updated_at: it.updated_at,
      }));
      return { manual_image_url: r.manual_image_url, cnt: r.cnt, items };
    });

    res.json({ ok: true, prefix, url, groups });
  } catch (e) {
    res.status(500).json({ ok: false, message: e?.message || 'Server error' });
  }
});

// 手动设置餐厅封面图（写入 SQLite，长期生效）
router.post('/media/manual-image', (req, res) => {
  try {
    const { cityKey, name, image_url, enabled } = req.body || {};
    const cityZh = cityZhFromKey(cityKey);
    const n = normalizeRestaurantName(name);
    const url = String(image_url || '').trim();
    const manualEnabled = enabled === 0 || enabled === false ? 0 : 1;
    if (!n) return res.json({ ok: false, message: 'Missing restaurant name' });
    const validUrl = url && (url.startsWith('/') || /^https?:\/\//i.test(url));
    if (!validUrl) return res.json({ ok: false, message: '请填写图片链接（http(s) 或本地上传后的 /api/manual-covers/...）' });

    const cacheKey = `best:${cityZh}|${n}`;
    // 先读出已有 data_json（避免覆盖历史最佳图/链接）
    const row = db.prepare('SELECT data_json FROM restaurant_media_best WHERE cache_key = ?').get(cacheKey);
    const dataJson = row?.data_json || '{}';

    db.prepare(
      `INSERT INTO restaurant_media_best (cache_key, city_hint, restaurant_name, data_json, manual_image_url, manual_enabled, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(cache_key) DO UPDATE SET
         manual_image_url = excluded.manual_image_url,
         manual_enabled = excluded.manual_enabled,
         updated_at = datetime('now')`
    ).run(cacheKey, cityZh, n, dataJson, url, manualEnabled);

    // 手动封面已更新：清理推荐/媒体内存缓存，确保前端立即生效（无需重启）
    clearRecommendationsCache();

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, message: e?.message || 'Server error' });
  }
});

export default router;
