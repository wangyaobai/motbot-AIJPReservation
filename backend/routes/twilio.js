import { Router } from 'express';
import twilio from 'twilio';
import { getDb } from '../db.js';
import voiceHandler from '../voice/voiceHandler.js';
import voiceDoneHandler from '../voice/voiceDoneHandler.js';
import recordingHandler from '../voice/recordingHandler.js';

const router = Router();

// Twilio 外呼时请求的 TwiML（AI 用日语与餐厅沟通）；GET/POST 都支持
router.get('/voice/:orderNo', voiceHandler);
router.post('/voice/:orderNo', voiceHandler);
router.get('/voice/:orderNo/done', voiceDoneHandler);
router.post('/voice/:orderNo/done', voiceDoneHandler);

// 通话结束后的状态回调（可选，用于更新 call status）
router.post('/status', (req, res) => {
  res.type('text/xml').send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
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
