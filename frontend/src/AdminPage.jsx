import { Link } from 'react-router-dom';
import { AdminQuery } from './AdminQuery';
import './App.css';

const API = import.meta.env.VITE_API_BASE || '/api';

export default function AdminPage() {
  return (
    <div className="app">
      <header className="header header-admin">
        <h1>后台 · 订单查询</h1>
        <p className="tagline">按联系人姓名或手机号查询预约记录</p>
        <Link to="/" className="link-btn">
          返回预约首页
        </Link>
      </header>
      <main className="main">
        <AdminQuery apiBase={API} />
      </main>
    </div>
  );
}
