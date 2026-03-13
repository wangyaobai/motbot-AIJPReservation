import { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useUiLang } from '../context/UiLangContext';

function passwordStrength(pwd) {
  if (!pwd) return { level: 0, text: '' };
  let level = 0;
  if (pwd.length >= 6) level++;
  if (pwd.length >= 10) level++;
  if (/[a-zA-Z]/.test(pwd) && /\d/.test(pwd)) level++;
  if (/[^a-zA-Z0-9]/.test(pwd)) level++;
  const text = ['', '弱', '中', '强', '很强'][level];
  return { level, text };
}

export function Register() {
  const { setToken, apiBase, safeResJson } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { uiLang } = useUiLang();
  const isEnUi = uiLang === 'en';
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [agree, setAgree] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const strength = passwordStrength(password);

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
      });
      const data = await safeResJson(res);
      if (!data.ok) throw new Error(data.message || (isEnUi ? 'Send failed' : '发送失败'));
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
    if (!code.trim()) {
      setError(isEnUi ? 'Please enter the code.' : '请填写验证码');
      return;
    }
    if (!/^[a-zA-Z0-9]{6,16}$/.test(password) || !/[a-zA-Z]/.test(password) || !/\d/.test(password)) {
      setError(isEnUi ? 'Password must be 6-16 chars and include letters + numbers.' : '密码须 6-16 位，且包含字母和数字');
      return;
    }
    if (!agree) {
      setError(isEnUi ? 'Please agree to the privacy policy.' : '请先同意隐私协议');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${apiBase}/user/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: raw,
          code: code.trim(),
          password,
          region: 'cn',
          agree_privacy: true,
        }),
      });
      const data = await safeResJson(res);
      if (!data.ok) throw new Error(data.message || (isEnUi ? 'Sign up failed' : '注册失败'));
      setToken(data.token, data.user);
      const from = location.state?.from || '/orders';
      navigate(from, { replace: true });
    } catch (e) {
      setError(e.message || (isEnUi ? 'Sign up failed' : '注册失败'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card" style={{ maxWidth: 400, margin: '24px auto' }}>
      <h2>{isEnUi ? 'Sign up' : '注册'}</h2>
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
        <div className="form-row">
          <label>{isEnUi ? 'Password (6-16 chars, letters + numbers)' : '设置密码（6-16 位，含字母和数字）'}</label>
          <input
            type="password"
            placeholder={isEnUi ? 'Enter password' : '请输入密码'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {password && strength.text && (
            <span className="text-muted" style={{ fontSize: 0.85, marginTop: 4 }}>
              {isEnUi ? 'Strength: ' : '强度：'}{strength.text}
            </span>
          )}
        </div>
        <div className="check-row">
          <input
            type="checkbox"
            id="agree"
            checked={agree}
            onChange={(e) => setAgree(e.target.checked)}
          />
          <label htmlFor="agree">{isEnUi ? 'I agree to the Privacy Policy' : '我已阅读并同意《隐私协议》'}</label>
        </div>
        {error && <p className="form-error">{error}</p>}
        <button type="submit" className="btn-primary" disabled={loading}>
          {loading ? (isEnUi ? 'Signing up…' : '注册中…') : (isEnUi ? 'Sign up' : '注册')}
        </button>
      </form>
      <p style={{ marginTop: 16, fontSize: 0.9 }}>
        {isEnUi ? 'Already have an account?' : '已有账号？'} <Link to="/login" state={location.state}>{isEnUi ? 'Sign in' : '去登录'}</Link>
      </p>
    </div>
  );
}
