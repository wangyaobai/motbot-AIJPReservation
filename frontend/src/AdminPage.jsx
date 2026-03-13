import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AdminQuery } from './AdminQuery';
import { AdminMediaCover } from './AdminMediaCover';
import './App.css';

const API = import.meta.env.VITE_API_BASE || '/api';

export default function AdminPage() {
  const [tab, setTab] = useState('orders');

  return (
    <div className="admin-root">
      <header className="admin-header">
        <h1>餐厅预约单管理后台</h1>
        <Link to="/" className="link-btn">返回预约首页</Link>
      </header>
      <nav className="admin-tabs">
        <button
          type="button"
          className={tab === 'orders' ? 'active' : ''}
          onClick={() => setTab('orders')}
        >
          订单查询
        </button>
        <button
          type="button"
          className={tab === 'media' ? 'active' : ''}
          onClick={() => setTab('media')}
        >
          封面图管理
        </button>
      </nav>
      <main className="admin-main">
        {tab === 'orders' && <AdminQuery apiBase={API} />}
        {tab === 'media' && <AdminMediaCover apiBase={API} />}
      </main>
    </div>
  );
}
