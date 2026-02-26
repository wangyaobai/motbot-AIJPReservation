import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { PageTitleBar } from '../components/TitleBar';

const statusText = {
  pending_pay: '待付款',
  pending: '预约中',
  calling: '预约中',
  completed: '预约成功',
  failed: '预约失败',
  cancelled: '已取消',
};

export function OrderDetail() {
  const { orderNo } = useParams();
  const { isLoggedIn, fetchWithAuth, safeResJson, apiBase } = useAuth();
  const navigate = useNavigate();
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [cancelling, setCancelling] = useState(false);

  const loadDetail = useCallback(async () => {
    if (!orderNo) return;
    setLoading(true);
    setError('');
    try {
      const r = await fetchWithAuth(`${apiBase}/order/detail/${orderNo}`);
      const data = await safeResJson(r);
      if (data.ok) setOrder(data.order);
      else setError(data.message || '加载失败');
    } catch {
      setError('网络错误');
    } finally {
      setLoading(false);
    }
  }, [orderNo, apiBase, fetchWithAuth]);

  useEffect(() => {
    if (!isLoggedIn) {
      navigate('/login', { replace: true, state: { from: `/orders/${orderNo}` } });
      return;
    }
    loadDetail();
  }, [orderNo, isLoggedIn, loadDetail, navigate]);

  const canCancel = order && order.status !== 'completed' && order.status !== 'cancelled';
  const showAiCallStatus = order && order.status !== 'pending_pay';

  const handleCancel = async () => {
    if (!order || !confirm('确定取消该预约？')) return;
    setCancelling(true);
    try {
      const res = await fetchWithAuth(`${apiBase}/order/cancel/${order.order_no}`, { method: 'POST' });
      const data = await safeResJson(res);
      if (!data.ok) throw new Error(data.message || '取消失败');
      setOrder(data.order);
    } catch (e) {
      alert(e.message || '取消失败');
    } finally {
      setCancelling(false);
    }
  };

  if (!isLoggedIn) return null;
  if (loading) {
    return (
      <div className="app">
        <PageTitleBar title="订单详情" backTo="/orders" />
        <div className="card" style={{ margin: 16 }}>加载中…</div>
      </div>
    );
  }
  if (error || !order) {
    return (
      <div className="app">
        <PageTitleBar title="订单详情" backTo="/orders" />
        <div style={{ padding: 16 }}>
          <p className="form-error">{error || '订单不存在'}</p>
          <Link to="/orders" className="link-btn">返回订单列表</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="app" style={{ paddingBottom: 24 }}>
      <PageTitleBar title="订单详情" backTo="/orders" />
      <div style={{ padding: '0 16px' }}>
        <div className="card" style={{ padding: 14 }}>
          <strong className="order-card-title" style={{ display: 'block', marginBottom: 14 }}>
            {order.restaurant_name || '未填餐厅名'}
          </strong>
          <div className="order-detail-dl">
            <div className="order-detail-row">
              <span className="order-detail-label">餐厅电话</span>
              <span className="order-detail-value">{order.restaurant_phone || '-'}</span>
            </div>
            <div className="order-detail-row">
              <span className="order-detail-label">预约时间</span>
              <span className="order-detail-value">{order.booking_date} {order.booking_time}</span>
            </div>
            <div className="order-detail-row">
              <span className="order-detail-label">人数</span>
              <span className="order-detail-value">{order.party_size} 人</span>
            </div>
            <div className="order-detail-row">
              <span className="order-detail-label">状态</span>
              <span className="order-detail-value">{statusText[order.status] || order.status}</span>
            </div>
            <div className="order-detail-row">
              <span className="order-detail-label">创建时间</span>
              <span className="order-detail-value">{order.created_at || '-'}</span>
            </div>
            {showAiCallStatus && (
              <div className="order-detail-row">
                <span className="order-detail-label">AI 通话状态</span>
                <span className="order-detail-value">
                  {order.ai_call_status_text || '暂无'}
                  {order.ai_call_status_updated_at && (
                    <span style={{ display: 'block', fontSize: 0.85, color: 'var(--text-muted)', marginTop: 4 }}>
                      {order.ai_call_status_updated_at}
                    </span>
                  )}
                </span>
              </div>
            )}
          </div>
          {(order.status === 'pending_pay' || order.status === 'pending') && (
            <p style={{ marginTop: 12, marginBottom: 0 }}>
              <Link
                to="/book"
                state={{ orderNo: order.order_no }}
                className="btn-detail"
                style={{ textAlign: 'center' }}
              >
                {order.status === 'pending_pay' ? '去支付' : '代打电话'}
              </Link>
            </p>
          )}
          {canCancel && (
            <p style={{ marginTop: 12, marginBottom: 0 }}>
              <button
                type="button"
                className="btn-cancel-booking"
                onClick={handleCancel}
                disabled={cancelling}
              >
                {cancelling ? '取消中…' : '取消预约'}
              </button>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
