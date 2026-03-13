import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { BookingForm } from '../BookingForm';
import { OrderResult } from '../OrderResult';
import { useAuth } from '../context/AuthContext';
import { PageTitleBar } from '../components/TitleBar';
import { useUiLang } from '../context/UiLangContext';
import '../App.css';

/** 预约页：无需登录即可填写并提交；已登录时订单会关联账号；支持 state.orderNo 打开已有订单（支付/拨打） */
export function BookingPage() {
  const { isLoggedIn, apiBase, fetchWithAuth, safeResJson } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { uiLang } = useUiLang();
  const isEn = uiLang === 'en';
  const [order, setOrder] = useState(null);
  const presetRestaurant = location.state?.presetRestaurant || null;

  const loadOrderByNo = useCallback(async (orderNo) => {
    if (!orderNo) return;
    try {
      if (isLoggedIn) {
        const r = await fetchWithAuth(`${apiBase}/order/detail/${orderNo}`);
        const data = await safeResJson(r);
        if (data.ok && data.order) setOrder(data.order);
      } else {
        const r = await fetch(`${apiBase}/orders/${orderNo}`);
        const data = await safeResJson(r);
        if (data.ok && data.order) setOrder(data.order);
      }
    } catch (_) {}
  }, [isLoggedIn, apiBase, fetchWithAuth, safeResJson]);

  useEffect(() => {
    const orderNo = location.state?.orderNo;
    if (orderNo) loadOrderByNo(orderNo);
  }, [location.state?.orderNo, loadOrderByNo]);

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
      {order ? (
        <PageTitleBar title={isEn ? 'Payment' : '支付'} onBackClick={() => setOrder(null)} showLangToggle />
      ) : (
        <PageTitleBar title={isEn ? 'Book' : '预约'} backTo="/" showLangToggle />
      )}
      <main className="main">
        {order ? (
          <OrderResult order={order} apiBase={apiBase} onReset={() => setOrder(null)} />
        ) : (
          <BookingForm onSubmit={handleSubmit} apiBase={apiBase} initial={presetRestaurant} />
        )}
      </main>
    </div>
  );
}
