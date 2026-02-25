import { useState } from 'react';

export function OrderResult({ order, apiBase, onReset }) {
  const [calling, setCalling] = useState(false);
  const [err, setErr] = useState('');
  const [currentOrder, setCurrentOrder] = useState(order);

  const startCall = async () => {
    setErr('');
    setCalling(true);
    try {
      const res = await fetch(`${apiBase}/orders/${order.order_no}/call`, { method: 'POST' });
      const data = await res.json();
      if (!data.ok) throw new Error(data.message || '发起通话失败');
      setCurrentOrder(data.order);
    } catch (e) {
      setErr(e.message || '发起通话失败');
    } finally {
      setCalling(false);
    }
  };

  const statusText = {
    pending: '待拨打电话',
    calling: '正在拨打餐厅电话…',
    completed: '已完成（已发短信摘要）',
  };

  return (
    <div className="card">
      <h2>预约已提交</h2>
      <p className="order-no">订单号：{currentOrder.order_no}</p>
      <p className="status">状态：{statusText[currentOrder.status] || currentOrder.status}</p>
      <ul className="order-summary">
        <li>餐厅：{currentOrder.restaurant_name || '-'} / {currentOrder.restaurant_phone}</li>
        <li>时间：{currentOrder.booking_date} {currentOrder.booking_time}，{currentOrder.party_size} 人</li>
        <li>联系人：{currentOrder.contact_name} {currentOrder.contact_phone}</li>
        {currentOrder.summary_text && (
          <li className="summary">AI 沟通摘要：{currentOrder.summary_text}</li>
        )}
      </ul>
      {currentOrder.recording_url && (
        <p>
          <a href={currentOrder.recording_url} target="_blank" rel="noopener noreferrer">收听通话录音</a>
        </p>
        )}
      {currentOrder.status === 'pending' && (
        <>
          <p className="hint">提交后请点击下方按钮，由 AI 自动拨打餐厅电话（日语沟通），并录音。完成后将短信发送摘要至您的手机。</p>
          {err && <p className="form-error">{err}</p>}
          <button type="button" className="btn-primary" onClick={startCall} disabled={calling}>
            {calling ? '正在发起通话…' : '立即代打电话'}
          </button>
        </>
      )}
      <button type="button" className="btn-primary secondary" onClick={onReset}>
        再预约一单
      </button>
    </div>
  );
}
