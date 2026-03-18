/**
 * 多轮 AI 对话：根据订单信息与历史记录，生成下一句日语回复（供 TTS 播放）。
 * 使用 DeepSeek，若无则退回到 OpenAI。
 */

const DEEPSEEK_API = 'https://api.deepseek.com/chat/completions';
const OPENAI_MODEL = 'gpt-4o-mini';

function formatDateJa(ymd) {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return ymd || '';
  const [, m, d] = ymd.split('-');
  return `${parseInt(m, 10)}月${parseInt(d, 10)}日`;
}

function normalizeDigits(s) {
  return (s || '').toString().replace(/\D/g, '');
}

function formatContactPhoneE164(order) {
  const raw = (order?.contact_phone || '').toString().trim();
  if (!raw) return '';
  if (raw.startsWith('+')) return raw;
  const digits = normalizeDigits(raw);
  const region = (order?.contact_phone_region || 'cn').toString().toLowerCase();
  if (region === 'jp') {
    const d = digits.replace(/^0+/, '');
    return d ? `+81${d}` : '';
  }
  // default cn
  const d = digits.replace(/^0+/, '');
  return d ? `+86${d}` : '';
}

function buildOrderContext(order, lang) {
  const l = (lang || 'ja').toLowerCase();
  const parts = [];
  const firstDate = formatDateJa(order.booking_date);
  const firstTime = order.booking_time || '';
  const secondDate = order.second_booking_date ? formatDateJa(order.second_booking_date) : '';
  const secondTime = order.second_booking_time || '';
  const adults = order.adult_count != null ? Number(order.adult_count) : (order.party_size || 0);
  const children = order.child_count != null ? Number(order.child_count) : 0;
  const contactName = (order.contact_name || '').toString().trim();
  const contactPhone = formatContactPhoneE164(order);

  if (l === 'en') {
    parts.push(`First choice: ${order.booking_date || ''} ${firstTime}`);
    if (order.second_booking_date && order.second_booking_time) {
      parts.push(`Second choice: ${order.second_booking_date} ${secondTime}`);
    }
    parts.push(`Party size: adults ${adults}${children > 0 ? `, children ${children}` : ''}`);
    if (order.dietary_notes && String(order.dietary_notes).trim()) {
      parts.push(`Dietary restrictions/allergies: ${order.dietary_notes.trim()}`);
    }
    if (order.booking_remark && String(order.booking_remark).trim()) {
      parts.push(`Remarks: ${order.booking_remark.trim()}`);
    }
    if (contactName) parts.push(`Contact name: ${contactName}`);
    if (contactPhone) parts.push(`Contact phone (for SMS/payment link): ${contactPhone}`);
    return parts.join(' | ');
  }

  // 默认日语
  parts.push(`第一希望：${firstDate} ${firstTime}`);
  if (order.second_booking_date && order.second_booking_time) {
    parts.push(`第二希望：${secondDate} ${secondTime}`);
  }
  if (children > 0) parts.push(`人数：大人${adults}名、子供${children}名`);
  else parts.push(`人数：${adults}名`);
  if (order.dietary_notes && String(order.dietary_notes).trim()) {
    parts.push(`食事制限・アレルギー：${order.dietary_notes.trim()}`);
  }
  if (order.booking_remark && String(order.booking_remark).trim()) {
    parts.push(`備考：${order.booking_remark.trim()}`);
  }
  if (contactName) parts.push(`予約者名：${contactName}`);
  if (contactPhone) parts.push(`連絡先（SMS等）：${contactPhone}`);
  return parts.join('；');
}

function containsChinese(text) {
  return /[\u4e00-\u9fff]/.test(text || '');
}

/**
 * @param {object} order - 订单行（含 booking_date, booking_time, party_size 等）
 * @param {Array<{role:string, text_ja:string}>} callRecords - 已有对话（ai/restaurant 交替）
 * @param {string|null} lastRestaurantText - 对方（餐厅）最新一句日文（ASR 结果）
 * @returns {Promise<{ text_ja: string, done: boolean, call_result?: string }>}
 */
export async function getNextAiReply(order, callRecords = [], lastRestaurantText = null) {
  // 自动语言：默认日语；调用方可传入 order._dialogue_lang='en' 或在 callRecords 中加 lang 逻辑（当前用于测试模拟器）
  const forcedLang = (order && order._dialogue_lang) ? String(order._dialogue_lang).toLowerCase() : 'ja';
  const lang = (forcedLang === 'en') ? 'en' : 'ja';
  const apiKey = process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return lang === 'en'
      ? { text_ja: 'Sorry, the system is not ready at the moment.', done: true }
      : { text_ja: '申し訳ございません。ただいまシステムの準備ができておりません。', done: true };
  }

  const useDeepSeek = !!process.env.DEEPSEEK_API_KEY;
  const orderCtx = buildOrderContext(order, lang);

  let historyStr = '';
  if (callRecords.length > 0) {
    historyStr = callRecords
      .map((r) => (r.role === 'ai' ? `AI: ${r.text_ja}` : `店: ${r.text_ja}`))
      .join('\n');
  }

  const systemPromptJa = `你是一个代客预约日本餐厅的 AI 助手。你正在用日语与餐厅工作人员通话。
订单信息：${orderCtx}

重要：你的回复必须全部为日语，禁止出现中文或英文（专有名词除外）。输出将直接用于日语 TTS 朗读。
每次回复尽量简短（1～2 句），不要一次说太多。

固定策略（必须遵守）：
1. 身份：一开始务必说明是「帮客人预约」的。
2. 首句：只说第一希望日期、时间、人数。不要提第二希望、饮食、套餐等。
3. 若对方说满席/不可用：再礼貌提出第二希望日期时间。
4. 若对方说时间 OK：再强调饮食禁忌（若有）。
5. 若对方问套餐：默认「餐厅推荐套餐」；若订单备注有写具体套餐，则按用户写的沟通。
6. 若对方要求预付/定金：礼貌争取「到店支付」；若不行则请对方将支付链接发短信到订单中的连络电话。不要编造链接或金额。
7. 预约时间：不要主动提可弹性。当餐厅主动提议其他时间时，再判断：若在原时间前后 1 小时内则接受，超出则礼貌拒绝并说明需在客户指定时间前后 1 小时内，不要替客户做主。

禁止：1) 一段对话中不要突然切换语言（如之前都是英文突然变日语）；2) 餐厅没有提到预约定金时，不要主动提发链接；3) 预约成功/失败的短信由 aireservation 平台发送，无需餐厅发送，不要提让餐厅发确认短信。

根据对话历史与对方最新回复，生成下一句日语回复。若对方已确认预约则感谢并结束；若满席则礼貌结束。
只输出一句日语，不要中文、不要解释。`;

  const systemPromptEn = `You are an AI assistant calling a restaurant to make a reservation on behalf of a customer.
Order details: ${orderCtx}

Important: your reply must be ONLY in English. It will be used for English TTS playback.
Keep each reply SHORT (1-2 sentences). Do not dump everything at once.

Fixed policy (must follow):
1. Identity: clearly state you are calling to help a customer make a reservation.
2. First message: only say first choice date, time, and party size. Do NOT mention second choice, dietary, or menu.
3. If restaurant says full/unavailable: then politely offer second choice date/time.
4. If restaurant says time OK: then emphasize dietary restrictions (if any).
5. If restaurant asks about menu/set: default to "restaurant's recommended"; if order remarks specify something, use that.
6. If restaurant requires deposit/prepayment: politely request pay at restaurant; if not possible, ask them to send payment link via SMS to the contact phone in the order. Do NOT invent links or amounts.
7. Reservation time: do NOT proactively mention flexibility. Only when the restaurant proposes a different time, then judge: accept if within ±1 hour of the customer's requested time; if beyond, politely decline and explain it must be within 1 hour of the customer's specified time. Do NOT make decisions on behalf of the customer.

Forbidden: 1) Do NOT switch mid-conversation (e.g. from English to Japanese); 2) Do NOT proactively mention payment links when the restaurant has not brought up deposit/prepayment; 3) Reservation success/failure SMS is sent by the aireservation platform, not the restaurant—do NOT ask the restaurant to send confirmation SMS.

Generate the next polite reply based on the dialogue history. If restaurant confirms, thank and end. If fully booked, politely end.
Output only English, no explanations.`;

  const firstMessageInstructionJa = `请根据上述订单信息，生成电话接通后的「首句」日语开场白，要求：
1. 先自然问候（如 お電話ありがとうございます），再明确说明：お客様のご予約を代行してお電話しております（帮客人预约）。
2. 只包含：第一希望日期、时间、人数。不要提第二希望、饮食、套餐等。
3. 简短礼貌，1～2 句，全部日语。`;

  const firstMessageInstructionEn = `Create the English opening message after the call is answered. Requirements:
1) Natural greeting, then clearly state: you are calling to help a customer make a reservation.
2) Include ONLY: first choice date, time, and party size. Do NOT mention second choice, dietary, or menu.
3) Keep it short and polite, 1-2 sentences. Output ONLY English.`;

  const userContent = lastRestaurantText
    ? (lang === 'en'
      ? `Dialogue so far:\n${historyStr}\nRestaurant (latest): ${lastRestaurantText}\nGenerate the next AI reply in English.`
      : `当前对话：\n${historyStr}\n店（最新）: ${lastRestaurantText}\n请生成 AI 下一句日语回复。`)
    : (historyStr
      ? (lang === 'en'
        ? `Dialogue so far:\n${historyStr}\nGenerate the next AI reply in English.`
        : `当前对话：\n${historyStr}\n请生成 AI 下一句日语回复。`)
      : (lang === 'en' ? firstMessageInstructionEn : firstMessageInstructionJa));

  const body = useDeepSeek
    ? {
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: lang === 'en' ? systemPromptEn : systemPromptJa },
          { role: 'user', content: userContent },
        ],
        max_tokens: 500,
        temperature: 0.3,
      }
    : {
        model: OPENAI_MODEL,
        messages: [
          { role: 'system', content: lang === 'en' ? systemPromptEn : systemPromptJa },
          { role: 'user', content: userContent },
        ],
        max_tokens: 500,
        temperature: 0.3,
      };

  const url = useDeepSeek ? DEEPSEEK_API : 'https://api.openai.com/v1/chat/completions';
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  };

  try {
    const resp = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    const data = await resp.json().catch(() => ({}));
    const raw = (data.choices?.[0]?.message?.content || '').trim();
    const fallback = lang === 'en' ? 'Thank you. We appreciate your help.' : 'ご確認のほど、よろしくお願いいたします。';
    let textJa = raw.replace(/^["']|["']$/g, '').trim() || fallback;

    // 若期望日语却输出中文，强制再生成一次（更严格约束）
    if (lang === 'ja' && containsChinese(textJa)) {
      const strictUser = `${userContent}\n\n重要：刚才的输出包含中文字符，请你重新生成。\n要求：只输出日语（かな/カナ/漢字可，但禁止中文简体表达），不得出现任何中文字符或中文标点。`;
      const strictBody = {
        ...body,
        messages: [
          { role: 'system', content: systemPromptJa },
          { role: 'user', content: strictUser },
        ],
        temperature: 0.1,
      };
      const resp2 = await fetch(url, { method: 'POST', headers, body: JSON.stringify(strictBody) });
      const data2 = await resp2.json().catch(() => ({}));
      const raw2 = (data2.choices?.[0]?.message?.content || '').trim();
      const again = raw2.replace(/^["']|["']$/g, '').trim();
      if (again) textJa = again;
    }

    let done = false;
    let call_result;
    const lower = textJa.toLowerCase();
    if (lang === 'ja' && /ありがとう|失礼いたします|承知|かしこまりました/.test(textJa) && lastRestaurantText) {
      if (/いっぱい|満席|無理|できません/.test(lastRestaurantText)) {
        done = true;
        call_result = 'full';
      } else {
        done = true;
        call_result = 'success';
      }
    }

    if (lang === 'en' && /(thank you|thanks|goodbye|have a (nice|great) day)/i.test(textJa) && lastRestaurantText) {
      if (/(fully booked|no availability|unavailable|sold out)/i.test(lastRestaurantText)) {
        done = true;
        call_result = 'full';
      } else {
        done = true;
        call_result = 'success';
      }
    }

    return { text_ja: textJa, done: done, call_result };
  } catch (e) {
    console.error('[aiDialogue] getNextAiReply error', e.message);
    return {
      text_ja: lang === 'en' ? 'Sorry, there was a connection issue.' : '申し訳ございません。通信に問題が発生しました。',
      done: true,
    };
  }
}
