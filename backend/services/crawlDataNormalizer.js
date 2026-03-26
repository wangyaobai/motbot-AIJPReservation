/**
 * 爬虫结果字段规范化（与前端展示对齐），及可选 DeepSeek 文案兜底。
 * 字段：recommend_reason（与 feature 同步）、review_snippet、source_platform、data_sources
 */

const DEEPSEEK_API = 'https://api.deepseek.com/chat/completions';

/**
 * @param {object} r - 单条餐厅
 * @returns {object}
 */
export function normalizeCrawledRestaurantRow(r) {
  if (!r || typeof r !== 'object') return r;
  const platform =
    r.source_platform ||
    (r.source === 'michelin'
      ? 'wikidata_michelin'
      : r.source === 'tabelog'
        ? 'tabelog'
        : r.source === 'google'
          ? 'google'
          : 'osm');
  const reason = String(r.recommend_reason || r.feature || '').trim();
  const feature = String(r.feature || reason).trim();
  const sources = Array.isArray(r.data_sources) && r.data_sources.length
    ? r.data_sources
    : [
        platform === 'wikidata_michelin'
          ? 'Wikidata·米其林'
          : platform === 'tabelog'
            ? 'Tabelog'
            : platform === 'google'
              ? 'Google Places'
              : 'OpenStreetMap',
      ];

  return {
    ...r,
    feature: feature || r.feature,
    recommend_reason: reason || feature,
    review_snippet: String(r.review_snippet || '').trim(),
    rating_summary: String(r.rating_summary || '').trim(),
    source_platform: platform,
    data_sources: sources,
  };
}

export function normalizeCrawledList(list) {
  const arr = Array.isArray(list) ? list : [];
  return arr.map((r) => normalizeCrawledRestaurantRow(r));
}

/**
 * 用 DeepSeek 为每条生成简短推荐理由与一句评价摘要（基于已有结构化字段，不编造电话地址）。
 */
export async function refineCrawledListWithDeepSeek(restaurants, cityZh) {
  if (process.env.CRAWLER_DEEPSEEK_REFINE !== '1') {
    return restaurants;
  }
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    console.warn('[crawlDataNormalizer] DeepSeek 兜底已开启(CRAWLER_DEEPSEEK_REFINE=1)但未配置 DEEPSEEK_API_KEY，跳过');
    return restaurants;
  }
  if (!Array.isArray(restaurants) || restaurants.length === 0) return restaurants;

  const slice = restaurants.slice(0, 20);
  const compact = slice.map((r, i) => ({
    i,
    name: r.name,
    source_platform: r.source_platform,
    address: (r.address || '').slice(0, 120),
    opening_hours: (r.opening_hours || '').slice(0, 200),
    feature: (r.feature || '').slice(0, 200),
  }));

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 60000);
  try {
    const prompt = `你是日本餐饮数据编辑。城市：${cityZh}。以下 JSON 数组每项是一家餐厅已有字段。请为每项输出 JSON 数组（与输入同长度、同顺序），每项仅含字段：recommend_reason（中文20字内推荐语，可结合来源类型）、review_snippet（中文一句15字内“氛围/适合人群”类描述，勿编造具体评分数字）。不要编造电话地址。若信息不足可写简短通用语。\n输入：${JSON.stringify(compact)}`;

    const res = await fetch(DEEPSEEK_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 2000,
        temperature: 0.3,
      }),
      signal: controller.signal,
    });
    clearTimeout(t);
    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      console.warn('[crawlDataNormalizer] DeepSeek refine HTTP', res.status, errBody.slice(0, 200));
      return restaurants;
    }
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content?.trim() || '';
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      console.warn('[crawlDataNormalizer] DeepSeek 返回中未解析到 JSON 数组，跳过兜底。原文片段:', text.slice(0, 160));
      return restaurants;
    }
    let parsed;
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch (pe) {
      console.warn('[crawlDataNormalizer] DeepSeek JSON 解析失败', pe?.message);
      return restaurants;
    }
    if (!Array.isArray(parsed)) return restaurants;

    const out = restaurants.map((r, idx) => {
      if (idx >= slice.length) return normalizeCrawledRestaurantRow(r);
      const patch = parsed[idx];
      if (!patch || typeof patch !== 'object') return normalizeCrawledRestaurantRow(r);
      return normalizeCrawledRestaurantRow({
        ...r,
        recommend_reason: String(patch.recommend_reason || r.recommend_reason || r.feature || '').trim() || r.feature,
        feature: String(patch.recommend_reason || r.feature || '').trim() || r.feature,
        review_snippet: String(patch.review_snippet || r.review_snippet || '').trim(),
      });
    });
    let withSnippet = 0;
    for (let i = 0; i < Math.min(slice.length, parsed.length); i++) {
      const p = parsed[i];
      if (p && String(p.review_snippet || '').trim()) withSnippet += 1;
    }
    console.log(
      `[crawlDataNormalizer] DeepSeek 兜底 ${cityZh}: 处理前 ${slice.length} 条，写入评价摘要约 ${withSnippet} 条（全表 ${restaurants.length} 条）`,
    );
    return out;
  } catch (e) {
    clearTimeout(t);
    console.warn('[crawlDataNormalizer] DeepSeek refine', e?.message);
    return restaurants;
  }
}
