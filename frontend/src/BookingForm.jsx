import { useState, useEffect } from 'react';
import { useAuth } from './context/AuthContext';
import { useUiLang } from './context/UiLangContext';

const DEFAULT_BOOKING_REMARK_ZH = '如需提前选套餐，请 AI 沟通预留该店最受欢迎套餐';
const DEFAULT_BOOKING_REMARK_EN = 'If possible, please reserve the restaurant’s most popular set/menu in advance.';

export function BookingForm({ onSubmit, apiBase, initial }) {
  const { safeResJson } = useAuth();
  const { uiLang } = useUiLang();
  const isEnUi = uiLang === 'en';
  const init = initial || {};
  const [loading, setLoading] = useState(false);
  const [restaurantName, setRestaurantName] = useState(init.restaurant_name || '');
  const [restaurantPhone, setRestaurantPhone] = useState(init.restaurant_phone || '');
  const [restaurantAddress, setRestaurantAddress] = useState(init.restaurant_address || '');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [searchUrl, setSearchUrl] = useState('');

  const [bookingDate, setBookingDate] = useState('');
  const [bookingTimeHour, setBookingTimeHour] = useState('18');
  const [bookingTimeMinute, setBookingTimeMinute] = useState('00');
  const [secondBookingDate, setSecondBookingDate] = useState('');
  const [secondTimeHour, setSecondTimeHour] = useState('19');
  const [secondTimeMinute, setSecondTimeMinute] = useState('00');
  const [adultCount, setAdultCount] = useState(init.adult_count || 1);
  const [childCount, setChildCount] = useState(0);
  const [dietaryNotes, setDietaryNotes] = useState('');
  const [bookingRemark, setBookingRemark] = useState(() => (
    isEnUi ? DEFAULT_BOOKING_REMARK_EN : DEFAULT_BOOKING_REMARK_ZH
  ));

  useEffect(() => {
    setBookingRemark((prev) => {
      if (isEnUi && prev === DEFAULT_BOOKING_REMARK_ZH) return DEFAULT_BOOKING_REMARK_EN;
      if (!isEnUi && prev === DEFAULT_BOOKING_REMARK_EN) return DEFAULT_BOOKING_REMARK_ZH;
      return prev;
    });
  }, [isEnUi]);
  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [contactRegion, setContactRegion] = useState('cn');
  const [callLang, setCallLang] = useState((init.call_lang || 'ja').toLowerCase()); // 通话语言：ja 日语 / en 英语
  const [error, setError] = useState('');

  const HOURS = Array.from({ length: 24 }, (_, i) => i);
  const MINUTES = [0, 10, 20, 30, 40, 50];
  const toTimeStr = (h, m) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;

  const doSearch = async () => {
    const q = restaurantName.trim();
    if (!q) {
      setSearchError(isEnUi ? 'Please enter a restaurant name first.' : '请先输入餐厅名称');
      return;
    }
    setSearchError('');
    setSearching(true);
    setSearchResults([]);
    setSearchUrl('');
    try {
      const res = await fetch(`${apiBase}/search/restaurant?q=${encodeURIComponent(q)}&lang=${encodeURIComponent(callLang)}`);
      const data = await safeResJson(res);
      setSearchResults(data.places || []);
      if (data.searchUrl) setSearchUrl(data.searchUrl);
      if (data.message) setSearchError(data.message);
    } catch {
      setSearchResults([]);
      setSearchError(isEnUi ? 'Search failed. Please fill in the restaurant phone number below.' : '网络搜索失败，请直接填写下方餐厅电话');
    } finally {
      setSearching(false);
    }
  };

  const pickPlace = (place) => {
    setRestaurantName(place.name || '');
    setRestaurantPhone(place.phone ? place.phone.replace(/\s/g, '') : '');
    setRestaurantAddress(place.address || '');
    setSearchResults([]);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!restaurantPhone.trim()) {
      setError(isEnUi ? 'Please fill in the restaurant phone number.' : '请填写餐厅电话（可通过上方店名搜索后点选结果自动填充）');
      return;
    }
    if (!bookingDate) {
      setError(isEnUi ? 'Please select your preferred date.' : '请选择第一希望预约日期');
      return;
    }
    if (adultCount + childCount < 1) {
      setError(isEnUi ? 'Please enter at least 1 guest.' : '成人或儿童至少填写 1 人');
      return;
    }
    if (!bookingRemark.trim()) {
      setError(isEnUi ? 'Please fill in booking notes.' : '请填写预约备注');
      return;
    }
    if (!contactName.trim() || !contactPhone.trim()) {
      setError(isEnUi ? 'Please fill in contact name and phone number.' : '请填写预约人与手机号');
      return;
    }
    setLoading(true);
    try {
      await onSubmit({
        restaurant_name: restaurantName.trim() || null,
        restaurant_phone: restaurantPhone.trim().replace(/\s/g, ''),
        restaurant_address: restaurantAddress.trim() || undefined,
        booking_date: bookingDate,
        booking_time: toTimeStr(bookingTimeHour, bookingTimeMinute),
        second_booking_date: secondBookingDate || undefined,
        second_booking_time: (secondBookingDate && toTimeStr(secondTimeHour, secondTimeMinute)) || undefined,
        adult_count: adultCount,
        child_count: childCount,
        dietary_notes: dietaryNotes.trim() || undefined,
        booking_remark: bookingRemark.trim() || undefined,
        contact_name: contactName.trim(),
        contact_phone: contactPhone.trim().replace(/\s/g, ''),
        contact_phone_region: contactRegion,
        call_lang: callLang,
      });
    } catch (err) {
      setError(err.message || '提交失败');
    } finally {
      setLoading(false);
    }
  };

  const today = new Date().toISOString().slice(0, 10);
  const Required = () => <span className="label-required">*</span>;

  const restaurantNamePlaceholder =
    callLang === 'en'
      ? (isEnUi ? 'Restaurant name (US/Europe, preferably English)' : '输入美国/欧洲餐厅店名（建议使用英文名称）')
      : (isEnUi ? 'Restaurant name (Japan)' : '输入日本餐厅店名');

  const restaurantPhonePlaceholder =
    callLang === 'en'
      ? (isEnUi ? 'e.g. +1-212-123-4567 / +44-20-1234-5678' : '例：+1-212-123-4567 / +44-20-1234-5678；也可通过上方店名搜索点选结果自动填充')
      : (isEnUi ? 'e.g. 03-1234-5678' : '例：03-1234-5678；也可通过上方店名搜索点选结果自动填充');

  return (
    <form onSubmit={handleSubmit} className="booking-form">
      <div className="card">
        <h2>{isEnUi ? 'Restaurant' : '目标餐厅'}</h2>
        <div className="form-row">
          <label>{isEnUi ? 'Restaurant name' : '餐厅名称'}</label>
          <div className="restaurant-name-row">
            <input
              type="text"
              placeholder={restaurantNamePlaceholder}
              value={restaurantName}
              onChange={(e) => { setRestaurantName(e.target.value); setSearchError(''); setRestaurantAddress(''); }}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), doSearch())}
            />
            <button type="button" className="btn-search" onClick={doSearch} disabled={searching}>
              {searching ? (isEnUi ? 'Searching…' : '搜索中…') : (isEnUi ? 'Search' : '搜索')}
            </button>
          </div>
          {searchError && <p className="form-error">{searchError}</p>}
          {searchResults.length > 0 && (
            <ul className="search-list">
              {searchResults.map((p, i) => (
                <li key={p.place_id || p.url || i}>
                  <button type="button" onClick={() => pickPlace(p)}>
                    <strong>{p.name}</strong>
                    {p.phone && <span className="phone">{p.phone}</span>}
                    {p.address && <span className="addr">{p.address}</span>}
                    {p.url && (
                      <span className="result-url" onClick={(e) => { e.stopPropagation(); window.open(p.url, '_blank'); }}>
                        {isEnUi ? 'Open link' : '打开链接'}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {searchUrl && searchResults.length === 0 && (
            <div className="search-url-box">
              <p className="search-url-hint">
                {isEnUi
                  ? 'Could not extract a phone number. Open the search page and paste the reservation phone into “Restaurant phone”.'
                  : '未解析到电话，可在浏览器中搜索后把找到的电话填到下方「餐厅电话」'}
              </p>
              <a href={searchUrl} target="_blank" rel="noopener noreferrer" className="btn-open-search">
                {isEnUi ? 'Open in browser' : '在浏览器中打开搜索'}
              </a>
            </div>
          )}
        </div>
        <div className="form-row">
          <label>{isEnUi ? 'Restaurant phone' : '餐厅电话'} <Required /></label>
          <input
            type="tel"
            placeholder={restaurantPhonePlaceholder}
            value={restaurantPhone}
            onChange={(e) => { setRestaurantPhone(e.target.value); setRestaurantAddress(''); }}
          />
        </div>
        <div className="form-row">
          <label>{isEnUi ? 'Call language / region' : '通话语言 / 国家地区'} <Required /></label>
          <select
            value={callLang}
            onChange={(e) => setCallLang(e.target.value)}
          >
            <option value="ja">{isEnUi ? 'Japan · Japanese (default)' : '日本餐厅 · 日语沟通（默认）'}</option>
            <option value="en">{isEnUi ? 'US/Europe · English' : '欧美餐厅 · 英语沟通'}</option>
          </select>
          <p style={{ marginTop: 4, fontSize: '0.8em', color: 'var(--text-muted)' }}>
            {isEnUi
              ? 'This setting controls how the AI speaks with the restaurant (Japanese or English) and affects language/timezone hints on later pages.'
              : '请选择本次预约的餐厅所在地区，系统会按此选择日语或英语与餐厅通话，并在后续预约凭证中使用对应的语言/时区说明。'}
          </p>
        </div>
      </div>

      <div className="card">
        <h2>{isEnUi ? 'Booking details' : '预约信息'}</h2>
        <div className="booking-time-row">
          <div className="booking-slot">
            <label>{isEnUi ? 'Preferred time (1st choice)' : '第一希望预约时间'} <Required /></label>
            <div className="slot-fields">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="YYYY-MM-DD"
                  value={bookingDate}
                  onChange={(e) => setBookingDate(e.target.value)}
                  required
                  aria-label={isEnUi ? 'First choice date (YYYY-MM-DD)' : '第一希望日期'}
                />
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  {isEnUi ? 'e.g. 2025-03-15' : '例：2025-03-15'}
                </span>
              </div>
              <select value={bookingTimeHour} onChange={(e) => setBookingTimeHour(e.target.value)} aria-label={isEnUi ? 'Hour' : '时'}>
                {HOURS.map((h) => (
                  <option key={h} value={h}>{isEnUi ? String(h).padStart(2, '0') : `${h} 时`}</option>
                ))}
              </select>
              <select value={bookingTimeMinute} onChange={(e) => setBookingTimeMinute(e.target.value)} aria-label={isEnUi ? 'Minute' : '分'}>
                {MINUTES.map((m) => (
                  <option key={m} value={m}>{isEnUi ? String(m).padStart(2, '0') : `${String(m).padStart(2, '0')} 分`}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="booking-slot">
            <label>{isEnUi ? 'Preferred time (2nd choice)' : '第二希望预约时间'}</label>
            <div className="slot-fields">
              <input
                type="text"
                inputMode="numeric"
                placeholder="YYYY-MM-DD"
                value={secondBookingDate}
                onChange={(e) => setSecondBookingDate(e.target.value)}
                aria-label={isEnUi ? 'Second choice date (YYYY-MM-DD)' : '第二希望日期'}
              />
              <select value={secondTimeHour} onChange={(e) => setSecondTimeHour(e.target.value)} aria-label={isEnUi ? 'Hour' : '时'}>
                {HOURS.map((h) => (
                  <option key={h} value={h}>{isEnUi ? String(h).padStart(2, '0') : `${h} 时`}</option>
                ))}
              </select>
              <select value={secondTimeMinute} onChange={(e) => setSecondTimeMinute(e.target.value)} aria-label={isEnUi ? 'Minute' : '分'}>
                {MINUTES.map((m) => (
                  <option key={m} value={m}>{isEnUi ? String(m).padStart(2, '0') : `${String(m).padStart(2, '0')} 分`}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
        <div className="form-row party-row party-row-inline">
          <div className="party-field">
            <label>{isEnUi ? 'Adults' : '成人人数'} <Required /></label>
            <input
              type="number"
              min={0}
              max={20}
              value={adultCount}
              onChange={(e) => setAdultCount(Math.max(0, parseInt(e.target.value, 10) || 0))}
            />
          </div>
          <div className="party-field">
            <label>{isEnUi ? 'Children' : '儿童人数'} <Required /></label>
            <input
              type="number"
              min={0}
              max={20}
              value={childCount}
              onChange={(e) => setChildCount(Math.max(0, parseInt(e.target.value, 10) || 0))}
            />
          </div>
        </div>
        <div className="form-row">
          <label>{isEnUi ? 'Dietary restrictions (allergies, preferences, etc.)' : '饮食注意（过敏食材、忌口、宗教饮食限制等）'}</label>
          <textarea
            placeholder={isEnUi ? 'Optional' : '请详细填写，无则留空'}
            value={dietaryNotes}
            onChange={(e) => setDietaryNotes(e.target.value)}
            rows={3}
          />
        </div>
        <div className="form-row">
          <label>{isEnUi ? 'Booking notes' : '预约备注'} <Required /></label>
          <textarea
            placeholder={isEnUi ? 'e.g. Reserve the most popular set menu; mention allergies or special requests.' : '如需提前选套餐，请 AI 沟通预留该店最受欢迎套餐'}
            value={bookingRemark}
            onChange={(e) => setBookingRemark(e.target.value)}
            rows={2}
          />
        </div>
      </div>

      <div className="card">
        <h2>{isEnUi ? 'Contact' : '联系人信息'}</h2>
        <div className="form-row">
          <label>{isEnUi ? 'Contact name' : '预约人'} <Required /></label>
          <input
            type="text"
            placeholder={isEnUi ? 'Name used for the reservation' : '预约使用的姓名'}
            value={contactName}
            onChange={(e) => setContactName(e.target.value)}
            required
          />
        </div>
        <div className="form-row">
          <label>{isEnUi ? 'Phone region' : '手机号地区'} <Required /></label>
          <select value={contactRegion} onChange={(e) => setContactRegion(e.target.value)}>
            <option value="cn">{isEnUi ? 'China (+86)' : '中国 (+86)'}</option>
            <option value="jp">{isEnUi ? 'Japan (+81)' : '日本 (+81)'}</option>
          </select>
        </div>
        <div className="form-row">
          <label>{isEnUi ? 'Phone number (SMS results)' : '手机号（用于接收预约结果短信）'} <Required /></label>
          <input
            type="tel"
            placeholder={contactRegion === 'jp' ? '090-1234-5678' : '138 0000 0000'}
            value={contactPhone}
            onChange={(e) => setContactPhone(e.target.value)}
            required
          />
        </div>
      </div>

      {error && <p className="form-error">{error}</p>}
      <button type="submit" className="btn-primary" disabled={loading}>
        {loading ? (isEnUi ? 'Submitting…' : '提交中…') : (isEnUi ? 'Submit' : '帮我订')}
      </button>
    </form>
  );
}
