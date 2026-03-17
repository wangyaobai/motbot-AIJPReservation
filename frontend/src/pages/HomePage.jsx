import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { TitleBar } from '../components/TitleBar';
import { useUiLang } from '../context/UiLangContext';
import { useAuth } from '../context/AuthContext';
import { useTranslate, hasCJK } from '../hooks/useTranslate';

const FALLBACK_IMAGE = 'https://images.pexels.com/photos/4106483/pexels-photo-4106483.jpeg';
const STORAGE_KEY_PREFIX = 'home_reco_cache_v3_';

/** 与后端一致：兜底图不展示给用户，只显示有封面图的餐厅 */
function isFallbackImage(url) {
  const u = String(url || '').trim();
  return !u || u.includes('images.pexels.com/photos/4106483/');
}

const enOrDash = (val) => (val && hasCJK(val) ? '—' : val || '');
/** 英文模式下推荐卡片用：有翻译用翻译，否则无 CJK 用原文，否则 "—"，绝不显示中文 */
const cardEn = (raw, translatedVal) => {
  if (translatedVal && !hasCJK(translatedVal)) return translatedVal;
  if (raw && !hasCJK(raw)) return raw;
  return '—';
};
/** 英文模式最终兜底：若仍含中日文则显示 — */
const safeEn = (val) => (val && hasCJK(val) ? '—' : (val || ''));
const enName = (r) => {
  const nameEn = r.name_en || r.nameEn;
  if (nameEn && !hasCJK(nameEn)) return nameEn;
  const inParens = r.name && r.name.match(/\(([^)]+)\)/);
  if (inParens && !hasCJK(inParens[1])) return inParens[1];
  return hasCJK(r.name) ? '—' : (r.name || '');
};

// 热门餐厅基础数据示例：实际部署时可扩展为每个城市大量餐厅
const POPULAR_RESTAURANTS = [
  // 日本 · 东京
  {
    id: 'tokyo-saito',
    country: 'jp',
    cityKey: 'tokyo',
    city: '东京・六本木',
    cityEn: 'Roppongi, Tokyo',
    name: '鮨さいとう（Sushi Saito）',
    phone: '03-3589-4412',
    address: '東京都港区六本木1-4-5 アークヒルズサウスタワー 1F',
    addressEn: '1-4-5 Roppongi, Minato-ku, Tokyo, Ark Hills South Tower 1F',
    call_lang: 'ja',
    feature: '米其林寿司名店，吧台握寿司体验，适合庆祝纪念日。',
    featureEn: 'Michelin-star sushi counter experience, great for special occasions.',
    image: 'https://images.pexels.com/photos/3298180/pexels-photo-3298180.jpeg',
  },
  {
    id: 'tokyo-gyukatsu',
    country: 'jp',
    cityKey: 'tokyo',
    city: '东京・新宿',
    cityEn: 'Shinjuku, Tokyo',
    name: '牛かつ もと村 新宿店',
    phone: '03-3348-1234',
    address: '東京都新宿区西新宿1-2-3',
    addressEn: '1-2-3 Nishi-Shinjuku, Shinjuku-ku, Tokyo',
    call_lang: 'ja',
    feature: '人气牛排炸牛排，适合第一次来日本的游客体验。',
    featureEn: 'Famous gyukatsu (beef cutlet); a must-try for first-time visitors.',
    image: 'https://images.pexels.com/photos/4106483/pexels-photo-4106483.jpeg',
  },
  // 日本 · 大阪
  {
    id: 'osaka-yakiniku',
    country: 'jp',
    cityKey: 'osaka',
    city: '大阪・难波',
    cityEn: 'Namba, Osaka',
    name: '万福焼肉 本店',
    phone: '06-6632-1234',
    address: '大阪府大阪市中央区難波1-2-3',
    addressEn: '1-2-3 Namba, Chuo-ku, Osaka',
    call_lang: 'ja',
    feature: '和牛烧肉・包厢座位，适合家庭聚餐与朋友聚会。',
    featureEn: 'Wagyu yakiniku with private rooms; great for groups.',
    image: 'https://images.pexels.com/photos/4106483/pexels-photo-4106483.jpeg',
  },
  // 日本 · 京都
  {
    id: 'kyoto-kappo',
    country: 'jp',
    cityKey: 'kyoto',
    city: '京都・祇园',
    cityEn: 'Gion, Kyoto',
    name: '祇園 花懐石',
    phone: '075-551-5678',
    address: '京都府京都市東山区祇園町南側XXX',
    addressEn: 'Gion, Higashiyama-ku, Kyoto',
    call_lang: 'ja',
    feature: '京都怀石料理，季节食材与和风庭院，提供安静包间。',
    featureEn: 'Seasonal kaiseki in a traditional setting with quiet rooms.',
    image: 'https://images.pexels.com/photos/6287523/pexels-photo-6287523.jpeg',
  },
  // 日本 · 名古屋（示例）
  {
    id: 'nagoya-hitsumabushi',
    country: 'jp',
    cityKey: 'nagoya',
    city: '名古屋・荣',
    cityEn: 'Sakae, Nagoya',
    name: 'ひつまぶし 名古屋名物店',
    phone: '052-123-4567',
    address: '愛知県名古屋市中区栄3-4-5',
    addressEn: '3-4-5 Sakae, Naka-ku, Nagoya, Aichi',
    call_lang: 'ja',
    feature: '名古屋鳗鱼饭代表店，适合第一次来名古屋的游客体验当地特色。',
    featureEn: 'Signature hitsumabushi eel bowl; classic Nagoya specialty.',
    image: 'https://images.pexels.com/photos/3298180/pexels-photo-3298180.jpeg',
  },
  // 日本 · 北海道（示例）
  {
    id: 'hokkaido-crab',
    country: 'jp',
    cityKey: 'hokkaido',
    city: '札幌・北海道',
    cityEn: 'Sapporo, Hokkaido',
    name: 'かに料理 北海道本店',
    phone: '011-234-5678',
    address: '北海道札幌市中央区南4条西2丁目',
    addressEn: 'Minami 4-jo Nishi 2-chome, Chuo-ku, Sapporo, Hokkaido',
    call_lang: 'ja',
    feature: '专做帝王蟹与螃蟹锅的老字号，非常适合冬季旅行聚餐。',
    featureEn: 'Crab specialist (king crab & hot pot), perfect for winter trips.',
    image: 'https://images.pexels.com/photos/5409001/pexels-photo-5409001.jpeg',
  },
  // 日本 · 神户（示例）
  {
    id: 'kobe-steak',
    country: 'jp',
    cityKey: 'kobe',
    city: '神户・三宫',
    cityEn: 'Sannomiya, Kobe',
    name: '神戸牛ステーキ みやこ',
    phone: '078-123-4567',
    address: '兵庫県神戸市中央区三宮町1-2-3',
    addressEn: '1-2-3 Sannomiya-cho, Chuo-ku, Kobe, Hyogo',
    call_lang: 'ja',
    feature: '主打神户牛铁板烧，提供吧台位与小包间，可庆祝纪念日。',
    featureEn: 'Kobe beef teppanyaki; counter seats and small private rooms.',
    image: 'https://images.pexels.com/photos/4106483/pexels-photo-4106483.jpeg',
  },
  // 日本 · 冲绳（示例）
  {
    id: 'okinawa-izakaya',
    country: 'jp',
    cityKey: 'okinawa',
    city: '那霸・冲绳',
    cityEn: 'Naha, Okinawa',
    name: '沖縄料理 居酒屋 海風',
    phone: '098-123-9876',
    address: '沖縄県那覇市牧志1-2-3',
    addressEn: '1-2-3 Makishi, Naha, Okinawa',
    call_lang: 'ja',
    feature: '提供海葡萄、苦瓜炒蛋等冲绳乡土料理，气氛热闹适合三五好友。',
    featureEn: 'Okinawan local dishes with a lively izakaya vibe.',
    image: 'https://images.pexels.com/photos/3298180/pexels-photo-3298180.jpeg',
  },
  // 日本 · 九州其他城市（示例）
  {
    id: 'kyushu-ramen',
    country: 'jp',
    cityKey: 'kyushu',
    city: '福冈・博多',
    cityEn: 'Hakata, Fukuoka',
    name: '博多豚骨ラーメン本店',
    phone: '092-123-4567',
    address: '福岡県福岡市博多区博多駅前1-2-3',
    addressEn: '1-2-3 Hakata-ekimae, Hakata-ku, Fukuoka',
    call_lang: 'ja',
    feature: '浓郁豚骨拉面配细面，营业到深夜，是当地人也常去的人气店。',
    featureEn: 'Rich tonkotsu ramen, open late and loved by locals.',
    image: 'https://images.pexels.com/photos/6287523/pexels-photo-6287523.jpeg',
  },
  // 日本 · 其他地区（示例）
  {
    id: 'other-onsen-ryokan',
    country: 'jp',
    cityKey: 'other',
    city: '箱根・温泉旅馆',
    cityEn: 'Hakone (Ryokan)',
    name: '箱根温泉旅館 山の庵',
    phone: '0460-12-3456',
    address: '神奈川県足柄下郡箱根町湯本XXX',
    addressEn: 'Yumoto, Hakone-machi, Kanagawa',
    call_lang: 'ja',
    feature: '带私人露天风吕的温泉旅馆，可代为预约晚餐与住宿套餐。',
    featureEn: 'Ryokan with private open-air baths; dinner/room packages available.',
    image: 'https://images.pexels.com/photos/262978/pexels-photo-262978.jpeg',
  },
  // 美国 · 洛杉矶
  {
    id: 'la-bestia',
    country: 'us',
    cityKey: 'losangeles',
    city: '洛杉矶・Arts District',
    cityEn: 'Arts District, Los Angeles',
    name: 'Bestia',
    phone: '+1-213-514-5724',
    address: '2121 E 7th Pl, Los Angeles, CA 90021, United States',
    addressEn: '2121 E 7th Pl, Los Angeles, CA 90021, United States',
    call_lang: 'en',
    feature: '热门意大利餐厅，自制腊肠与手工意面，需提前预约。',
    featureEn: 'Popular Italian spot with handmade pasta; book ahead.',
    image: 'https://images.pexels.com/photos/262978/pexels-photo-262978.jpeg',
  },
];

function loadCachedRecommendations(city) {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  try {
    const raw = window.localStorage.getItem(`${STORAGE_KEY_PREFIX}${city}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed) ? parsed : [];
    const forCity = list.filter((r) => belongsToCity(r, city));
    if (forCity.length !== list.length) return null;
    return forCity.length ? forCity : null;
  } catch {
    return null;
  }
}

function saveCachedRecommendations(city, list) {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    const forCity = Array.isArray(list) ? list.filter((r) => belongsToCity(r, city)) : [];
    window.localStorage.setItem(`${STORAGE_KEY_PREFIX}${city}`, JSON.stringify(forCity));
  } catch {
    // ignore
  }
}

function isSameRecommendationList(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const ra = a[i];
    const rb = b[i];
    if (!ra || !rb) return false;
    if (ra.id !== rb.id) return false;
    if (ra.image !== rb.image) return false;
  }
  return true;
}

// 与后端一致：福冈/博多→九州，冲绳/那霸→冲绳；含日文变体（福岡、沖縄、那覇）
const CITY_PREFIXES = {
  hokkaido: ['北海道', '札幌'],
  tokyo: ['东京', '東京'],
  osaka: ['大阪'],
  nagoya: ['名古屋'],
  kyoto: ['京都'],
  kobe: ['神户'],
  okinawa: ['冲绳', '那霸', '沖縄', '那覇'],
  kyushu: ['九州', '福冈', '福岡', '博多'],
  other: null,
};
const MAIN_8_CITY_PREFIXES = [
  '北海道', '札幌', '东京', '東京', '大阪', '名古屋', '京都', '神户',
  '冲绳', '那霸', '沖縄', '那覇',
  '九州', '福冈', '福岡', '博多',
];
function isInMain8Cities(cityStr) {
  const s = String(cityStr || '').trim();
  return MAIN_8_CITY_PREFIXES.some((p) => s.startsWith(p));
}
function belongsToCity(r, cityKey) {
  if (!r?.city) return false;
  const key = String(cityKey || '').toLowerCase();
  if (key === 'other') return !isInMain8Cities(r.city);
  const prefixes = CITY_PREFIXES[key];
  if (!prefixes) return true;
  const s = String(r.city).trim();
  return prefixes.some((p) => s.startsWith(p));
}
function filterListByCity(list, cityKey) {
  if (!Array.isArray(list)) return [];
  return list.filter((r) => belongsToCity(r, cityKey));
}
const NEED_MANUAL_IMAGE_NAMES = ['自由轩', '自由軒'];
function isNeedManualImageOnly(name) {
  const s = String(name || '').trim();
  return NEED_MANUAL_IMAGE_NAMES.some((k) => s.includes(k));
}

/** 仅在大阪展示的店名（切城时易被带出），非大阪时直接过滤 */
const OSAKA_ONLY_NAMES = ['千房'];
function isOsakaOnlyRestaurant(name) {
  const s = String(name || '').trim();
  return OSAKA_ONLY_NAMES.some((k) => s.includes(k));
}

function dedupeByIdOrName(list) {
  const seen = new Set();
  return list.filter((r) => {
    const key = (r?.id || r?.name || '').toString().trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// 日本城市标签：北海道，东京，大阪，名古屋，京都，神户，冲绳，九州，其他
const JP_CITY_TAGS = [
  { value: 'hokkaido', labelZh: '北海道', labelEn: 'Hokkaido' },
  { value: 'tokyo', labelZh: '东京', labelEn: 'Tokyo' },
  { value: 'osaka', labelZh: '大阪', labelEn: 'Osaka' },
  { value: 'nagoya', labelZh: '名古屋', labelEn: 'Nagoya' },
  { value: 'kyoto', labelZh: '京都', labelEn: 'Kyoto' },
  { value: 'kobe', labelZh: '神户', labelEn: 'Kobe' },
  { value: 'okinawa', labelZh: '冲绳', labelEn: 'Okinawa' },
  { value: 'kyushu', labelZh: '九州', labelEn: 'Kyushu' },
  { value: 'other', labelZh: '其他', labelEn: 'Others' },
];

export function HomePage() {
  const navigate = useNavigate();
  const { apiBase } = useAuth();
  const { uiLang } = useUiLang();
  const isEn = uiLang === 'en';
  const [city, setCity] = useState('tokyo');
  const [loading, setLoading] = useState(false);
  const [remote, setRemote] = useState({});
  const { translateToEn } = useTranslate(apiBase);
  const [translated, setTranslated] = useState({});
  const [failedImageIds, setFailedImageIds] = useState(() => new Set());

  useEffect(() => {
    setFailedImageIds(new Set());
  }, [city]);

  const goBookDirect = useCallback(() => {
    navigate('/book');
  }, [navigate]);

  const handleBookRestaurant = useCallback((r) => {
    navigate('/book', {
      state: {
        presetRestaurant: {
          restaurant_name: r.name,
          restaurant_phone: r.phone,
          restaurant_address: r.address,
          call_lang: r.call_lang,
        },
      },
    });
  }, [navigate]);

  const filteredRestaurants = useMemo(
    () => {
      const remoteList = remote[city];
      const raw = remoteList?.length
        ? filterListByCity(remoteList, city)
        : POPULAR_RESTAURANTS.filter((r) => r.cityKey === city);
      let list = raw.filter((r) => r && !isFallbackImage(r?.image));
      list = list.filter((r) => !isNeedManualImageOnly(r?.name));
      list = list.filter((r) => belongsToCity(r, city));
      if (city !== 'osaka') list = list.filter((r) => !isOsakaOnlyRestaurant(r?.name));
      if (city === 'other') list = list.filter((r) => !isInMain8Cities(r?.city));
      return dedupeByIdOrName(list);
    },
    [city, remote],
  );

  const cardKey = (r) => r.id || r.name || '';
  const displayRestaurants = useMemo(
    () => filteredRestaurants.filter((r) => !failedImageIds.has(cardKey(r))),
    [filteredRestaurants, failedImageIds],
  );

  // 英文模式：用中文数据直接调翻译接口，翻译结果再展示（城市、地址、亮点、店名）
  useEffect(() => {
    if (!isEn || !filteredRestaurants.length || !translateToEn) return;
    displayRestaurants.forEach((r) => {
      const id = r.id;
      const cityZh = (r.city || '').trim();
      if (cityZh) {
        translateToEn(cityZh).then((en) => { if (en && !hasCJK(en)) setTranslated((prev) => ({ ...prev, [`${id}-city`]: en })); });
      }
      const addressZh = (r.address || '').trim();
      if (addressZh) {
        translateToEn(addressZh).then((en) => { if (en && !hasCJK(en)) setTranslated((prev) => ({ ...prev, [`${id}-address`]: en })); });
      }
      const featureZh = (r.feature || '').trim();
      if (featureZh) {
        translateToEn(featureZh).then((en) => { if (en && !hasCJK(en)) setTranslated((prev) => ({ ...prev, [`${id}-feature`]: en })); });
      }
      const nameRaw = r.name_en || r.nameEn || (r.name && r.name.match(/\(([^)]+)\)/)?.[1]) || r.name;
      if (nameRaw && hasCJK(nameRaw)) {
        translateToEn(nameRaw).then((en) => { if (en && !hasCJK(en)) setTranslated((prev) => ({ ...prev, [`${id}-name`]: en })); });
      }
    });
  }, [isEn, displayRestaurants, translateToEn]);

  return (
    <div className="app">
      <TitleBar showLangToggle />
      <main className="main">
        <div className="card card-shadow" style={{ marginTop: 16, marginBottom: 16 }}>
          <h2 style={{ marginBottom: 12 }}>
            {isEn ? "Don't like the picks? Search for exactly what you want!" : '推荐的不喜欢？自己精准搜！'}
          </h2>
          <button
            type="button"
            className="btn-primary"
            style={{ padding: '10px 14px', fontSize: '0.95rem', width: '100%' }}
            onClick={goBookDirect}
          >
            {isEn ? 'Search' : '搜索'}
          </button>
        </div>

        <div className="city-tabs-wrap">
          <div className="city-tabs">
            {JP_CITY_TAGS.map((c) => {
              const active = city === c.value;
              return (
                <button
                  key={c.value}
                  type="button"
                  className={`city-chip${active ? ' active' : ''}`}
                  onClick={() => setCity(c.value)}
                >
                  {isEn ? c.labelEn : c.labelZh}
                </button>
              );
            })}
          </div>
        </div>

        <EffectLoader city={city} apiBase={apiBase} setRemote={setRemote} setLoading={setLoading} />

        {loading && (
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: '0 0 8px 2px' }}>
            {isEn ? 'Loading recommended restaurants…' : '正在获取推荐餐厅…'}
          </p>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 16 }}>
          {displayRestaurants.map((r) => {
            const key = cardKey(r);
            return (
            <article key={key} className="card card-shadow" style={{ padding: 14 }}>
              <div style={{ display: 'flex', gap: 10 }}>
                <RestaurantThumb
                  cardKey={key}
                  name={isEn ? (translated[`${r.id}-name`] ?? enName(r)) : r.name}
                  image={r.image}
                  onImageError={(k) => setFailedImageIds((prev) => new Set(prev).add(k))}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <h3 style={{ margin: '0 0 4px', fontSize: '1rem' }}>{isEn ? (translated[`${r.id}-name`] ?? enName(r)) : r.name}</h3>
                  <p style={{ margin: '0 0 6px', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                    {isEn ? (translated[`${r.id}-city`] || '—') : r.city}
                  </p>
                  <p style={{ margin: '0 0 4px', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                    {isEn ? 'Phone: ' : '电话：'}
                    {r.phone}
                  </p>
                  <p style={{ margin: '0 0 4px', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    {isEn ? 'Address: ' : '地址：'}
                    {isEn ? (translated[`${r.id}-address`] || '—') : r.address}
                  </p>
                  <p style={{ margin: '4px 0 8px', fontSize: '0.8rem', color: 'var(--text)' }}>
                    {isEn ? 'Highlights: ' : '餐厅特色：'}
                    {isEn ? (translated[`${r.id}-feature`] || '—') : r.feature}
                  </p>
                  <button
                    type="button"
                    className="btn-primary"
                    style={{ padding: '8px 10px', fontSize: '0.9rem' }}
                    onClick={() => handleBookRestaurant(r)}
                  >
                    {isEn ? 'Book this restaurant' : '预约这家餐厅'}
                  </button>
                </div>
              </div>
            </article>
          );})}
        </div>
      </main>
    </div>
  );
}

function EffectLoader({ city, apiBase, setRemote, setLoading }) {
  useEffect(() => {
    let cancelled = false;
    setRemote({ [city]: undefined });
    const fetchRecommendations = async () => {
      const cached = loadCachedRecommendations(city);
      if (!cancelled && cached && cached.length > 0) {
        const byCity = filterListByCity(cached, city);
        const onlyWithCover = byCity.filter((r) => r && !isFallbackImage(r?.image));
        setRemote({ [city]: onlyWithCover });
      }

      setLoading(true);
      try {
        const url = `${apiBase}/recommendations?country=jp&city=${encodeURIComponent(city)}`;
        const resp = await fetch(url, { cache: 'no-store' });
        const data = await resp.json().catch(() => ({}));
        if (!cancelled && data.ok && Array.isArray(data.restaurants) && data.restaurants.length > 0) {
          const byCity = filterListByCity(data.restaurants, city);
          const onlyWithCover = byCity.filter((r) => r && !isFallbackImage(r?.image));
          saveCachedRecommendations(city, onlyWithCover);
          setRemote({ [city]: onlyWithCover.length ? onlyWithCover : undefined });
        }
        // API 失败或返回空时不再把 remote 置空，保留 undefined 以使用前端兜底示例列表
      } catch {
        // 忽略错误，前端自动使用内置示例数据兜底
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchRecommendations();
    return () => { cancelled = true; };
  }, [city, apiBase, setRemote, setLoading]);
  return null;
}

function RestaurantThumb({ cardKey, name, image, onImageError }) {
  const initial = (typeof image === 'string' && image.trim()) ? image.trim() : '';
  const [src, setSrc] = useState(initial || FALLBACK_IMAGE);
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    const next = (typeof image === 'string' && image.trim()) ? image.trim() : '';
    if (!next) {
      setSrc(FALLBACK_IMAGE);
      setImageFailed(false);
      return;
    }
    setSrc(next);
    setImageFailed(false);
  }, [image]);

  const handleError = () => {
    setImageFailed(true);
    if (onImageError && cardKey) onImageError(cardKey);
  };

  return (
    <div style={{ flex: '0 0 96px' }}>
      <div
        style={{
          width: 96,
          height: 96,
          borderRadius: 10,
          overflow: 'hidden',
          position: 'relative',
          background: '#f2f2f2',
        }}
      >
        {!imageFailed ? (
          <img
            src={src}
            alt={name}
            referrerPolicy="no-referrer"
            onError={handleError}
            style={{ width: 96, height: 96, objectFit: 'cover', display: 'block' }}
          />
        ) : (
          <div style={{ width: 96, height: 96, background: '#e8e8e8', display: 'block' }} aria-hidden="true" />
        )}
      </div>
    </div>
  );
}
