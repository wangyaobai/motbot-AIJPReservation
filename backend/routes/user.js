import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { getDb, generateUid } from '../db.js';
import { signToken, requireAuth, optionalAuth } from '../middleware/auth.js';
import { sendVerificationCode as sendDysms } from '../services/sms-aliyun.js';
import { sendVerificationCode as sendDypns } from '../services/sms-aliyun-dypns.js';

const router = Router();
const db = getDb();

const SALT_ROUNDS = 10;
const CODE_EXPIRE_MINUTES = 5;
const CODE_LENGTH = 6;
const SEND_CODE_COOLDOWN_SEC = 60;
const MAX_CODES_PER_HOUR = 5;

function randomCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function normalizePhone(phone) {
  return (phone || '').replace(/\D/g, '').trim();
}

/** 随机日本料理名 + 随机形容词，作为昵称（不支持编辑） */
function generateNickname() {
  const names = ['寿司', '天妇罗', '烧鸟', '拉面', '鳗鱼饭', '刺身', '怀石', '居酒屋', '荞麦面', '乌冬', '茶泡饭', '味噌', '关东煮', '章鱼烧', '和牛'];
  const adjectives = ['元气', '樱花', '富士', '京都', '江户', '旬味', '本格', '旬鲜', '雅', '风雅', '一期一会', '和风', '深夜', '暖'];
  const n = names[Math.floor(Math.random() * names.length)];
  const a = adjectives[Math.floor(Math.random() * adjectives.length)];
  return a + n;
}

/** 发送验证码（同一手机 1 小时内最多 5 次，60 秒内不可重复） */
router.post('/send-code', async (req, res) => {
  try {
    const { phone, region = 'cn' } = req.body;
    const raw = (phone || '').trim();
    if (!raw) return res.status(400).json({ ok: false, message: '请填写手机号' });

    const normalized = normalizePhone(raw);
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();

    const recentCount = db.prepare(
      'SELECT COUNT(*) as c FROM verification_codes WHERE phone = ? AND created_at > ?'
    ).get(normalized, oneHourAgo);
    if (recentCount.c >= MAX_CODES_PER_HOUR) {
      return res.status(429).json({ ok: false, message: '该手机号发送次数过多，请 1 小时后再试' });
    }

    const last = db.prepare(
      'SELECT created_at FROM verification_codes WHERE phone = ? ORDER BY id DESC LIMIT 1'
    ).get(normalized);
    if (last) {
      const lastTime = new Date(last.created_at).getTime();
      if ((now.getTime() - lastTime) / 1000 < SEND_CODE_COOLDOWN_SEC) {
        return res.status(429).json({
          ok: false,
          message: `请 ${SEND_CODE_COOLDOWN_SEC} 秒后再重新获取验证码`,
        });
      }
    }

    const code = randomCode();
    const expiresAt = new Date(now.getTime() + CODE_EXPIRE_MINUTES * 60 * 1000).toISOString();
    db.prepare(
      'INSERT INTO verification_codes (phone, code, expires_at) VALUES (?, ?, ?)'
    ).run(normalized, code, expiresAt);

    // 阿里云：号码认证服务(dypns) 或 短信服务(dysms)
    if (region === 'cn' || !region) {
      const useDypns = (process.env.ALIYUN_SMS_PROVIDER || '').toLowerCase() === 'dypns';
      const sendSms = useDypns ? sendDypns : sendDysms;
      const result = await sendSms(normalized, code);
      if (!result.success) {
        if (result.message && (result.message.includes('未配置') || result.message.includes('未配置阿里云'))) {
          console.log('[发送验证码] 未配置阿里云短信，验证码仅打印于服务端 →', { phone: normalized, code });
        } else {
          return res.status(500).json({
            ok: false,
            message: result.message || '验证码发送失败，请稍后重试',
          });
        }
      }
    }
    res.json({ ok: true, message: '验证码已发送' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, message: e.message || '发送失败' });
  }
});

/** 注册：手机号 + 验证码 + 密码 */
router.post('/register', async (req, res) => {
  try {
    const { phone, code, password, region = 'cn', agree_privacy } = req.body;
    if (!agree_privacy) {
      return res.status(400).json({ ok: false, message: '请先同意隐私协议' });
    }
    const raw = (phone || '').trim();
    if (!raw) return res.status(400).json({ ok: false, message: '请填写手机号' });
    if (!code) return res.status(400).json({ ok: false, message: '请填写验证码' });
    if (!password || typeof password !== 'string') {
      return res.status(400).json({ ok: false, message: '请设置 6-16 位密码（含字母和数字）' });
    }
    if (!/^[a-zA-Z0-9]{6,16}$/.test(password) || !/[a-zA-Z]/.test(password) || !/\d/.test(password)) {
      return res.status(400).json({ ok: false, message: '密码须 6-16 位，且包含字母和数字' });
    }

    const normalized = normalizePhone(raw);
    const row = db.prepare(
      'SELECT * FROM verification_codes WHERE phone = ? AND code = ? AND expires_at > datetime(\'now\') ORDER BY id DESC LIMIT 1'
    ).get(normalized, String(code).trim());
    if (!row) {
      return res.status(400).json({ ok: false, message: '验证码错误或已过期' });
    }

    const exists = db.prepare('SELECT uid FROM users WHERE phone = ?').get(normalized);
    if (exists) return res.status(400).json({ ok: false, message: '该手机号已注册' });

    const uid = generateUid();
    const hash = await bcrypt.hash(password, SALT_ROUNDS);
    const nickname = generateNickname();
    db.prepare(
      'INSERT INTO users (uid, phone, password, nickname, status) VALUES (?, ?, ?, ?, 1)'
    ).run(uid, normalized, hash, nickname);

    const token = signToken({ uid });
    const user = db.prepare('SELECT uid, phone, nickname, create_time, status FROM users WHERE uid = ?').get(uid);
    res.json({
      ok: true,
      token,
      expiresIn: '7d',
      user: { ...user, phone: maskPhone(user.phone) },
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, message: e.message || '注册失败' });
  }
});

/** 登录：手机号 + 密码 或 手机号 + 验证码 */
router.post('/login', async (req, res) => {
  console.log('[LOGIN] 收到登录请求, body.phone:', req.body && req.body.phone);
  const send500 = (msg) => {
    try {
      res.status(500).json({ ok: false, message: msg });
    } catch (_) {
      res.status(500).setHeader('Content-Type', 'application/json').end(JSON.stringify({ ok: false, message: msg }));
    }
  };
  try {
    const { phone, password, code, region = 'cn' } = req.body || {};
    const raw = (phone || '').trim();
    if (!raw) return res.status(400).json({ ok: false, message: '请填写手机号' });

    const normalized = normalizePhone(raw);
    const user = db.prepare('SELECT * FROM users WHERE phone = ?').get(normalized);
    if (!user) return res.status(400).json({ ok: false, message: '该手机号未注册' });
    if (user.status !== 1) return res.status(400).json({ ok: false, message: '账号已被禁用' });

    let ok = false;
    if (code != null && String(code).trim()) {
      const vc = db.prepare(
        'SELECT * FROM verification_codes WHERE phone = ? AND code = ? AND expires_at > datetime(\'now\') ORDER BY id DESC LIMIT 1'
      ).get(normalized, String(code).trim());
      ok = !!vc;
    } else if (password != null && String(password)) {
      ok = await bcrypt.compare(String(password), user.password || '');
    }
    if (!ok) {
      return res.status(400).json({ ok: false, message: code != null ? '验证码错误或已过期' : '密码错误' });
    }

    const ip = (req.headers['x-forwarded-for'] || req.ip || '').slice(0, 64);
    const device = (req.headers['user-agent'] || '').slice(0, 256);
    try {
      db.prepare('INSERT INTO login_log (user_id, ip, device) VALUES (?, ?, ?)').run(user.uid, ip, device);
    } catch (logErr) {
      console.error('login_log insert:', logErr);
    }
    try {
      db.prepare('UPDATE users SET last_login_time = datetime(\'now\') WHERE uid = ?').run(user.uid);
    } catch (upErr) {
      console.error('update last_login_time:', upErr);
    }

    const token = signToken({ uid: user.uid });
    const out = db.prepare('SELECT uid, phone, nickname, create_time, last_login_time, status FROM users WHERE uid = ?').get(user.uid);
    res.json({
      ok: true,
      token,
      expiresIn: '7d',
      user: { ...out, phone: maskPhone(out.phone) },
    });
  } catch (e) {
    console.error('[LOGIN] 登录异常:', e && e.message ? e.message : e);
    if (e && e.stack) console.error(e.stack);
    send500(e && e.message ? String(e.message) : '登录失败');
  }
});

/** 刷新 Token（需携带当前有效 Token） */
router.post('/refresh-token', requireAuth, (req, res) => {
  try {
    const token = signToken({ uid: req.userId });
    res.json({ ok: true, token, expiresIn: '7d' });
  } catch (e) {
    res.status(500).json({ ok: false, message: e.message || '刷新失败' });
  }
});

/** 判断是否为旧版“手机号式”昵称（需替换为随机日本料理名） */
function isPhoneStyleNickname(nickname) {
  if (!nickname || typeof nickname !== 'string') return true;
  const s = nickname.trim();
  if (!s) return true;
  if (/^\d+$/.test(s)) return true;
  if (/\d{3}\*+\d{4}/.test(s) || /^\d+[\s*]+\d+$/.test(s)) return true;
  return false;
}

/** 获取当前用户信息（脱敏）；若昵称为空或手机号形式则自动改为随机日本料理名 */
router.get('/info', requireAuth, (req, res) => {
  try {
    let row = db.prepare('SELECT uid, phone, nickname, create_time, last_login_time, status FROM users WHERE uid = ?').get(req.userId);
    if (!row) return res.status(404).json({ ok: false, message: '用户不存在' });
    if (isPhoneStyleNickname(row.nickname)) {
      const newNickname = generateNickname();
      db.prepare('UPDATE users SET nickname = ? WHERE uid = ?').run(newNickname, row.uid);
      row = db.prepare('SELECT uid, phone, nickname, create_time, last_login_time, status FROM users WHERE uid = ?').get(req.userId);
    }
    res.json({ ok: true, user: { ...row, phone: maskPhone(row.phone) } });
  } catch (e) {
    res.status(500).json({ ok: false, message: e.message || '查询失败' });
  }
});

/** 重置密码：验证码 + 新密码 */
router.post('/password/reset', async (req, res) => {
  try {
    const { phone, code, password } = req.body;
    const raw = (phone || '').trim();
    if (!raw || !code || !password) {
      return res.status(400).json({ ok: false, message: '请填写手机号、验证码和新密码' });
    }
    if (!/^[a-zA-Z0-9]{6,16}$/.test(password) || !/[a-zA-Z]/.test(password) || !/\d/.test(password)) {
      return res.status(400).json({ ok: false, message: '密码须 6-16 位，且包含字母和数字' });
    }

    const normalized = normalizePhone(raw);
    const vc = db.prepare(
      'SELECT * FROM verification_codes WHERE phone = ? AND code = ? AND expires_at > datetime(\'now\') ORDER BY id DESC LIMIT 1'
    ).get(normalized, String(code).trim());
    if (!vc) return res.status(400).json({ ok: false, message: '验证码错误或已过期' });

    const user = db.prepare('SELECT uid FROM users WHERE phone = ?').get(normalized);
    if (!user) return res.status(400).json({ ok: false, message: '该手机号未注册' });

    const hash = await bcrypt.hash(password, SALT_ROUNDS);
    db.prepare('UPDATE users SET password = ? WHERE uid = ?').run(hash, user.uid);
    res.json({ ok: true, message: '密码已重置' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, message: e.message || '重置失败' });
  }
});

function maskPhone(phone) {
  if (!phone || phone.length < 7) return phone;
  return phone.slice(0, 3) + '****' + phone.slice(-4);
}

export default router;
