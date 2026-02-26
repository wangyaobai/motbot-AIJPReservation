import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export function BindHistory() {
  const { isLoggedIn, fetchWithAuth, apiBase } = useAuth();
  const navigate = useNavigate();
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setResult(null);
    const raw = (phone || '').trim().replace(/\D/g, '');
    if (raw.length < 11) {
      setError('请填写正确的联系人手机号');
      return;
    }
    setLoading(true);
    try {
      const res = await fetchWithAuth(`${apiBase}/order/bind-history`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contact_phone: raw }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.message || '绑定失败');
      setResult(data);
    } catch (e) {
      setError(e.message || '绑定失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isLoggedIn) navigate('/login', { replace: true });
  }, [isLoggedIn, navigate]);

  if (!isLoggedIn) return null;

  return (
    <div className="card" style={{ maxWidth: 400, margin: '24px auto' }}>
      <h2>绑定历史订单</h2>
      <p className="hint">
        若您曾在未登录状态下预约，可在此输入当时填写的联系人手机号，将近 3 个月内该手机号的订单绑定到当前账号。
      </p>
      <form onSubmit={handleSubmit}>
        <div className="form-row">
          <label>联系人手机号</label>
          <input
            type="tel"
            placeholder="请输入预约时填写的手机号"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </div>
        {error && <p className="form-error">{error}</p>}
        {result && <p style={{ color: 'var(--accent)' }}>{result.message}</p>}
        <button type="submit" className="btn-primary" disabled={loading}>
          {loading ? '绑定中…' : '确认绑定'}
        </button>
      </form>
      <p style={{ marginTop: 16 }}>
        <Link to="/profile" className="link-btn">返回个人中心</Link>
      </p>
    </div>
  );
}
