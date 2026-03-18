import { useState, useRef, useEffect } from 'react';

const API = import.meta.env.VITE_API_BASE || '/api';

const DEFAULT_BOOKING_REMARK = '如需提前选套餐，请 AI 沟通预留该店最受欢迎套餐';

/** 根据文本判断语言：含日文假名/汉字则日语，否则英语 */
function detectLang(text) {
  if (!text?.trim()) return 'ja';
  return /[\u3040-\u309f\u30a0-\u30ff\u4e00-\u9fff]/.test(text) ? 'ja' : 'en';
}

/** 默认模拟订单（与用户端预约表单字段一致） */
const defaultOrder = () => {
  const d = new Date();
  const date = d.toISOString().slice(0, 10);
  return {
    booking_date: date,
    booking_time: '18:00',
    second_booking_date: '',
    second_booking_time: '',
    adult_count: 2,
    child_count: 0,
    party_size: 2,
    dietary_notes: '',
    booking_remark: DEFAULT_BOOKING_REMARK,
    contact_name: 'テスト',
    contact_phone: '13800138000',
    contact_phone_region: 'cn',
  };
};

export function AdminVoiceTest({ apiBase = API }) {
  const [adminToken, setAdminToken] = useState(() =>
    typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('adminToken') || '' : ''
  );
  const [langMode, setLangMode] = useState('auto'); // auto | ja | en
  const [order, setOrder] = useState(defaultOrder);
  const [callRecords, setCallRecords] = useState([]);
  const [inputText, setInputText] = useState('');
  const [status, setStatus] = useState('idle');
  const [err, setErr] = useState('');
  const [isDone, setIsDone] = useState(false);
  const [asrResult, setAsrResult] = useState('');
  const [ttsUrl, setTtsUrl] = useState('');
  const mediaRecorderRef = useRef(null);
  const audioRef = useRef(null);

  useEffect(() => {
    if (adminToken && typeof sessionStorage !== 'undefined') sessionStorage.setItem('adminToken', adminToken);
  }, [adminToken]);

  const headers = () => ({ 'x-admin-token': adminToken?.trim() || '', 'Content-Type': 'application/json' });

  const getEffectiveLang = (text) => {
    if (langMode === 'ja') return 'ja';
    if (langMode === 'en') return 'en';
    return detectLang(text || inputText);
  };

  const fetchNextReply = async (records, lastText) => {
    const lang = getEffectiveLang(lastText);
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

  const fetchTts = async (text, lang) => {
    const res = await fetch(`${apiBase}/admin/voice-test/tts`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ text, lang }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.message || 'TTS 失败');
    return data.url;
  };

  const playResolveRef = useRef(null);
  const playAudio = (url) => {
    setTtsUrl(url);
    return new Promise((resolve, reject) => {
      playResolveRef.current = { resolve, reject };
    });
  };
  useEffect(() => {
    if (!ttsUrl || !audioRef.current) return;
    const el = audioRef.current;
    const onEnd = () => {
      playResolveRef.current?.resolve();
      playResolveRef.current = null;
    };
    const onErr = (e) => {
      setTtsUrl('');
      playResolveRef.current?.reject(e);
      playResolveRef.current = null;
    };
    el.onended = onEnd;
    el.onerror = onErr;
    el.play().catch((e) => {
      setTtsUrl('');
      playResolveRef.current?.reject(e);
      playResolveRef.current = null;
    });
  }, [ttsUrl]);

  const handleReplay = async (aiText) => {
    if (!aiText?.trim()) return;
    setErr('');
    const lang = langMode === 'auto' ? detectLang(aiText) : langMode;
    try {
      const url = await fetchTts(aiText, lang);
      setTtsUrl(url);
    } catch (e) {
      setErr(e.message || 'TTS 失败');
    }
  };

  const runRound = async (userText) => {
    if (!userText?.trim()) return;
    setErr('');
    setAsrResult('');
    const text = userText.trim();
    const newRecords = [...callRecords, { role: 'restaurant', text_ja: text }];
    setCallRecords(newRecords);
    setInputText('');

    setStatus('thinking');
    try {
      const reply = await fetchNextReply(newRecords, text);
      const lang = getEffectiveLang(text);
      if (reply.done) {
        setIsDone(true);
        setStatus('done');
      } else {
        setStatus('tts');
      }

      const aiText = reply.text_ja;
      setCallRecords((r) => [...r, { role: 'ai', text_ja: aiText }]);

      const url = await fetchTts(aiText, lang);
      setStatus('playing');
      await playAudio(url);
      if (!reply.done) setStatus('idle');
    } catch (e) {
      setErr(e.message || '请求失败');
      setStatus('idle');
    }
  };

  const handleSubmit = () => {
    if (inputText.trim()) runRound(inputText);
  };

  const startRecording = async () => {
    setErr('');
    setAsrResult('');
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
          const asrLang = langMode === 'auto' ? 'ja' : langMode;
          form.append('lang', asrLang);
          const res = await fetch(`${apiBase}/admin/voice-test/asr`, {
            method: 'POST',
            headers: { 'x-admin-token': adminToken?.trim() || '' },
            body: form,
          });
          const data = await res.json();
          if (!data.ok) throw new Error(data.message || 'ASR 失败');
          const txt = (data.text || '').trim();
          setAsrResult(txt);
          setInputText(txt);
          if (txt) {
            runRound(txt);
          } else {
            setStatus('idle');
          }
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
    setInputText('');
    setAsrResult('');
    setTtsUrl('');
    setStatus('idle');
    setErr('');
  };

  const busy = ['recording', 'asr', 'thinking', 'tts', 'playing'].includes(status);

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
        <div className="admin-voice-test-section">
          <h4>预约信息（与用户端一致）</h4>
          <div className="form-row">
            <label>第一希望</label>
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
            </span>
          </div>
          <div className="form-row">
            <label>第二希望</label>
            <span className="form-inline">
              <input
                type="date"
                value={order.second_booking_date}
                onChange={(e) =>
                  setOrder((o) => ({
                    ...o,
                    second_booking_date: e.target.value,
                    second_booking_time: e.target.value ? o.second_booking_time : '',
                  }))
                }
                disabled={busy}
                placeholder="YYYY-MM-DD"
              />
              <input
                type="time"
                value={order.second_booking_time}
                onChange={(e) => setOrder((o) => ({ ...o, second_booking_time: e.target.value }))}
                disabled={busy}
              />
            </span>
          </div>
          <div className="form-row">
            <label>人数</label>
            <span className="form-inline">
              <input
                type="number"
                min={0}
                max={20}
                value={order.adult_count}
                onChange={(e) => {
                  const v = Math.max(0, parseInt(e.target.value, 10) || 0);
                  setOrder((o) => ({ ...o, adult_count: v, party_size: v + (o.child_count || 0) }));
                }}
                disabled={busy}
                style={{ width: 50 }}
              />
              成人
              <input
                type="number"
                min={0}
                max={20}
                value={order.child_count}
                onChange={(e) => {
                  const v = Math.max(0, parseInt(e.target.value, 10) || 0);
                  setOrder((o) => ({ ...o, child_count: v, party_size: (o.adult_count || 0) + v }));
                }}
                disabled={busy}
                style={{ width: 50 }}
              />
              儿童
            </span>
          </div>
          <div className="form-row">
            <label>饮食注意</label>
            <textarea
              value={order.dietary_notes}
              onChange={(e) => setOrder((o) => ({ ...o, dietary_notes: e.target.value }))}
              placeholder="过敏食材、忌口、宗教饮食限制等，无则留空"
              rows={2}
              disabled={busy}
            />
          </div>
          <div className="form-row">
            <label>预约备注</label>
            <textarea
              value={order.booking_remark}
              onChange={(e) => setOrder((o) => ({ ...o, booking_remark: e.target.value }))}
              placeholder="如需提前选套餐，请 AI 沟通预留该店最受欢迎套餐"
              rows={2}
              disabled={busy}
            />
          </div>
        </div>

        <div className="admin-voice-test-section">
          <h4>联系人信息</h4>
          <div className="form-row">
            <label>预约人</label>
            <input
              type="text"
              value={order.contact_name}
              onChange={(e) => setOrder((o) => ({ ...o, contact_name: e.target.value }))}
              placeholder="预约使用的姓名"
              disabled={busy}
              style={{ width: 180 }}
            />
          </div>
          <div className="form-row">
            <label>手机号地区</label>
            <select
              value={order.contact_phone_region}
              onChange={(e) => setOrder((o) => ({ ...o, contact_phone_region: e.target.value }))}
              disabled={busy}
            >
              <option value="cn">中国 (+86)</option>
              <option value="jp">日本 (+81)</option>
            </select>
          </div>
          <div className="form-row">
            <label>手机号</label>
            <input
              type="tel"
              value={order.contact_phone}
              onChange={(e) => setOrder((o) => ({ ...o, contact_phone: e.target.value }))}
              placeholder={order.contact_phone_region === 'jp' ? '090-1234-5678' : '138 0000 0000'}
              disabled={busy}
              style={{ width: 180 }}
            />
          </div>
        </div>
      </div>

      {err && <p className="form-error">{err}</p>}

      <div className="admin-voice-test-dialogue">
        <p className="dialogue-instruction">
          不发起真实通话。您输入一句「餐厅」的回复（建议日语），系统生成 AI 下一句并通过阿里云 TTS 播放。
        </p>
        <div className="dialogue-control-panel">
          <div className="dialogue-buttons">
            <button type="button" className="btn-reset" onClick={reset} disabled={busy}>
              重置对话
            </button>
            <button
              type="button"
              className="btn-submit"
              onClick={handleSubmit}
              disabled={busy || !inputText.trim() || !adminToken?.trim()}
            >
              提交餐厅回复 → 生成 AI 下一句
            </button>
            <button
              type="button"
              className="btn-record"
              onMouseDown={(e) => { e.preventDefault(); startRecording(); }}
              onTouchStart={(e) => { e.preventDefault(); startRecording(); }}
              disabled={busy || !adminToken?.trim()}
            >
              {status === 'recording' ? '🔴 录音中…' : '开始录音 (ASR)'}
            </button>
          </div>
          <p className="dialogue-hint">手动输入文字，或点击开始录音。</p>
          <div className="dialogue-lang-radio">
            <label>
              <input type="radio" name="lang" value="auto" checked={langMode === 'auto'} onChange={() => setLangMode('auto')} />
              自动（根据输入判断）
            </label>
            <label>
              <input type="radio" name="lang" value="ja" checked={langMode === 'ja'} onChange={() => setLangMode('ja')} />
              日语
            </label>
            <label>
              <input type="radio" name="lang" value="en" checked={langMode === 'en'} onChange={() => setLangMode('en')} />
              英语
            </label>
          </div>
          <textarea
            className="dialogue-input"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder="はい、承知しました。お名前をお願いします。"
            rows={3}
            disabled={busy}
          />
          {ttsUrl && (
            <div className="dialogue-audio">
              <p className="dialogue-audio-label">AI 语音回复（可重复播放）</p>
              <audio ref={audioRef} src={ttsUrl} controls />
            </div>
          )}
          {asrResult && (
            <p className="dialogue-asr-result">ASR识别到: {asrResult}</p>
          )}
        </div>
        <div className="dialogue-status">
          {status === 'recording' && '正在录音…'}
          {status === 'asr' && '识别中…'}
          {status === 'thinking' && 'AI 思考中…'}
          {status === 'tts' && '合成语音…'}
          {status === 'playing' && '播放中…'}
          {status === 'done' && '对话已结束'}
        </div>
        <div className="dialogue-log">
          <h4>对话记录</h4>
          {callRecords.length === 0 ? (
            <p className="muted">暂无记录，输入餐厅回复后点击提交</p>
          ) : (
            <div className="dialogue-bubbles">
              {callRecords.map((r, i) => (
                <div key={i} className={`bubble ${r.role === 'ai' ? 'bubble-ai' : 'bubble-restaurant'}`}>
                  <span className="bubble-role">{r.role === 'ai' ? 'AI' : '餐厅'}</span>
                  <span className="bubble-text">{r.text_ja}</span>
                  {r.role === 'ai' && (
                    <button type="button" className="bubble-play" onClick={() => handleReplay(r.text_ja)} title="重新播放">
                      ▶ 播放
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
