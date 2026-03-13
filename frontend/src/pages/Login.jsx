import { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useUiLang } from '../context/UiLangContext';

export function Login() {
  const { setToken, apiBase } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { uiLang } = useUiLang();
  const isEnUi = uiLang === 'en';
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
      setError(isEnUi ? 'Please enter a valid phone number.' : '请填写正确手机号');
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
        data = { ok: false, message: isEnUi ? 'Empty server response.' : '服务器未返回数据' };
      } else {
        try {
          data = JSON.parse(text);
        } catch (err) {
          data = { ok: false, message: isEnUi ? 'Invalid server response format.' : '返回格式错误' };
        }
      }
      if (!data.ok) throw new Error(data.message || (isEnUi ? 'Send failed' : '发送失败'));
      setCodeSent(true);
      setCooldown(60);
      const t = setInterval(() => {
        setCooldown((c) => (c <= 1 ? (clearInterval(t), 0) : c - 1));
      }, 1000);
    } catch (e) {
      setError(e.message || (isEnUi ? 'Failed to send code.' : '发送验证码失败'));
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    const raw = phone.trim().replace(/\D/g, '');
    if (!raw) {
      setError(isEnUi ? 'Please enter your phone number.' : '请填写手机号');
      return;
    }
    if (useCode) {
      if (!code.trim()) {
        setError(isEnUi ? 'Please enter the code.' : '请填写验证码');
        return;
      }
    } else {
      if (!password) {
        setError(isEnUi ? 'Please enter your password.' : '请填写密码');
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
        data = { ok: false, message: isEnUi ? 'Empty server response. Please ensure backend is running and proxy is correct.' : '服务器未返回数据，请确认后端已启动且 Vite 代理指向正确端口（当前应为 3003）' };
      } else {
        try {
          data = JSON.parse(text);
        } catch (err) {
          data = { ok: false, message: isEnUi ? 'Invalid server response format.' : '服务器返回格式错误' };
        }
      }
      if (!data.ok) throw new Error(data.message || (isEnUi ? 'Login failed' : '登录失败'));
      setToken(data.token, data.user);
      const from = location.state?.from || '/orders';
      navigate(from, { replace: true });
    } catch (e) {
      setError(e.message || (isEnUi ? 'Login failed' : '登录失败'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card" style={{ maxWidth: 400, margin: '24px auto' }}>
      <h2>{isEnUi ? 'Sign in' : '登录'}</h2>
      <form onSubmit={handleSubmit}>
        <div className="form-row">
          <label>{isEnUi ? 'Phone' : '手机号'}</label>
          <input
            type="tel"
            placeholder={isEnUi ? 'Enter phone number' : '请输入手机号'}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </div>
        {!useCode ? (
          <div className="form-row">
            <label>{isEnUi ? 'Password' : '密码'}</label>
            <input
              type="password"
              placeholder={isEnUi ? 'Enter password' : '请输入密码'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
        ) : (
          <div className="form-row">
            <label>{isEnUi ? 'Verification code' : '验证码'}</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="text"
                placeholder={isEnUi ? 'Enter code' : '请输入验证码'}
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
                {cooldown > 0
                  ? (isEnUi ? `Resend in ${cooldown}s` : `${cooldown}s 后重发`)
                  : (isEnUi ? 'Send code' : '获取验证码')}
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
          <label htmlFor="useCode">{isEnUi ? 'Use verification code' : '验证码快捷登录'}</label>
        </div>
        {error && <p className="form-error">{error}</p>}
        <button type="submit" className="btn-primary" disabled={loading}>
          {loading ? (isEnUi ? 'Signing in…' : '登录中…') : (isEnUi ? 'Sign in' : '登录')}
        </button>
      </form>
      <p style={{ marginTop: 16, fontSize: 0.9, textAlign: 'center' }}>
        {isEnUi ? 'No account?' : '还没有账号？'} <Link to="/register" state={location.state}>{isEnUi ? 'Sign up' : '立即注册'}</Link>
      </p>
      <Link
        to="/register"
        state={location.state}
        className="btn-primary secondary"
        style={{ display: 'block', marginTop: 12, textAlign: 'center', textDecoration: 'none' }}
      >
        {isEnUi ? 'Go to sign up' : '去注册'}
      </Link>
      <p style={{ marginTop: 16, fontSize: 0.85, color: 'var(--text-muted)', textAlign: 'center' }}>
        <Link to="/forgot-password">{isEnUi ? 'Forgot password' : '忘记密码'}</Link>
      </p>
    </div>
  );
}
