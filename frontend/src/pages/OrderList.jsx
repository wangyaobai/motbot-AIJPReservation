import { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { PageTitleBar } from '../components/TitleBar';
import { formatLocalDateTime } from '../utils/date';

const TABS = [
  { value: 'all', label: '全部' },
  { value: 'pending_pay', label: '未支付' },
  { value: 'booking', label: '预约中' },
  { value: 'completed', label: '预约完成' },
  { value: 'cancel_fail', label: '取消/失败' },
];

const statusText = {
  pending_pay: '未支付',
  pending: '预约中',
  calling: '预约中',
  completed: '预约完成',
  failed: '预约失败',
  cancelled: '取消',
};

export function OrderList() {
  const { isLoggedIn, fetchWithAuth, safeResJson, apiBase } = useAuth();
  const navigate = useNavigate();
  const [orders, setOrders] = useState([]);
  const [total, setTotal] = useState(0);
  const [tab, setTab] = useState('all');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [cancelling, setCancelling] = useState(null);
  const pageSize = 10;

  const statusFilter = tab === 'cancel_fail' ? 'cancelled_or_failed' : tab;

  useEffect(() => {
    if (!isLoggedIn) navigate('/login', { replace: true, state: { from: '/orders' } });
  }, [isLoggedIn, navigate]);

  const load = useCallback(async (pageNum = 1, append = false) => {
    if (!isLoggedIn) return;
    if (pageNum === 1) setLoading(true);
    else setLoadingMore(true);
    try {
      const res = await fetchWithAuth(
        `${apiBase}/order/list?status=${statusFilter}&page=${pageNum}&pageSize=${pageSize}`
      );
      const data = await safeResJson(res);
      if (!data.ok) throw new Error(data.message || '加载失败');
      if (append) setOrders((prev) => [...prev, ...data.orders]);
      else setOrders(data.orders || []);
      setTotal(data.total || 0);
      setPage(pageNum);
    } catch (e) {
      if (!append) setOrders([]);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [isLoggedIn, statusFilter, apiBase, fetchWithAuth, safeResJson, navigate]);

  useEffect(() => {
    load(1);
  }, [statusFilter]);

  useEffect(() => {
    if (isLoggedIn) load(1);
  }, [isLoggedIn]);

  const loadMore = () => {
    if (loadingMore || orders.length >= total) return;
    load(page + 1, true);
  };

  const canCancel = (o) => o.status !== 'completed' && o.status !== 'cancelled';

  const handleCancel = async (orderNo) => {
    if (!confirm('确定取消该预约？')) return;
    setCancelling(orderNo);
    try {
      const res = await fetchWithAuth(`${apiBase}/order/cancel/${orderNo}`, { method: 'POST' });
      const data = await safeResJson(res);
      if (!data.ok) throw new Error(data.message || '取消失败');
      setOrders((prev) => prev.map((o) => (o.order_no === orderNo ? data.order : o)));
    } catch (e) {
      alert(e.message || '取消失败');
    } finally {
      setCancelling(null);
    }
  };

  if (!isLoggedIn) return null; // 已在上方 redirect 到登录，此处仅防御性返回

  return (
    <div className="app app-page-with-white" style={{ paddingBottom: 24 }}>
      <PageTitleBar title="我的订单" backTo="/book" />
      <div className="page-white-body">
        <div className="page-header-white" />
        <div style={{ padding: '0 16px' }}>
        <div className="tabs-wrap">
          <div className="tabs">
            {TABS.map((t) => (
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
          <p className="text-muted">加载中…</p>
        ) : (() => {
          const list = tab === 'cancel_fail' ? orders.filter((o) => o.status !== 'pending_pay') : orders;
          return list.length === 0 ? (
            <p className="text-muted">暂无订单</p>
          ) : (
            <ul className="order-list" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {list.map((o) => (
                <li key={o.id} className="card card-shadow" style={{ padding: 14, marginBottom: 12 }}>
                  <span className="order-card-title">{o.restaurant_name || '未填餐厅名'}</span>
                  <p className="order-card-row">
                    <span className="order-card-label">下单时间</span>
                    <span className="order-card-value">{formatLocalDateTime(o.created_at)}</span>
                  </p>
                  <p className="order-card-row">
                    <span className="order-card-label">预定信息</span>
                    <span className="order-card-value">
                      {o.booking_date} {o.booking_time}
                      {(o.second_booking_date && o.second_booking_time) && ` / ${o.second_booking_date} ${o.second_booking_time}`}
                      {' · 成人 '}{(o.adult_count ?? o.party_size ?? 0)}{' 儿童 '}{(o.child_count ?? 0)}
                    </span>
                  </p>
                  <p className="order-card-row" style={{ marginBottom: 12 }}>
                    <span className="order-card-label">状态</span>
                    <span className="order-card-value">{statusText[o.status] || o.status}</span>
                  </p>
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    {o.status === 'pending_pay' && (
                      <Link to="/book" state={{ orderNo: o.order_no }} className="btn-detail">
                        去支付
                      </Link>
                    )}
                    <Link to={`/orders/${o.order_no}`} className="btn-detail">
                      详情
                    </Link>
                    {canCancel(o) && (
                      <button
                        type="button"
                        className="btn-cancel-booking"
                        onClick={() => handleCancel(o.order_no)}
                        disabled={cancelling === o.order_no}
                      >
                        {cancelling === o.order_no ? '取消中…' : '取消预约'}
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
            {loadingMore ? '加载中…' : '加载更多'}
          </button>
        )}
      </div>
      </div>
    </div>
  );
}
