import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { PageTitleBar } from '../components/TitleBar';

function formatDuration(sec) {
  if (sec == null || Number.isNaN(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** 模拟对话：双角色日语+中文。后端若有 order.ai_conversation 则优先使用 */
function getDialogue(order) {
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

export function OrderAiRecord() {
  const { orderNo } = useParams();
  const { isLoggedIn, fetchWithAuth, safeResJson, apiBase } = useAuth();
  const navigate = useNavigate();
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const audioRef = useRef(null);

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

  const onTimeUpdate = () => {
    const el = audioRef.current;
    if (el) setCurrentTime(el.currentTime);
  };
  const onLoadedMetadata = () => {
    const el = audioRef.current;
    if (el) setDuration(el.duration);
  };
  const onSeek = (e) => {
    const el = audioRef.current;
    if (!el) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const p = (e.clientX - rect.left) / rect.width;
    el.currentTime = p * el.duration;
    setCurrentTime(el.currentTime);
  };

  if (!isLoggedIn) return null;
  if (loading) {
    return (
      <div className="app app-page-with-white">
        <PageTitleBar title="AI沟通记录" backTo={`/orders/${orderNo}`} />
        <div className="page-white-body">
          <div style={{ margin: 16 }}>加载中…</div>
        </div>
      </div>
    );
  }
  if (error || !order) {
    return (
      <div className="app app-page-with-white">
        <PageTitleBar title="AI沟通记录" backTo="/orders" />
        <div className="page-white-body">
          <div style={{ padding: 16 }}>
            <p className="form-error">{error || '订单不存在'}</p>
            <Link to="/orders" className="link-btn">返回订单列表</Link>
          </div>
        </div>
      </div>
    );
  }

  const hasRecording = !!(order.recording_url && order.status === 'completed');
  const durSec = order.recording_duration_sec ?? duration;
  const dialogue = getDialogue(order);

  const audioBarHeight = 72;
  return (
    <div className="app app-page-with-white" style={{ paddingBottom: audioBarHeight + 24 }}>
      <PageTitleBar title="AI沟通记录" backTo={`/orders/${orderNo}`} />
      <div className="page-white-body">
        <div className="page-header-white" />
        <div style={{ padding: '0 16px 16px' }}>
        <p style={{ marginBottom: 16, color: 'var(--text-muted)', fontSize: '0.9em' }}>
          以下为 AI 与餐厅通话内容转写（日语+中文），供您核对预约内容。
        </p>

        <section style={{ marginBottom: 24 }}>
          <h3 style={{ fontSize: '1em', marginBottom: 12 }}>沟通对话</h3>
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
                  {line.role === 'ai' ? 'AI' : '餐厅'}
                </div>
                <p style={{ margin: 0, fontSize: '0.95em', lineHeight: 1.5 }}>{line.ja}</p>
                <p style={{ margin: '4px 0 0', fontSize: '0.9em', color: 'var(--text-muted)' }}>{line.zh}</p>
              </div>
            ))}
          </div>
        </section>

        {order.summary_text && (
          <section style={{ marginBottom: 20 }}>
            <h3 style={{ fontSize: '1em', marginBottom: 8 }}>通话摘要</h3>
            <p style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{order.summary_text}</p>
          </section>
        )}

        <section style={{ marginBottom: 0 }}>
          <h3 style={{ fontSize: '1em', marginBottom: 8 }}>通话录音</h3>
          {hasRecording ? (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9em' }}>请在底部播放器收听。</p>
          ) : (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9em' }}>暂无通话录音。</p>
          )}
        </section>
        </div>

        {hasRecording && (
        <div
          style={{
            position: 'fixed',
            left: 0,
            right: 0,
            bottom: 0,
            background: '#fff',
            borderTop: '1px solid var(--border)',
            padding: '10px 16px',
            paddingBottom: 'calc(10px + env(safe-area-inset-bottom))',
            boxShadow: '0 -2px 10px rgba(0,0,0,0.06)',
          }}
        >
          <audio
            ref={audioRef}
            src={order.recording_url}
            controls
            style={{ width: '100%', height: 32, marginBottom: 6 }}
            onTimeUpdate={onTimeUpdate}
            onLoadedMetadata={onLoadedMetadata}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8em', color: 'var(--text-muted)' }}>
            <span>{formatDuration(currentTime)}</span>
            <span>{formatDuration(duration || durSec)}</span>
          </div>
          <div
            role="progressbar"
            tabIndex={0}
            style={{ height: 6, background: 'var(--border)', borderRadius: 3, marginTop: 4, cursor: 'pointer' }}
            onClick={onSeek}
            onKeyDown={(e) => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') e.preventDefault(); }}
          >
            <div
              style={{
                height: '100%',
                width: `${duration ? (currentTime / duration) * 100 : 0}%`,
                background: 'var(--accent)',
                borderRadius: 3,
              }}
            />
          </div>
        </div>
        )}
      </div>
    </div>
  );
}
