import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export function ForgotPassword() {
  const { apiBase, safeResJson } = useAuth();
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [cooldown, setCooldown] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

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
      });
      const data = await safeResJson(res);
      if (!data.ok) throw new Error(data.message || '发送失败');
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
    if (!raw || !code.trim() || !password) {
      setError('请填写手机号、验证码和新密码');
      return;
    }
    if (!/^[a-zA-Z0-9]{6,16}$/.test(password) || !/[a-zA-Z]/.test(password) || !/\d/.test(password)) {
      setError('密码须 6-16 位，且包含字母和数字');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${apiBase}/user/password/reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: raw, code: code.trim(), password }),
      });
      const data = await safeResJson(res);
      if (!data.ok) throw new Error(data.message || '重置失败');
      setDone(true);
    } catch (e) {
      setError(e.message || '重置失败');
    } finally {
      setLoading(false);
    }
  };

  if (done) {
    return (
      <div className="card" style={{ maxWidth: 400, margin: '24px auto' }}>
        <h2>密码已重置</h2>
        <p>请使用新密码登录。</p>
        <Link to="/login" className="btn-primary" style={{ display: 'inline-block', textAlign: 'center' }}>
          去登录
        </Link>
      </div>
    );
  }

  return (
    <div className="card" style={{ maxWidth: 400, margin: '24px auto' }}>
      <h2>忘记密码</h2>
      <form onSubmit={handleSubmit}>
        <div className="form-row">
          <label>手机号</label>
          <input
            type="tel"
            placeholder="请输入注册手机号"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </div>
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
        <div className="form-row">
          <label>新密码（6-16 位，含字母和数字）</label>
          <input
            type="password"
            placeholder="请输入新密码"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {error && <p className="form-error">{error}</p>}
        <button type="submit" className="btn-primary" disabled={loading}>
          {loading ? '提交中…' : '重置密码'}
        </button>
      </form>
      <p style={{ marginTop: 16, fontSize: 0.9 }}>
        <Link to="/login">返回登录</Link>
      </p>
    </div>
  );
}
