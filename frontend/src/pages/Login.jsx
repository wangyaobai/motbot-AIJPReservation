import { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export function Login() {
  const { setToken, apiBase } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [useCode, setUseCode] = useState(false);
  const [codeSent, setCodeSent] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const sendCode = async () => {
    const raw = phone.trim().replace(/\D/g, '');
    if (raw.length < 11) {
      setError('请填写正确手机号');
      return;
    }
    setError('');
    try {
      const res = await fetch(`${apiBase}/user/send-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: raw, region: 'cn' }),
        cache: 'no-store',
      });
      const text = await res.text();
      let data;
      if (!text || !text.trim()) {
        data = { ok: false, message: '服务器未返回数据' };
      } else {
        try {
          data = JSON.parse(text);
        } catch (err) {
          data = { ok: false, message: '返回格式错误' };
        }
      }
      if (!data.ok) throw new Error(data.message || '发送失败');
      setCodeSent(true);
      setCooldown(60);
      const t = setInterval(() => {
        setCooldown((c) => (c <= 1 ? (clearInterval(t), 0) : c - 1));
      }, 1000);
    } catch (e) {
      setError(e.message || '发送验证码失败');
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    const raw = phone.trim().replace(/\D/g, '');
    if (!raw) {
      setError('请填写手机号');
      return;
    }
    if (useCode) {
      if (!code.trim()) {
        setError('请填写验证码');
        return;
      }
    } else {
      if (!password) {
        setError('请填写密码');
        return;
      }
    }
    setLoading(true);
    try {
      const res = await fetch(`${apiBase}/user/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: raw,
          region: 'cn',
          ...(useCode ? { code: code.trim() } : { password }),
        }),
        cache: 'no-store',
      });
      const text = await res.text();
      let data;
      if (!text || !text.trim()) {
        data = { ok: false, message: '服务器未返回数据，请确认后端已启动且 Vite 代理指向正确端口（当前应为 3003）' };
      } else {
        try {
          data = JSON.parse(text);
        } catch (err) {
          data = { ok: false, message: '服务器返回格式错误' };
        }
      }
      if (!data.ok) throw new Error(data.message || '登录失败');
      setToken(data.token, data.user);
      const from = location.state?.from || '/orders';
      navigate(from, { replace: true });
    } catch (e) {
      setError(e.message || '登录失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card" style={{ maxWidth: 400, margin: '24px auto' }}>
      <h2>登录</h2>
      <form onSubmit={handleSubmit}>
        <div className="form-row">
          <label>手机号</label>
          <input
            type="tel"
            placeholder="请输入手机号"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </div>
        {!useCode ? (
          <div className="form-row">
            <label>密码</label>
            <input
              type="password"
              placeholder="请输入密码"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
        ) : (
          <div className="form-row">
            <label>验证码</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="text"
                placeholder="请输入验证码"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                maxLength={6}
                style={{ flex: 1 }}
              />
              <button
                type="button"
                className="btn-search"
                onClick={sendCode}
                disabled={cooldown > 0}
              >
                {cooldown > 0 ? `${cooldown}s 后重发` : '获取验证码'}
              </button>
            </div>
          </div>
        )}
        <div className="check-row">
          <input
            type="checkbox"
            id="useCode"
            checked={useCode}
            onChange={(e) => setUseCode(e.target.checked)}
          />
          <label htmlFor="useCode">验证码快捷登录</label>
        </div>
        {error && <p className="form-error">{error}</p>}
        <button type="submit" className="btn-primary" disabled={loading}>
          {loading ? '登录中…' : '登录'}
        </button>
      </form>
      <p style={{ marginTop: 16, fontSize: 0.9, textAlign: 'center' }}>
        还没有账号？ <Link to="/register" state={location.state}>立即注册</Link>
      </p>
      <Link
        to="/register"
        state={location.state}
        className="btn-primary secondary"
        style={{ display: 'block', marginTop: 12, textAlign: 'center', textDecoration: 'none' }}
      >
        去注册
      </Link>
      <p style={{ marginTop: 16, fontSize: 0.85, color: 'var(--text-muted)', textAlign: 'center' }}>
        <Link to="/forgot-password">忘记密码</Link>
      </p>
    </div>
  );
}
