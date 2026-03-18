import { Router } from 'express';
import { getDb } from '../db.js';
import { runRefineRecommendationImages } from '../services/refineRecommendationImages.js';
import { getBestCachedMedia } from '../services/resolveRestaurantMedia.js';
import {
  isNeedManualImageOnly,
  moveOkinawaFromOtherToOkinawa,
  readFallbackRecommendations,
  readCrawledRecommendations,
  readBestRecommendations,
  writeBestRecommendations,
  backupToFallback,
  getCityZh,
} from '../services/recommendationsStore.js';
import { clearRecommendationsCache } from './recommendations.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import multer from 'multer';
import { randomBytes, createHash } from 'crypto';
import { importManualCoversFromJsonFile } from '../services/manualCovers.js';
import { transcribeJaFromBuffer, transcribeEnFromBuffer, convertTo16kMp3 } from '../services/aliyunAsr.js';
import { synthesizeJaToUrl, synthesizeEnToUrl } from '../services/aliyunTts.js';
import { getNextAiReply } from '../services/aiDialogue.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const manualCoversDir = path.join(__dirname, '..', 'public', 'manual-covers');

const router = Router();

// sharp 是原生依赖：某些服务器环境可能安装失败。这里做成“可选”，避免服务直接起不来导致 502。
let sharpPromise = null;
async function getSharp() {
  if (!sharpPromise) {
    sharpPromise = import('sharp')
      .then((m) => m?.default || m)
      .catch(() => null);
  }
  return sharpPromise;
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (!fs.existsSync(manualCoversDir)) fs.mkdirSync(manualCoversDir, { recursive: true });
    cb(null, manualCoversDir);
  },
  filename: (req, file, cb) => {
    // 先落盘临时文件，后续统一压缩转成 webp
    const ext = (file.mimetype === 'image/png' ? '.png' : file.mimetype === 'image/webp' ? '.webp' : '.jpg');
    cb(null, `upload-${Date.now()}-${randomBytes(4).toString('hex')}${ext}`);
  },
});
const uploadCover = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } }).single('cover');
const uploadAudio = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } }).single('audio');
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
  uploadCover(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ ok: false, message: err.message || '上传失败' });
    }
    if (!req.file || !req.file.filename) {
      return res.status(400).json({ ok: false, message: '未选择文件' });
    }
    try {
      const inPath = req.file.path;
      const outName = `cover-${Date.now()}-${randomBytes(6).toString('hex')}.webp`;
      const outPath = path.join(manualCoversDir, outName);
      const sharp = await getSharp();
      if (sharp) {
        await sharp(inPath)
          .rotate()
          .resize({ width: 900, withoutEnlargement: true })
          .webp({ quality: 78 })
          .toFile(outPath);
        try { fs.unlinkSync(inPath); } catch {}
        return res.json({ ok: true, url: `/api/manual-covers/${outName}` });
      }
      // 无 sharp 时兜底：直接返回原图（不影响服务可用性）
      return res.json({ ok: true, url: `/api/manual-covers/${req.file.filename}` });
    } catch (e) {
      return res.status(500).json({ ok: false, message: e?.message || '图片处理失败' });
    }
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

  // 注意：cache_key 里包含中文/日文时，简单 replace 会导致大量餐厅同名（全变成下划线），从而互相覆盖。
  // 用 hash 作为文件名，保证稳定且不会冲突。
  const key = String(cache_key || '');
  const digest = createHash('sha1').update(key).digest('hex').slice(0, 16);
  const filename = `best-${digest}.webp`;
  const filepath = path.join(manualCoversDir, filename);
  const buf = Buffer.from(await resp.arrayBuffer());
  // 统一转 webp 缩小体积，提升加载速度
  try {
    const sharp = await getSharp();
    if (!sharp) throw new Error('sharp not available');
    await sharp(buf)
      .rotate()
      .resize({ width: 900, withoutEnlargement: true })
      .webp({ quality: 78 })
      .toFile(filepath);
  } catch {
    // 某些站点返回的并非图片或格式异常：兜底直接落盘
    fs.writeFileSync(filepath, buf);
  }
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

// ========== 店铺管理：兜底 + 新爬取 ==========

/** 备份当前 recommendations_best 到兜底表（首次或兜底为空时调用） */
router.post('/shops/fallback/backup', (req, res) => {
  try {
    const count = backupToFallback();
    res.json({ ok: true, count, message: `已备份 ${count} 个城市到兜底表` });
  } catch (e) {
    res.status(500).json({ ok: false, message: e?.message || 'Server error' });
  }
});

/** 兜底店铺列表（按城市） */
router.get('/shops/fallback', (req, res) => {
  try {
    const items = [];
    for (const cityKey of JP_CITY_KEYS) {
      const data = readFallbackRecommendations({ country: 'jp', cityKey });
      const cityZh = cityZhFromKey(cityKey);
      if (!data?.restaurants?.length) {
        items.push({ cityKey, cityZh, restaurants: [], updatedAt: '' });
        continue;
      }
      const list = data.restaurants.map((r) => {
        const best = getBestCachedMedia({ cityHint: data.cityZh, name: r.name });
        const manualUrl = best?.manual_image_url && best?.manual_enabled !== 0 ? best.manual_image_url : '';
        return {
          ...r,
          image: manualUrl || r.image || FALLBACK_IMAGE,
          manual_image_url: manualUrl,
        };
      });
      items.push({ cityKey, cityZh, restaurants: list, updatedAt: data.updatedAt || '' });
    }
    res.json({ ok: true, items });
  } catch (e) {
    res.status(500).json({ ok: false, message: e?.message || 'Server error' });
  }
});

/** 新爬取数据列表（按城市） */
router.get('/shops/crawled', (req, res) => {
  try {
    const items = [];
    for (const cityKey of JP_CITY_KEYS) {
      const data = readCrawledRecommendations({ country: 'jp', cityKey });
      const cityZh = cityZhFromKey(cityKey);
      if (!data?.restaurants?.length) {
        items.push({ cityKey, cityZh, restaurants: [], crawledAt: '', noCoverCount: 0 });
        continue;
      }
      const noCoverCount = data.restaurants.filter((r) => !r.has_cover).length;
      items.push({
        cityKey,
        cityZh,
        restaurants: data.restaurants,
        crawledAt: data.crawledAt || '',
        noCoverCount,
      });
    }
    res.json({ ok: true, items });
  } catch (e) {
    res.status(500).json({ ok: false, message: e?.message || 'Server error' });
  }
});

/** 保存兜底店铺（封面、店铺信息） */
router.post('/shops/fallback/save', (req, res) => {
  try {
    const { cityKey, name, image_url, address, phone } = req.body || {};
    const n = normalizeRestaurantName(name);
    const cityZh = cityZhFromKey(cityKey);
    if (!n) return res.json({ ok: false, message: 'Missing restaurant name' });

    const url = String(image_url || '').trim();
    const validUrl = url && (url.startsWith('/') || /^https?:\/\//i.test(url));
    if (validUrl) {
      const cacheKey = `best:${cityZh}|${n}`;
      const row = db.prepare('SELECT data_json FROM restaurant_media_best WHERE cache_key = ?').get(cacheKey);
      const dataJson = row?.data_json || '{}';
      db.prepare(
        `INSERT INTO restaurant_media_best (cache_key, city_hint, restaurant_name, data_json, manual_image_url, manual_enabled, updated_at)
         VALUES (?, ?, ?, ?, ?, 1, datetime('now'))
         ON CONFLICT(cache_key) DO UPDATE SET
           manual_image_url = excluded.manual_image_url,
           manual_enabled = 1,
           updated_at = datetime('now')`
      ).run(cacheKey, cityZh, n, dataJson, url);
    }

    let data = readFallbackRecommendations({ country: 'jp', cityKey });
    if (!data?.restaurants?.length) {
      data = readBestRecommendations({ country: 'jp', cityKey });
    }
    if (data?.restaurants?.length) {
      const list = data.restaurants.map((r) => {
        const rn = normalizeRestaurantName(r.name);
        if (rn !== n) return r;
        return {
          ...r,
          ...(image_url && validUrl ? { image: url } : {}),
          ...(address !== undefined ? { address: String(address || '').trim() } : {}),
          ...(phone !== undefined ? { phone: String(phone || '').trim() } : {}),
        };
      });
      const key = `reco:jp|${cityKey}`;
      db.prepare(
        `INSERT INTO recommendations_fallback (cache_key, country, city_key, city_zh, restaurants_json, updated_at)
         VALUES (?, 'jp', ?, ?, ?, datetime('now'))
         ON CONFLICT(cache_key) DO UPDATE SET
           restaurants_json = excluded.restaurants_json,
           updated_at = datetime('now')`
      ).run(key, cityKey, cityZh, JSON.stringify(list));
    }

    clearRecommendationsCache();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, message: e?.message || 'Server error' });
  }
});

/** 确认爬取数据进入前端展示（写入 recommendations_best） */
router.post('/shops/crawled/confirm', (req, res) => {
  try {
    const { cityKey, restaurantIds } = req.body || {};
    if (!cityKey || !JP_CITY_KEYS.includes(cityKey)) {
      return res.json({ ok: false, message: 'Invalid cityKey' });
    }
    const data = readCrawledRecommendations({ country: 'jp', cityKey });
    if (!data?.restaurants?.length) {
      return res.json({ ok: false, message: '该城市暂无爬取数据' });
    }
    const cityZh = getCityZh(cityKey);
    let list = data.restaurants;
    if (Array.isArray(restaurantIds) && restaurantIds.length > 0) {
      const idSet = new Set(restaurantIds);
      list = list.filter((r) => idSet.has(r.id));
    }
    const final = list.slice(0, 10);
    if (final.length === 0) {
      return res.json({ ok: false, message: '请至少选择 1 家餐厅' });
    }
    writeBestRecommendations({ country: 'jp', cityKey, cityZh, restaurants: final });
    clearRecommendationsCache();
    res.json({ ok: true, count: final.length, message: `已确认 ${final.length} 家进入前端展示` });
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

// ========== AI 预定语音测试（多轮对话） ==========
function getBaseUrl(req) {
  const base = process.env.BASE_URL;
  if (base) return base.replace(/\/$/, '');
  const host = req.get('host') || 'localhost:3000';
  const proto = req.get('x-forwarded-proto') || req.protocol || 'http';
  return `${proto}://${host}`;
}

/** 语音转文字：上传音频（webm/mp3/wav 等），返回转写文本 */
router.post('/voice-test/asr', (req, res) => {
  if (!requireAdminToken(req, res)) return;
  uploadAudio(req, res, async (err) => {
    if (err) return res.status(400).json({ ok: false, message: err.message || '上传失败' });
    const file = req.file;
    if (!file || !file.buffer?.length) return res.status(400).json({ ok: false, message: '请上传音频文件' });
    const lang = (req.body?.lang || 'ja').toString().toLowerCase() === 'en' ? 'en' : 'ja';
    try {
      const mimetype = (file.mimetype || '').toLowerCase();
      const extMap = { 'audio/webm': 'webm', 'audio/mp3': 'mp3', 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/ogg': 'ogg' };
      const ext = extMap[mimetype] || (file.originalname?.match(/\.(\w+)$/)?.[1]) || 'webm';
      const buf16k = await convertTo16kMp3(file.buffer, ext);
      const transcribe = lang === 'en' ? transcribeEnFromBuffer : transcribeJaFromBuffer;
      const text = await transcribe(buf16k, { format: 'mp3', sample_rate: '16000' });
      res.json({ ok: true, text: text || '' });
    } catch (e) {
      console.error('[admin voice-test asr]', e.message);
      res.status(500).json({ ok: false, message: e.message || 'ASR 失败' });
    }
  });
});

/** 获取 AI 下一句回复 */
router.post('/voice-test/next-reply', async (req, res) => {
  if (!requireAdminToken(req, res)) return;
  try {
    const { order, callRecords, lastRestaurantText, lang } = req.body || {};
    const l = (lang || 'ja').toString().toLowerCase() === 'en' ? 'en' : 'ja';
    const orderWithLang = { ...(order || {}), _dialogue_lang: l };
    const result = await getNextAiReply(orderWithLang, callRecords || [], lastRestaurantText || null);
    res.json({ ok: true, ...result });
  } catch (e) {
    console.error('[admin voice-test next-reply]', e.message);
    res.status(500).json({ ok: false, message: e.message || '生成失败' });
  }
});

/** 文字转语音：返回 TTS 音频 URL */
router.post('/voice-test/tts', async (req, res) => {
  if (!requireAdminToken(req, res)) return;
  try {
    const { text, lang } = req.body || {};
    if (!text || !String(text).trim()) return res.status(400).json({ ok: false, message: '缺少 text' });
    const l = (lang || 'ja').toString().toLowerCase() === 'en' ? 'en' : 'ja';
    const baseUrl = getBaseUrl(req);
    const synthesize = l === 'en' ? synthesizeEnToUrl : synthesizeJaToUrl;
    const url = await synthesize(String(text).trim(), baseUrl);
    if (!url) return res.status(503).json({ ok: false, message: 'TTS 未配置或生成失败' });
    res.json({ ok: true, url });
  } catch (e) {
    console.error('[admin voice-test tts]', e.message);
    res.status(500).json({ ok: false, message: e.message || 'TTS 失败' });
  }
});

export default router;
