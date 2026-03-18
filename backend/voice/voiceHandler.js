import { getDb } from '../db.js';
import twilio from 'twilio';
const VoiceResponse = twilio.twiml.VoiceResponse;

function getBaseUrl(req) {
  const base = process.env.BASE_URL;
  if (base) return base.replace(/\/$/, '');
  const host = req.get('host') || 'localhost:3000';
  const proto = req.get('x-forwarded-proto') || req.protocol || 'http';
  return `${proto}://${host}`;
}

function formatDateForJapanese(ymd) {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return ymd || '';
  const [, m, d] = ymd.split('-');
  const month = parseInt(m, 10);
  const day = parseInt(d, 10);
  return `${month}月${day}日`;
}

/**
 * 2.5 期：多轮对话入口。
 * 1) 先 Record 等对方接通并说「喂」等，再 Play AI 话术（不在一接通就开讲）
 * 2) 首句由预生成缓存或 LLM 生成，避免 502
 */
async function handleMultiRound(order, orderNo, req, res) {
  const baseUrl = getBaseUrl(req);
  const twiml = new VoiceResponse();

  // 先 Record 5 秒，等对方接通并说「はい」「もしもし」等，再在 voiceRecordHandler 中 Play AI 话术
  twiml.record({
    maxLength: 5,
    playBeep: false,
    timeout: 5,
    action: `${baseUrl}/twilio/voice/${orderNo}/record`,
    method: 'POST',
  });

  res.type('text/xml').send(twiml.toString());
}

/**
 * 原固定话术：Polly 播报 + Gather + redirect done
 */
function handleLegacy(order, orderNo, req, res) {
  const baseUrl = getBaseUrl(req);
  const twiml = new VoiceResponse();

  twiml.say(
    { language: 'ja-JP', voice: 'Polly.Mizuki' },
    'こんにちは。お客様の代わりにご予約のお電話をさせていただいております。'
  );

  const dateStr1 = formatDateForJapanese(order.booking_date);
  const timeStr1 = order.booking_time || '';
  twiml.say(
    { language: 'ja-JP', voice: 'Polly.Mizuki' },
    `第一希望は、${dateStr1}の${timeStr1}でございます。`
  );

  if (order.second_booking_date && order.second_booking_time) {
    const dateStr2 = formatDateForJapanese(order.second_booking_date);
    const timeStr2 = order.second_booking_time;
    twiml.say(
      { language: 'ja-JP', voice: 'Polly.Mizuki' },
      `第二希望は、${dateStr2}の${timeStr2}でございます。`
    );
  }

  const adults = order.adult_count != null ? Number(order.adult_count) : (order.party_size || 0);
  const children = order.child_count != null ? Number(order.child_count) : 0;
  if (children > 0) {
    twiml.say(
      { language: 'ja-JP', voice: 'Polly.Mizuki' },
      `大人${adults}名様、お子様${children}名様でご予約をお願いいたします。`
    );
  } else {
    twiml.say(
      { language: 'ja-JP', voice: 'Polly.Mizuki' },
      `${adults}名様でご予約をお願いいたします。`
    );
  }

  if (order.dietary_notes && String(order.dietary_notes).trim()) {
    twiml.say(
      { language: 'ja-JP', voice: 'Polly.Mizuki' },
      '食事に関するご要望がございます。'
    );
    twiml.say(
      { language: 'ja-JP', voice: 'Polly.Mizuki' },
      String(order.dietary_notes).trim()
    );
  }

  if (order.booking_remark && String(order.booking_remark).trim()) {
    twiml.say(
      { language: 'ja-JP', voice: 'Polly.Mizuki' },
      'その他、お客様からのご要望は以下のとおりです。'
    );
    twiml.say(
      { language: 'ja-JP', voice: 'Polly.Mizuki' },
      String(order.booking_remark).trim()
    );
  }

  twiml.say(
    { language: 'ja-JP', voice: 'Polly.Mizuki' },
    'ご対応のほど、よろしくお願いいたします。'
  );

  twiml.gather({
    numDigits: 1,
    timeout: 8,
    action: `${baseUrl}/twilio/voice/${orderNo}/done`,
    method: 'POST',
  });
  twiml.say({ language: 'ja-JP', voice: 'Polly.Mizuki' }, '何かご質問がございましたら、お申し付けください。');
  twiml.redirect({ method: 'POST' }, `${baseUrl}/twilio/voice/${orderNo}/done`);

  res.type('text/xml').send(twiml.toString());
}

export default async function voiceHandler(req, res) {
  const { orderNo } = req.params;
  const db = getDb();
  const order = db.prepare('SELECT * FROM orders WHERE order_no = ?').get(orderNo);
  if (!order) {
    const twiml = new VoiceResponse();
    twiml.say({ language: 'ja-JP' }, '申し訳ございません。予約情報が見つかりません。');
    twiml.hangup();
    res.type('text/xml').send(twiml.toString());
    return;
  }

  const useMultiRound = !!(process.env.ALI_APP_KEY_JA || process.env.ALIYUN_APP_KEY_JA || process.env.ALI_APP_KEY_EN || process.env.ALI_APP_KEY || process.env.ALIYUN_APP_KEY);
  if (useMultiRound) {
    return handleMultiRound(order, orderNo, req, res);
  }
  return handleLegacy(order, orderNo, req, res);
}
