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
    const stmt = db.prepare(`
      INSERT INTO orders (
        order_no, restaurant_name, restaurant_phone,
        booking_date, booking_time, party_size,
        flexible_hour, want_set_meal,
        contact_name, contact_phone, contact_phone_region,
        status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
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
    );

    const row = db.prepare('SELECT * FROM orders WHERE order_no = ?').get(orderNo);
    res.json({ ok: true, order: row });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, message: e.message || '创建订单失败' });
  }
});

// 根据用户名/手机查询订单列表（后台用）
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

// 触发 AI 外呼（拨打电话给餐厅）
router.post('/:orderNo/call', async (req, res) => {
  try {
    const order = db.prepare('SELECT * FROM orders WHERE order_no = ?').get(req.params.orderNo);
    if (!order) return res.status(404).json({ ok: false, message: '订单不存在' });
    if (order.status !== 'pending') {
      return res.status(400).json({ ok: false, message: '当前订单状态不允许发起通话' });
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

export default router;
