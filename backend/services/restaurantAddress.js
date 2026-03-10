/**
 * 通过 DeepSeek 根据餐厅名称或电话查询日本餐厅地址。
 * 用于预约凭证页展示店铺地址。
 * 另：仅根据电话反查店铺名称+地址（用户未使用搜索直接填电话时，预约成功后补全）。
 */

const cache = new Map();
const cacheByPhone = new Map();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 小时

function cacheKey(name, phone) {
  const n = (name || '').trim().slice(0, 100);
  const p = (phone || '').replace(/\D/g, '').slice(-10);
  return `${n}|${p}`;
}

/**
 * 仅根据电话用 DeepSeek 反查日本餐厅名称与地址（用于用户直接填电话、未通过搜索时，预约成功后补全并展示在预约凭证）。
 * @param {string} restaurantPhone
 * @returns {Promise<{ name: string, address: string }>}
 */
export async function fetchRestaurantNameAndAddressByPhone(restaurantPhone) {
  const phone = (restaurantPhone || '').trim().replace(/\s/g, '');
  if (!phone) return { name: '', address: '' };

  const key = 'phone:' + phone.replace(/\D/g, '').slice(-12);
  const cached = cacheByPhone.get(key);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return { name: cached.name || '', address: cached.address || '' };
  }

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    console.warn('[restaurantAddress] DEEPSEEK_API_KEY 未配置，无法根据电话反查店铺名称与地址，请在 .env 中配置后重启');
    cacheByPhone.set(key, { name: '', address: '', fetchedAt: Date.now() });
    return { name: '', address: '' };
  }

  const digitsOnly = phone.replace(/\D/g, '');
  const isLikelyJapan = /^\+?81/.test(phone.replace(/\s/g, '')) || (digitsOnly.length >= 9 && digitsOnly.length <= 11 && /^0/.test(digitsOnly));
  const prompt = isLikelyJapan ? `你是一个日本商户信息查询助手。请根据「仅且唯一」的以下电话号码，返回「官方登记为该号码」的那一家店铺的名称与地址。

重要：必须返回「该电话号码实际所属」的店铺，不要返回其他店铺。例如号码 06-6353-9995 对应的是「寿司处 まえ田」，不要误答成「大阪王将」等其它店铺。若你的知识库中该号码对应的是小众店、寿司店等，就返回该店；不要用知名连锁店替代。

电话号码（日本）：${phone}
数字部分：${digitsOnly}

严格只输出两行纯文本，不要任何前缀、标号或说明：
第1行：店铺名称（仅日文店名）
第2行：详细地址（日本格式：〒邮编、都道府県、市区町村等）
若无法确定该号码对应哪家店，两行都写「—」。`
  : `你是一个餐厅信息查询助手。请根据「仅且唯一」的以下电话号码，返回「官方登记为该号码」的那一家餐厅/门店的名称与详细地址。

重要：
- 只返回这个电话号码“实际所属”的实体（门店/办公室/集团等），不要猜测其他店。
- 如果该号码看起来是集团办公室/总部电话，也照实返回其名称与地址，不要硬凑门店。

电话号码：${phone}
数字部分：${digitsOnly}

严格只输出两行纯文本，不要任何前缀、标号或说明：
第1行：名称（可英文/当地语言）
第2行：详细地址（街道门牌 + 城市 + 州/省 + 邮编 + 国家/地区，尽量完整）
若无法确定，两行都写「—」。`;

  try {
    const resp = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 300,
        temperature: 0.1,
      }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const errMsg = data.error?.message || data.message || resp.statusText;
      console.error('[restaurantAddress] DeepSeek by-phone error', resp.status, errMsg);
      cacheByPhone.set(key, { name: '', address: '', fetchedAt: Date.now() });
      return { name: '', address: '' };
    }
    if (data.error) {
      console.error('[restaurantAddress] DeepSeek API error', data.error);
      cacheByPhone.set(key, { name: '', address: '', fetchedAt: Date.now() });
      return { name: '', address: '' };
    }
    const raw = (data.choices?.[0]?.message?.content || '').trim();
    const lines = raw
      .split(/\r?\n/)
      .map((s) => s.replace(/^(第一行|第二行|店铺名称|详细地址)[：:]\s*/i, '').trim())
      .filter(Boolean);
    const name = (lines[0] || '—').slice(0, 200);
    const address = (lines[1] || '—').replace(/\n+/g, ' ').slice(0, 300);
    cacheByPhone.set(key, { name, address, fetchedAt: Date.now() });
    return { name, address };
  } catch (e) {
    console.error('[restaurantAddress] fetchRestaurantNameAndAddressByPhone', e.message, e.stack);
    cacheByPhone.set(key, { name: '', address: '', fetchedAt: Date.now() });
    return { name: '', address: '' };
  }
}

/**
 * @param {string} restaurantName
 * @param {string} restaurantPhone
 * @returns {Promise<string>} 地址字符串，失败或未配置时返回空字符串
 */
export async function fetchRestaurantAddress(restaurantName, restaurantPhone, options = {}) {
  const key = cacheKey(restaurantName, restaurantPhone);
  const cached = cache.get(key);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.address || '';
  }

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    cache.set(key, { address: '', fetchedAt: Date.now() });
    return '';
  }

  const lang = (options.lang || '').toString().toLowerCase();
  const phoneDigits = String(restaurantPhone || '').replace(/\D/g, '');
  const isLikelyJapan = lang === 'ja' || /^\+?81/.test(String(restaurantPhone || '').replace(/\s/g, '')) || (phoneDigits.length >= 9 && phoneDigits.length <= 11 && /^0/.test(phoneDigits));

  const namePart = (restaurantName || '').trim() ? `餐厅名「${String(restaurantName).trim().slice(0, 80)}」` : '';
  const phonePart = (restaurantPhone || '').trim() ? `电话 ${String(restaurantPhone).trim()}` : '';
  const prompt = isLikelyJapan
    ? `请根据以下餐厅信息，给出该餐厅的详细地址（日本格式：〒邮编、都道府県、市区町村、街道门牌等）。
${namePart} ${phonePart}
只返回地址文字，不要其他说明。若无法确定请返回空或「—」。`
    : `请根据以下餐厅信息，给出该餐厅的详细地址（尽量完整：街道门牌 + 城市 + 州/省 + 邮编 + 国家/地区）。
${namePart} ${phonePart}
只返回地址文字，不要其他说明。若无法确定请返回空或「—」。`;

  try {
    const resp = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 200,
        temperature: 0.1,
      }),
    });
    if (!resp.ok) {
      console.error('[restaurantAddress] DeepSeek error', resp.status);
      cache.set(key, { address: '', fetchedAt: Date.now() });
      return '';
    }
    const data = await resp.json();
    const address = (data.choices?.[0]?.message?.content || '').trim().replace(/\n+/g, ' ').slice(0, 300);
    cache.set(key, { address, fetchedAt: Date.now() });
    return address;
  } catch (e) {
    console.error('[restaurantAddress]', e.message);
    cache.set(key, { address: '', fetchedAt: Date.now() });
    return '';
  }
}
