import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { PageTitleBar } from '../components/TitleBar';
import { formatLocalDateTime, formatLocalEstimate, formatEstimateJst } from '../utils/date';
import { useUiLang } from '../context/UiLangContext';
import { useTranslate, hasCJK } from '../hooks/useTranslate';

export function OrderDetail() {
  const { orderNo } = useParams();
  const { isLoggedIn, fetchWithAuth, safeResJson, apiBase } = useAuth();
  const navigate = useNavigate();
  const { uiLang } = useUiLang();
  const isEnUi = uiLang === 'en';
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const { translateToEn } = useTranslate(apiBase);
  const [translatedDietary, setTranslatedDietary] = useState('');
  const [translatedRemark, setTranslatedRemark] = useState('');
  const [translatedLogs, setTranslatedLogs] = useState([]);

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

  // 英文模式：先翻译再展示（饮食注意、预约备注、AI 日志）
  useEffect(() => {
    if (!order || !isEnUi) {
      setTranslatedDietary('');
      setTranslatedRemark('');
      setTranslatedLogs([]);
      return;
    }
    if (order.dietary_notes && hasCJK(order.dietary_notes)) {
      translateToEn(order.dietary_notes).then((en) => { if (en && !hasCJK(en)) setTranslatedDietary(en); });
    } else {
      setTranslatedDietary('');
    }
    if (order.booking_remark && hasCJK(order.booking_remark)) {
      translateToEn(order.booking_remark).then((en) => { if (en && !hasCJK(en)) setTranslatedRemark(en); });
    } else {
      setTranslatedRemark('');
    }
    let logList = [];
    try {
      if (order.ai_call_status_log && typeof order.ai_call_status_log === 'string') {
        const parsed = JSON.parse(order.ai_call_status_log);
        if (Array.isArray(parsed)) logList = parsed;
      }
    } catch {}
    if (logList.length === 0) {
      setTranslatedLogs([]);
      return;
    }
    const next = new Array(logList.length).fill(null);
    setTranslatedLogs(next);
    logList.forEach((entry, i) => {
      const t = entry?.text;
      if (!t || typeof t !== 'string' || !hasCJK(t)) {
        next[i] = t || '';
        return;
      }
      translateToEn(t).then((en) => {
        if (en && !hasCJK(en)) {
          setTranslatedLogs((prev) => {
            const copy = [...(prev || [])];
            copy[i] = en;
            return copy;
          });
        }
      });
    });
  }, [order, isEnUi, translateToEn]);

  const canCancel = order && order.status !== 'completed' && order.status !== 'cancelled';
  const showAiCallStatus = order && order.status !== 'pending_pay';

  const callLang = (order?.call_lang || 'ja').toLowerCase();
  const isEnCall = callLang === 'en';

  const translateLogToEn = (text) => {
    if (!text || typeof text !== 'string') return text;
    let t = text.trim();
    if (!t) return t;
    t = t.replace(/您已完成支付提交预约单[，,]待系统确认[。.]?/g, 'Payment received. Your booking is pending confirmation.');
    t = t.replace(/系统排队中[，,]预计(\d+)月(\d+)日\s*(\d{1,2}):(\d{2})开始拨打[，,]请您耐心等待[。.]?/g, (_, m, d, h, min) => `In queue. Estimated call time ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][parseInt(m,10)-1]} ${d}, ${h.padStart(2,'0')}:${min}. Please wait.`);
    t = t.replace(/系统排队中[，,]预计([^，]+)开始拨打[，,]请您耐心等待[。.]?/g, 'In queue. Estimated call time as above. Please wait.');
    t = t.replace(/未接通[，,]今日尝试次数已用完[，,]等待明日营业时间再次尝试[。.]?/g, 'No answer. Max attempts for today. Please try again tomorrow.');
    t = t.replace(/未接通[，,]预计再次尝试[（(]第(\d+)次[）)]/g, 'No answer. Will retry (attempt $1).');
    t = t.replace(/当日已尝试\d+次未接通[，,]请明日再试或更换时间[。.]?/g, 'Tried 3 times today with no answer. Please try again tomorrow.');
    t = t.replace(/开始发起拨打/g, 'Call initiated.');
    t = t.replace(/第(\d+)次尝试[，,]开始发起拨打/g, 'Retry $1, call initiated.');
    t = t.replace(/AI已开始拨打[，,]未接通[，,]预计([^。]+)开始再次尝试[，,]请您耐心等待[。.]?/g, 'AI tried calling but no answer. It will retry. Please wait.');
    t = t.replace(/餐厅尚未营业/g, 'Restaurant not open yet.');
    t = t.replace(/预约成功/g, 'Reservation confirmed.');
    t = t.replace(/预约失败/g, 'Reservation failed.');
    t = t.replace(/「AI沟通记录」/g, 'AI call recording');
    t = t.replace(/「预约凭证」/g, 'Reservation Voucher');
    t = t.replace(/(\d+)月(\d+)日/g, (_, m, d) => `${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][parseInt(m,10)-1]} ${d}`);
    return t;
  };

  const translateIfCn = (text) => {
    if (!isEnUi || !text || typeof text !== 'string') return text;
    return translateLogToEn(text);
  };

  const displayDietary = () => {
    if (!order?.dietary_notes) return '';
    if (!isEnUi) return order.dietary_notes;
    if (translatedDietary) return translatedDietary;
    return hasCJK(order.dietary_notes) ? '—' : order.dietary_notes;
  };
  const displayRemark = () => {
    if (!order?.booking_remark) return '';
    if (!isEnUi) return order.booking_remark;
    if (translatedRemark) return translatedRemark;
    return hasCJK(order.booking_remark) ? '—' : order.booking_remark;
  };

  const handleCancel = async () => {
    if (!order || !confirm(isEnUi ? 'Cancel this booking?' : '确定取消该预约？')) return;
    setCancelling(true);
    try {
      const res = await fetchWithAuth(`${apiBase}/order/cancel/${order.order_no}`, { method: 'POST' });
      const data = await safeResJson(res);
      if (!data.ok) throw new Error(data.message || (isEnUi ? 'Cancel failed' : '取消失败'));
      setOrder(data.order);
    } catch (e) {
      alert(e.message || (isEnUi ? 'Cancel failed' : '取消失败'));
    } finally {
      setCancelling(false);
    }
  };

  if (!isLoggedIn) return null;
  if (loading) {
    return (
      <div className="app app-page-with-white">
        <PageTitleBar title={isEnUi ? 'Order details' : '订单详情'} useHomeIcon={false} onBackClick={() => navigate('/orders')} showLangToggle />
        <div className="page-white-body">
          <div className="card" style={{ margin: 16 }}>{isEnUi ? 'Loading…' : '加载中…'}</div>
        </div>
      </div>
    );
  }
  if (error || !order) {
    return (
      <div className="app app-page-with-white">
        <PageTitleBar title={isEnUi ? 'Order details' : '订单详情'} useHomeIcon={false} onBackClick={() => navigate('/orders')} showLangToggle />
        <div className="page-white-body">
          <div style={{ padding: 16 }}>
            <p className="form-error">{error || (isEnUi ? 'Order not found' : '订单不存在')}</p>
            <Link to="/orders" className="link-btn">{isEnUi ? 'Back to orders' : '返回订单列表'}</Link>
          </div>
        </div>
      </div>
    );
  }

  const statusText = isEnUi
    ? { pending_pay: 'Unpaid', pending: 'In progress', calling: 'Calling', completed: 'Completed', failed: 'Failed', cancelled: 'Cancelled' }
    : { pending_pay: '未支付', pending: '预约中', calling: '预约中', completed: '预约完成', failed: '预约失败', cancelled: '取消' };

  return (
    <div className="app app-page-with-white" style={{ paddingBottom: 24 }}>
      <PageTitleBar title={isEnUi ? 'Order details' : '订单详情'} useHomeIcon={false} onBackClick={() => navigate('/orders')} showLangToggle />
      <div className="page-white-body">
        <div className="page-header-white" />
        <div style={{ padding: '0 16px' }}>
        <div className="card" style={{ padding: 14 }}>
          <strong className="order-card-title" style={{ display: 'block', marginBottom: 14 }}>
            {order.restaurant_name || (isEnUi ? 'Restaurant name not provided' : '未填餐厅名')}
          </strong>
          <div className="order-detail-dl">
            <div className="order-detail-row">
              <span className="order-detail-label">{isEnUi ? 'Restaurant phone' : '餐厅电话'}</span>
              <span className="order-detail-value">{order.restaurant_phone || '-'}</span>
            </div>
            <div className="order-detail-row">
              <span className="order-detail-label">{isEnUi ? '1st choice' : '第一希望'}</span>
              <span className="order-detail-value">{order.booking_date} {order.booking_time}</span>
            </div>
            {(order.second_booking_date && order.second_booking_time) && (
              <div className="order-detail-row">
                <span className="order-detail-label">{isEnUi ? '2nd choice' : '第二希望'}</span>
                <span className="order-detail-value">{order.second_booking_date} {order.second_booking_time}</span>
              </div>
            )}
            <div className="order-detail-row">
              <span className="order-detail-label">{isEnUi ? 'Guests' : '人数'}</span>
              <span className="order-detail-value">
                {isEnUi
                  ? `Adults ${order.adult_count ?? order.party_size ?? 0}, Children ${order.child_count ?? 0}`
                  : `成人 ${order.adult_count ?? order.party_size ?? 0}，儿童 ${order.child_count ?? 0}`}
              </span>
            </div>
            {order.dietary_notes && (
              <div className="order-detail-row">
                <span className="order-detail-label">{isEnUi ? 'Dietary notes' : '饮食注意'}</span>
                <span className="order-detail-value">{displayDietary()}</span>
              </div>
            )}
            {order.booking_remark && (
              <div className="order-detail-row">
                <span className="order-detail-label">{isEnUi ? 'Notes' : '预约备注'}</span>
                <span className="order-detail-value">{displayRemark()}</span>
              </div>
            )}
            <div className="order-detail-row">
              <span className="order-detail-label">{isEnUi ? 'Status' : '状态'}</span>
              <span className="order-detail-value">{statusText[order.status] || order.status}</span>
            </div>
            <div className="order-detail-row">
              <span className="order-detail-label">{isEnUi ? 'Created at' : '创建时间'}</span>
              <span className="order-detail-value">{formatLocalDateTime(order.created_at, isEnUi ? 'en' : undefined)}</span>
            </div>
            {showAiCallStatus && (
              <div className="order-detail-row">
                <span className="order-detail-label">{isEnUi ? 'AI call status' : 'AI 通话状态'}</span>
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
                        const aiCn = '「AI沟通记录」';
                        const voucherCn = '「预约凭证」';
                        const aiLabel = isEnUi ? 'AI call recording' : aiCn;
                        const voucherLabel = isEnUi ? 'Reservation Voucher' : voucherCn;
                        const aiEn = 'AI call recording';
                        const voucherEn = 'Reservation Voucher';
                        const findNext = () => {
                          const candidates = [
                            { i: rest.indexOf(aiCn), which: 'ai', len: aiCn.length },
                            { i: rest.indexOf(aiEn), which: 'ai', len: aiEn.length },
                            { i: rest.indexOf('reservation call process'), which: 'ai', len: 'reservation call process'.length },
                            { i: rest.indexOf('reservation call proces'), which: 'ai', len: 'reservation call proces'.length },
                            { i: rest.indexOf(voucherCn), which: 'voucher', len: voucherCn.length },
                            { i: rest.indexOf(voucherEn), which: 'voucher', len: voucherEn.length },
                          ].filter((c) => c.i >= 0);
                          if (candidates.length === 0) return null;
                          const best = candidates.reduce((a, b) => (a.i <= b.i ? a : b));
                          return { next: best.i, which: best.which, len: best.len };
                        };
                        while (rest.length) {
                          const found = findNext();
                          if (!found) { parts.push(rest); break; }
                          if (found.next > 0) parts.push(rest.slice(0, found.next));
                          if (found.which === 'ai') {
                            parts.push(<Link key={parts.length} to={`/orders/${order.order_no}/ai-record`}>{aiLabel}</Link>);
                          } else {
                            parts.push(<Link key={parts.length} to={`/orders/${order.order_no}/voucher`}>{voucherLabel}</Link>);
                          }
                          rest = rest.slice(found.next + found.len);
                        }
                        return parts.length === 1 && typeof parts[0] === 'string' ? parts[0] : parts;
                      };
                      const formatEst = (dt) => (isEnCall ? formatLocalEstimate(dt, isEnUi ? 'en' : undefined) : formatEstimateJst(dt, isEnUi ? 'en' : undefined));
                      const tzLabel = isEnCall ? (isEnUi ? 'local time' : '当地时间') : (isEnUi ? 'Japan time' : '日本时间');
                      const currentStatusLine = order.ai_call_est_at
                        ? (order.ai_call_status_type === 'retry'
                          ? (isEnUi
                            ? `AI tried calling but no answer. It will retry around ${formatEst(order.ai_call_est_at)} (${tzLabel}).`
                            : `AI已开始拨打，未接通，预计${formatEst(order.ai_call_est_at)}（${tzLabel}）开始再次尝试，请您耐心等待。`)
                          : (isEnUi
                            ? `${order.ai_call_status_type === 'not_open' ? 'Restaurant not open yet' : 'In queue'}, estimated call time ${formatEst(order.ai_call_est_at)} (${tzLabel}).`
                            : `${order.ai_call_status_type === 'not_open' ? '餐厅尚未营业' : '系统排队中'}，预计${formatEst(order.ai_call_est_at)}（${tzLabel}）开始拨打，请您耐心等待。`))
                        : null;
                      return (
                        <>
                          {currentStatusLine && (
                            <p style={{ marginBottom: 8, marginTop: 0 }}>{currentStatusLine}</p>
                          )}
                          <ul className="ai-call-log" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                            {logList.map((entry, i) => {
                              const logText = isEnUi
                                ? (typeof translatedLogs[i] === 'string' ? translatedLogs[i] : translateLogToEn(entry.text))
                                : entry.text;
                              return (
                                <li key={i} style={{ marginBottom: 6, fontSize: '0.9em' }}>
                                  <span style={{ color: 'var(--text-muted)', marginRight: 8 }}>{formatLocalDateTime(entry.at, isEnUi ? 'en' : undefined)}</span>
                                  {renderLogText(logText)}
                                </li>
                              );
                            })}
                          </ul>
                        </>
                      );
                    }
                    return (
                      <>
                        {order.ai_call_status_type === 'retry' && order.ai_call_est_at
                          ? (isEnUi
                            ? `AI tried calling but no answer. It will retry around ${(isEnCall ? formatLocalEstimate : formatEstimateJst)(order.ai_call_est_at, 'en')} (${isEnCall ? 'local time' : 'Japan time'}).`
                            : `AI已开始拨打，未接通，预计${(isEnCall ? formatLocalEstimate : formatEstimateJst)(order.ai_call_est_at)}（${isEnCall ? '当地时间' : '日本时间'}）开始再次尝试，请您耐心等待。`)
                          : order.ai_call_status_type === 'retry_max'
                          ? (translateIfCn(order.ai_call_status_text) || (isEnUi ? 'Tried 3 times today with no answer. Please try again tomorrow.' : '当日已尝试3次未接通，请明日再试或更换时间。'))
                          : order.ai_call_est_at
                          ? (isEnUi
                            ? `${order.ai_call_status_type === 'not_open' ? 'Restaurant not open yet' : 'In queue'}, estimated call time ${(isEnCall ? formatLocalEstimate : formatEstimateJst)(order.ai_call_est_at, 'en')} (${isEnCall ? 'local time' : 'Japan time'}).`
                            : `${order.ai_call_status_type === 'not_open' ? '餐厅尚未营业' : '系统排队中'}，预计${(isEnCall ? formatLocalEstimate : formatEstimateJst)(order.ai_call_est_at)}（${isEnCall ? '当地时间' : '日本时间'}）开始拨打，请您耐心等待。`)
                          : (translateIfCn(order.ai_call_status_text) || (isEnUi ? 'N/A' : '暂无'))}
                        {order.ai_call_status_updated_at && (
                          <span style={{ display: 'block', fontSize: 0.85, color: 'var(--text-muted)', marginTop: 4 }}>
                            {formatLocalDateTime(order.ai_call_status_updated_at, isEnUi ? 'en' : undefined)}
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
                  {isEnUi ? 'Pay' : '去支付'}
                </Link>
              )}
              {canCancel && (
                <button
                  type="button"
                  className="btn-cancel-booking"
                  onClick={handleCancel}
                  disabled={cancelling}
                >
                  {cancelling ? (isEnUi ? 'Cancelling…' : '取消中…') : (isEnUi ? 'Cancel' : '取消预约')}
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
