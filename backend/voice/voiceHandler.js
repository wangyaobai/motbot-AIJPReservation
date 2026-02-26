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

  // 第一希望：日期时间（YYYY-MM-DD → X月X日）
  const dateStr1 = formatDateForJapanese(order.booking_date);
  const timeStr1 = order.booking_time || '';
  twiml.say(
    { language: 'ja-JP', voice: 'Polly.Mizuki' },
    `第一希望は、${dateStr1}の${timeStr1}でございます。`
  );

  // 第二希望（如有）
  if (order.second_booking_date && order.second_booking_time) {
    const dateStr2 = formatDateForJapanese(order.second_booking_date);
    const timeStr2 = order.second_booking_time;
    twiml.say(
      { language: 'ja-JP', voice: 'Polly.Mizuki' },
      `第二希望は、${dateStr2}の${timeStr2}でございます。`
    );
  }

  // 人数：成人・儿童
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

  // 饮食注意（如有）：用日语说明有饮食相关要求，再读原文（可能含中文）
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

  // 预约备注（如有）：用日语说明另有备注，再读原文
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
