import { getDb } from '../db.js';
import OpenAI from 'openai';
import twilio from 'twilio';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || '' });

function getTwilioClient() {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) return null;
  return twilio(sid, token);
}

/**
 * Twilio 录音完成回调会 POST 到 /twilio/recording，但 Twilio 的 webhook 是
 * RecordingStatusCallback，在 Create Recording 或 Call 的 record 完成时触发。
 * 这里按「调用 Twilio API 拉取录音 URL + 转写 + 摘要 + 发短信」流程实现。
 * 实际回调参数见: https://www.twilio.com/docs/voice/api/recording#recordingstatuscallback
 */
export default async function recordingHandler(body) {
  const { RecordingSid, RecordingUrl, CallSid, RecordingDuration } = body;
  if (!RecordingSid || !CallSid) return;

  const db = getDb();
  const order = db.prepare('SELECT * FROM orders WHERE twilio_call_sid = ?').get(CallSid);
  if (!order) return;

  const base = RecordingUrl || `https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/Recordings/${RecordingSid}`;
  const recordingUrl = base.replace(/\.(mp3|wav)?$/i, '') + '.mp3';
  const duration = parseInt(RecordingDuration, 10) || 0;

  db.prepare(
    'UPDATE orders SET recording_url = ?, recording_duration_sec = ?, updated_at = datetime(\'now\') WHERE id = ?'
  ).run(recordingUrl, duration, order.id);

  let summaryText = '通话已结束。';
  if (openai.apiKey) {
    try {
      const transcript = await transcribeRecording(recordingUrl);
      if (transcript) {
        summaryText = await generateSummary(transcript, order);
      }
    } catch (e) {
      console.error('transcribe/summary error', e);
      summaryText = `通话录音已保存。转写或摘要生成失败：${e.message}`;
    }
  }

  db.prepare('UPDATE orders SET summary_text = ?, status = \'completed\', updated_at = datetime(\'now\') WHERE id = ?').run(
    summaryText,
    order.id
  );

  const twilioClient = getTwilioClient();
  if (twilioClient && order.contact_phone) {
    try {
      const digits = order.contact_phone.replace(/\D/g, '');
      const to = order.contact_phone_region === 'jp'
        ? (order.contact_phone.startsWith('+') ? order.contact_phone : `+81${digits}`)
        : `+86${digits.replace(/^0/, '')}`;
      await twilioClient.messages.create({
        body: `【日本餐厅预约】您的预约通话已完成。摘要：${summaryText}`,
        from: process.env.TWILIO_PHONE_NUMBER,
        to,
      });
      db.prepare('UPDATE orders SET sms_sent = 1 WHERE id = ?').run(order.id);
    } catch (e) {
      console.error('SMS send error', e);
    }
  }
}

async function transcribeRecording(recordingUrl) {
  if (!openai.apiKey) return null;
  const resp = await fetch(recordingUrl, {
    headers: process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN
      ? { Authorization: 'Basic ' + Buffer.from(process.env.TWILIO_ACCOUNT_SID + ':' + process.env.TWILIO_AUTH_TOKEN).toString('base64') }
      : {},
  });
  if (!resp.ok) return null;
  const buf = Buffer.from(await resp.arrayBuffer());
  const FormData = (await import('form-data')).default;
  const form = new FormData();
  form.append('file', buf, { filename: 'recording.mp3' });
  form.append('model', 'whisper-1');
  form.append('language', 'ja');
  const transcriptResp = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { ...form.getHeaders(), Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: form,
  });
  if (!transcriptResp.ok) return null;
  const data = await transcriptResp.json();
  return data.text || null;
}

async function generateSummary(transcript, order) {
  const prompt = `以下是一段日语餐厅预约电话的转写文本。请用中文写一段简短摘要（2-4句话），说明：是否预约成功、预约日期时间与人数、餐厅是否有其他说明。\n\n转写：\n${transcript}`;
  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 300,
  });
  return completion.choices[0]?.message?.content?.trim() || '摘要生成失败。';
}
