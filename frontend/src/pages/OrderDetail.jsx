import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { PageTitleBar } from '../components/TitleBar';
import { formatLocalDateTime, formatLocalEstimate, formatEstimateJst } from '../utils/date';

const statusText = {
  pending_pay: '未支付',
  pending: '预约中',
  calling: '预约中',
  completed: '预约完成',
  failed: '预约失败',
  cancelled: '取消',
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

  const callLang = (order?.call_lang || 'ja').toLowerCase();
  const isEnCall = callLang === 'en';

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
      <div className="app app-page-with-white">
        <PageTitleBar title="订单详情" backTo="/orders" />
        <div className="page-white-body">
          <div className="card" style={{ margin: 16 }}>加载中…</div>
        </div>
      </div>
    );
  }
  if (error || !order) {
    return (
      <div className="app app-page-with-white">
        <PageTitleBar title="订单详情" backTo="/orders" />
        <div className="page-white-body">
          <div style={{ padding: 16 }}>
            <p className="form-error">{error || '订单不存在'}</p>
            <Link to="/orders" className="link-btn">返回订单列表</Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app app-page-with-white" style={{ paddingBottom: 24 }}>
      <PageTitleBar title="订单详情" backTo="/orders" />
      <div className="page-white-body">
        <div className="page-header-white" />
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
              <span className="order-detail-label">第一希望</span>
              <span className="order-detail-value">{order.booking_date} {order.booking_time}</span>
            </div>
            {(order.second_booking_date && order.second_booking_time) && (
              <div className="order-detail-row">
                <span className="order-detail-label">第二希望</span>
                <span className="order-detail-value">{order.second_booking_date} {order.second_booking_time}</span>
              </div>
            )}
            <div className="order-detail-row">
              <span className="order-detail-label">人数</span>
              <span className="order-detail-value">成人 {order.adult_count ?? order.party_size ?? 0}，儿童 {order.child_count ?? 0}</span>
            </div>
            {order.dietary_notes && (
              <div className="order-detail-row">
                <span className="order-detail-label">饮食注意</span>
                <span className="order-detail-value">{order.dietary_notes}</span>
              </div>
            )}
            {order.booking_remark && (
              <div className="order-detail-row">
                <span className="order-detail-label">预约备注</span>
                <span className="order-detail-value">{order.booking_remark}</span>
              </div>
            )}
            <div className="order-detail-row">
              <span className="order-detail-label">状态</span>
              <span className="order-detail-value">{statusText[order.status] || order.status}</span>
            </div>
            <div className="order-detail-row">
              <span className="order-detail-label">创建时间</span>
              <span className="order-detail-value">{formatLocalDateTime(order.created_at)}</span>
            </div>
            {showAiCallStatus && (
              <div className="order-detail-row">
                <span className="order-detail-label">AI 通话状态</span>
                <span className="order-detail-value">
                  {(() => {
                    let logList = [];
                    if (order.ai_call_status_log && typeof order.ai_call_status_log === 'string') {
                      try {
                        logList = JSON.parse(order.ai_call_status_log);
                        if (!Array.isArray(logList)) logList = [];
                      } catch {}
                    }
                    if (logList.length > 0) {
                      const renderLogText = (text) => {
                        if (!text || typeof text !== 'string') return text;
                        const parts = [];
                        let rest = text;
                        const ai = '「AI沟通记录」';
                        const voucher = '「预约凭证」';
                        while (rest.length) {
                          const i1 = rest.indexOf(ai);
                          const i2 = rest.indexOf(voucher);
                          let next = -1;
                          let which = null;
                          if (i1 >= 0 && (i2 < 0 || i1 <= i2)) { next = i1; which = 'ai'; }
                          else if (i2 >= 0) { next = i2; which = 'voucher'; }
                          if (next < 0) { parts.push(rest); break; }
                          if (next > 0) parts.push(rest.slice(0, next));
                          if (which === 'ai') {
                            parts.push(<Link key={parts.length} to={`/orders/${order.order_no}/ai-record`}>{ai}</Link>);
                            rest = rest.slice(next + ai.length);
                          } else {
                            parts.push(<Link key={parts.length} to={`/orders/${order.order_no}/voucher`}>{voucher}</Link>);
                            rest = rest.slice(next + voucher.length);
                          }
                        }
                        return parts.length === 1 && typeof parts[0] === 'string' ? parts[0] : parts;
                      };
                      const formatEst = isEnCall ? formatLocalEstimate : formatEstimateJst;
                      const tzLabel = isEnCall ? '当地时间' : '日本时间';
                      const currentStatusLine = order.ai_call_est_at
                        ? (order.ai_call_status_type === 'retry'
                          ? `AI已开始拨打，未接通，预计${formatEst(order.ai_call_est_at)}（${tzLabel}）开始再次尝试，请您耐心等待。`
                          : `${order.ai_call_status_type === 'not_open' ? '餐厅尚未营业' : '系统排队中'}，预计${formatEst(order.ai_call_est_at)}（${tzLabel}）开始拨打，请您耐心等待。`)
                        : null;
                      return (
                        <>
                          {currentStatusLine && (
                            <p style={{ marginBottom: 8, marginTop: 0 }}>{currentStatusLine}</p>
                          )}
                          <ul className="ai-call-log" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                            {logList.map((entry, i) => (
                              <li key={i} style={{ marginBottom: 6, fontSize: '0.9em' }}>
                                <span style={{ color: 'var(--text-muted)', marginRight: 8 }}>{formatLocalDateTime(entry.at)}</span>
                                {renderLogText(entry.text)}
                              </li>
                            ))}
                          </ul>
                        </>
                      );
                    }
                    return (
                      <>
                        {order.ai_call_status_type === 'retry' && order.ai_call_est_at
                          ? `AI已开始拨打，未接通，预计${(isEnCall ? formatLocalEstimate : formatEstimateJst)(order.ai_call_est_at)}（${isEnCall ? '当地时间' : '日本时间'}）开始再次尝试，请您耐心等待。`
                          : order.ai_call_status_type === 'retry_max'
                          ? (order.ai_call_status_text || '当日已尝试3次未接通，请明日再试或更换时间。')
                          : order.ai_call_est_at
                          ? `${order.ai_call_status_type === 'not_open' ? '餐厅尚未营业' : '系统排队中'}，预计${(isEnCall ? formatLocalEstimate : formatEstimateJst)(order.ai_call_est_at)}（${isEnCall ? '当地时间' : '日本时间'}）开始拨打，请您耐心等待。`
                          : (order.ai_call_status_text || '暂无')}
                        {order.ai_call_status_updated_at && (
                          <span style={{ display: 'block', fontSize: 0.85, color: 'var(--text-muted)', marginTop: 4 }}>
                            {formatLocalDateTime(order.ai_call_status_updated_at)}
                          </span>
                        )}
                      </>
                    );
                  })()}
                </span>
              </div>
            )}
          </div>
          {(order.status === 'pending_pay' || canCancel) && (
            <div style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 10 }}>
              {order.status === 'pending_pay' && (
                <Link to="/book" state={{ orderNo: order.order_no }} className="btn-detail" style={{ display: 'inline-block', textAlign: 'center' }}>
                  去支付
                </Link>
              )}
              {canCancel && (
                <button
                  type="button"
                  className="btn-cancel-booking"
                  onClick={handleCancel}
                  disabled={cancelling}
                >
                  {cancelling ? '取消中…' : '取消预约'}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
      </div>
    </div>
  );
}
