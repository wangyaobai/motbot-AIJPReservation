import { getDb } from '../db.js';

/**
 * 向订单的 AI 通话状态日志追加一条记录（每个节点状态+时间点）
 * @param {number} orderId - orders.id
 * @param {string} text - 节点描述，如 "开始发起拨打"、"未接通，预计…再次尝试（第1次）"
 */
export function appendAiCallLog(orderId, text) {
  if (!orderId || !text) return;
  const db = getDb();
  const row = db.prepare('SELECT ai_call_status_log FROM orders WHERE id = ?').get(orderId);
  if (!row) return;
  const raw = row.ai_call_status_log;
  let list = [];
  if (raw && typeof raw === 'string') {
    try {
      list = JSON.parse(raw);
      if (!Array.isArray(list)) list = [];
    } catch {
      list = [];
    }
  }
  const at = new Date().toISOString();
  list.push({ at, text });
  db.prepare('UPDATE orders SET ai_call_status_log = ? WHERE id = ?').run(JSON.stringify(list), orderId);
}
