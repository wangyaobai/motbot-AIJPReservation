import { Router } from 'express';
import { getDb } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { fetchBusinessHours, getNextOpenUtc } from '../services/businessHours.js';
import { appendAiCallLog } from '../services/aiCallLog.js';
import { fetchRestaurantAddress } from '../services/restaurantAddress.js';

const router = Router();
const db = getDb();

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 将 UTC 时间格式化为日本时间 JST，用于写入 AI 通话状态日志（预计开始拨打时间按餐厅营业时间） */
function formatEstForLog(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const jst = new Date(d.getTime() + JST_OFFSET_MS);
  const m = jst.getUTCMonth() + 1;
  const day = jst.getUTCDate();
  const hh = String(jst.getUTCHours()).padStart(2, '0');
  const min = String(jst.getUTCMinutes()).padStart(2, '0');
  return `${m}月${day}日 ${hh}:${min}`;
}

/** 同步：仅排队逻辑，供无 DeepSeek 或需快速返回时使用；可被 orders 路由复用 */
export function enrichAiCallStatus(order) {
  if (!order || (order.status !== 'pending' && order.status !== 'calling')) {
    return order;
  }
  const text = order.ai_call_status_text;
  const updated = order.ai_call_status_updated_at;
  if (text) {
    order.ai_call_status_text = text;
    order.ai_call_status_updated_at = updated || null;
    return order;
  }
  applyQueueEstimate(order);
  return order;
}

function applyQueueEstimate(order) {
  const queueCount = db.prepare(
    `SELECT COUNT(*) as c FROM orders WHERE status IN ('pending', 'calling') AND (created_at < ? OR (created_at = ? AND id <= ?))`
  ).get(order.created_at, order.created_at, order.id);
  const pos = (queueCount && queueCount.c) || 0;
  const estMinutes = pos * 5;
  const createdStr = order.created_at ? String(order.created_at).trim() : null;
  const created = createdStr
    ? new Date(createdStr.includes('T') ? createdStr : createdStr.replace(' ', 'T') + (createdStr.endsWith('Z') ? '' : 'Z'))
    : new Date();
  const est = new Date(created.getTime() + estMinutes * 60 * 1000);
  order.ai_call_est_at = est.toISOString();
  order.ai_call_status_type = 'queue';
  order.ai_call_status_text = `系统排队中，预计开始拨打时间见下方，请您耐心等待。`;
  order.ai_call_status_updated_at = new Date().toISOString().slice(0, 19).replace('T', ' ');
}

/**
 * 异步：根据餐厅营业时间判断「餐厅尚未营业」或「系统排队中」，并填充预计拨打时间与文案
 */
export async function enrichAiCallStatusAsync(order) {
  if (!order || (order.status !== 'pending' && order.status !== 'calling')) {
    return order;
  }
  if (order.ai_call_status_text) {
    order.ai_call_status_updated_at = order.ai_call_status_updated_at || null;
    return order;
  }
  const now = new Date();
  let hours;
  try {
    hours = await fetchBusinessHours(order.restaurant_name, order.restaurant_phone);
  } catch (e) {
    console.error('[enrichAiCallStatus] fetchBusinessHours', e.message);
    hours = { open: '11:00', close: '22:00' };
  }
  const nextOpenUtc = getNextOpenUtc(hours, now);
  if (nextOpenUtc) {
    order.ai_call_est_at = nextOpenUtc.toISOString();
    order.ai_call_status_type = 'not_open';
    order.ai_call_status_text = `餐厅尚未营业，预计开始拨打时间见下方，请您耐心等待。`;
  } else {
    applyQueueEstimate(order);
  }
  order.ai_call_status_updated_at = new Date().toISOString().slice(0, 19).replace('T', ' ');
  // 持久化预计拨打时间，供调度器在「到了时间」时自动触发首次/再次拨打
  if (order.id && order.ai_call_est_at) {
    try {
      db.prepare(
        'UPDATE orders SET ai_call_est_at = ?, ai_call_status_type = ?, ai_call_status_text = ?, ai_call_status_updated_at = ? WHERE id = ?'
      ).run(
        order.ai_call_est_at,
        order.ai_call_status_type || null,
        order.ai_call_status_text || null,
        order.ai_call_status_updated_at || null,
        order.id
      );
      const raw = db.prepare('SELECT ai_call_status_log FROM orders WHERE id = ?').get(order.id)?.ai_call_status_log;
      let hasOrderedLog = false;
      if (raw && typeof raw === 'string') {
        try {
          const list = JSON.parse(raw);
          hasOrderedLog = Array.isArray(list) && list.some((e) => (e.text || '').includes('餐厅尚未营业') || (e.text || '').includes('系统排队中'));
        } catch {}
      }
      if (!hasOrderedLog) {
        const estStr = formatEstForLog(order.ai_call_est_at);
        const msg = order.ai_call_status_type === 'not_open'
          ? `餐厅尚未营业，预计${estStr}开始拨打，请您耐心等待。`
          : `系统排队中，预计${estStr}开始拨打，请您耐心等待。`;
        appendAiCallLog(order.id, msg);
      }
    } catch (e) {
      console.error('[enrichAiCallStatus] persist est_at', e.message);
    }
  }
  return order;
}

function normalizePhone(phone) {
  return (phone || '').replace(/\D/g, '').trim();
}

function orderMatchesStatus(order, statusFilter) {
  if (!statusFilter || statusFilter === 'all') return true;
  if (statusFilter === 'pending_pay') return order.status === 'pending_pay';
  if (statusFilter === 'booking') return order.status === 'pending' || order.status === 'calling';
  if (statusFilter === 'cancelled_or_failed') return order.status === 'cancelled' || order.status === 'failed';
  if (['completed', 'failed', 'cancelled'].includes(statusFilter)) return order.status === statusFilter;
  return true;
}

/** 用户订单列表：当前用户绑定的订单 + 未绑定但联系人手机与当前用户一致的订单，按状态筛选，分页 */
router.get('/list', requireAuth, async (req, res) => {
  try {
    const uid = req.userId;
    const { status: statusFilter, page = '1', pageSize = '10' } = req.query;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const size = Math.min(100, Math.max(1, parseInt(pageSize, 10) || 10));
    const offset = (pageNum - 1) * size;

    const userRow = db.prepare('SELECT phone FROM users WHERE uid = ?').get(uid);
    const userPhoneNorm = userRow && userRow.phone ? normalizePhone(userRow.phone) : '';

    let where = 'user_id = ?';
    const params = [uid];
    if (statusFilter && statusFilter !== 'all') {
      if (statusFilter === 'pending_pay') {
        where += ' AND status = ?';
        params.push('pending_pay');
      } else if (statusFilter === 'booking') {
        where += " AND status IN ('pending', 'calling')";
      } else if (statusFilter === 'cancelled_or_failed') {
        where += " AND status IN ('cancelled', 'failed')";
      } else if (['completed', 'failed', 'cancelled'].includes(statusFilter)) {
        where += ' AND status = ?';
        params.push(statusFilter);
      }
    }
    const rowsBound = db.prepare(`SELECT * FROM orders WHERE ${where} ORDER BY created_at DESC`).all(...params);

    let rowsUnbound = [];
    if (userPhoneNorm) {
      const unbound = db.prepare(
        "SELECT * FROM orders WHERE (user_id IS NULL OR user_id = '') ORDER BY created_at DESC LIMIT 500"
      ).all();
      rowsUnbound = unbound.filter(
        (o) => normalizePhone(o.contact_phone) === userPhoneNorm && orderMatchesStatus(o, statusFilter)
      );
    }

    const merged = [...rowsBound, ...rowsUnbound]
      .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
    const total = merged.length;
    const pageRows = merged.slice(offset, offset + size);
    const orders = await Promise.all(pageRows.map((o) => enrichAiCallStatusAsync({ ...o })));

    res.json({ ok: true, orders, total, page: pageNum, pageSize: size });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, message: e.message || '查询失败' });
  }
});

/** 订单详情：本人可查（user_id 匹配，或未绑定且联系人手机与当前用户一致） */
router.get('/detail/:orderNo', requireAuth, async (req, res) => {
  try {
    const row = db.prepare('SELECT * FROM orders WHERE order_no = ?').get(req.params.orderNo);
    if (!row) return res.status(404).json({ ok: false, message: '订单不存在' });
    const userRow = db.prepare('SELECT phone FROM users WHERE uid = ?').get(req.userId);
    const userPhoneNorm = userRow && userRow.phone ? normalizePhone(userRow.phone) : '';
    const canAccess =
      row.user_id === req.userId ||
      ((!row.user_id || row.user_id === '') && userPhoneNorm && normalizePhone(row.contact_phone) === userPhoneNorm);
    if (!canAccess) return res.status(403).json({ ok: false, message: '无权查看该订单' });
    const order = await enrichAiCallStatusAsync({ ...row });
    res.json({ ok: true, order });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, message: e.message || '查询失败' });
  }
});

/** 预约凭证用：返回订单 + 通过 DeepSeek 获取的餐厅地址。保证返回可序列化的 JSON。 */
router.get('/voucher-info/:orderNo', requireAuth, async (req, res) => {
  try {
    const row = db.prepare('SELECT * FROM orders WHERE order_no = ?').get(req.params.orderNo);
    if (!row) return res.status(404).json({ ok: false, message: '订单不存在' });
    const userRow = db.prepare('SELECT phone FROM users WHERE uid = ?').get(req.userId);
    const userPhoneNorm = userRow && userRow.phone ? normalizePhone(userRow.phone) : '';
    const canAccess =
      row.user_id === req.userId ||
      ((!row.user_id || row.user_id === '') && userPhoneNorm && normalizePhone(row.contact_phone) === userPhoneNorm);
    if (!canAccess) return res.status(403).json({ ok: false, message: '无权查看该订单' });
    const order = await enrichAiCallStatusAsync({ ...row });
    let restaurant_address = '';
    try {
      const addr = await fetchRestaurantAddress(order.restaurant_name, order.restaurant_phone);
      restaurant_address = typeof addr === 'string' ? addr : '';
    } catch (addrErr) {
      console.error('[voucher-info] fetchRestaurantAddress', addrErr.message);
    }
    const orderPayload = { ...order, restaurant_address };
    res.json({ ok: true, order: JSON.parse(JSON.stringify(orderPayload)) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, message: e.message || '查询失败' });
  }
});

/** 用户本人取消订单（本人或未绑定且手机一致，且未成功/未取消可取消） */
router.post('/cancel/:orderNo', requireAuth, (req, res) => {
  try {
    const order = db.prepare('SELECT * FROM orders WHERE order_no = ?').get(req.params.orderNo);
    if (!order) return res.status(404).json({ ok: false, message: '订单不存在' });
    const userRow = db.prepare('SELECT phone FROM users WHERE uid = ?').get(req.userId);
    const userPhoneNorm = userRow && userRow.phone ? normalizePhone(userRow.phone) : '';
    const canAccess =
      order.user_id === req.userId ||
      ((!order.user_id || order.user_id === '') && userPhoneNorm && normalizePhone(order.contact_phone) === userPhoneNorm);
    if (!canAccess) return res.status(403).json({ ok: false, message: '无权操作该订单' });
    if (order.status === 'completed') {
      return res.status(400).json({ ok: false, message: '预约已成功，不可取消' });
    }
    if (order.status === 'cancelled') {
      return res.status(400).json({ ok: false, message: '订单已取消' });
    }
    db.prepare("UPDATE orders SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?").run(order.id);
    const updated = db.prepare('SELECT * FROM orders WHERE order_no = ?').get(req.params.orderNo);
    res.json({ ok: true, order: updated });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, message: e.message || '取消失败' });
  }
});

/** 绑定历史订单：手机号匹配近 3 个月订单，更新 user_id */
router.post('/bind-history', requireAuth, (req, res) => {
  try {
    const uid = req.userId;
    const { contact_phone } = req.body;
    const phone = (contact_phone || '').replace(/\D/g, '').trim();
    if (!phone) {
      return res.status(400).json({ ok: false, message: '请填写联系人手机号' });
    }

    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
    const since = threeMonthsAgo.toISOString().slice(0, 19).replace('T', ' ');

    const orders = db.prepare(
      `SELECT id, order_no, contact_phone FROM orders 
       WHERE (user_id IS NULL OR user_id = '') AND created_at >= ?`
    ).all(since);

    const toBind = orders.filter(o => (o.contact_phone || '').replace(/\D/g, '') === phone);
    if (toBind.length === 0) {
      return res.json({ ok: true, bound: 0, message: '未找到可绑定的历史订单' });
    }

    const stmt = db.prepare('UPDATE orders SET user_id = ?, bind_time = datetime(\'now\') WHERE id = ?');
    for (const o of toBind) {
      stmt.run(uid, o.id);
    }
    res.json({ ok: true, bound: toBind.length, message: `已绑定 ${toBind.length} 笔历史订单` });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, message: e.message || '绑定失败' });
  }
});

export default router;
