import { Router } from 'express';
import { getDb, generateOrderNo } from '../db.js';

const router = Router();
const db = getDb();

// 创建订单（提交预约信息）
router.post('/', (req, res) => {
  try {
    const {
      restaurant_name,
      restaurant_phone,
      booking_date,
      booking_time,
      party_size,
      flexible_hour = false,
      want_set_meal = false,
      contact_name,
      contact_phone,
      contact_phone_region = 'cn',
    } = req.body;

    if (!restaurant_phone || !booking_date || !booking_time || !party_size || !contact_name || !contact_phone) {
      return res.status(400).json({ ok: false, message: '缺少必填项：餐厅电话、预约日期时间、人数、联系人姓名与手机' });
    }

    const orderNo = generateOrderNo();
    const userId = req.userId || null;
    const stmt = db.prepare(`
      INSERT INTO orders (
        order_no, restaurant_name, restaurant_phone,
        booking_date, booking_time, party_size,
        flexible_hour, want_set_meal,
        contact_name, contact_phone, contact_phone_region,
        status, user_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_pay', ?)
    `);
    stmt.run(
      orderNo,
      restaurant_name || null,
      restaurant_phone,
      booking_date,
      booking_time,
      Number(party_size) || 1,
      flexible_hour ? 1 : 0,
      want_set_meal ? 1 : 0,
      contact_name,
      contact_phone,
      contact_phone_region === 'jp' ? 'jp' : 'cn',
      userId,
    );

    const row = db.prepare('SELECT * FROM orders WHERE order_no = ?').get(orderNo);
    res.json({ ok: true, order: row });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, message: e.message || '创建订单失败' });
  }
});

// 管理后台：订单列表（支持按状态、按用户 user_id 筛选）
router.get('/', (req, res) => {
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
    res.json({ ok: true, orders: rows });
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
    const updated = db.prepare('SELECT * FROM orders WHERE order_no = ?').get(req.params.orderNo);
    res.json({ ok: true, order: updated });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, message: e.message || '操作失败' });
  }
});

// 触发 AI 外呼（拨打电话给餐厅）
router.post('/:orderNo/call', async (req, res) => {
  try {
    const order = db.prepare('SELECT * FROM orders WHERE order_no = ?').get(req.params.orderNo);
    if (!order) return res.status(404).json({ ok: false, message: '订单不存在' });
    if (order.status !== 'pending') {
      return res.status(400).json({ ok: false, message: '请先完成支付后再发起通话' });
    }

    const sid = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    const from = process.env.TWILIO_PHONE_NUMBER;
    const baseUrl = (process.env.BASE_URL || '').replace(/\/$/, '');
    if (!sid || !token || !from || !baseUrl) {
      return res.status(400).json({
        ok: false,
        message: '电话服务暂未配置。请在 backend/.env 中填写 TWILIO_ACCOUNT_SID、TWILIO_AUTH_TOKEN、TWILIO_PHONE_NUMBER 和 BASE_URL 后再试。',
      });
    }

    const twilio = (await import('twilio')).default;
    const client = twilio(sid, token);

    const to = order.restaurant_phone.replace(/\D/g, '');
    const toE164 = to.startsWith('0') ? '+81' + to.slice(1) : (to.length <= 10 ? '+81' + to : '+' + to);

    const call = await client.calls.create({
      to: toE164,
      from,
      url: `${baseUrl}/twilio/voice/${order.order_no}`,
      statusCallback: `${baseUrl}/twilio/status`,
      record: 'record-from-answer',
      recordingStatusCallback: `${baseUrl}/twilio/recording`,
      recordingStatusCallbackEvent: ['completed'],
      timeout: 30,
    });

    db.prepare('UPDATE orders SET twilio_call_sid = ?, status = \'calling\', updated_at = datetime(\'now\') WHERE id = ?').run(
      call.sid,
      order.id
    );
    const updated = db.prepare('SELECT * FROM orders WHERE order_no = ?').get(req.params.orderNo);
    res.json({ ok: true, order: updated, call_sid: call.sid });
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
