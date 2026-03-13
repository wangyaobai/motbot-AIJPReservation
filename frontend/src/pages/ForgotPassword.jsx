import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useUiLang } from '../context/UiLangContext';

export function ForgotPassword() {
  const { apiBase, safeResJson } = useAuth();
  const { uiLang } = useUiLang();
  const isEnUi = uiLang === 'en';
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
    if (!raw || !code.trim() || !password) {
      setError(isEnUi ? 'Please fill in phone, code and new password.' : '请填写手机号、验证码和新密码');
      return;
    }
    if (!/^[a-zA-Z0-9]{6,16}$/.test(password) || !/[a-zA-Z]/.test(password) || !/\d/.test(password)) {
      setError(isEnUi ? 'Password must be 6-16 chars and include letters + numbers.' : '密码须 6-16 位，且包含字母和数字');
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
      if (!data.ok) throw new Error(data.message || (isEnUi ? 'Reset failed' : '重置失败'));
      setDone(true);
    } catch (e) {
      setError(e.message || (isEnUi ? 'Reset failed' : '重置失败'));
    } finally {
      setLoading(false);
    }
  };

  if (done) {
    return (
      <div className="card" style={{ maxWidth: 400, margin: '24px auto' }}>
        <h2>{isEnUi ? 'Password reset' : '密码已重置'}</h2>
        <p>{isEnUi ? 'Please sign in with your new password.' : '请使用新密码登录。'}</p>
        <Link to="/login" className="btn-primary" style={{ display: 'inline-block', textAlign: 'center' }}>
          {isEnUi ? 'Sign in' : '去登录'}
        </Link>
      </div>
    );
  }

  return (
    <div className="card" style={{ maxWidth: 400, margin: '24px auto' }}>
      <h2>{isEnUi ? 'Forgot password' : '忘记密码'}</h2>
      <form onSubmit={handleSubmit}>
        <div className="form-row">
          <label>{isEnUi ? 'Phone' : '手机号'}</label>
          <input
            type="tel"
            placeholder={isEnUi ? 'Enter registered phone' : '请输入注册手机号'}
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
          <label>{isEnUi ? 'New password (6-16 chars, letters + numbers)' : '新密码（6-16 位，含字母和数字）'}</label>
          <input
            type="password"
            placeholder={isEnUi ? 'Enter new password' : '请输入新密码'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {error && <p className="form-error">{error}</p>}
        <button type="submit" className="btn-primary" disabled={loading}>
          {loading ? (isEnUi ? 'Submitting…' : '提交中…') : (isEnUi ? 'Reset password' : '重置密码')}
        </button>
      </form>
      <p style={{ marginTop: 16, fontSize: 0.9 }}>
        <Link to="/login">{isEnUi ? 'Back to sign in' : '返回登录'}</Link>
      </p>
    </div>
  );
}
