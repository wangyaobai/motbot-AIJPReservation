/**
 * Twilio Gather 模式：利用 Twilio 内置语音识别替代 Record+下载+ffmpeg+ASR。
 * Gather 回调直接提供 SpeechResult 文本 → LLM → TTS → 返回 Gather(Play) 继续监听。
 * 通过 USE_TWILIO_GATHER=1 启用。
 */
import twilio from 'twilio';
import { getDb } from '../db.js';
import { getNextAiReply, generateTemplateFirstMessage } from '../services/aiDialogue.js';
import { synthesizeJaToUrl, synthesizeEnToUrl } from '../services/aliyunTts.js';
import { get as getFirstMessageCache, remove as removeFirstMessageCache } from '../services/firstMessageCache.js';

const VoiceResponse = twilio.twiml.VoiceResponse;
const MAX_ROUNDS = 8;

function getBaseUrl(req) {
  const base = process.env.BASE_URL;
  if (base) return base.replace(/\/$/, '');
  const host = req.get('host') || 'localhost:3000';
  const proto = req.get('x-forwarded-proto') || req.protocol || 'http';
  return `${proto}://${host}`;
}

function buildGather(twiml, { baseUrl, orderNo, lang }) {
  const language = lang === 'en' ? 'en-US' : 'ja-JP';
  return twiml.gather({
    input: 'speech',
    language,
    speechModel: 'experimental_conversations',
    speechTimeout: 'auto',
    action: `${baseUrl}/twilio/voice/${orderNo}/gather`,
    method: 'POST',
  });
}

export default async function voiceGatherHandler(req, res) {
  const { orderNo } = req.params;
  const body = req.body || {};
  const speechResult = (body.SpeechResult || '').trim();

  const db = getDb();
  const order = db.prepare('SELECT * FROM orders WHERE order_no = ?').get(orderNo);

  const twiml = new VoiceResponse();
  if (!order) {
    twiml.say({ language: 'ja-JP' }, '申し訳ございません。予約情報が見つかりません。');
    twiml.hangup();
    res.type('text/xml').send(twiml.toString());
    return;
  }

  const baseUrl = getBaseUrl(req);
  const lang = (order.call_lang || 'ja').toLowerCase() === 'en' ? 'en' : 'ja';
  let callRecords = [];
  try {
    const raw = order.call_records;
    if (raw) callRecords = JSON.parse(raw);
  } catch (_) {}

  const debugTiming = process.env.DEBUG_VOICE === '1';
  const t0 = debugTiming ? Date.now() : 0;

  const emptyFallback = lang === 'en' ? '(silence or unclear)' : '(無音または聞き取れず)';
  const lastText = speechResult || emptyFallback;
  callRecords.push({ role: 'restaurant', text_ja: lastText });
  if (debugTiming) console.log(`[voice-gather] ASR skipped (Twilio built-in), text: ${lastText}`);

  let nextReply;
  let ttsUrlCached = null;
  let earlyTtsData = null;
  const isFirstReply = callRecords.length === 1;
  const cached = isFirstReply ? getFirstMessageCache(order.order_no) : null;
  if (cached) {
    removeFirstMessageCache(order.order_no);
    nextReply = { text_ja: cached.text_ja, done: false };
    ttsUrlCached = cached.ttsUrl;
  } else if (isFirstReply) {
    nextReply = { text_ja: generateTemplateFirstMessage(order, lang), done: false };
    if (debugTiming) console.log(`[voice-gather] first message via template (no LLM)`);
  } else {
    const synthesizeFn = lang === 'en' ? synthesizeEnToUrl : synthesizeJaToUrl;
    const t1 = debugTiming ? Date.now() : 0;
    nextReply = await getNextAiReply(order, callRecords, lastText === emptyFallback ? null : lastText, {
      onSentenceReady: (text) => {
        if (!earlyTtsData) {
          earlyTtsData = { text, promise: synthesizeFn(text, baseUrl).catch(() => '') };
        }
      }
    });
    if (debugTiming) console.log(`[voice-gather] LLM ${Date.now() - t1}ms`);
  }
  callRecords.push({ role: 'ai', text_ja: nextReply.text_ja });

  db.prepare('UPDATE orders SET call_records = ?, updated_at = datetime(\'now\') WHERE id = ?').run(
    JSON.stringify(callRecords),
    order.id
  );

  if (nextReply.done || nextReply.call_result || callRecords.length >= MAX_ROUNDS * 2) {
    if (nextReply.call_result) {
      db.prepare('UPDATE orders SET call_result = ?, updated_at = datetime(\'now\') WHERE id = ?').run(
        nextReply.call_result,
        order.id
      );
    }
    twiml.say(
      { language: lang === 'en' ? 'en-US' : 'ja-JP' },
      nextReply.text_ja || (lang === 'en' ? 'Thank you for confirming. Goodbye.' : 'ご確認ありがとうございます。失礼いたします。')
    );
    twiml.hangup();
    res.type('text/xml').send(twiml.toString());
    return;
  }

  const t2 = debugTiming ? Date.now() : 0;
  let ttsUrl;
  if (ttsUrlCached) {
    ttsUrl = ttsUrlCached;
  } else if (earlyTtsData && earlyTtsData.text === nextReply.text_ja) {
    ttsUrl = await earlyTtsData.promise;
  } else {
    ttsUrl = await (lang === 'en'
      ? synthesizeEnToUrl(nextReply.text_ja, baseUrl)
      : synthesizeJaToUrl(nextReply.text_ja, baseUrl));
  }
  if (debugTiming) console.log(`[voice-gather] TTS ${earlyTtsData ? '(streamed) ' : ''}${Date.now() - t2}ms, total ${Date.now() - t0}ms`);

  const gather = buildGather(twiml, { baseUrl, orderNo, lang });
  if (ttsUrl) {
    gather.play(ttsUrl);
  } else {
    gather.say({ language: lang === 'en' ? 'en-US' : 'ja-JP' }, nextReply.text_ja);
  }

  twiml.say(
    { language: lang === 'en' ? 'en-US' : 'ja-JP' },
    lang === 'en' ? 'Sorry, I didn\'t catch that.' : 'すみません、聞き取れませんでした。'
  );
  twiml.hangup();

  res.type('text/xml').send(twiml.toString());
}
