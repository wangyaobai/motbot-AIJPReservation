import { Router } from 'express';
import { getDb, generateOrderNo } from '../db.js';
import { enrichAiCallStatusAsync } from './order.js';
import { startTwilioCallForOrder } from '../services/twilioCall.js';
import { appendAiCallLog } from '../services/aiCallLog.js';
import { fetchRestaurantAddress, fetchRestaurantNameAndAddressByPhone } from '../services/restaurantAddress.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
const db = getDb();

function normalizePhone(phone) {
  return (phone || '').replace(/\D/g, '').trim();
}

// 创建订单（提交预约信息）。若用户未用搜索只填了电话，创建后根据电话反查店铺名称和地址并写入。
router.post('/', async (req, res) => {
  try {
    const {
      restaurant_name,
      restaurant_phone,
      restaurant_address,
      booking_date,
      booking_time,
      second_booking_date,
      second_booking_time,
      adult_count = 1,
      child_count = 0,
      dietary_notes,
      booking_remark,
      contact_name,
      contact_phone,
      contact_phone_region = 'cn',
    } = req.body;

    const phone = (restaurant_phone && String(restaurant_phone).trim());
    const date = (booking_date && String(booking_date).trim());
    const time = (booking_time && String(booking_time).trim());
    const name = (contact_name && String(contact_name).trim());
    const contactTel = (contact_phone && String(contact_phone).trim());
    const remark = (booking_remark && String(booking_remark).trim());

    if (!phone) return res.status(400).json({ ok: false, message: '请填写餐厅电话' });
    if (!date) return res.status(400).json({ ok: false, message: '请选择第一希望预约日期' });
    if (!time) return res.status(400).json({ ok: false, message: '请选择第一希望预约时间' });
    if (!remark) return res.status(400).json({ ok: false, message: '请填写预约备注' });
    if (!name) return res.status(400).json({ ok: false, message: '请填写预约人' });
    if (!contactTel) return res.status(400).json({ ok: false, message: '请填写手机号' });

    const adults = Math.max(0, parseInt(adult_count, 10) || 1);
    const children = Math.max(0, parseInt(child_count, 10) || 0);
    const party_size = adults + children;
    if (party_size < 1) {
      return res.status(400).json({ ok: false, message: '成人或儿童至少填写 1 人' });
    }

    const orderNo = generateOrderNo();
    const userId = req.userId || null;
    const nameVal = (typeof restaurant_name === 'string' && restaurant_name.trim() !== '') ? restaurant_name.trim() : null;
    const addr = (restaurant_address && String(restaurant_address).trim()) || null;
    const stmt = db.prepare(`
      INSERT INTO orders (
        order_no, restaurant_name, restaurant_phone, restaurant_address,
        booking_date, booking_time, second_booking_date, second_booking_time,
        party_size, adult_count, child_count,
        dietary_notes, booking_remark,
        contact_name, contact_phone, contact_phone_region,
        status, user_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_pay', ?)
    `);
    stmt.run(
      orderNo,
      nameVal,
      phone,
      addr,
      date,
      time,
      second_booking_date || null,
      second_booking_time || null,
      party_size,
      adults,
      children,
      (dietary_notes && String(dietary_notes).trim()) || null,
      remark,
      name,
      contactTel,
      contact_phone_region === 'jp' ? 'jp' : 'cn',
      userId,
    );

    let row = db.prepare('SELECT * FROM orders WHERE order_no = ?').get(orderNo);
    const needReverseLookup = !nameVal && phone;
    if (needReverseLookup) {
      try {
        const { name: fetchedName, address: fetchedAddr } = await fetchRestaurantNameAndAddressByPhone(phone);
        if (fetchedName || fetchedAddr) {
          db.prepare(
            'UPDATE orders SET restaurant_name = COALESCE(?, restaurant_name), restaurant_address = COALESCE(?, restaurant_address) WHERE order_no = ?'
          ).run(fetchedName || null, fetchedAddr || null, orderNo);
          row = db.prepare('SELECT * FROM orders WHERE order_no = ?').get(orderNo);
        }
      } catch (e) {
        console.error('[orders] 创建订单后按电话反查店铺失败', e.message);
      }
    }
    res.json({ ok: true, order: row });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, message: e.message || '创建订单失败' });
  }
});

// 管理后台：订单列表（支持按状态、按用户 user_id 筛选）
router.get('/', async (req, res) => {
  try {
    const { status: statusFilter, user_id: userId } = req.query;
    let sql = 'SELECT * FROM orders WHERE 1=1';
    const params = [];
    if (userId) {
      sql += ' AND user_id = ?';
      params.push(userId);
    }
    if (statusFilter && statusFilter !== 'all') {
      if (statusFilter === 'pending_pay') {
        sql += ' AND status = ?';
        params.push('pending_pay');
      } else if (statusFilter === 'booking') {
        sql += " AND status IN ('pending', 'calling')";
      } else if (['completed', 'failed', 'cancelled'].includes(statusFilter)) {
        sql += ' AND status = ?';
        params.push(statusFilter);
      }
    }
    sql += ' ORDER BY created_at DESC';
    const rows = db.prepare(sql).all(...params);
    const orders = await Promise.all(rows.map((r) => enrichAiCallStatusAsync({ ...r })));
    res.json({ ok: true, orders });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, message: e.message || '查询失败' });
  }
});

// 根据用户名/手机查询订单列表
router.get('/by-user', (req, res) => {
  try {
    const { contact_name, contact_phone } = req.query;
    if (!contact_name && !contact_phone) {
      return res.status(400).json({ ok: false, message: '请提供 contact_name 或 contact_phone' });
    }
    let sql = 'SELECT * FROM orders WHERE 1=1';
    const params = [];
    if (contact_name) { sql += ' AND contact_name = ?'; params.push(contact_name); }
    if (contact_phone) { sql += ' AND contact_phone = ?'; params.push(contact_phone); }
    sql += ' ORDER BY created_at DESC';
    const rows = db.prepare(sql).all(...params);
    res.json({ ok: true, orders: rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, message: e.message || '查询失败' });
  }
});

// 预约凭证：返回订单 + 餐厅地址（DeepSeek），需登录且本人
router.get('/:orderNo/voucher-info', requireAuth, async (req, res) => {
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

// 根据订单号查询单笔
router.get('/:orderNo', (req, res) => {
  try {
    const row = db.prepare('SELECT * FROM orders WHERE order_no = ?').get(req.params.orderNo);
    if (!row) return res.status(404).json({ ok: false, message: '订单不存在' });
    res.json({ ok: true, order: row });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, message: e.message || '查询失败' });
  }
});

// 确认支付（占位：暂不接真实支付，后续可对接支付回调）
router.post('/:orderNo/confirm-payment', (req, res) => {
  try {
    const order = db.prepare('SELECT * FROM orders WHERE order_no = ?').get(req.params.orderNo);
    if (!order) return res.status(404).json({ ok: false, message: '订单不存在' });
    if (order.status !== 'pending_pay') {
      return res.status(400).json({ ok: false, message: '当前订单状态无需支付' });
    }
    db.prepare("UPDATE orders SET status = 'pending', updated_at = datetime('now') WHERE id = ?").run(order.id);
    appendAiCallLog(order.id, '您已完成支付提交预约单，待系统确认。');
    const updated = db.prepare('SELECT * FROM orders WHERE order_no = ?').get(req.params.orderNo);
    res.json({ ok: true, order: updated });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, message: e.message || '操作失败' });
  }
});

// 触发 AI 外呼（拨打电话给餐厅）；当日最多尝试 3 次；首次点击后未接通将自动按 30 分钟间隔重试
router.post('/:orderNo/call', async (req, res) => {
  try {
    const order = db.prepare('SELECT * FROM orders WHERE order_no = ?').get(req.params.orderNo);
    if (!order) return res.status(404).json({ ok: false, message: '订单不存在' });
    if (order.status !== 'pending') {
      return res.status(400).json({ ok: false, message: '请先完成支付后再发起通话' });
    }
    const today = new Date().toISOString().slice(0, 10);
    const lastAt = order.ai_last_attempt_at ? String(order.ai_last_attempt_at).trim() : null;
    const lastDate = lastAt ? lastAt.slice(0, 10) : null;
    const attemptCount = lastDate === today ? (order.ai_call_attempt_count || 0) : 0;
    if (attemptCount >= 3) {
      return res.status(400).json({ ok: false, message: '当日已尝试3次未接通，请明日再试或更换时间。' });
    }

    await startTwilioCallForOrder(order);
    const logText = attemptCount === 0 ? '开始发起拨打' : `第${attemptCount + 1}次尝试，开始发起拨打`;
    appendAiCallLog(order.id, logText);

    const updated = db.prepare('SELECT * FROM orders WHERE order_no = ?').get(req.params.orderNo);
    res.json({ ok: true, order: updated, call_sid: updated.twilio_call_sid });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, message: e.message || '发起通话失败' });
  }
});

// 管理员取消订单（未成功前可取消）
router.post('/:orderNo/cancel', (req, res) => {
  try {
    const order = db.prepare('SELECT * FROM orders WHERE order_no = ?').get(req.params.orderNo);
    if (!order) return res.status(404).json({ ok: false, message: '订单不存在' });
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

export default router;
