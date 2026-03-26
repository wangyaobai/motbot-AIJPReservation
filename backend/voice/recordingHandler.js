import { getDb } from '../db.js';
import { appendAiCallLog } from '../services/aiCallLog.js';
import { fetchRestaurantAddress, fetchRestaurantNameAndAddressByPhone } from '../services/restaurantAddress.js';
import { transcribeFromUrl } from '../services/aliyunAsr.js';
import twilio from 'twilio';

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
/** 模拟通话时使用的假转写（根据订单生成一句日文） */
function getTestTranscript(order) {
  const d = order.booking_date || '';
  const t = order.booking_time || '';
  const n = order.party_size ?? 0;
  const m = d.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  const dateStr = m ? `${parseInt(m[2], 10)}月${parseInt(m[3], 10)}日` : '';
  const [hh, min] = (t || '').split(':');
  const timeStr = hh != null ? `${parseInt(hh, 10)}時${min ? parseInt(min, 10) + '分' : ''}` : '';
  return `はい、かしこまりました。${dateStr}${timeStr}、${n}名様でご予約承ります。`;
}

export default async function recordingHandler(body) {
  const { RecordingSid, RecordingUrl, CallSid, RecordingDuration } = body;
  if (!RecordingSid || !CallSid) return;

  const db = getDb();
  const order = db.prepare('SELECT * FROM orders WHERE twilio_call_sid = ?').get(CallSid);
  if (!order) return;

  const isTestSimulate = String(RecordingSid).startsWith('TEST_');
  const base = RecordingUrl || `https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/Recordings/${RecordingSid}`;
  const recordingUrl = base.replace(/\.(mp3|wav)?$/i, '') + '.mp3';
  const duration = parseInt(RecordingDuration, 10) || 0;

  appendAiCallLog(order.id, isTestSimulate ? '（模拟）接通，通话完成' : '接通，通话完成');
  let transcriptFull = '';
  if (isTestSimulate) {
    transcriptFull = getTestTranscript(order);
    db.prepare('UPDATE orders SET transcript_full = ?, updated_at = datetime(\'now\') WHERE id = ?').run(transcriptFull, order.id);
  } else {
    const authHeader = process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN
      ? 'Basic ' + Buffer.from(process.env.TWILIO_ACCOUNT_SID + ':' + process.env.TWILIO_AUTH_TOKEN).toString('base64')
      : null;
    const lang = (order.call_lang || 'ja').toString().toLowerCase() === 'en' ? 'en' : 'ja';
    transcriptFull = await transcribeFromUrl(recordingUrl, { authHeader, lang }) || '';
    if (transcriptFull) {
      db.prepare('UPDATE orders SET transcript_full = ?, updated_at = datetime(\'now\') WHERE id = ?').run(transcriptFull, order.id);
    }
  }

  let summaryText = '通话已结束。';
  let transcriptCn = '';
  const hasDeepSeek = !!process.env.DEEPSEEK_API_KEY;
  if (hasDeepSeek && transcriptFull) {
    try {
      summaryText = await generateSummary(transcriptFull, order);
      transcriptCn = await translateToChinese(transcriptFull, order);
      if (transcriptCn) {
        db.prepare('UPDATE orders SET transcript_cn = ?, updated_at = datetime(\'now\') WHERE id = ?').run(transcriptCn, order.id);
      }
    } catch (e) {
      console.error('transcribe/summary error', e);
      summaryText = `通话录音已保存。转写或摘要生成失败：${e.message}`;
    }
  }

  db.prepare(
    'UPDATE orders SET recording_url = ?, recording_duration_sec = ?, updated_at = datetime(\'now\') WHERE id = ?'
  ).run(isTestSimulate ? null : recordingUrl, duration, order.id);

  const existingCallResult = (order.call_result || '').trim().toLowerCase();
  const isFullBooked = existingCallResult === 'full' || /已约满|约满|满席|いっぱい|満席/.test(summaryText || '');
  const isRetry = existingCallResult === 'retry';
  const summaryIndicatesFailure = /失败|未成功|无法预约|拒绝|已约满|约满|满席/.test(summaryText || '');
  const retryActuallySucceeded = isRetry && !isFullBooked && !summaryIndicatesFailure;
  const finalStatus = isFullBooked ? 'failed' : (isRetry ? (retryActuallySucceeded ? 'completed' : 'failed') : 'completed');
  if (isFullBooked) {
    appendAiCallLog(order.id, 'AI拨打已接通，店家反馈已约满，本次订单已结束。您可以再次尝试发起新的预约时间或预约其他餐厅。');
  } else if (isRetry && !retryActuallySucceeded) {
    appendAiCallLog(order.id, 'AI拨打已接通，但未获得店家明确预约成功确认，本次订单已结束。');
  } else {
    const d = order.booking_date || '';
    const t = order.booking_time || '';
    const n = order.party_size ?? 0;
    const m = d.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    const dateStr = m ? `${parseInt(m[2], 10)}月${parseInt(m[3], 10)}日` : '—';
    const [hh, min] = (t || '').split(':');
    const timeStr = hh != null ? `${parseInt(hh, 10)}时${min ? `${parseInt(min, 10)}分` : ''}` : '—';
    const successMsg = `您的预订已经成功，已经成功预定了${dateStr}${timeStr}${n}人的座位。预约通话过程可查看「AI沟通记录」，就餐可出示「预约凭证」。`;
    appendAiCallLog(order.id, successMsg);
  }

  db.prepare('UPDATE orders SET summary_text = ?, status = ?, updated_at = datetime(\'now\') WHERE id = ?').run(
    summaryText,
    finalStatus,
    order.id
  );

  // 预约成功后补全店铺信息，供预约凭证展示：
  // - 用户未使用搜索、只填了电话：用 DeepSeek 根据电话反查店铺名称+地址并存储
  // - 有名称无地址：仅反查地址
  if (finalStatus === 'completed' && order.restaurant_phone) {
    try {
      if (!order.restaurant_name) {
        const { name, address } = await fetchRestaurantNameAndAddressByPhone(order.restaurant_phone);
        if (name || address) {
          db.prepare(
            'UPDATE orders SET restaurant_name = COALESCE(?, restaurant_name), restaurant_address = COALESCE(?, restaurant_address) WHERE id = ?'
          ).run(name || null, address || null, order.id);
        }
      } else if (!order.restaurant_address) {
        const addr = await fetchRestaurantAddress(order.restaurant_name, order.restaurant_phone);
        if (addr) db.prepare('UPDATE orders SET restaurant_address = ? WHERE id = ?').run(addr, order.id);
      }
    } catch (e) {
      console.error('[recording] fetchRestaurantNameAndAddressByPhone / fetchRestaurantAddress', e.message);
    }
  }

  const twilioClient = getTwilioClient();
  if (twilioClient && order.contact_phone) {
    try {
      const digits = order.contact_phone.replace(/\D/g, '');
      const to = order.contact_phone_region === 'jp'
        ? (order.contact_phone.startsWith('+') ? order.contact_phone : `+81${digits}`)
        : `+86${digits.replace(/^0/, '')}`;
      const smsBody = `【日本餐厅预约】您的预约通话已完成。摘要：${summaryText}`;
      await twilioClient.messages.create({
        body: smsBody,
        from: process.env.TWILIO_PHONE_NUMBER,
        to,
      });
      db.prepare('UPDATE orders SET sms_sent = 1, sms_body = ? WHERE id = ?').run(smsBody, order.id);
    } catch (e) {
      console.error('SMS send error', e);
    }
  }
}

async function generateSummary(transcript, order) {
  const isEn = (order?.call_lang || '').toString().toLowerCase() === 'en';
  const prompt = isEn
    ? `Below is a restaurant reservation call transcript (English). Please write a short summary in Chinese (2-4 sentences) including:
- whether the reservation was successful
- date/time and party size
- any extra notes from the restaurant
If the restaurant says fully booked / no availability / cannot accept the reservation, explicitly include “店家反馈已约满” or “已约满” in your Chinese summary.\n\nTranscript:\n${transcript}`
    : `以下是一段日语餐厅预约电话的转写文本。请用中文写一段简短摘要（2-4句话），说明：是否预约成功、预约日期时间与人数、餐厅是否有其他说明。
若店家表示该时段已约满、满席或无法预约，请在摘要中明确写出「店家反馈已约满」或「已约满」，以便系统标记为预约失败。\n\n转写：\n${transcript}`;
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return '摘要生成失败。';
  const url = 'https://api.deepseek.com/chat/completions';
  const body = { model: 'deepseek-chat', messages: [{ role: 'user', content: prompt }], max_tokens: 300, temperature: 0.3 };
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  });
  const data = await resp.json().catch(() => ({}));
  const text = data.choices?.[0]?.message?.content?.trim();
  return text || '摘要生成失败。';
}

async function translateToChinese(transcript, order) {
  if (!transcript.trim()) return '';
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return '';
  const url = 'https://api.deepseek.com/chat/completions';
  const isEn = (order?.call_lang || '').toString().toLowerCase() === 'en';
  const content = isEn
    ? `将以下英文内容翻译成中文，只输出译文：\n\n${transcript}`
    : `将以下日语内容翻译成中文，只输出译文：\n\n${transcript}`;
  const body = { model: 'deepseek-chat', messages: [{ role: 'user', content }], max_tokens: 500, temperature: 0.2 };
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  });
  const data = await resp.json().catch(() => ({}));
  return data.choices?.[0]?.message?.content?.trim() || '';
}
