import { getDb } from '../db.js';
import { set as setFirstMessageCache } from './firstMessageCache.js';

/**
 * 为订单发起 Twilio 外呼。会更新订单的 twilio_call_sid、status=calling 并清空 ai_call_status 展示字段。
 * 同时预生成首句（LLM+TTS）供接听后快速响应，避免 502。
 * @param {object} order - 订单行（需含 id, order_no, restaurant_phone）
 * @returns {{ call_sid: string }}
 */
export async function startTwilioCallForOrder(order) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_PHONE_NUMBER;
  const baseUrl = (process.env.BASE_URL || '').replace(/\/$/, '');
  if (!sid || !token || !from || !baseUrl) {
    throw new Error('电话服务暂未配置。请在 backend/.env 中填写 TWILIO_ACCOUNT_SID、TWILIO_AUTH_TOKEN、TWILIO_PHONE_NUMBER 和 BASE_URL。');
  }
  const twilio = (await import('twilio')).default;
  const client = twilio(sid, token);
  const to = (order.restaurant_phone || '').replace(/\D/g, '');
  let toE164;
  if (to.startsWith('86') && to.length >= 11) {
    toE164 = '+' + to;
  } else if (to.length === 11 && to.startsWith('1')) {
    // 11 位且以 1 开头：按 +1 北美号码处理（餐厅主要在美国，而非中国）
    toE164 = '+1' + to.slice(1);
  } else if (to.startsWith('0')) {
    toE164 = '+81' + to.slice(1);
  } else if (to.length <= 10) {
    toE164 = '+81' + to;
  } else {
    toE164 = '+' + to;
  }

  // Twilio 拉取 TwiML/回调应命中后端 /api 路由（server.js 挂载在 /api/twilio）。
  // 如果这里写成 /twilio，生产环境可能 404，餐厅端会听到 “Configure your numbers voice url”。
  const apiBase = `${baseUrl}/api/twilio`;

  const call = await client.calls.create({
    to: toE164,
    from,
    url: `${apiBase}/voice/${order.order_no}`,
    statusCallback: `${apiBase}/status`,
    record: 'true', // 录制双方完整对话
    recordingStatusCallback: `${apiBase}/recording`,
    recordingStatusCallbackEvent: ['completed'],
    timeout: 30,
  });
  const db = getDb();
  db.prepare(`
    UPDATE orders SET twilio_call_sid = ?, status = 'calling',
      ai_call_status_text = NULL, ai_call_est_at = NULL, ai_call_status_type = NULL,
      ai_call_status_updated_at = NULL, updated_at = datetime('now')
    WHERE id = ?
  `).run(call.sid, order.id);

  // 预生成首句（典型接听语「はい」的回复），供接听后快速响应，避免 502
  setImmediate(async () => {
    try {
      const { getNextAiReply } = await import('./aiDialogue.js');
      const { synthesizeJaToUrl, synthesizeEnToUrl } = await import('./aliyunTts.js');
      const lang = (order.call_lang || 'ja').toLowerCase() === 'en' ? 'en' : 'ja';
      const greeting = lang === 'ja' ? 'はい' : 'Hello';
      const reply = await getNextAiReply({ ...order, _dialogue_lang: lang }, [{ role: 'restaurant', text_ja: greeting }], greeting);
      const ttsUrl = lang === 'en'
        ? await synthesizeEnToUrl(reply.text_ja, baseUrl)
        : await synthesizeJaToUrl(reply.text_ja, baseUrl);
      setFirstMessageCache(order.order_no, { text_ja: reply.text_ja, ttsUrl, lang });
    } catch (e) {
      console.warn('[twilioCall] pre-generate first message failed', e.message);
    }
  });

  return { call_sid: call.sid };
}
