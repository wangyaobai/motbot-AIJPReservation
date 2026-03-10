import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { PageTitleBar } from '../components/TitleBar';

export function Profile() {
  const { user, isLoggedIn, logout, apiBase, fetchWithAuth, safeResJson } = useAuth();
  const navigate = useNavigate();
  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isLoggedIn) {
      navigate('/login', { replace: true, state: { from: '/profile' } });
      return;
    }
    fetchWithAuth(`${apiBase}/user/info`)
      .then((r) => safeResJson(r))
      .then((data) => {
        if (data.ok) setInfo(data.user);
      })
      .finally(() => setLoading(false));
  }, [isLoggedIn, apiBase, fetchWithAuth, navigate]);

  if (!isLoggedIn || loading) {
    return (
      <div className="app">
        <PageTitleBar title="个人中心" backTo="/book" useHomeIcon />
        <div className="card" style={{ margin: 16 }}>加载中…</div>
      </div>
    );
  }

  const nickname = info?.nickname || user?.nickname || '-';
  const phone = info?.phone ?? user?.phone ?? '-';

  return (
    <div className="app" style={{ paddingBottom: 24 }}>
      <PageTitleBar title="个人中心" backTo="/book" useHomeIcon />
      <div style={{ padding: '0 16px' }}>
        <div className="card profile-info-card" style={{ padding: 18, marginTop: 12, marginBottom: 12 }}>
          <div className="profile-row">
            <span className="profile-label">昵称</span>
            <span className="profile-value">{nickname}</span>
          </div>
          <div className="profile-row">
            <span className="profile-label">手机号</span>
            <span className="profile-value">{phone}</span>
          </div>
        </div>
        <div className="card profile-actions-card" style={{ padding: 0, overflow: 'hidden' }}>
          <Link
            to="/forgot-password"
            className="profile-action-item"
            style={{ display: 'block', padding: '14px 18px', color: 'var(--text)', textDecoration: 'none', borderBottom: '1px solid var(--border)' }}
          >
            修改密码
          </Link>
          <button
            type="button"
            className="profile-action-item profile-action-btn"
            style={{ display: 'block', width: '100%', padding: '14px 18px', border: 'none', background: 'none', color: 'var(--text)', fontSize: '1rem', cursor: 'pointer', textAlign: 'left' }}
            onClick={() => { logout(); navigate('/'); }}
          >
            退出登录
          </button>
        </div>
      </div>
    </div>
  );
}
