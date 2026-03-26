/**
 * 多轮 AI 对话：根据订单信息与历史记录，生成下一句日语回复（供 TTS 播放）。
 * 使用 DeepSeek，若无则退回到 OpenAI。
 */

const DEEPSEEK_API = 'https://api.deepseek.com/chat/completions';
const OPENAI_MODEL = 'gpt-4o-mini';
const MAX_TOKENS = parseInt(process.env.AI_MAX_TOKENS, 10) || 50;

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

  const restaurantName = (order.restaurant_name || '').toString().trim();
  if (l === 'en') {
    if (restaurantName) parts.push(`Restaurant: ${restaurantName}`);
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
  if (restaurantName) parts.push(`店名：${restaurantName}`);
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
 * DeepSeek 流式请求，收集完整回复。可减少首 token 延迟，总时长略优。
 */
async function fetchDeepSeekStream(url, headers, body, signal) {
  const resp = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ ...body, stream: true }),
    signal,
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let fullContent = '';
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6).trim();
        if (data === '[DONE]') return fullContent.trim();
        try {
          const json = JSON.parse(data);
          const delta = json.choices?.[0]?.delta?.content;
          if (delta) fullContent += delta;
        } catch {}
      }
    }
  }
  return fullContent.trim();
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
  const preferOpenAI = process.env.AI_USE_OPENAI === '1';
  const useDeepSeek = !preferOpenAI && !!process.env.DEEPSEEK_API_KEY;
  const apiKey = useDeepSeek ? process.env.DEEPSEEK_API_KEY : process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return lang === 'en'
      ? { text_ja: 'Sorry, the system is not ready at the moment.', done: true }
      : { text_ja: '申し訳ございません。ただいまシステムの準備ができておりません。', done: true };
  }

  const orderCtx = buildOrderContext(order, lang);

  const maxHistory = parseInt(process.env.AI_MAX_HISTORY_TURNS, 10) || 2;
  const recentRecords = callRecords.length > maxHistory * 2
    ? callRecords.slice(-maxHistory * 2)
    : callRecords;
  let historyStr = '';
  if (recentRecords.length > 0) {
    historyStr = recentRecords
      .map((r) => (r.role === 'ai' ? `AI: ${r.text_ja}` : `店: ${r.text_ja}`))
      .join('\n');
  }

  const systemPromptJa = `代客预约日本餐厅的AI。用日语通话。回复必须全日语、1～2句、简短。
订单：${orderCtx}

规则：
1. 首句：确认店名「○○でございますか？」→自介是代客预约→第一希望日期时间人数。不提第二希望/饮食/套餐。
2. 满席→提第二希望。时间OK→说饮食禁忌（若有）。套餐→默认店推荐或按备注。
3. 预付→争取到店支付；不行→请发链接到连络电话。不编造金额链接。
4. 时间弹性：不主动提。餐厅提其他时间→±1小时内接受，超出礼貌拒绝。
5. 身份：始终代客预约方，非餐厅员工。时间不合→礼貌结束。不切换身份。
6. 成功判定：对方明确肯定（かしこまりました/承知/予約できました/オッケー/大丈夫/よろしく等）→感谢结束。模糊回应（検討します/後で連絡等）→请求确认。

只输出一句日语。`;

  const systemPromptEn = `AI booking agent calling a restaurant for a customer. Reply in English only, 1-2 sentences.
Order: ${orderCtx}

Rules:
1. Opening: confirm restaurant name → introduce as customer's booking agent → first choice date/time/party size. No second choice/dietary/menu yet.
2. Full → offer second choice. Time OK → mention dietary restrictions if any. Menu → default restaurant's recommended or per remarks.
3. Deposit → try pay at restaurant; if not, ask SMS payment link to contact phone. Don't invent amounts/links.
4. Time flexibility: don't mention proactively. Restaurant suggests other time → accept if ±1 hour, else politely decline.
5. Identity: always customer's agent, never restaurant staff. Time mismatch → politely end call.
6. Success: only on explicit confirmation (sure/ok/confirmed/reserved/no problem) → thank and end. Ambiguous → ask to confirm.

Output only English.`;

  const firstMessageInstructionJa = `请根据上述订单信息，生成电话接通后的「首句」日语开场白，要求：
1. 先自然问候（如 お電話ありがとうございます）。
2. 先确认餐厅名字（如「○○でございますか？」），再说明：お客様のご予約を代行してお電話しております（帮客人预约）。
3. 再说第一希望日期、时间、人数。不要提第二希望、饮食、套餐等。
4. 简短礼貌，2～3 句，全部日语。`;

  const firstMessageInstructionEn = `Create the English opening message after the call is answered. Requirements:
1) Natural greeting.
2) First confirm the restaurant name (e.g. "Is this [restaurant name]?"), then state you are calling to help a customer make a reservation.
3) Include first choice date, time, and party size. Do NOT mention second choice, dietary, or menu.
4) Keep it short and polite, 2-3 sentences. Output ONLY English.`;

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
        max_tokens: MAX_TOKENS,
        temperature: 0.1,
      }
    : {
        model: OPENAI_MODEL,
        messages: [
          { role: 'system', content: lang === 'en' ? systemPromptEn : systemPromptJa },
          { role: 'user', content: userContent },
        ],
        max_tokens: MAX_TOKENS,
        temperature: 0.1,
      };

  const url = useDeepSeek ? DEEPSEEK_API : 'https://api.openai.com/v1/chat/completions';
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  };
  const timeoutMs = parseInt(process.env.AI_REQUEST_TIMEOUT_MS, 10) || 15000;

  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), timeoutMs);
    let raw;
    const useStream = useDeepSeek && process.env.AI_STREAM !== '0';
    if (useStream) {
      raw = await fetchDeepSeekStream(url, headers, body, ctrl.signal);
    } else {
      const resp = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      const data = await resp.json().catch(() => ({}));
      raw = (data.choices?.[0]?.message?.content || '').trim();
    }
    clearTimeout(to);
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
      const ctrl2 = new AbortController();
      const to2 = setTimeout(() => ctrl2.abort(), timeoutMs);
      const resp2 = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(strictBody),
        signal: ctrl2.signal,
      });
      clearTimeout(to2);
      const data2 = await resp2.json().catch(() => ({}));
      const raw2 = (data2.choices?.[0]?.message?.content || '').trim();
      const again = raw2.replace(/^["']|["']$/g, '').trim();
      if (again) textJa = again;
    }

    let done = false;
    let call_result;
    const lastText = (lastRestaurantText || '').trim();
    const hasFull = lang === 'ja' ? /いっぱい|満席|無理|できません/.test(lastText) : /(fully booked|no availability|unavailable|sold out)/i.test(lastText);
    const hasPositive = lang === 'ja'
      ? /かしこまりました|承知しました|予約できました|オッケー|大丈夫です|承知|了解|はい.*大丈夫|^はい$|^オッケー$|よろしくお願い|お待ちして|お取りできます|ご予約承り|お席.*ご用意|お願いします|お待ちいたし|お受けできます|ご用意いたし|お取りいたし/i.test(lastText)
      : /(sure|ok|confirmed|reserved|yes|alright|no problem|sounds good|we can do that)/i.test(lastText);
    const aiEnding = lang === 'ja'
      ? /ありがとう|失礼いたします|承知|かしこまりました/.test(textJa)
      : /(thank you|thanks|goodbye|have a (nice|great) day)/i.test(textJa);

    if (aiEnding && lastText) {
      if (hasFull) {
        done = true;
        call_result = 'full';
      } else if (hasPositive) {
        done = true;
        call_result = 'success';
      } else {
        done = true;
        call_result = 'retry';
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
