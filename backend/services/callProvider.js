import { startTwilioCallForOrder } from './twilioCall.js';

/**
 * 统一呼叫提供方封装。
 * 目前仅使用 Twilio，后续可根据环境变量切换到其他平台（如 Plivo / Vonage 等）。
 * @param {object} order - 订单行（需含 id, order_no, restaurant_phone）
 * @returns {Promise<{ call_sid: string }>}
 */
export async function startCallForOrder(order) {
  // 预留扩展点：未来可根据 process.env.CALL_PROVIDER 选择不同实现
  // const provider = process.env.CALL_PROVIDER || 'twilio';
  // if (provider === 'twilio') { ... } else if (provider === 'plivo') { ... }
  return startTwilioCallForOrder(order);
}

