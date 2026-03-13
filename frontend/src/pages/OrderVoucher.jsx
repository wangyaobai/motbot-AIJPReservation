import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { PageTitleBar } from '../components/TitleBar';
import { useUiLang } from '../context/UiLangContext';

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

function speakJapanese(text) {
  if (!text || !window.speechSynthesis) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'ja-JP';
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(u);
}

export function OrderVoucher() {
  const { orderNo } = useParams();
  const { isLoggedIn, fetchWithAuth, safeResJson, apiBase } = useAuth();
  const navigate = useNavigate();
  const { uiLang } = useUiLang();
  const isEnUi = uiLang === 'en';
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isLoggedIn) {
      navigate('/login', { replace: true, state: { from: `/orders/${orderNo}/voucher` } });
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const r = await fetchWithAuth(`${apiBase}/orders/${orderNo}/voucher-info`);
        const contentType = r.headers.get('Content-Type') || '';
        if (!r.ok && !contentType.includes('application/json')) {
          if (!cancelled) setError(r.status === 401 ? '请先登录' : `请求失败 ${r.status}`);
          return;
        }
        const data = await safeResJson(r);
        if (!cancelled && data.ok && data.order) setOrder(data.order);
        else if (!cancelled) setError(data.message || '加载失败');
      } catch {
        if (!cancelled) setError('网络错误');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [orderNo, isLoggedIn, apiBase, fetchWithAuth, safeResJson, navigate]);

  if (!isLoggedIn) return null;
  if (loading) {
    return (
      <div className="app app-page-with-white">
        <PageTitleBar title={isEnUi ? 'Voucher' : '预约凭证'} showLangToggle backTo={`/orders/${orderNo}`} />
        <div className="page-white-body">
          <div className="page-header-white" />
          <div className="card card-shadow" style={{ margin: 16 }}>{isEnUi ? 'Loading…' : '加载中…'}</div>
        </div>
      </div>
    );
  }
  if (error || !order) {
    return (
      <div className="app app-page-with-white">
        <PageTitleBar title={isEnUi ? 'Voucher' : '预约凭证'} showLangToggle backTo="/orders" />
        <div className="page-white-body">
          <div className="page-header-white" />
          <div style={{ padding: 16 }}>
            <p className="form-error">{error || (isEnUi ? 'Order not found' : '订单不存在')}</p>
            <Link to="/orders" className="link-btn">{isEnUi ? 'Back to orders' : '返回订单列表'}</Link>
          </div>
        </div>
      </div>
    );
  }

  const party = order.party_size ?? 0;
  const callLang = (order.call_lang || 'ja').toLowerCase();
  const jpDate = toJpDate(order.booking_date);
  const jpTime = toJpTime(order.booking_time);
  const jpSentence = `こんにちは、${jpDate}の${jpTime || ''}に${party}名で予約しています。`;
  const enSentence = `Hello, I have a reservation for ${party} people on ${order.booking_date || ''} at ${order.booking_time || ''}.`;
  const cnSentence = `您好，我预订了${order.booking_date || ''} ${order.booking_time || ''}的${party}人位。`;
  const jpRestaurant = order.restaurant_name || '—';
  const cnRestaurant = order.restaurant_name_zh || order.restaurant_name || '';
  const jpAddress = order.restaurant_address || '—';
  const cnAddress = order.restaurant_address_zh || order.restaurant_address || '';
  const openMap = () => {
    const q = encodeURIComponent(order.restaurant_address || '');
    if (q) window.open(`https://www.google.com/maps/search/?api=1&query=${q}`, '_blank');
  };

  const divider7 = { height: 7, background: '#e8e8e8', margin: '12px 0' };
  const divider10 = { height: 10, background: '#e0e0e0', margin: '12px 0' };
  const labelGray = { fontSize: '0.9em', color: 'var(--text-muted)', marginBottom: 4 };
  const valueBold = { fontSize: '1em', fontWeight: 700, color: '#2d2d2d', margin: 0 };
  const h1Style = { fontSize: '1.1em', fontWeight: 700, color: '#2d2d2d', margin: 0, textAlign: 'center' };
  const h2Style = { fontSize: '1em', fontWeight: 700, color: '#2d2d2d', margin: 0 };

  return (
    <div className="app app-page-with-white" style={{ paddingBottom: 24, minHeight: '100vh' }}>
      <PageTitleBar title={isEnUi ? 'Voucher' : '预约凭证'} showLangToggle backTo={`/orders/${orderNo}`} />
      <div className="page-white-body">
        <div className="page-header-white" />
        <div style={{ padding: '0 16px' }}>
        <div className="card card-shadow voucher-card" style={{ padding: 20, borderRadius: 12, maxWidth: 480, margin: '0 auto' }}>
          {/* (1) 一级标题居中，标题下 10px 分割线 */}
          <h1 style={h1Style}>{callLang === 'en' ? 'Reservation' : '予約情報'}</h1>
          <div style={divider10} />

          {/* (2) 预约信息：主通话语言句+喇叭，下方中文灰色小字，7px 分割线 */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
            <h2 style={{ ...h2Style, flex: 1 }}>{callLang === 'en' ? 'Reservation details' : '予約情報'}</h2>
            <button
              type="button"
              onClick={() => { if (callLang === 'ja') speakJapanese(jpSentence); }}
              style={{ flexShrink: 0, width: 32, height: 32, padding: 0, border: 'none', background: 'transparent', cursor: 'pointer', fontSize: '1.1em' }}
              aria-label={callLang === 'en' ? (isEnUi ? 'Play (disabled)' : '播放（不可用）') : (isEnUi ? 'Play Japanese' : '日语朗读')}
            >
              🔈
            </button>
          </div>
          <p style={{ fontSize: '0.95em', color: '#2d2d2d', margin: '0 0 4px' }}>
            {callLang === 'en' ? enSentence : jpSentence}
          </p>
          <p style={{ ...labelGray, marginTop: 0 }}>{cnSentence}</p>
          <div style={divider7} />

          {/* (3) 餐厅名称：主通话语言名称，下方中文灰色小字 */}
          <h1 style={{ ...h1Style, textAlign: 'left', marginBottom: 4 }}>{jpRestaurant}</h1>
          <p style={{ ...labelGray, marginBottom: 12 }}>{cnRestaurant}</p>

          {/* (4) 地址：同一行标题+地址，右侧导航；下方中文地址，7px 分割线 */}
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
            <h2 style={{ ...h2Style, flex: 1 }}>
              {callLang === 'en' ? 'Address' : '住所'} {jpAddress}
            </h2>
            <button
              type="button"
              onClick={openMap}
              style={{ flexShrink: 0, padding: '6px 12px', borderRadius: 8, border: '1px solid var(--border)', background: '#fff', cursor: 'pointer', fontSize: '0.85em' }}
            >
              {callLang === 'en' ? 'Navigate' : (isEnUi ? 'Navigate' : '导航')}
            </button>
          </div>
          <p style={{ ...labelGray, marginTop: 0 }}>{cnAddress}</p>
          <div style={divider7} />

          {/* (5) 预约人信息 与 人数 同一行灰色小字，具体信息下一行黑色加粗 */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px 24px', marginBottom: 12 }}>
            <div>
              <p style={labelGray}>
                {callLang === 'en' ? 'Guest name（预约人信息）' : '予約名（预约人信息）'}
              </p>
              <p style={valueBold}>{order.contact_name || '—'}</p>
            </div>
            <div>
              <p style={labelGray}>
                {callLang === 'en' ? 'Number of guests（人数）' : '人数（人数）'}
              </p>
              <p style={valueBold}>{party}人</p>
            </div>
          </div>

          {/* (6) 预约电话：标签灰色小字，电话号码下一行黑色加粗 */}
          <div>
            <p style={labelGray}>
              {callLang === 'en' ? 'Contact phone（预约电话）' : '予約電話番号（预约电话）'}
            </p>
            <p style={valueBold}>{order.contact_phone || '—'}</p>
          </div>
        </div>
        </div>
      </div>
    </div>
  );
}
