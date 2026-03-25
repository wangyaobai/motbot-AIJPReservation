import { useState, useEffect } from 'react';
import { formatLocalDateTime, formatLocalEstimate, formatEstimateJst } from './utils/date';

const STATUS_MAP = {
  pending_pay: '未支付',
  pending: '预约中',
  calling: '预约中',
  completed: '预约完成',
  failed: '预约失败',
  cancelled: '取消',
};

function statusLabel(s) {
  return STATUS_MAP[s] || s || '-';
}

function toJpDate(dateStr) {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return '';
  const [, y, m, d] = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return `${parseInt(m, 10)}月${parseInt(d, 10)}日`;
}
function toJpTime(timeStr) {
  if (!timeStr) return '';
  const [h, min] = timeStr.split(':');
  return `${parseInt(h, 10)}時${min ? parseInt(min, 10) + '分' : ''}`;
}

function getDialogue(order) {
  if (!order) return [];
  if (order.ai_conversation && Array.isArray(order.ai_conversation) && order.ai_conversation.length > 0) {
    return order.ai_conversation;
  }
  const d = order.booking_date || '';
  const t = order.booking_time || '';
  const n = order.party_size ?? 0;
  const m = d.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  const dateJp = m ? `${parseInt(m[2], 10)}月${parseInt(m[3], 10)}日` : '—';
  const [hh, min] = (t || '').split(':');
  const timeJp = hh != null ? `${parseInt(hh, 10)}時${min ? parseInt(min, 10) + '分' : ''}` : '';
  return [
    { role: 'ai', ja: 'こんにちは。お客様の代わりにご予約のお電話をさせていただいております。', zh: '您好，我们是代客预约服务，代客人致电预约。' },
    { role: 'restaurant', ja: 'はい、お電話ありがとうございます。', zh: '好的，感谢来电。' },
    { role: 'ai', ja: `${dateJp}の${timeJp}に${n}名でご予約をお願いいたします。`, zh: `我想预约${dateJp}${timeJp}${n}位。` },
    { role: 'restaurant', ja: 'かしこまりました。承りました。', zh: '好的，已为您登记。' },
    { role: 'ai', ja: 'ご確認ありがとうございます。それでは失礼いたします。', zh: '感谢确认，再见。' },
  ];
}

export function AdminQuery({ apiBase }) {
  const [statusFilter, setStatusFilter] = useState('all');
  const [userId, setUserId] = useState('');
  const [users, setUsers] = useState([]);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [detailOrder, setDetailOrder] = useState(null);
  const [detailSubModal, setDetailSubModal] = useState(null);
  const [cancelling, setCancelling] = useState(null);

  useEffect(() => {
    fetch(`${apiBase}/admin/users`)
      .then((r) => r.json())
      .then((d) => d.ok && setUsers(d.users || []))
      .catch(() => {});
  }, [apiBase]);

  const fetchOrders = async () => {
    setErr('');
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== 'all') params.set('status', statusFilter);
      if (userId) params.set('user_id', userId);
      const res = await fetch(`${apiBase}/orders?${params}`);
      const data = await res.json();
      if (!data.ok) throw new Error(data.message || '加载失败');
      setOrders(data.orders || []);
    } catch (e) {
      setErr(e.message || '加载失败');
      setOrders([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOrders();
  }, [statusFilter, userId, apiBase]);

  const handleCancel = async (orderNo) => {
    if (!confirm('确定取消该预约订单？')) return;
    setCancelling(orderNo);
    try {
      const res = await fetch(`${apiBase}/orders/${orderNo}/cancel`, { method: 'POST' });
      const data = await res.json();
      if (!data.ok) throw new Error(data.message || '取消失败');
      setDetailOrder(null);
      fetchOrders();
    } catch (e) {
      alert(e.message || '取消失败');
    } finally {
      setCancelling(null);
    }
  };

  const canCancel = (o) => o.status !== 'completed' && o.status !== 'cancelled';

  function formatPeople(o) {
    if (o.adult_count != null || o.child_count != null) return `成人 ${o.adult_count ?? o.party_size ?? 0} 儿童 ${o.child_count ?? 0}`;
    return `${o.party_size ?? 0} 人`;
  }

  return (
    <div className="admin-query">
      <div className="admin-toolbar">
        <label className="filter-label">预约状态</label>
        <select
          className="filter-select"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="all">全部</option>
          <option value="pending_pay">未支付</option>
          <option value="booking">预约中</option>
          <option value="completed">预约完成</option>
          <option value="failed">预约失败</option>
          <option value="cancelled">已取消</option>
        </select>
        <label className="filter-label">按用户</label>
        <select
          className="filter-select"
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
        >
          <option value="">全部用户</option>
          {users.map((u) => (
            <option key={u.uid} value={u.uid}>{u.phone || u.uid} {u.nickname ? `(${u.nickname})` : ''}</option>
          ))}
        </select>
        <button type="button" className="btn-refresh" onClick={fetchOrders} disabled={loading}>
          {loading ? '加载中…' : '刷新'}
        </button>
      </div>
      {err && <p className="form-error">{err}</p>}
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>订单号</th>
              <th>餐厅</th>
              <th>预约人</th>
              <th>预约时间</th>
              <th>人数</th>
              <th>状态</th>
              <th>用户</th>
              <th>创建时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {!loading && orders.length === 0 ? (
              <tr>
                <td colSpan="9" className="empty-td">暂无订单</td>
              </tr>
            ) : (
              orders.map((o) => (
                <tr key={o.id}>
                  <td className="td-order-no">{o.order_no}</td>
                  <td className="td-restaurant">
                    <span className="name">{o.restaurant_name || '-'}</span>
                    <span className="sub">{o.restaurant_phone}</span>
                  </td>
                  <td className="td-contact">
                    <span className="name">{o.contact_name}</span>
                    <span className="sub">{o.contact_phone}</span>
                  </td>
                  <td>
                    {o.booking_date} {o.booking_time}
                    {(o.second_booking_date && o.second_booking_time) && (
                      <span className="sub"> / {o.second_booking_date} {o.second_booking_time}</span>
                    )}
                  </td>
                  <td>{formatPeople(o)}</td>
                  <td>{statusLabel(o.status)}</td>
                  <td>{o.user_id ? o.user_id : '-'}</td>
                  <td>{formatLocalDateTime(o.created_at)}</td>
                  <td className="td-actions">
                    <button type="button" className="btn-link" onClick={() => setDetailOrder(o)}>详情</button>
                    {canCancel(o) && (
                      <button type="button" className="btn-link danger" onClick={() => handleCancel(o.order_no)} disabled={cancelling === o.order_no}>
                        {cancelling === o.order_no ? '取消中…' : '取消'}
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {detailOrder && (
        <div className="modal-overlay" onClick={() => { setDetailOrder(null); setDetailSubModal(null); }}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>预约详情</h3>
              <button type="button" className="modal-close" onClick={() => { setDetailOrder(null); setDetailSubModal(null); }}>×</button>
            </div>
            <div className="modal-body">
              <dl className="detail-dl">
                <dt>订单号</dt>
                <dd>{detailOrder.order_no}</dd>
                <dt>餐厅名称</dt>
                <dd>{detailOrder.restaurant_name || '-'}</dd>
                <dt>餐厅电话</dt>
                <dd>{detailOrder.restaurant_phone}</dd>
                <dt>预约人（姓名和电话）</dt>
                <dd>{detailOrder.contact_name} / {detailOrder.contact_phone}</dd>
                <dt>第一希望</dt>
                <dd>{detailOrder.booking_date} {detailOrder.booking_time}</dd>
                {(detailOrder.second_booking_date && detailOrder.second_booking_time) && (
                  <>
                    <dt>第二希望</dt>
                    <dd>{detailOrder.second_booking_date} {detailOrder.second_booking_time}</dd>
                  </>
                )}
                <dt>人数</dt>
                <dd>{formatPeople(detailOrder)}</dd>
                {detailOrder.dietary_notes && (
                  <>
                    <dt>饮食注意</dt>
                    <dd>{detailOrder.dietary_notes}</dd>
                  </>
                )}
                {detailOrder.booking_remark && (
                  <>
                    <dt>预约备注</dt>
                    <dd>{detailOrder.booking_remark}</dd>
                  </>
                )}
                <dt>状态</dt>
                <dd>{statusLabel(detailOrder.status)}</dd>
                {(detailOrder.status === 'pending' || detailOrder.status === 'calling' || detailOrder.status === 'failed' || detailOrder.ai_call_status_text || detailOrder.ai_call_est_at || (detailOrder.ai_call_status_log && detailOrder.ai_call_status_log.length > 0)) && (
                  <>
                    <dt>AI 通话状态</dt>
                    <dd>
                      {(() => {
                        let logList = [];
                        if (detailOrder.ai_call_status_log && typeof detailOrder.ai_call_status_log === 'string') {
                          try {
                            logList = JSON.parse(detailOrder.ai_call_status_log);
                            if (!Array.isArray(logList)) logList = [];
                          } catch {}
                        }
                        if (logList.length > 0) {
                          const ai = '「AI沟通记录」';
                          const voucher = '「预约凭证」';
                          const renderLogText = (text) => {
                            if (!text || typeof text !== 'string') return text;
                            const parts = [];
                            let rest = text;
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
                                parts.push(
                                  <button key={parts.length} type="button" className="link-btn" style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', textDecoration: 'underline' }} onClick={() => setDetailSubModal('ai-record')}>
                                    {ai}
                                  </button>
                                );
                                rest = rest.slice(next + ai.length);
                              } else {
                                parts.push(
                                  <button key={parts.length} type="button" className="link-btn" style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', textDecoration: 'underline' }} onClick={() => setDetailSubModal('voucher')}>
                                    {voucher}
                                  </button>
                                );
                                rest = rest.slice(next + voucher.length);
                              }
                            }
                            return parts.length === 1 && typeof parts[0] === 'string' ? parts[0] : parts;
                          };
                          return (
                            <ul className="ai-call-log">
                              {logList.map((entry, i) => (
                                <li key={i}>
                                  <span className="ai-call-log-time">{formatLocalDateTime(entry.at)}</span>
                                  {renderLogText(entry.text)}
                                </li>
                              ))}
                            </ul>
                          );
                        }
                        return (
                          <>
                            {detailOrder.ai_call_status_type === 'retry' && detailOrder.ai_call_est_at
                              ? `AI已开始拨打，未接通，预计${formatEstimateJst(detailOrder.ai_call_est_at)}（日本时间）开始再次尝试，请您耐心等待。`
                              : detailOrder.ai_call_status_type === 'retry_max'
                              ? (detailOrder.ai_call_status_text || '当日已尝试3次未接通，请明日再试或更换时间。')
                              : detailOrder.ai_call_est_at
                              ? `${detailOrder.ai_call_status_type === 'not_open' ? '餐厅尚未营业' : '系统排队中'}，预计${formatEstimateJst(detailOrder.ai_call_est_at)}（日本时间）开始拨打，请您耐心等待。`
                              : (detailOrder.ai_call_status_text || '-')}
                            {detailOrder.ai_call_status_updated_at && (
                              <span className="ai-call-log-time" style={{ display: 'block', marginTop: 4 }}>
                                更新时间：{formatLocalDateTime(detailOrder.ai_call_status_updated_at)}
                              </span>
                            )}
                          </>
                        );
                      })()}
                    </dd>
                  </>
                )}
                <dt>AI 通话结果</dt>
                <dd>{detailOrder.summary_text || '-'}</dd>
                <dt>短信通知</dt>
                <dd>
                  <span>{detailOrder.sms_sent ? '已发送' : '未发送'}</span>
                  {(detailOrder.sms_body || (detailOrder.sms_sent && detailOrder.summary_text)) ? (
                    <div className="sms-preview">
                      {detailOrder.sms_body || `【日本餐厅预约】您的预约通话已完成。摘要：${detailOrder.summary_text || ''}`}
                    </div>
                  ) : null}
                </dd>
                <dt>创建时间</dt>
                <dd>{formatLocalDateTime(detailOrder.created_at)}</dd>
              </dl>
              {detailOrder.recording_url && (
                <p><a href={`${apiBase}/orders/${detailOrder.order_no}/recording`} target="_blank" rel="noopener noreferrer">听录音</a></p>
              )}
            </div>
          </div>
        </div>
      )}

      {detailOrder && detailSubModal === 'ai-record' && (
        <div className="modal-overlay" style={{ zIndex: 1001 }} onClick={() => setDetailSubModal(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>AI沟通记录</h3>
              <button type="button" className="modal-close" onClick={() => setDetailSubModal(null)}>×</button>
            </div>
            <div className="modal-body">
              <p className="admin-desc">以下为 AI 与餐厅通话内容转写（日语+中文）。</p>
              <section style={{ marginBottom: 16 }}>
                <h4 className="admin-panel-title" style={{ marginBottom: 10 }}>沟通对话</h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {getDialogue(detailOrder).map((line, i) => (
                    <div key={i} className={`dialogue-bubble ${line.role === 'ai' ? 'dialogue-bubble-ai' : 'dialogue-bubble-restaurant'}`}>
                      <div className="dialogue-bubble-role">{line.role === 'ai' ? 'AI' : '餐厅'}</div>
                      <p className="dialogue-bubble-ja">{line.ja}</p>
                      <p className="dialogue-bubble-zh">{line.zh}</p>
                    </div>
                  ))}
                </div>
              </section>
              {detailOrder.summary_text && (
                <section style={{ marginBottom: 16 }}>
                  <h4 className="admin-panel-title" style={{ marginBottom: 10 }}>通话摘要</h4>
                  <p style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6, fontSize: '0.875rem' }}>{detailOrder.summary_text}</p>
                </section>
              )}
              {detailOrder.recording_url && (
                <p><a href={`${apiBase}/orders/${detailOrder.order_no}/recording`} target="_blank" rel="noopener noreferrer">听录音</a></p>
              )}
            </div>
          </div>
        </div>
      )}

      {detailOrder && detailSubModal === 'voucher' && (
        <div className="modal-overlay" style={{ zIndex: 1001 }} onClick={() => setDetailSubModal(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>预约凭证</h3>
              <button type="button" className="modal-close" onClick={() => setDetailSubModal(null)}>×</button>
            </div>
            <div className="modal-body">
              {(() => {
                const o = detailOrder;
                const party = o.party_size ?? 0;
                const jpDate = toJpDate(o.booking_date);
                const jpTime = toJpTime(o.booking_time);
                const jpSentence = `こんにちは、${jpDate}の${jpTime || ''}に${party}名で予約しています。`;
                const cnSentence = `您好，我预订了${o.booking_date || ''} ${o.booking_time || ''}的${party}人位。`;
                return (
                  <div className="voucher-card">
                    <h2 className="voucher-card h2">予約情報</h2>
                    <div className="voucher-divider" />
                    <div style={{ marginBottom: 14 }}>
                      <p className="voucher-label">{jpSentence}</p>
                      <p className="voucher-label">{cnSentence}</p>
                    </div>
                    <div className="voucher-divider" />
                    <p className="voucher-value" style={{ fontSize: '1.05rem', marginBottom: 4 }}>{o.restaurant_name || '—'}</p>
                    <p className="voucher-label" style={{ marginBottom: 14 }}>{o.restaurant_name_zh || o.restaurant_name || ''}</p>
                    <div style={{ marginBottom: 14 }}>
                      <p className="voucher-label">住所</p>
                      <p className="voucher-value">{o.restaurant_address || '—'}</p>
                      <p className="voucher-label">{o.restaurant_address_zh || o.restaurant_address || ''}</p>
                    </div>
                    <div className="voucher-divider" />
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '14px 24px', marginBottom: 14 }}>
                      <div>
                        <p className="voucher-label">予約名（预约人）</p>
                        <p className="voucher-value">{o.contact_name || '—'}</p>
                      </div>
                      <div>
                        <p className="voucher-label">人数</p>
                        <p className="voucher-value">{party}人</p>
                      </div>
                    </div>
                    <div>
                      <p className="voucher-label">予約電話番号（预约电话）</p>
                      <p className="voucher-value">{o.contact_phone || '—'}</p>
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
