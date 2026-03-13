import { Router } from 'express';
import { getDb } from '../db.js';
import { runRefineRecommendationImages } from '../services/refineRecommendationImages.js';
import { getBestCachedMedia } from '../services/resolveRestaurantMedia.js';
import { isNeedManualImageOnly, moveOkinawaFromOtherToOkinawa } from '../services/recommendationsStore.js';
import { clearRecommendationsCache } from './recommendations.js';
import path from 'path';
import { fileURLToPath } from 'url';
import { importManualCoversFromJsonFile } from '../services/manualCovers.js';

const router = Router();
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
      // 由于前端会对“加载失败的外链图”直接过滤，后端无法可靠预测哪些图能在浏览器展示。
      // 因此后台以“手动封面数”为准：只要手动封面 < 10，就列出该城全部未手动的餐厅给你补齐。
      let manualCount = 0;
      for (const r of list) {
        if (!r) continue;
        const best = getBestCachedMedia({ cityHint: cityZh, name: r.name });
        if (best?.manual_image_url && best.manual_enabled !== 0) manualCount += 1;
      }
      const needFill = manualCount < 10;

      const candidates = list.filter((r) => {
        if (!r) return false;
        const best = getBestCachedMedia({ cityHint: cityZh, name: r.name });
        if (best?.manual_image_url && best.manual_enabled !== 0) return false;
        // 若需补齐到 10：列出该城所有未手动的店
        if (needFill) return true;
        // 若已不需要补齐：只列出明显需要处理的（兜底/需人工/高概率前端失败图源）
        if (isFallbackImage(r?.image)) return true;
        if (isNeedManualImageOnly(r)) return true;
        if (isLikelyFrontendBlockedImage(r?.image)) return true;
        return false;
      });
      items.push({
        cityKey,
        cityZh: row.city_zh || cityZh,
        totalInCity: list.length,
        withCoverCount: manualCount,
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

// 手动设置餐厅封面图（写入 SQLite，长期生效）
router.post('/media/manual-image', (req, res) => {
  try {
    const { cityKey, name, image_url, enabled } = req.body || {};
    const cityZh = cityZhFromKey(cityKey);
    const n = normalizeRestaurantName(name);
    const url = String(image_url || '').trim();
    const manualEnabled = enabled === 0 || enabled === false ? 0 : 1;
    if (!n) return res.json({ ok: false, message: 'Missing restaurant name' });
    if (!url || !/^https?:\/\//i.test(url)) return res.json({ ok: false, message: 'Invalid image_url' });

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

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, message: e?.message || 'Server error' });
  }
});

export default router;
