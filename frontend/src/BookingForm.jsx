import { useState } from 'react';

export function BookingForm({ onSubmit, apiBase }) {
  const [loading, setLoading] = useState(false);
  const [restaurantName, setRestaurantName] = useState('');
  const [restaurantPhone, setRestaurantPhone] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [searchUrl, setSearchUrl] = useState('');

  const [bookingDate, setBookingDate] = useState('');
  const [bookingTime, setBookingTime] = useState('');
  const [partySize, setPartySize] = useState('2');
  const [flexibleHour, setFlexibleHour] = useState(true);
  const [wantSetMeal, setWantSetMeal] = useState(true);
  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [contactRegion, setContactRegion] = useState('cn');
  const [error, setError] = useState('');

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
      const data = await res.json();
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
    setSearchResults([]);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!restaurantPhone.trim()) {
      setError('请填写餐厅电话（可通过上方店名搜索后点选结果自动填充）');
      return;
    }
    if (!bookingDate || !bookingTime) {
      setError('请选择预约日期与时间');
      return;
    }
    if (!contactName.trim() || !contactPhone.trim()) {
      setError('请填写联系人姓名与手机号');
      return;
    }
    setLoading(true);
    try {
      await onSubmit({
        restaurant_name: restaurantName.trim() || null,
        restaurant_phone: restaurantPhone.trim().replace(/\s/g, ''),
        booking_date: bookingDate,
        booking_time: bookingTime,
        party_size: parseInt(partySize, 10) || 2,
        flexible_hour: flexibleHour,
        want_set_meal: wantSetMeal,
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
              onChange={(e) => { setRestaurantName(e.target.value); setSearchError(''); }}
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
          <label>餐厅电话（必填）</label>
          <input
            type="tel"
            placeholder="例：03-1234-5678；也可通过上方店名搜索点选结果自动填充"
            value={restaurantPhone}
            onChange={(e) => setRestaurantPhone(e.target.value)}
          />
        </div>
      </div>

      <div className="card">
        <h2>预约信息</h2>
        <div className="form-row">
          <label>预约日期</label>
          <input
            type="date"
            value={bookingDate}
            onChange={(e) => setBookingDate(e.target.value)}
            min={today}
            required
          />
        </div>
        <div className="form-row">
          <label>预约时间</label>
          <input
            type="time"
            value={bookingTime}
            onChange={(e) => setBookingTime(e.target.value)}
            required
          />
        </div>
        <div className="form-row">
          <label>人数</label>
          <select value={partySize} onChange={(e) => setPartySize(e.target.value)}>
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
              <option key={n} value={n}>{n} 人</option>
            ))}
          </select>
        </div>
        <div className="check-row">
          <input
            type="checkbox"
            id="flex"
            checked={flexibleHour}
            onChange={(e) => setFlexibleHour(e.target.checked)}
          />
          <label htmlFor="flex">该时间无法预约时，允许前后 1 小时内调整</label>
        </div>
        <div className="check-row">
          <input
            type="checkbox"
            id="setmeal"
            checked={wantSetMeal}
            onChange={(e) => setWantSetMeal(e.target.checked)}
          />
          <label htmlFor="setmeal">如需提前选套餐，请 AI 沟通预留该店最受欢迎套餐</label>
        </div>
      </div>

      <div className="card">
        <h2>联系人信息</h2>
        <div className="form-row">
          <label>您的姓名</label>
          <input
            type="text"
            placeholder="预约使用的姓名"
            value={contactName}
            onChange={(e) => setContactName(e.target.value)}
            required
          />
        </div>
        <div className="form-row">
          <label>手机号地区</label>
          <select value={contactRegion} onChange={(e) => setContactRegion(e.target.value)}>
            <option value="cn">中国 (+86)</option>
            <option value="jp">日本 (+81)</option>
          </select>
        </div>
        <div className="form-row">
          <label>手机号（用于接收预约结果短信）</label>
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
