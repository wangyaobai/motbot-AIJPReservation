import { useState, useRef, useEffect } from 'react';

const API = import.meta.env.VITE_API_BASE || '/api';

/** 默认模拟订单 */
const defaultOrder = () => {
  const d = new Date();
  const date = d.toISOString().slice(0, 10);
  const time = '18:00';
  return {
    booking_date: date,
    booking_time: time,
    second_booking_date: '',
    second_booking_time: '',
    adult_count: 2,
    child_count: 0,
    party_size: 2,
    dietary_notes: '',
    booking_remark: '',
    contact_name: 'テスト',
    contact_phone: '+8613800138000',
    contact_phone_region: 'cn',
  };
};

export function AdminVoiceTest({ apiBase = API }) {
  const [adminToken, setAdminToken] = useState(() =>
    typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('adminToken') || '' : ''
  );
  const [lang, setLang] = useState('ja');
  const [order, setOrder] = useState(defaultOrder);
  const [callRecords, setCallRecords] = useState([]);
  const [lastUserText, setLastUserText] = useState('');
  const [status, setStatus] = useState('idle'); // idle | recording | asr | thinking | tts | playing | done
  const [err, setErr] = useState('');
  const [isDone, setIsDone] = useState(false);
  const mediaRecorderRef = useRef(null);
  const audioRef = useRef(null);

  useEffect(() => {
    if (adminToken && typeof sessionStorage !== 'undefined') sessionStorage.setItem('adminToken', adminToken);
  }, [adminToken]);

  const headers = () => ({ 'x-admin-token': adminToken?.trim() || '', 'Content-Type': 'application/json' });

  const fetchNextReply = async (records, lastText) => {
    const res = await fetch(`${apiBase}/admin/voice-test/next-reply`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        order: { ...order, _dialogue_lang: lang },
        callRecords: records,
        lastRestaurantText: lastText,
        lang,
      }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.message || '生成失败');
    return data;
  };

  const fetchTts = async (text) => {
    const res = await fetch(`${apiBase}/admin/voice-test/tts`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ text, lang }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.message || 'TTS 失败');
    return data.url;
  };

  const playAudio = (url) => {
    return new Promise((resolve, reject) => {
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => resolve();
      audio.onerror = (e) => reject(e);
      audio.play().catch(reject);
    });
  };

  const runRound = async (userText) => {
    if (!userText?.trim()) return;
    setErr('');
    const text = userText.trim();
    const newRecords = [...callRecords, { role: 'restaurant', text_ja: text }];
    setCallRecords(newRecords);
    setLastUserText('');

    setStatus('thinking');
    try {
      const reply = await fetchNextReply(newRecords, text);
      if (reply.done) {
        setIsDone(true);
        setStatus('done');
      } else {
        setStatus('tts');
      }

      const aiText = reply.text_ja;
      setCallRecords((r) => [...r, { role: 'ai', text_ja: aiText }]);

      const ttsUrl = await fetchTts(aiText);
      setStatus('playing');
      await playAudio(ttsUrl);
      if (!reply.done) setStatus('idle');
    } catch (e) {
      setErr(e.message || '请求失败');
      setStatus('idle');
    }
  };

  const handleStart = async () => {
    const greeting = lang === 'en' ? 'Hello' : 'はい';
    await runRound(greeting);
  };

  const handleTextSubmit = (e) => {
    e.preventDefault();
    if (lastUserText.trim()) runRound(lastUserText);
  };

  const handleAsrResult = async (text) => {
    if (text?.trim()) await runRound(text);
    else setStatus('idle');
  };

  const startRecording = async () => {
    setErr('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      const chunks = [];
      recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
        setStatus('asr');
        try {
          const form = new FormData();
          form.append('audio', blob, 'recording.webm');
          form.append('lang', lang);
          const res = await fetch(`${apiBase}/admin/voice-test/asr`, {
            method: 'POST',
            headers: { 'x-admin-token': adminToken?.trim() || '' },
            body: form,
          });
          const data = await res.json();
          if (!data.ok) throw new Error(data.message || 'ASR 失败');
          await handleAsrResult(data.text);
        } catch (e) {
          setErr(e.message || 'ASR 失败');
          setStatus('idle');
        }
      };
      recorder.start();
      setStatus('recording');
      const stop = () => {
        const rec = mediaRecorderRef.current;
        if (rec && rec.state !== 'inactive') rec.stop();
        document.removeEventListener('mouseup', stop);
        document.removeEventListener('touchend', stop);
      };
      document.addEventListener('mouseup', stop, { once: true });
      document.addEventListener('touchend', stop, { once: true });
    } catch (e) {
      setErr(e.message || '无法访问麦克风');
      setStatus('idle');
    }
  };

  const reset = () => {
    setCallRecords([]);
    setIsDone(false);
    setStatus('idle');
    setErr('');
  };

  const busy = ['recording', 'asr', 'thinking', 'tts', 'playing'].includes(status);
  const canStart = !busy && callRecords.length === 0;
  const canInput = !busy && callRecords.length > 0 && !isDone;

  return (
    <div className="admin-voice-test">
      <h3>AI 预定语音测试（多轮对话）</h3>
      <p className="admin-voice-test-desc">
        模拟餐厅接听场景，对着电脑说话或输入文字，测试 AI 对话逻辑。需配置 Admin Token、阿里云 ASR/TTS、DeepSeek/OpenAI。
      </p>

      <div className="admin-voice-test-form">
        <div className="form-row">
          <label>Admin Token</label>
          <input
            type="password"
            value={adminToken}
            onChange={(e) => setAdminToken(e.target.value)}
            placeholder="与 .env ADMIN_TOKEN 一致"
            style={{ width: 200 }}
          />
        </div>
        <div className="form-row">
          <label>通话语言</label>
          <select value={lang} onChange={(e) => setLang(e.target.value)} disabled={busy}>
            <option value="ja">日语</option>
            <option value="en">英语</option>
          </select>
        </div>
        <div className="form-row">
          <label>预约信息</label>
          <span className="form-inline">
            <input
              type="date"
              value={order.booking_date}
              onChange={(e) => setOrder((o) => ({ ...o, booking_date: e.target.value }))}
              disabled={busy}
            />
            <input
              type="time"
              value={order.booking_time}
              onChange={(e) => setOrder((o) => ({ ...o, booking_time: e.target.value }))}
              disabled={busy}
            />
            <input
              type="number"
              min={1}
              value={order.party_size}
              onChange={(e) =>
                setOrder((o) => ({
                  ...o,
                  party_size: parseInt(e.target.value, 10) || 1,
                  adult_count: parseInt(e.target.value, 10) || 1,
                }))
              }
              disabled={busy}
              style={{ width: 50 }}
            />
            人
          </span>
        </div>
      </div>

      {err && <p className="form-error">{err}</p>}

      <div className="admin-voice-test-actions">
        {callRecords.length === 0 && (
          <button type="button" className="btn-primary" onClick={handleStart} disabled={!canStart || !adminToken?.trim()}>
            开始对话（模拟接听）
          </button>
        )}
        {callRecords.length > 0 && !isDone && (
          <>
            <button
              type="button"
              className="btn-record"
              onMouseDown={(e) => { e.preventDefault(); startRecording(); }}
              onTouchStart={(e) => { e.preventDefault(); startRecording(); }}
              disabled={busy}
            >
              {status === 'recording' ? '🔴 松开发送' : '按住说话'}
            </button>
            <form onSubmit={handleTextSubmit} className="form-inline">
              <input
                type="text"
                value={lastUserText}
                onChange={(e) => setLastUserText(e.target.value)}
                placeholder={lang === 'ja' ? '输入模拟餐厅回复，如：かしこまりました' : 'Type restaurant reply, e.g. Sure'}
                disabled={busy}
              />
              <button type="submit" disabled={busy || !lastUserText.trim()}>
                发送
              </button>
            </form>
          </>
        )}
        {callRecords.length > 0 && (
          <button type="button" className="btn-link" onClick={reset} disabled={busy}>
            重新开始
          </button>
        )}
      </div>

      <div className="admin-voice-test-status">
        {status === 'recording' && '正在录音…'}
        {status === 'asr' && '识别中…'}
        {status === 'thinking' && 'AI 思考中…'}
        {status === 'tts' && '合成语音…'}
        {status === 'playing' && '播放中…'}
        {status === 'done' && '对话已结束'}
      </div>

      <div className="admin-voice-test-log">
        <h4>对话记录</h4>
        {callRecords.length === 0 ? (
          <p className="muted">暂无记录，点击「开始对话」模拟餐厅接听</p>
        ) : (
          <ul>
            {callRecords.map((r, i) => (
              <li key={i} className={r.role === 'ai' ? 'ai' : 'restaurant'}>
                <span className="role">{r.role === 'ai' ? 'AI' : '餐厅'}</span>
                <span className="text">{r.text_ja}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
