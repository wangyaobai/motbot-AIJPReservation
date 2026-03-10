/**
 * 多轮通话：Record 结束后的回调。对录音做 ASR → 更新 call_records → LLM 下一句 → TTS → 返回 Play+Record 或挂断。
 */
import twilio from 'twilio';
import { getDb } from '../db.js';
import { transcribeJaFromUrl } from '../services/aliyunAsr.js';
import { getNextAiReply } from '../services/aiDialogue.js';
import { synthesizeJaToUrl } from '../services/aliyunTts.js';

const VoiceResponse = twilio.twiml.VoiceResponse;
const MAX_ROUNDS = 8;

function getBaseUrl(req) {
  const base = process.env.BASE_URL;
  if (base) return base.replace(/\/$/, '');
  const host = req.get('host') || 'localhost:3000';
  const proto = req.get('x-forwarded-proto') || req.protocol || 'http';
  return `${proto}://${host}`;
}

function getAuthHeader() {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) return null;
  return 'Basic ' + Buffer.from(sid + ':' + token).toString('base64');
}

export default async function voiceRecordHandler(req, res) {
  const { orderNo } = req.params;
  const body = req.body || {};
  const recordingUrl = body.RecordingUrl || body.recording_url;
  const callSid = body.CallSid || body.CallSid;

  const db = getDb();
  const order = orderNo
    ? db.prepare('SELECT * FROM orders WHERE order_no = ?').get(orderNo)
    : (callSid ? db.prepare('SELECT * FROM orders WHERE twilio_call_sid = ?').get(callSid) : null);

  const twiml = new VoiceResponse();
  if (!order) {
    twiml.say({ language: 'ja-JP' }, '申し訳ございません。予約情報が見つかりません。');
    twiml.hangup();
    res.type('text/xml').send(twiml.toString());
    return;
  }

  const baseUrl = getBaseUrl(req);
  let callRecords = [];
  try {
    const raw = order.call_records;
    if (raw) callRecords = JSON.parse(raw);
  } catch (_) {}

  const authHeader = getAuthHeader();
  const recordingUri = (recordingUrl || '').replace(/\.(mp3|wav)?$/i, '') + '.mp3';
  const lastText = await transcribeJaFromUrl(recordingUri, { authHeader });
  callRecords.push({ role: 'restaurant', text_ja: lastText || '(無音または聞き取れず)' });

  const nextReply = await getNextAiReply(order, callRecords, lastText || null);
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
    twiml.say({ language: 'ja-JP' }, nextReply.text_ja || 'ご確認ありがとうございます。失礼いたします。');
    twiml.hangup();
    res.type('text/xml').send(twiml.toString());
    return;
  }

  const ttsUrl = await synthesizeJaToUrl(nextReply.text_ja, baseUrl);
  if (ttsUrl) {
    twiml.play(ttsUrl);
  } else {
    twiml.say({ language: 'ja-JP' }, nextReply.text_ja);
  }
  twiml.record({
    maxLength: 30,
    playBeep: false,
    action: `${baseUrl}/twilio/voice/${order.order_no}/record`,
    method: 'POST',
    recordingStatusCallback: undefined,
  });

  res.type('text/xml').send(twiml.toString());
}
