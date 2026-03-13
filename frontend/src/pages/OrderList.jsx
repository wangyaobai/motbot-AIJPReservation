import { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { PageTitleBar } from '../components/TitleBar';
import { formatLocalDateTime } from '../utils/date';
import { useUiLang } from '../context/UiLangContext';

export function OrderList() {
  const { isLoggedIn, fetchWithAuth, safeResJson, apiBase } = useAuth();
  const navigate = useNavigate();
  const { uiLang } = useUiLang();
  const isEnUi = uiLang === 'en';
  const [orders, setOrders] = useState([]);
  const [total, setTotal] = useState(0);
  const [tab, setTab] = useState('all');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [cancelling, setCancelling] = useState(null);
  const [loadError, setLoadError] = useState('');
  const pageSize = 10;

  const statusFilter = tab === 'cancel_fail' ? 'cancelled_or_failed' : tab;

  useEffect(() => {
    if (!isLoggedIn) navigate('/login', { replace: true, state: { from: '/orders' } });
  }, [isLoggedIn, navigate]);

  const load = useCallback(async (pageNum = 1, append = false) => {
    if (!isLoggedIn) return;
    setLoadError('');
    if (pageNum === 1) setLoading(true);
    else setLoadingMore(true);
    try {
      const res = await fetchWithAuth(
        `${apiBase}/order/list?status=${statusFilter}&page=${pageNum}&pageSize=${pageSize}`
      );
      const data = await safeResJson(res);
      if (!data.ok) throw new Error(data.message || (isEnUi ? 'Load failed' : '加载失败'));
      if (append) setOrders((prev) => [...prev, ...(data.orders || [])]);
      else setOrders(data.orders || []);
      setTotal(data.total ?? 0);
      setPage(pageNum);
    } catch (e) {
      if (!append) setOrders([]);
      setLoadError(e?.message || (isEnUi ? 'Load failed' : '加载失败'));
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [isLoggedIn, statusFilter, apiBase, fetchWithAuth, safeResJson, isEnUi]);

  useEffect(() => {
    if (isLoggedIn) load(1);
  }, [isLoggedIn, statusFilter, load]);

  const loadMore = () => {
    if (loadingMore || orders.length >= total) return;
    load(page + 1, true);
  };

  const canCancel = (o) => o.status !== 'completed' && o.status !== 'cancelled';

  const handleCancel = async (orderNo) => {
    if (!confirm(isEnUi ? 'Cancel this booking?' : '确定取消该预约？')) return;
    setCancelling(orderNo);
    try {
      const res = await fetchWithAuth(`${apiBase}/order/cancel/${orderNo}`, { method: 'POST' });
      const data = await safeResJson(res);
      if (!data.ok) throw new Error(data.message || (isEnUi ? 'Cancel failed' : '取消失败'));
      setOrders((prev) => prev.map((o) => (o.order_no === orderNo ? data.order : o)));
    } catch (e) {
      alert(e.message || (isEnUi ? 'Cancel failed' : '取消失败'));
    } finally {
      setCancelling(null);
    }
  };

  if (!isLoggedIn) return null; // 已在上方 redirect 到登录，此处仅防御性返回

  return (
    <div className="app app-page-with-white" style={{ paddingBottom: 24 }}>
      <PageTitleBar title={isEnUi ? 'Orders' : '我的订单'} backTo="/" showLangToggle />
      <div className="page-white-body">
        <div className="page-header-white" />
        <div style={{ padding: '0 16px' }}>
        <div className="tabs-wrap">
          <div className="tabs">
            {[
              { value: 'all', label: isEnUi ? 'All' : '全部' },
              { value: 'pending_pay', label: isEnUi ? 'Unpaid' : '未支付' },
              { value: 'booking', label: isEnUi ? 'In progress' : '预约中' },
              { value: 'completed', label: isEnUi ? 'Completed' : '预约完成' },
              { value: 'cancel_fail', label: isEnUi ? 'Cancelled/Failed' : '取消/失败' },
            ].map((t) => (
              <button
                key={t.value}
                type="button"
                className={`tab ${tab === t.value ? 'active' : ''}`}
                onClick={() => setTab(t.value)}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
        {loading ? (
          <p className="text-muted">{isEnUi ? 'Loading…' : '加载中…'}</p>
        ) : loadError ? (
          <p className="form-error" style={{ marginTop: 8 }}>
            {loadError}
            <button type="button" className="link-btn" style={{ marginLeft: 8 }} onClick={() => load(1)}>
              {isEnUi ? 'Retry' : '重试'}
            </button>
          </p>
        ) : (() => {
          const list = tab === 'cancel_fail' ? orders.filter((o) => o.status !== 'pending_pay') : orders;
          return list.length === 0 ? (
            <p className="text-muted">{isEnUi ? 'No orders yet.' : '暂无订单'}</p>
          ) : (
            <ul className="order-list" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {list.map((o) => (
                <li key={o.id} className="card card-shadow" style={{ padding: 14, marginBottom: 12 }}>
                  <span className="order-card-title">{o.restaurant_name || (isEnUi ? 'Restaurant name not provided' : '未填餐厅名')}</span>
                  <p className="order-card-row">
                    <span className="order-card-label">{isEnUi ? 'Created at' : '下单时间'}</span>
                    <span className="order-card-value">{formatLocalDateTime(o.created_at)}</span>
                  </p>
                  <p className="order-card-row">
                    <span className="order-card-label">{isEnUi ? 'Booking' : '预定信息'}</span>
                    <span className="order-card-value">
                      {o.booking_date} {o.booking_time}
                      {(o.second_booking_date && o.second_booking_time) && ` / ${o.second_booking_date} ${o.second_booking_time}`}
                      {isEnUi
                        ? ` · Adults ${(o.adult_count ?? o.party_size ?? 0)} · Children ${(o.child_count ?? 0)}`
                        : ` · 成人 ${(o.adult_count ?? o.party_size ?? 0)} 儿童 ${(o.child_count ?? 0)}`}
                    </span>
                  </p>
                  <p className="order-card-row" style={{ marginBottom: 12 }}>
                    <span className="order-card-label">{isEnUi ? 'Status' : '状态'}</span>
                    <span className="order-card-value">
                      {(isEnUi
                        ? { pending_pay: 'Unpaid', pending: 'In progress', calling: 'Calling', completed: 'Completed', failed: 'Failed', cancelled: 'Cancelled' }
                        : { pending_pay: '未支付', pending: '预约中', calling: '预约中', completed: '预约完成', failed: '预约失败', cancelled: '取消' }
                      )[o.status] || o.status}
                    </span>
                  </p>
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    {o.status === 'pending_pay' && (
                      <Link to="/book" state={{ orderNo: o.order_no }} className="btn-detail">
                        {isEnUi ? 'Pay' : '去支付'}
                      </Link>
                    )}
                    <Link to={`/orders/${o.order_no}`} className="btn-detail">
                      {isEnUi ? 'Details' : '详情'}
                    </Link>
                    {canCancel(o) && (
                      <button
                        type="button"
                        className="btn-cancel-booking"
                        onClick={() => handleCancel(o.order_no)}
                        disabled={cancelling === o.order_no}
                      >
                        {cancelling === o.order_no ? (isEnUi ? 'Cancelling…' : '取消中…') : (isEnUi ? 'Cancel' : '取消预约')}
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          );
        })()}
        {!loading && orders.length > 0 && orders.length < total && (
          <button
            type="button"
            className="btn-primary secondary"
            onClick={loadMore}
            disabled={loadingMore}
            style={{ marginTop: 16 }}
          >
            {loadingMore ? (isEnUi ? 'Loading…' : '加载中…') : (isEnUi ? 'Load more' : '加载更多')}
          </button>
        )}
      </div>
      </div>
    </div>
  );
}
