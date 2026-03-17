/**
 * 米其林指南爬虫：尝试从 guide.michelin.com 获取星级/必比登餐厅。
 * 注意：米其林站点可能为 SPA，fetch 仅能拿到首屏 HTML，若为空则回退到 Wikidata。
 */
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const MICHELIN_REGIONS = {
  tokyo: { jp: 'tokyo-region/tokyo', en: 'tokyo-region/tokyo' },
  osaka: { jp: 'kansai/osaka', en: 'kansai/osaka' },
  kyoto: { jp: 'kansai/kyoto', en: 'kansai/kyoto' },
};

async function fetchHtml(url) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html', 'Accept-Language': 'ja,en;q=0.9' },
      signal: controller.signal,
    });
    clearTimeout(t);
    return res.ok ? await res.text() : null;
  } catch {
    clearTimeout(t);
    return null;
  }
}

/**
 * 从米其林 HTML 提取餐厅链接（若为 SPA 可能为空）
 */
function extractRestaurantLinks(html, baseUrl) {
  const links = new Set();
  const re = /href=["'](\/jp\/[a-z]+\/[^"']*\/restaurant\/[^"']+)["']/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const path = m[1];
    if (path && !path.includes('#')) links.add('https://guide.michelin.com' + path);
  }
  return [...links];
}

/**
 * 从详情页提取电话、地址
 */
function extractDetail(html) {
  const out = { phone: '', address: '' };
  const phoneRe = /(?:電話|TEL|tel|phone)[\s:：]*([0-9\-+\(\)\s]{10,25})/i;
  const m1 = html.match(phoneRe);
  if (m1) out.phone = (m1[1] || '').replace(/\s/g, '').trim();
  const addrRe = /(?:住所|address)[\s:：]*([^\n<"']{10,100}[都道府県][^\n<"']{5,80})/i;
  const m2 = html.match(addrRe);
  if (m2) out.address = (m2[1] || '').trim();
  return out;
}

/**
 * 爬取米其林某区域餐厅（可能因 SPA 返回空，需配合 Tabelog 使用）
 */
export async function crawlMichelinRegion(cityKey, limit = 10) {
  const region = MICHELIN_REGIONS[cityKey];
  if (!region) return [];

  const url = `https://guide.michelin.com/jp/ja/${region.jp}/restaurants`;
  const html = await fetchHtml(url);
  if (!html) return [];

  const links = extractRestaurantLinks(html, url);
  const results = [];
  const delay = (ms) => new Promise((r) => setTimeout(r, ms));

  for (const link of links.slice(0, limit)) {
    await delay(4000);
    const detailHtml = await fetchHtml(link);
    if (!detailHtml) continue;
    const detail = extractDetail(detailHtml);
    const nameMatch = link.match(/\/restaurant\/([^/]+)\/?$/);
    const name = nameMatch ? decodeURIComponent(nameMatch[1]).replace(/-/g, ' ') : '';
    if (!name || (!detail.phone && !detail.address)) continue;
    results.push({
      name,
      phone: detail.phone,
      address: detail.address,
      cityKey,
      call_lang: 'ja',
      feature: '米其林指南',
    });
  }
  return results;
}
