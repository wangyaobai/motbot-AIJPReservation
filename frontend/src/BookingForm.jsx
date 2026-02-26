import { useState } from 'react';
import { useAuth } from './context/AuthContext';

export function BookingForm({ onSubmit, apiBase }) {
  const { safeResJson } = useAuth();
  const [loading, setLoading] = useState(false);
  const [restaurantName, setRestaurantName] = useState('');
  const [restaurantPhone, setRestaurantPhone] = useState('');
  const [restaurantAddress, setRestaurantAddress] = useState('');
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
  const [adultCount, setAdultCount] = useState(1);
  const [childCount, setChildCount] = useState(0);
  const [dietaryNotes, setDietaryNotes] = useState('');
  const [bookingRemark, setBookingRemark] = useState('如需提前选套餐，请 AI 沟通预留该店最受欢迎套餐');
  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [contactRegion, setContactRegion] = useState('cn');
  const [error, setError] = useState('');

  const HOURS = Array.from({ length: 24 }, (_, i) => i);
  const MINUTES = [0, 10, 20, 30, 40, 50];
  const toTimeStr = (h, m) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;

  const doSearch = async () => {
    const q = restaurantName.trim();
    if (!q) {
      setSearchError('请先输入餐厅名称');
      return;
    }
    setSearchError('');
    setSearching(true);
    setSearchResults([]);
    setSearchUrl('');
    try {
      const res = await fetch(`${apiBase}/search/restaurant?q=${encodeURIComponent(q)}`);
      const data = await safeResJson(res);
      setSearchResults(data.places || []);
      if (data.searchUrl) setSearchUrl(data.searchUrl);
      if (data.message) setSearchError(data.message);
    } catch {
      setSearchResults([]);
      setSearchError('网络搜索失败，请直接填写下方餐厅电话');
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
      setError('请填写餐厅电话（可通过上方店名搜索后点选结果自动填充）');
      return;
    }
    if (!bookingDate) {
      setError('请选择第一希望预约日期');
      return;
    }
    if (adultCount + childCount < 1) {
      setError('成人或儿童至少填写 1 人');
      return;
    }
    if (!bookingRemark.trim()) {
      setError('请填写预约备注');
      return;
    }
    if (!contactName.trim() || !contactPhone.trim()) {
      setError('请填写预约人与手机号');
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
      });
    } catch (err) {
      setError(err.message || '提交失败');
    } finally {
      setLoading(false);
    }
  };

  const today = new Date().toISOString().slice(0, 10);
  const Required = () => <span className="label-required">*</span>;

  return (
    <form onSubmit={handleSubmit} className="booking-form">
      <div className="card">
        <h2>目标餐厅</h2>
        <div className="form-row">
          <label>餐厅名称</label>
          <div className="restaurant-name-row">
            <input
              type="text"
              placeholder="输入日本餐厅店名"
              value={restaurantName}
              onChange={(e) => { setRestaurantName(e.target.value); setSearchError(''); setRestaurantAddress(''); }}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), doSearch())}
            />
            <button type="button" className="btn-search" onClick={doSearch} disabled={searching}>
              {searching ? '搜索中…' : '搜索'}
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
                        打开链接
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {searchUrl && searchResults.length === 0 && (
            <div className="search-url-box">
              <p className="search-url-hint">未解析到电话，可在浏览器中搜索后把找到的电话填到下方「餐厅电话」</p>
              <a href={searchUrl} target="_blank" rel="noopener noreferrer" className="btn-open-search">
                在浏览器中打开搜索
              </a>
            </div>
          )}
        </div>
        <div className="form-row">
          <label>餐厅电话 <Required /></label>
          <input
            type="tel"
            placeholder="例：03-1234-5678；也可通过上方店名搜索点选结果自动填充"
            value={restaurantPhone}
            onChange={(e) => { setRestaurantPhone(e.target.value); setRestaurantAddress(''); }}
          />
        </div>
      </div>

      <div className="card">
        <h2>预约信息</h2>
        <div className="booking-time-row">
          <div className="booking-slot">
            <label>第一希望预约时间 <Required /></label>
            <div className="slot-fields">
              <input
                type="date"
                value={bookingDate}
                onChange={(e) => setBookingDate(e.target.value)}
                min={today}
                required
                aria-label="第一希望日期"
              />
              <select value={bookingTimeHour} onChange={(e) => setBookingTimeHour(e.target.value)} aria-label="时">
                {HOURS.map((h) => (
                  <option key={h} value={h}>{h} 时</option>
                ))}
              </select>
              <select value={bookingTimeMinute} onChange={(e) => setBookingTimeMinute(e.target.value)} aria-label="分">
                {MINUTES.map((m) => (
                  <option key={m} value={m}>{String(m).padStart(2, '0')} 分</option>
                ))}
              </select>
            </div>
          </div>
          <div className="booking-slot">
            <label>第二希望预约时间</label>
            <div className="slot-fields">
              <input
                type="date"
                value={secondBookingDate}
                onChange={(e) => setSecondBookingDate(e.target.value)}
                min={today}
                aria-label="第二希望日期"
              />
              <select value={secondTimeHour} onChange={(e) => setSecondTimeHour(e.target.value)} aria-label="时">
                {HOURS.map((h) => (
                  <option key={h} value={h}>{h} 时</option>
                ))}
              </select>
              <select value={secondTimeMinute} onChange={(e) => setSecondTimeMinute(e.target.value)} aria-label="分">
                {MINUTES.map((m) => (
                  <option key={m} value={m}>{String(m).padStart(2, '0')} 分</option>
                ))}
              </select>
            </div>
          </div>
        </div>
        <div className="form-row party-row party-row-inline">
          <div className="party-field">
            <label>成人人数 <Required /></label>
            <input
              type="number"
              min={0}
              max={20}
              value={adultCount}
              onChange={(e) => setAdultCount(Math.max(0, parseInt(e.target.value, 10) || 0))}
            />
          </div>
          <div className="party-field">
            <label>儿童人数 <Required /></label>
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
          <label>饮食注意（过敏食材、忌口、宗教饮食限制等）</label>
          <textarea
            placeholder="请详细填写，无则留空"
            value={dietaryNotes}
            onChange={(e) => setDietaryNotes(e.target.value)}
            rows={3}
          />
        </div>
        <div className="form-row">
          <label>预约备注 <Required /></label>
          <textarea
            placeholder="如需提前选套餐，请 AI 沟通预留该店最受欢迎套餐"
            value={bookingRemark}
            onChange={(e) => setBookingRemark(e.target.value)}
            rows={2}
          />
        </div>
      </div>

      <div className="card">
        <h2>联系人信息</h2>
        <div className="form-row">
          <label>预约人 <Required /></label>
          <input
            type="text"
            placeholder="预约使用的姓名"
            value={contactName}
            onChange={(e) => setContactName(e.target.value)}
            required
          />
        </div>
        <div className="form-row">
          <label>手机号地区 <Required /></label>
          <select value={contactRegion} onChange={(e) => setContactRegion(e.target.value)}>
            <option value="cn">中国 (+86)</option>
            <option value="jp">日本 (+81)</option>
          </select>
        </div>
        <div className="form-row">
          <label>手机号（用于接收预约结果短信） <Required /></label>
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
        {loading ? '提交中…' : '帮我订'}
      </button>
    </form>
  );
}
