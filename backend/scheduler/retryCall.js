import { getDb } from '../db.js';
import { startTwilioCallForOrder } from '../services/twilioCall.js';
import { appendAiCallLog } from '../services/aiCallLog.js';

const INTERVAL_MS = 2 * 60 * 1000; // 每 2 分钟检查一次

function getAttemptCountForToday(order) {
  const today = new Date().toISOString().slice(0, 10);
  const lastAt = order.ai_last_attempt_at ? String(order.ai_last_attempt_at).trim() : null;
  const lastDate = lastAt ? lastAt.slice(0, 10) : null;
  return lastDate === today ? (order.ai_call_attempt_count || 0) : 0;
}

export function startRetryCallScheduler() {
  setInterval(async () => {
    try {
      const db = getDb();
      const now = new Date().toISOString();
      // 包含两类：1) 首次拨打（排队/未营业到了时间） 2) 未接通后的重试（ai_call_status_type = 'retry'）
      const rows = db.prepare(`
        SELECT * FROM orders
        WHERE status = 'pending'
          AND ai_call_est_at IS NOT NULL
          AND ai_call_est_at <= ?
        ORDER BY ai_call_est_at ASC
      `).all(now);
      for (const order of rows) {
        const attemptCount = getAttemptCountForToday(order);
        if (attemptCount >= 3) continue;
        try {
          await startTwilioCallForOrder(order);
          const logText = attemptCount === 0 ? '开始发起拨打' : `第${attemptCount + 1}次尝试，开始发起拨打`;
          appendAiCallLog(order.id, logText);
        } catch (e) {
          console.error('[retryCall] start call failed', order.order_no, e.message);
        }
      }
    } catch (e) {
      console.error('[retryCall] scheduler error', e);
    }
  }, INTERVAL_MS);
}
