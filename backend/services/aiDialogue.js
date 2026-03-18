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
重要规则（固定策略）：
- 若对方提到需要「予約金／デポジット／事前決済／前払い」等预付费用：请你请求对方将线上支付链接发送到订单中的「连络先（SMS等）」号码；并说明国际顾客线上支付可能不便，礼貌询问是否可以通融「到店支付／当日支払い／店頭決済」。不要编造支付链接或金额。

请根据当前对话历史与对方最新回复，生成你方下一句日语回复（简短礼貌）。
若对方已明确表示「可以预约」「承知しました」「かしこまりました」等，则回复感谢并结束。
若对方表示「满席」「いっぱい」「その時間は無理」等，则礼貌结束。
若对方在询问细节，则用日语简要确认订单内容。
只输出一句日语，不要中文、不要解释。`;

  const systemPromptEn = `You are an AI assistant calling a restaurant to make a reservation on behalf of a customer.
Order details: ${orderCtx}

Important: your reply must be ONLY in English. It will be used for English TTS playback.
If the restaurant asks for the customer's phone number (e.g., where to send a payment link), you MUST answer with the provided contact phone from the order details. Never output placeholders like "[insert ...]".
Fixed policy:
- If the restaurant says a reservation deposit / prepayment is required, ask them to send the online payment link to the contact phone in the order details, and politely request whether, since this is an international guest, it would be possible to pay in person at the restaurant instead. Do NOT invent payment links or amounts.

Generate the next polite reply based on the dialogue history and the restaurant's latest response.
If the restaurant clearly confirms the reservation, thank them and end the call.
If they say it's fully booked or unavailable, politely end the call.
If they ask for details, confirm the reservation details briefly.
Output only English, no explanations.`;

  const firstMessageInstructionJa = `请根据上述订单信息，生成电话接通后的「首句」日语开场白，要求：
1. 先有自然问候（如 お電話ありがとうございます、お忙しいところ失礼します 等），再说明是代客预约。
2. 必须包含：第一希望日期与时间；若订单有第二希望则说明第二希望日期时间；人数（大人・儿童分开写若有儿童）；若订单有饮食注意/忌口则用日语说明；若订单有其他备注则简要说明；结尾礼貌语（如 よろしくお願いいたします）。
3. 语气自然、适合电话朗读，可分成 2～4 句，整段全部为日语。`;

  const firstMessageInstructionEn = `Create the English opening message after the call is answered (2-4 sentences):
1) Start with a natural greeting and brief introduction (calling on behalf of a customer).
2) Must include: first choice date/time; second choice if provided; party size (adults/children); dietary restrictions if any; other remarks if any.
3) If mentioning contact details, use the provided contact phone from the order details (do NOT use placeholders).
4) End politely (e.g., Thank you, we appreciate your help.). Output ONLY English.`;

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
