import { Router } from 'express';
import twilio from 'twilio';
import { getDb } from '../db.js';
import { appendAiCallLog } from '../services/aiCallLog.js';
import voiceHandler from '../voice/voiceHandler.js';
import voiceDoneHandler from '../voice/voiceDoneHandler.js';
import recordingHandler from '../voice/recordingHandler.js';

const router = Router();

const RETRY_INTERVAL_MS = 30 * 60 * 1000; // 30 分钟

// Twilio 外呼时请求的 TwiML（AI 用日语与餐厅沟通）；GET/POST 都支持
router.get('/voice/:orderNo', voiceHandler);
router.post('/voice/:orderNo', voiceHandler);
router.get('/voice/:orderNo/done', voiceDoneHandler);
router.post('/voice/:orderNo/done', voiceDoneHandler);

// 通话结束后的状态回调：未接通时更新当日尝试次数，并设置「再次尝试」或「当日已 3 次」
const FAILED_STATUSES = ['busy', 'failed', 'no-answer', 'canceled'];
router.post('/status', (req, res) => {
  res.type('text/xml').send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
  const CallSid = req.body?.CallSid;
  const CallStatus = (req.body?.CallStatus || '').toLowerCase();
  if (!CallSid || !FAILED_STATUSES.includes(CallStatus)) return;
  try {
    const db = getDb();
    const order = db.prepare('SELECT * FROM orders WHERE twilio_call_sid = ?').get(CallSid);
    if (!order || (order.status !== 'calling')) return;
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const lastAt = order.ai_last_attempt_at ? String(order.ai_last_attempt_at).trim() : null;
    const lastDate = lastAt ? lastAt.slice(0, 10) : null;
    const prevCount = lastDate === today ? (order.ai_call_attempt_count || 0) : 0;
    const newCount = prevCount + 1;
    const isoNow = now.toISOString();
    const updatedAt = isoNow.slice(0, 19).replace('T', ' ');
    if (newCount >= 3) {
      appendAiCallLog(order.id, '未接通，今日尝试次数已用完，等待明日营业时间再次尝试。');
      db.prepare(`
        UPDATE orders SET
          status = 'failed',
          ai_call_attempt_count = ?,
          ai_last_attempt_at = ?,
          ai_call_status_text = ?,
          ai_call_status_updated_at = ?,
          ai_call_status_type = 'retry_max',
          ai_call_est_at = NULL,
          updated_at = datetime('now')
        WHERE id = ?
      `).run(
        newCount,
        isoNow,
        '当日已尝试3次未接通，请明日再试或更换时间。',
        updatedAt,
        order.id
      );
    } else {
      const nextRetry = new Date(now.getTime() + RETRY_INTERVAL_MS);
      const logText = `未接通，预计再次尝试（第${newCount}次）`;
      appendAiCallLog(order.id, logText);
      db.prepare(`
        UPDATE orders SET
          status = 'pending',
          ai_call_attempt_count = ?,
          ai_last_attempt_at = ?,
          ai_call_status_text = ?,
          ai_call_est_at = ?,
          ai_call_status_updated_at = ?,
          ai_call_status_type = 'retry',
          updated_at = datetime('now')
        WHERE id = ?
      `).run(
        newCount,
        isoNow,
        'AI已开始拨打，未接通，预计下方时间开始再次尝试，请您耐心等待。',
        nextRetry.toISOString(),
        updatedAt,
        order.id
      );
    }
  } catch (e) {
    console.error('[twilio/status]', e);
  }
});

// 录音完成后回调：拉取录音、转写、生成摘要、发短信
router.post('/recording', async (req, res) => {
  try {
    await recordingHandler(req.body);
    res.type('text/xml').send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
  } catch (e) {
    console.error('recording callback error', e);
    res.status(500).end();
  }
});

export default router;
