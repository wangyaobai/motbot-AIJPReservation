import { Router } from 'express';
import { getDb } from '../db.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
const db = getDb();

/** 为「预约中」订单补充 AI 通话状态文案（无则按排队计算预计时间） */
function enrichAiCallStatus(order) {
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
  const queueCount = db.prepare(
    `SELECT COUNT(*) as c FROM orders WHERE status IN ('pending', 'calling') AND (created_at < ? OR (created_at = ? AND id <= ?))`
  ).get(order.created_at, order.created_at, order.id);
  const pos = (queueCount && queueCount.c) || 0;
  const estMinutes = pos * 5;
  const created = order.created_at ? new Date(order.created_at.replace(' ', 'T')) : new Date();
  const est = new Date(created.getTime() + estMinutes * 60 * 1000);
  const mm = est.getMonth() + 1;
  const dd = est.getDate();
  const hh = String(est.getHours()).padStart(2, '0');
  const min = String(est.getMinutes()).padStart(2, '0');
  order.ai_call_status_text = `系统排队中，预计${mm}月${dd}日 ${hh}:${min}开始拨打，请您耐心等待。`;
  order.ai_call_status_updated_at = new Date().toISOString().slice(0, 19).replace('T', ' ');
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
router.get('/list', requireAuth, (req, res) => {
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
    const orders = pageRows.map((o) => enrichAiCallStatus({ ...o }));

    res.json({ ok: true, orders, total, page: pageNum, pageSize: size });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, message: e.message || '查询失败' });
  }
});

/** 订单详情：本人可查（user_id 匹配，或未绑定且联系人手机与当前用户一致） */
router.get('/detail/:orderNo', requireAuth, (req, res) => {
  try {
    const row = db.prepare('SELECT * FROM orders WHERE order_no = ?').get(req.params.orderNo);
    if (!row) return res.status(404).json({ ok: false, message: '订单不存在' });
    const userRow = db.prepare('SELECT phone FROM users WHERE uid = ?').get(req.userId);
    const userPhoneNorm = userRow && userRow.phone ? normalizePhone(userRow.phone) : '';
    const canAccess =
      row.user_id === req.userId ||
      ((!row.user_id || row.user_id === '') && userPhoneNorm && normalizePhone(row.contact_phone) === userPhoneNorm);
    if (!canAccess) return res.status(403).json({ ok: false, message: '无权查看该订单' });
    const order = enrichAiCallStatus({ ...row });
    res.json({ ok: true, order });
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
