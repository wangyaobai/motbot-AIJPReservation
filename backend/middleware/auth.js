import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'restaurant-booking-secret-change-in-production';
const JWT_EXPIRES_IN = '7d';

export function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

export function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

/** 可选登录：有 Token 则解析并挂载 req.userId，无或无效则不挂载 */
export function optionalAuth(req, res, next) {
  const auth = req.headers.authorization;
  const token = auth && auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return next();
  const payload = verifyToken(token);
  if (payload && payload.uid) req.userId = payload.uid;
  next();
}

/** 必须登录：无有效 Token 返回 401 */
export function requireAuth(req, res, next) {
  const auth = req.headers.authorization;
  const token = auth && auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) {
    return res.status(401).json({ ok: false, message: '请先登录', code: 'UNAUTHORIZED' });
  }
  const payload = verifyToken(token);
  if (!payload || !payload.uid) {
    return res.status(401).json({ ok: false, message: '登录已过期，请重新登录', code: 'TOKEN_INVALID' });
  }
  req.userId = payload.uid;
  next();
}
