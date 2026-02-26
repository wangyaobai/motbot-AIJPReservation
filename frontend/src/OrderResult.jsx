import { useState } from 'react';
import { useAuth } from './context/AuthContext';

export function OrderResult({ order, apiBase, onReset, backLabel }) {
  const { safeResJson } = useAuth();
  const [calling, setCalling] = useState(false);
  const [paying, setPaying] = useState(false);
  const [err, setErr] = useState('');
  const [currentOrder, setCurrentOrder] = useState(order);

  const confirmPayment = async () => {
    setErr('');
    setPaying(true);
    try {
      const res = await fetch(`${apiBase}/orders/${order.order_no}/confirm-payment`, { method: 'POST' });
      const data = await safeResJson(res);
      if (!data.ok) throw new Error(data.message || '操作失败');
      setCurrentOrder(data.order);
    } catch (e) {
      setErr(e.message || '操作失败');
    } finally {
      setPaying(false);
    }
  };

  const startCall = async () => {
    setErr('');
    setCalling(true);
    try {
      const res = await fetch(`${apiBase}/orders/${order.order_no}/call`, { method: 'POST' });
      const data = await safeResJson(res);
      if (!data.ok) throw new Error(data.message || '发起通话失败');
      setCurrentOrder(data.order);
    } catch (e) {
      setErr(e.message || '发起通话失败');
    } finally {
      setCalling(false);
    }
  };

  const statusText = {
    pending_pay: '未支付',
    pending: '预约中',
    calling: '预约中',
    completed: '预约完成',
    failed: '预约失败',
    cancelled: '取消',
  };

  return (
    <div className="card">
      <h2>预约已提交</h2>
      <p className="order-no">订单号：{currentOrder.order_no}</p>
      <p className="status">状态：{statusText[currentOrder.status] || currentOrder.status}</p>
      <ul className="order-summary">
        <li>餐厅：{currentOrder.restaurant_name || '-'} / {currentOrder.restaurant_phone}</li>
        <li>
          第一希望：{currentOrder.booking_date} {currentOrder.booking_time}
          {(currentOrder.second_booking_date && currentOrder.second_booking_time) && (
            <> · 第二希望：{currentOrder.second_booking_date} {currentOrder.second_booking_time}</>
          )}
        </li>
        <li>人数：成人 {currentOrder.adult_count ?? currentOrder.party_size ?? 0}，儿童 {currentOrder.child_count ?? 0}</li>
        {(currentOrder.dietary_notes) && <li>饮食注意：{currentOrder.dietary_notes}</li>}
        {(currentOrder.booking_remark) && <li>预约备注：{currentOrder.booking_remark}</li>}
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
      {currentOrder.status === 'pending_pay' && (
        <>
          <p className="hint">请完成支付后，即可由 AI 代您拨打餐厅电话。</p>
          {err && <p className="form-error">{err}</p>}
          <button type="button" className="btn-primary" onClick={confirmPayment} disabled={paying}>
            {paying ? '处理中…' : '支付'}
          </button>
        </>
      )}
      {currentOrder.status === 'pending' && (
        <>
          <p className="hint">点击下方按钮，由 AI 自动拨打餐厅电话（日语沟通），并录音。完成后将短信发送摘要至您的手机。</p>
          {err && <p className="form-error">{err}</p>}
          <button type="button" className="btn-primary" onClick={startCall} disabled={calling}>
            {calling ? '正在发起通话…' : '立即代打电话'}
          </button>
        </>
      )}
      <button type="button" className="btn-primary secondary" onClick={onReset}>
        {backLabel || '再预约一单'}
      </button>
    </div>
  );
}
