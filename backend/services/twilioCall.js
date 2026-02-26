import { getDb } from '../db.js';

/**
 * 为订单发起 Twilio 外呼。会更新订单的 twilio_call_sid、status=calling 并清空 ai_call_status 展示字段。
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
  const toE164 = to.startsWith('0') ? '+81' + to.slice(1) : (to.length <= 10 ? '+81' + to : '+' + to);
  const call = await client.calls.create({
    to: toE164,
    from,
    url: `${baseUrl}/twilio/voice/${order.order_no}`,
    statusCallback: `${baseUrl}/twilio/status`,
    record: 'record-from-answer',
    recordingStatusCallback: `${baseUrl}/twilio/recording`,
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
  return { call_sid: call.sid };
}
