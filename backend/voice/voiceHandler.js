import { getDb } from '../db.js';
import twilio from 'twilio';

const VoiceResponse = twilio.twiml.VoiceResponse;

export default function voiceHandler(req, res) {
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

  const twiml = new VoiceResponse();

  // 日语：您好，我们是代客预约服务，想为客人预约。
  twiml.say(
    { language: 'ja-JP', voice: 'Polly.Mizuki' },
    'こんにちは。お客様の代わりにご予約のお電話をさせていただいております。'
  );

  // 日期时间与人数（将 YYYY-MM-DD 转为日语口语：X月X日）
  const dateStr = formatDateForJapanese(order.booking_date);
  const timeStr = order.booking_time;
  const party = order.party_size;
  twiml.say(
    { language: 'ja-JP', voice: 'Polly.Mizuki' },
    `${dateStr}の${timeStr}、${party}名様でご予約をお願いいたします。`
  );

  if (order.flexible_hour) {
    twiml.say(
      { language: 'ja-JP', voice: 'Polly.Mizuki' },
      'その時間が難しい場合は、前後1時間のご調整も可能です。'
    );
  }

  if (order.want_set_meal) {
    twiml.say(
      { language: 'ja-JP', voice: 'Polly.Mizuki' },
      '人気のコースのご用意もお願いできますでしょうか。'
    );
  }

  twiml.say(
    { language: 'ja-JP', voice: 'Polly.Mizuki' },
    'ご対応のほど、よろしくお願いいたします。'
  );

  // 收集对方回复（可选）：等待 5 秒，便于对方说「はい」等
  twiml.gather({
    numDigits: 1,
    timeout: 8,
    action: `${getBaseUrl(req)}/twilio/voice/${orderNo}/done`,
    method: 'POST',
  });
  twiml.say({ language: 'ja-JP', voice: 'Polly.Mizuki' }, '何かご質問がございましたら、お申し付けください。');
  twiml.redirect({ method: 'POST' }, `${getBaseUrl(req)}/twilio/voice/${orderNo}/done`);

  res.type('text/xml').send(twiml.toString());
}

function formatDateForJapanese(ymd) {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return ymd || '';
  const [, m, d] = ymd.split('-');
  const month = parseInt(m, 10);
  const day = parseInt(d, 10);
  return `${month}月${day}日`;
}

function getBaseUrl(req) {
  const base = process.env.BASE_URL;
  if (base) return base.replace(/\/$/, '');
  const host = req.get('host') || 'localhost:3000';
  const proto = req.get('x-forwarded-proto') || req.protocol || 'http';
  return `${proto}://${host}`;
}
