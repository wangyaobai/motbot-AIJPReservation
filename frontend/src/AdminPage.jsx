import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { AdminLogin } from './AdminLogin';
import { AdminQuery } from './AdminQuery';
import { AdminMediaCover } from './AdminMediaCover';
import { AdminShops } from './AdminShops';
import { AdminVoiceTest } from './AdminVoiceTest';
import './App.css';

const API = import.meta.env.VITE_API_BASE || '/api';

export default function AdminPage() {
  const [tab, setTab] = useState('orders');
  const [adminToken, setAdminToken] = useState(() =>
    typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('adminToken') || '' : ''
  );
  const [verifying, setVerifying] = useState(!!adminToken);

  useEffect(() => {
    if (!adminToken) { setVerifying(false); return; }
    fetch(`${API}/admin/me`, { headers: { 'x-admin-token': adminToken } })
      .then((r) => r.json())
      .then((d) => { if (!d.ok) handleLogout(); })
      .catch(() => handleLogout())
      .finally(() => setVerifying(false));
  }, []);

  const handleLogin = useCallback((token) => {
    setAdminToken(token);
    if (typeof sessionStorage !== 'undefined') sessionStorage.setItem('adminToken', token);
  }, []);

  const handleLogout = useCallback(() => {
    setAdminToken('');
    if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem('adminToken');
  }, []);

  if (verifying) {
    return <div className="admin-login-root"><p style={{ color: '#9ca3af' }}>验证登录状态…</p></div>;
  }

  if (!adminToken) {
    return <AdminLogin apiBase={API} onLogin={handleLogin} />;
  }

  return (
    <div className="admin-root">
      <header className="admin-header">
        <h1>餐厅预约单管理后台</h1>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <Link to="/" className="link-btn">返回预约首页</Link>
          <button type="button" className="btn-ghost" onClick={handleLogout}>退出登录</button>
        </div>
      </header>
      <nav className="admin-tabs">
        <button type="button" className={tab === 'orders' ? 'active' : ''} onClick={() => setTab('orders')}>
          订单查询
        </button>
        <button type="button" className={tab === 'media' ? 'active' : ''} onClick={() => setTab('media')}>
          封面图管理
        </button>
        <button type="button" className={tab === 'shops' ? 'active' : ''} onClick={() => setTab('shops')}>
          店铺管理
        </button>
        <button type="button" className={tab === 'voice' ? 'active' : ''} onClick={() => setTab('voice')}>
          语音测试
        </button>
      </nav>
      <main className="admin-main">
        {tab === 'orders' && <AdminQuery apiBase={API} adminToken={adminToken} />}
        {tab === 'media' && <AdminMediaCover apiBase={API} adminToken={adminToken} />}
        {tab === 'shops' && <AdminShops apiBase={API} adminToken={adminToken} />}
        {tab === 'voice' && <AdminVoiceTest apiBase={API} adminToken={adminToken} />}
      </main>
    </div>
  );
}
