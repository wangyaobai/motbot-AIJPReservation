import { useState } from 'react';

export function AdminQuery({ apiBase }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [orders, setOrders] = useState(null);
  const [err, setErr] = useState('');

  const search = async (e) => {
    e.preventDefault();
    if (!name.trim() && !phone.trim()) {
      setErr('请填写姓名或手机号');
      return;
    }
    setErr('');
    setLoading(true);
    setOrders(null);
    try {
      const params = new URLSearchParams();
      if (name.trim()) params.set('contact_name', name.trim());
      if (phone.trim()) params.set('contact_phone', phone.trim());
      const res = await fetch(`${apiBase}/orders/by-user?${params}`);
      const data = await res.json();
      if (!data.ok) throw new Error(data.message || '查询失败');
      setOrders(data.orders || []);
    } catch (e) {
      setErr(e.message || '查询失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="admin-query">
      <div className="card">
        <h2>按用户查询</h2>
        <form onSubmit={search}>
          <div className="form-row">
            <label>联系人姓名</label>
            <input
              type="text"
              placeholder="选填"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="form-row">
            <label>联系人手机号</label>
            <input
              type="tel"
              placeholder="选填"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </div>
          {err && <p className="form-error">{err}</p>}
          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? '查询中…' : '查询'}
          </button>
        </form>
      </div>
      {orders && (
        <div className="card">
          <h2>订单列表（{orders.length} 条）</h2>
          {orders.length === 0 ? (
            <p className="text-muted">暂无记录</p>
          ) : (
            <ul className="order-list">
              {orders.map((o) => (
                <li key={o.id} className="order-item">
                  <p><strong>{o.order_no}</strong> {o.status}</p>
                  <p>餐厅：{o.restaurant_name || '-'} {o.restaurant_phone}</p>
                  <p>{o.booking_date} {o.booking_time}，{o.party_size}人 | {o.contact_name} {o.contact_phone}</p>
                  {o.summary_text && <p className="summary">摘要：{o.summary_text}</p>}
                  {o.recording_url && (
                    <a href={o.recording_url} target="_blank" rel="noopener noreferrer">听录音</a>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
