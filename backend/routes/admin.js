import { Router } from 'express';
import { getDb } from '../db.js';

const router = Router();
const db = getDb();

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

export default router;
