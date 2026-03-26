import { useState } from 'react';

export function AdminLogin({ apiBase, onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!username.trim() || !password) return;
    setErr('');
    setLoading(true);
    try {
      const res = await fetch(`${apiBase}/admin/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!data.ok) throw new Error(data.message || '登录失败');
      onLogin(data.token);
    } catch (e) {
      setErr(e.message || '登录失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="admin-login-root">
      <form className="admin-login-card" onSubmit={handleSubmit}>
        <h1 className="admin-login-title">管理后台登录</h1>
        <p className="admin-login-subtitle">餐厅预约单管理系统</p>
        {err && <p className="admin-login-error">{err}</p>}
        <div className="admin-login-field">
          <label htmlFor="admin-user">用户名</label>
          <input
            id="admin-user"
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="请输入用户名"
            autoComplete="username"
            autoFocus
          />
        </div>
        <div className="admin-login-field">
          <label htmlFor="admin-pass">密码</label>
          <input
            id="admin-pass"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="请输入密码"
            autoComplete="current-password"
          />
        </div>
        <button
          type="submit"
          className="admin-login-btn"
          disabled={loading || !username.trim() || !password}
        >
          {loading ? '登录中…' : '登 录'}
        </button>
      </form>
    </div>
  );
}
