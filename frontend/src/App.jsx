import { useState } from 'react';
import { Link } from 'react-router-dom';
import { BookingForm } from './BookingForm';
import { OrderResult } from './OrderResult';
import { useAuth } from './context/AuthContext';
import './App.css';

export default function App() {
  const { isLoggedIn, apiBase, fetchWithAuth, safeResJson } = useAuth();
  const [order, setOrder] = useState(null);

  const handleSubmit = async (data) => {
    const res = await fetchWithAuth(`${apiBase}/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const json = await safeResJson(res);
    if (!json.ok) throw new Error(json.message || '提交失败');
    setOrder(json.order);
  };

  return (
    <div className="app">
      <header className="header">
        <div className="header-image" />
        <div className="header-text">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <div>
              <h1>🥢 日本餐厅 AI 代预约</h1>
              <p className="tagline">不会日语？AI 帮您用日语致电餐厅预约</p>
            </div>
            {isLoggedIn ? (
              <Link to="/profile" className="link-btn">个人中心</Link>
            ) : (
              <Link to="/login" className="link-btn">登录</Link>
            )}
          </div>
        </div>
      </header>

      <main className="main">
        {order ? (
          <OrderResult order={order} apiBase={apiBase} onReset={() => setOrder(null)} />
        ) : (
          <BookingForm onSubmit={handleSubmit} apiBase={apiBase} />
        )}
      </main>
    </div>
  );
}
