import { useState } from 'react';
import { useAuth } from './context/AuthContext';
import { useUiLang } from './context/UiLangContext';

export function OrderResult({ order, apiBase, onReset, backLabel }) {
  const { safeResJson } = useAuth();
  const { uiLang } = useUiLang();
  const isEnUi = uiLang === 'en';
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
      if (!data.ok) throw new Error(data.message || (isEnUi ? 'Operation failed' : '操作失败'));
      setCurrentOrder(data.order);
    } catch (e) {
      setErr(e.message || (isEnUi ? 'Operation failed' : '操作失败'));
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
      if (!data.ok) throw new Error(data.message || (isEnUi ? 'Failed to start the call' : '发起通话失败'));
      setCurrentOrder(data.order);
    } catch (e) {
      setErr(e.message || (isEnUi ? 'Failed to start the call' : '发起通话失败'));
    } finally {
      setCalling(false);
    }
  };


  const statusText = {
    pending_pay: isEnUi ? 'Unpaid' : '未支付',
    pending: isEnUi ? 'In progress' : '预约中',
    calling: isEnUi ? 'Calling' : '预约中',
    completed: isEnUi ? 'Completed' : '预约完成',
    failed: isEnUi ? 'Failed' : '预约失败',
    cancelled: isEnUi ? 'Cancelled' : '取消',
  };

  const callLangText = (currentOrder.call_lang || 'ja').toLowerCase() === 'en'
    ? (isEnUi ? 'English' : '英语沟通')
    : (isEnUi ? 'Japanese' : '日语沟通');

  return (
    <div className="card">
      <h2>{isEnUi ? 'Booking submitted' : '预约已提交'}</h2>
      <p className="order-no">{isEnUi ? 'Order No: ' : '订单号：'}{currentOrder.order_no}</p>
      <p className="status">{isEnUi ? 'Status: ' : '状态：'}{statusText[currentOrder.status] || currentOrder.status}</p>
      <ul className="order-summary">
        <li>{isEnUi ? 'Restaurant: ' : '餐厅：'}{currentOrder.restaurant_name || '-'} / {currentOrder.restaurant_phone}</li>
        <li>
          {isEnUi ? '1st choice: ' : '第一希望：'}{currentOrder.booking_date} {currentOrder.booking_time}
          {(currentOrder.second_booking_date && currentOrder.second_booking_time) && (
            <> · {isEnUi ? '2nd choice: ' : '第二希望：'}{currentOrder.second_booking_date} {currentOrder.second_booking_time}</>
          )}
        </li>
        <li>
          {isEnUi
            ? `Guests: Adults ${currentOrder.adult_count ?? currentOrder.party_size ?? 0}, Children ${currentOrder.child_count ?? 0}`
            : `人数：成人 ${currentOrder.adult_count ?? currentOrder.party_size ?? 0}，儿童 ${currentOrder.child_count ?? 0}`}
        </li>
        {(currentOrder.dietary_notes) && <li>{isEnUi ? 'Dietary notes: ' : '饮食注意：'}{currentOrder.dietary_notes}</li>}
        {(currentOrder.booking_remark) && <li>{isEnUi ? 'Notes: ' : '预约备注：'}{currentOrder.booking_remark}</li>}
        <li>{isEnUi ? 'Contact: ' : '联系人：'}{currentOrder.contact_name} {currentOrder.contact_phone}</li>
        {currentOrder.summary_text && (
          <li className="summary">{isEnUi ? 'AI summary: ' : 'AI 沟通摘要：'}{currentOrder.summary_text}</li>
        )}
      </ul>
      {currentOrder.recording_url && (
        <p>
          <a href={currentOrder.recording_url} target="_blank" rel="noopener noreferrer">
            {isEnUi ? 'Listen to recording' : '收听通话录音'}
          </a>
        </p>
      )}
      {currentOrder.status === 'pending_pay' && (
        <>
          <p className="hint">
            {isEnUi
              ? 'Please complete payment first. After that, AI can call the restaurant for you.'
              : '请完成支付后，即可由 AI 代您拨打餐厅电话。'}
          </p>
          {err && <p className="form-error">{err}</p>}
          <button type="button" className="btn-primary" onClick={confirmPayment} disabled={paying}>
            {paying ? (isEnUi ? 'Processing…' : '处理中…') : (isEnUi ? 'Pay' : '支付')}
          </button>
        </>
      )}
      {currentOrder.status === 'pending' && (
        <>
          <p className="hint">
            {isEnUi
              ? `Tap below and AI will call the restaurant (${callLangText}) and record the call. A summary will be sent to your phone via SMS after completion.`
              : `点击下方按钮，由 AI 自动拨打餐厅电话（${callLangText}），并录音。完成后将短信发送摘要至您的手机。`}
          </p>
          {err && <p className="form-error">{err}</p>}
          <button type="button" className="btn-primary" onClick={startCall} disabled={calling}>
            {calling ? (isEnUi ? 'Starting call…' : '正在发起通话…') : (isEnUi ? 'Start AI call' : '立即代打电话')}
          </button>
        </>
      )}
      <button type="button" className="btn-primary secondary" onClick={onReset}>
        {backLabel || (isEnUi ? 'Book another' : '再预约一单')}
      </button>
    </div>
  );
}
