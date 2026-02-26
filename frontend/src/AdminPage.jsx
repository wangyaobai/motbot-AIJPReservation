import { Link } from 'react-router-dom';
import { AdminQuery } from './AdminQuery';
import './App.css';

const API = import.meta.env.VITE_API_BASE || '/api';

export default function AdminPage() {
  return (
    <div className="admin-root">
      <header className="admin-header">
        <h1>餐厅预约单管理后台</h1>
        <Link to="/" className="link-btn">返回预约首页</Link>
      </header>
      <main className="admin-main">
        <AdminQuery apiBase={API} />
      </main>
    </div>
  );
}
