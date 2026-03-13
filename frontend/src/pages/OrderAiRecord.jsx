import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { PageTitleBar } from '../components/TitleBar';
import { useUiLang } from '../context/UiLangContext';

function formatDuration(sec) {
  if (sec == null || Number.isNaN(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** 对话内容：优先使用 2.5 期 call_records（多轮 AI 真实记录），否则 ai_conversation，否则模拟话术 */
function getDialogue(order) {
  const callLang = (order.call_lang || 'ja').toLowerCase();
  if (order.call_records) {
    try {
      const arr = typeof order.call_records === 'string' ? JSON.parse(order.call_records) : order.call_records;
      if (Array.isArray(arr) && arr.length > 0) {
        return arr.map((item) => ({
          role: item.role === 'restaurant' ? 'restaurant' : 'ai',
          ja: item.text_ja || item.ja || '',
          zh: item.text_cn || item.zh || '',
        }));
      }
    } catch (_) {}
  }
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

  if (callLang === 'en') {
    return [
      { role: 'ai', ja: 'Hello, this is an AI calling on behalf of the guest to make a reservation.', zh: '您好，我们是代客预约服务，受客人委托致电预约。' },
      { role: 'restaurant', ja: 'Hi, thank you for calling.', zh: '好的，感谢来电。' },
      { role: 'ai', ja: `We would like to book a table for ${n} people on ${d || 'the selected date'} at ${t || 'the selected time'}.`, zh: `我想预约${d || ''} ${t || ''}${n}人。` },
      { role: 'restaurant', ja: 'All right, your reservation is confirmed.', zh: '好的，已为您登记。' },
      { role: 'ai', ja: 'Thank you for confirming. Have a nice day.', zh: '感谢确认，再见。' },
    ];
  }

  return [
    { role: 'ai', ja: 'こんにちは。お客様の代わりにご予約のお電話をさせていただいております。', zh: '您好，我们是代客预约服务，代客人致电预约。' },
    { role: 'restaurant', ja: 'はい、お電話ありがとうございます。', zh: '好的，感谢来电。' },
    { role: 'ai', ja: `${dateJp}の${timeJp}に${n}名でご予約をお願いいたします。`, zh: `我想预约${dateJp}${timeJp}${n}位。` },
    { role: 'restaurant', ja: 'かしこまりました。承りました。', zh: '好的，已为您登记。' },
    { role: 'ai', ja: 'ご確認ありがとうございます。それでは失礼いたします。', zh: '感谢确认，再见。' },
  ];
}

export function OrderAiRecord() {
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
      navigate('/login', { replace: true, state: { from: `/orders/${orderNo}/ai-record` } });
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const r = await fetchWithAuth(`${apiBase}/order/detail/${orderNo}`);
        const data = await safeResJson(r);
        if (!cancelled && data.ok) setOrder(data.order);
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
        <PageTitleBar title={isEnUi ? 'AI call transcript' : 'AI沟通记录'} showLangToggle backTo={`/orders/${orderNo}`} />
        <div className="page-white-body">
          <div style={{ margin: 16 }}>{isEnUi ? 'Loading…' : '加载中…'}</div>
        </div>
      </div>
    );
  }
  if (error || !order) {
    return (
      <div className="app app-page-with-white">
        <PageTitleBar title={isEnUi ? 'AI call transcript' : 'AI沟通记录'} showLangToggle backTo="/orders" />
        <div className="page-white-body">
          <div style={{ padding: 16 }}>
            <p className="form-error">{error || (isEnUi ? 'Order not found' : '订单不存在')}</p>
            <Link to="/orders" className="link-btn">{isEnUi ? 'Back to orders' : '返回订单列表'}</Link>
          </div>
        </div>
      </div>
    );
  }

  const callLang = (order.call_lang || 'ja').toLowerCase();
  const isEnCall = callLang === 'en';
  // 仅在有录音且预约成功时展示底部播放器
  const hasRecording = !!(order.recording_url && order.status === 'completed');
  const durSec = order.recording_duration_sec ?? 0;
  const dialogue = getDialogue(order);

  return (
    <div className="app app-page-with-white" style={{ paddingBottom: 24 }}>
      <PageTitleBar title={isEnUi ? 'AI call transcript' : 'AI沟通记录'} showLangToggle backTo={`/orders/${orderNo}`} />
      <div className="page-white-body">
        <div className="page-header-white" />
        <div style={{ padding: '0 16px 16px' }}>
        <p style={{ marginBottom: 16, color: 'var(--text-muted)', fontSize: '0.9em' }}>
          {isEnCall
            ? (isEnUi
              ? 'Transcript of the AI call (English + Chinese) for your reference.'
              : '以下为 AI 与餐厅通话内容转写（英语+中文），供您核对预约内容。')
            : (isEnUi
              ? 'Transcript of the AI call (Japanese + Chinese) for your reference.'
              : '以下为 AI 与餐厅通话内容转写（日语+中文），供您核对预约内容。')}
        </p>

        <section style={{ marginBottom: 24 }}>
          <h3 style={{ fontSize: '1em', marginBottom: 12 }}>{isEnUi ? 'Conversation' : '沟通对话'}</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {dialogue.map((line, i) => (
              <div
                key={i}
                style={{
                  padding: 10,
                  borderRadius: 8,
                  background: line.role === 'ai' ? 'var(--bg-secondary, #f0f7ff)' : 'var(--bg-muted, #f5f5f5)',
                  borderLeft: `3px solid ${line.role === 'ai' ? 'var(--primary, #1890ff)' : 'var(--text-muted, #999)'}`,
                }}
              >
                <div style={{ fontSize: '0.8em', color: 'var(--text-muted)', marginBottom: 6 }}>
                  {line.role === 'ai'
                    ? (isEnCall ? (isEnUi ? 'AI (English)' : 'AI（英语）') : (isEnUi ? 'AI (Japanese)' : 'AI（日语）'))
                    : (isEnUi ? 'Restaurant' : '餐厅')}
                </div>
                <p style={{ margin: 0, fontSize: '0.95em', lineHeight: 1.5 }}>{line.ja}</p>
                <p style={{ margin: '4px 0 0', fontSize: '0.9em', color: 'var(--text-muted)' }}>{line.zh}</p>
              </div>
            ))}
          </div>
        </section>

        {order.summary_text && (
          <section style={{ marginBottom: 20 }}>
            <h3 style={{ fontSize: '1em', marginBottom: 8 }}>{isEnUi ? 'Summary' : '通话摘要'}</h3>
            <p style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{order.summary_text}</p>
          </section>
        )}

        {order.transcript_cn && (
          <section style={{ marginBottom: 20 }}>
            <h3 style={{ fontSize: '1em', marginBottom: 8 }}>{isEnUi ? 'Full Chinese translation' : '完整中文译文'}</h3>
            <p style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6, color: 'var(--text-muted)', fontSize: '0.95em' }}>{order.transcript_cn}</p>
          </section>
        )}

        <section style={{ marginBottom: 0 }}>
          <h3 style={{ fontSize: '1em', marginBottom: 8 }}>{isEnUi ? 'Recording' : '通话录音'}</h3>
          <audio
            src={hasRecording ? order.recording_url : ''}
            controls
            disabled={!hasRecording}
            style={{ width: '100%' }}
          />
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85em', marginTop: 6 }}>
            {hasRecording
              ? (isEnUi ? `Duration ~ ${formatDuration(durSec)}.` : `总时长约 ${formatDuration(durSec)}，如有疑问可反复收听确认。`)
              : (isEnUi ? 'No recording available.' : '暂无通话录音。')}
          </p>
        </section>
        </div>
      </div>
    </div>
  );
}
