import { useState } from 'react';
import { BookingForm } from './BookingForm';
import { OrderResult } from './OrderResult';
import './App.css';

const API = import.meta.env.VITE_API_BASE || '/api';

export default function App() {
  const [order, setOrder] = useState(null);

  const handleSubmit = async (data) => {
    const res = await fetch(`${API}/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.message || '提交失败');
    setOrder(json.order);
  };

  return (
    <div className="app">
      <header className="header">
        <div className="header-image" />
        <div className="header-text">
          <h1>🥢 日本餐厅 AI 代预约</h1>
          <p className="tagline">不会日语？AI 帮您用日语致电餐厅预约</p>
        </div>
      </header>

      <main className="main">
        {order ? (
          <OrderResult order={order} apiBase={API} onReset={() => setOrder(null)} />
        ) : (
          <BookingForm onSubmit={handleSubmit} apiBase={API} />
        )}
      </main>
    </div>
  );
}
