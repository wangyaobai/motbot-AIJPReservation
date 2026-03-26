import { useState, useEffect, useRef } from 'react';

const FALLBACK_IMG = 'https://images.pexels.com/photos/4106483/pexels-photo-4106483.jpeg';

function sourcePlatformOf(r) {
  if (r?.source_platform) return r.source_platform;
  if (r?.source === 'michelin') return 'wikidata_michelin';
  if (r?.source === 'tabelog') return 'tabelog';
  if (r?.source === 'google') return 'google';
  return 'osm';
}

const CRAWLED_PLATFORM_FILTER_OPTS = [
  { value: 'all', label: '全部来源' },
  { value: 'wikidata_michelin', label: '米其林（Wikidata）' },
  { value: 'tabelog', label: 'Tabelog 高分' },
  { value: 'osm', label: 'OpenStreetMap' },
  { value: 'google', label: 'Google' },
];

const PLATFORM_GROUP_LABEL = {
  wikidata_michelin: '米其林 / Wikidata',
  tabelog: 'Tabelog 高评价',
  google: 'Google 补充',
  osm: 'OpenStreetMap',
};

const PLATFORM_ORDER = ['wikidata_michelin', 'tabelog', 'google', 'osm'];

function groupCrawledByPlatform(restaurants) {
  const list = Array.isArray(restaurants) ? restaurants : [];
  const map = new Map();
  for (const r of list) {
    const p = sourcePlatformOf(r);
    if (!map.has(p)) map.set(p, []);
    map.get(p).push(r);
  }
  const extra = [...map.keys()].filter((p) => !PLATFORM_ORDER.includes(p));
  const order = [...PLATFORM_ORDER, ...extra];
  return order
    .filter((p) => map.get(p)?.length)
    .map((p) => ({ platform: p, label: PLATFORM_GROUP_LABEL[p] || p, list: map.get(p) }));
}

export function AdminShops({ apiBase, adminToken }) {
  const authHeaders = (extra = {}) => ({ 'x-admin-token': adminToken || '', ...extra });
  const [subTab, setSubTab] = useState('fallback');
  const [fallbackItems, setFallbackItems] = useState([]);
  const [crawledItems, setCrawledItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [urlByKey, setUrlByKey] = useState({});
  const [addrByKey, setAddrByKey] = useState({});
  const [phoneByKey, setPhoneByKey] = useState({});
  const [savingKey, setSavingKey] = useState(null);
  const [uploadingKey, setUploadingKey] = useState(null);
  const [confirmingCity, setConfirmingCity] = useState(null);
  const [selectedIds, setSelectedIds] = useState({});
  const [backupMsg, setBackupMsg] = useState('');
  const [restoreMsg, setRestoreMsg] = useState('');
  const [restoring, setRestoring] = useState(false);
  const [crawlerStatus, setCrawlerStatus] = useState(null);
  const [crawlerRunning, setCrawlerRunning] = useState(false);
  const [crawlerMsg, setCrawlerMsg] = useState('');
  const [crawledPlatformFilter, setCrawledPlatformFilter] = useState('all');
  const fileInputRef = useRef(null);
  const fileInputKeyRef = useRef(null);

  const assertOkJson = async (res, fallbackMsg) => {
    const ct = (res.headers?.get?.('content-type') || '').toLowerCase();
    const isJson = ct.includes('application/json');
    const data = isJson ? await res.json().catch(() => ({})) : null;
    if (data?.ok) return data;
    throw new Error(data?.message || fallbackMsg || `请求失败（HTTP ${res.status}）`);
  };

  const fetchFallback = async () => {
    const res = await fetch(`${apiBase}/admin/shops/fallback`, { headers: authHeaders() });
    const data = await assertOkJson(res, '加载兜底失败');
    setFallbackItems(data.items || []);
  };

  const fetchCrawled = async () => {
    const res = await fetch(`${apiBase}/admin/shops/crawled`, { headers: authHeaders() });
    const data = await assertOkJson(res, '加载爬取失败');
    setCrawledItems(data.items || []);
  };

  const fetchCrawlerStatus = async () => {
    try {
      const res = await fetch(`${apiBase}/admin/crawler-status`, { headers: authHeaders() });
      const data = await assertOkJson(res, '');
      setCrawlerStatus(data);
      setCrawlerRunning(data.running || false);
    } catch {}
  };

  const fetchAll = async () => {
    setErr('');
    setLoading(true);
    try {
      await Promise.all([fetchFallback(), fetchCrawled(), fetchCrawlerStatus()]);
    } catch (e) {
      setErr(e.message || '加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAll(); }, [apiBase]);

  useEffect(() => {
    if (!crawlerRunning) return;
    const timer = setInterval(async () => {
      await fetchCrawlerStatus();
    }, 5000);
    return () => clearInterval(timer);
  }, [crawlerRunning]);

  const runBackup = async () => {
    setBackupMsg('');
    try {
      const res = await fetch(`${apiBase}/admin/shops/fallback/backup`, { method: 'POST', headers: authHeaders() });
      const data = await assertOkJson(res, '备份失败');
      setBackupMsg(data.message || '备份成功');
      fetchFallback();
    } catch (e) {
      setBackupMsg(e.message || '备份失败');
    }
  };

  const runRestore = async (cityKey) => {
    if (!confirm(cityKey
      ? `确认将「${cityKey}」从兜底恢复到前端展示？当前前端数据将被覆盖。`
      : '确认将所有城市从兜底恢复到前端展示？当前前端数据将被覆盖。'
    )) return;
    setRestoring(true);
    setRestoreMsg('');
    try {
      const res = await fetch(`${apiBase}/admin/shops/fallback/restore`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ cityKey: cityKey || undefined }),
      });
      const data = await assertOkJson(res, '恢复失败');
      setRestoreMsg(data.message || '恢复成功');
      fetchFallback();
    } catch (e) {
      setRestoreMsg(e.message || '恢复失败');
    } finally {
      setRestoring(false);
    }
  };

  const runCrawler = async () => {
    setCrawlerMsg('');
    setCrawlerRunning(true);
    try {
      const res = await fetch(`${apiBase}/admin/run-crawler`, { method: 'POST', headers: authHeaders() });
      const data = await assertOkJson(res, '启动爬虫失败');
      setCrawlerMsg(data.message || '爬虫已启动');
    } catch (e) {
      setCrawlerMsg(e.message || '启动爬虫失败');
      setCrawlerRunning(false);
    }
  };

  const handleSaveFallback = async (cityKey, name, url, address, phone) => {
    const key = `${cityKey}|${name}`;
    setSavingKey(key);
    try {
      const res = await fetch(`${apiBase}/admin/shops/fallback/save`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ cityKey, name: name.trim(), image_url: url?.trim() || '', address: address?.trim(), phone: phone?.trim() }),
      });
      await assertOkJson(res, '保存失败');
      setUrlByKey((prev) => ({ ...prev, [key]: '' }));
      fetchFallback();
    } catch (e) {
      alert(e.message || '保存失败');
    } finally {
      setSavingKey(null);
    }
  };

  const handleSaveCover = async (cityKey, name, url) => {
    const key = `${cityKey}|${name}`;
    if (!url?.trim()) { alert('请填写图片 URL，或先上传/填入当前展示图'); return; }
    const trimmed = url.trim();
    if (!trimmed.startsWith('/') && !/^https?:\/\//i.test(trimmed)) {
      alert('请输入 http(s):// 或 /api/manual-covers/...');
      return;
    }
    setSavingKey(key);
    try {
      const res = await fetch(`${apiBase}/admin/media/manual-image`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ cityKey, name: name.trim(), image_url: trimmed, enabled: 1 }),
      });
      await assertOkJson(res, '保存失败');
      setUrlByKey((prev) => ({ ...prev, [key]: '' }));
      fetchCrawled();
    } catch (e) {
      alert(e.message || '保存失败');
    } finally {
      setSavingKey(null);
    }
  };

  const updateUrl = (cityKey, name, value) => {
    setUrlByKey((prev) => ({ ...prev, [`${cityKey}|${name}`]: value }));
  };

  const handleUploadCover = (cityKey, name) => {
    fileInputKeyRef.current = `${cityKey}|${name}`;
    fileInputRef.current?.click();
  };

  const onFileSelect = async (e) => {
    const file = e.target?.files?.[0];
    e.target.value = '';
    const key = fileInputKeyRef.current;
    if (!file || !key) return;
    const [cityKey, ...parts] = key.split('|');
    const name = parts.join('|');
    if (!file.type.startsWith('image/')) { alert('请选择图片文件'); return; }
    setUploadingKey(key);
    try {
      const form = new FormData();
      form.append('cover', file);
      const res = await fetch(`${apiBase}/admin/media/upload-cover`, { method: 'POST', headers: { 'x-admin-token': adminToken || '' }, body: form });
      const data = await assertOkJson(res, '上传失败');
      updateUrl(cityKey, name, data.url || '');
    } catch (err) {
      alert(err.message || '上传失败');
    } finally {
      setUploadingKey(null);
    }
  };

  const toggleSelected = (cityKey, id) => {
    setSelectedIds((prev) => {
      const set = new Set(prev[cityKey] || []);
      if (set.has(id)) set.delete(id);
      else set.add(id);
      return { ...prev, [cityKey]: [...set] };
    });
  };

  const selectAllInCity = (cityKey, restaurants) => {
    const ids = restaurants.slice(0, 10).map((r) => r.id).filter(Boolean);
    setSelectedIds((prev) => ({ ...prev, [cityKey]: ids }));
  };

  const handleConfirm = async (cityKey) => {
    setConfirmingCity(cityKey);
    try {
      const ids = selectedIds[cityKey] || [];
      const res = await fetch(`${apiBase}/admin/shops/crawled/confirm`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ cityKey, restaurantIds: ids.length > 0 ? ids : undefined }),
      });
      const data = await assertOkJson(res, '确认失败');
      alert(data.message || '已确认');
      setSelectedIds((prev) => ({ ...prev, [cityKey]: [] }));
      fetchCrawled();
    } catch (e) {
      alert(e.message || '确认失败');
    } finally {
      setConfirmingCity(null);
    }
  };

  const handleDelete = async (target, cityKey, name) => {
    if (!confirm(`确认删除「${name}」？`)) return;
    try {
      const res = await fetch(`${apiBase}/admin/shops/${target}/delete`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ cityKey, name }),
      });
      await assertOkJson(res, '删除失败');
      if (target === 'fallback') fetchFallback();
      else if (target === 'crawled') fetchCrawled();
      else fetchAll();
    } catch (e) {
      alert(e.message || '删除失败');
    }
  };

  const dayName = (d) => ['日', '一', '二', '三', '四', '五', '六'][d] || d;
  const fallbackHasData = fallbackItems.some((g) => g.restaurants?.length > 0);

  if (loading) return <p className="admin-media-loading">加载店铺数据…</p>;

  return (
    <div className="admin-shops">
      <nav className="admin-subtabs">
        <button type="button" className={subTab === 'fallback' ? 'active' : ''} onClick={() => setSubTab('fallback')}>
          兜底店铺
        </button>
        <button type="button" className={subTab === 'crawled' ? 'active' : ''} onClick={() => setSubTab('crawled')}>
          爬取数据
        </button>
      </nav>

      {err && <p className="form-error">{err}</p>}

      {subTab === 'fallback' && (
        <div className="admin-shops-fallback">
          <p className="admin-desc">
            兜底数据是你手工整理好的前端展示数据的备份。每次从「爬取数据」确认进入前端时，系统会自动将旧数据备份到这里。
            如果新数据有误，可点击「恢复到前端」回退到兜底版本。
          </p>
          <div className="admin-panel">
            <div className="admin-actions">
              <button type="button" className="btn-primary" disabled={restoring || !fallbackHasData} onClick={() => runRestore()}>
                {restoring ? '恢复中…' : '全部恢复到前端'}
              </button>
              <button type="button" className="btn-outline" onClick={runBackup}>
                手动备份当前到兜底
              </button>
              <button type="button" className="btn-ghost" onClick={fetchAll}>刷新</button>
            </div>
            {backupMsg && <p className="admin-msg">{backupMsg}</p>}
            {restoreMsg && <p className="admin-msg">{restoreMsg}</p>}
          </div>
          {!fallbackHasData ? (
            <div className="admin-panel" style={{ textAlign: 'center', padding: '40px 20px' }}>
              <p style={{ fontSize: '1.1rem', color: '#6b7280', marginBottom: 16 }}>
                兜底店铺为空。你可以点击「手动备份当前到兜底」保存当前前端数据；或当你从「爬取数据」确认新数据时，系统会自动备份。
              </p>
            </div>
          ) : (
            fallbackItems.map((g) => (
              <div key={g.cityKey} className="admin-media-city">
                <h3>
                  {g.cityZh}（{g.cityKey}）
                  {g.updatedAt && <span className="admin-media-count"> 备份于 {g.updatedAt}</span>}
                  {g.restaurants?.length > 0 && (
                    <button type="button" className="btn-outline" style={{ marginLeft: 12, fontSize: '0.75rem', padding: '2px 10px' }}
                      disabled={restoring} onClick={() => runRestore(g.cityKey)}>
                      恢复此城到前端
                    </button>
                  )}
                </h3>
                {!g.restaurants?.length ? (
                  <p className="admin-media-empty">暂无兜底数据</p>
                ) : (
                  <ul className="admin-media-list">
                    {g.restaurants.map((r) => {
                      const key = `${g.cityKey}|${r.name}`;
                      const url = urlByKey[key] ?? '';
                      const addr = addrByKey[key] ?? r.address ?? '';
                      const phone = phoneByKey[key] ?? r.phone ?? '';
                      const saving = savingKey === key;
                      return (
                        <li key={key} className="admin-media-row">
                          <div className="admin-media-thumb">
                            <img src={r.image || FALLBACK_IMG} alt="" />
                          </div>
                          <div className="admin-media-info" style={{ flex: '1 1 200px' }}>
                            <strong>{r.name}</strong>
                            <input type="text" placeholder="地址" value={addr}
                              onChange={(e) => setAddrByKey((p) => ({ ...p, [key]: e.target.value }))}
                              className="admin-media-input" style={{ width: '100%', marginTop: 4, minWidth: 0 }} />
                            <input type="text" placeholder="电话" value={phone}
                              onChange={(e) => setPhoneByKey((p) => ({ ...p, [key]: e.target.value }))}
                              className="admin-media-input" style={{ width: '100%', marginTop: 4, minWidth: 0 }} />
                          </div>
                          <div className="admin-media-form">
                            <input type="text" placeholder="封面 URL" value={url}
                              onChange={(e) => updateUrl(g.cityKey, r.name, e.target.value)}
                              className="admin-media-input" />
                            <button type="button" className="btn-primary" disabled={uploadingKey === key}
                              onClick={() => handleUploadCover(g.cityKey, r.name)}>
                              {uploadingKey === key ? '上传中…' : '上传'}
                            </button>
                            <button type="button" className="btn-primary" disabled={saving}
                              onClick={() => handleSaveFallback(g.cityKey, r.name, url || r.image, addr, phone)}>
                              {saving ? '保存中…' : '保存'}
                            </button>
                            <button type="button" className="btn-danger" onClick={() => handleDelete('fallback', g.cityKey, r.name)}>
                              删除
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {subTab === 'crawled' && (
        <div className="admin-shops-crawled">
          <div className="admin-panel">
            <div className="admin-actions">
              <button type="button" className="btn-primary" disabled={crawlerRunning} onClick={runCrawler}>
                {crawlerRunning ? '爬虫运行中…' : '立即执行爬虫'}
              </button>
              <button type="button" className="btn-ghost" onClick={() => { fetchCrawled(); fetchCrawlerStatus(); }}>
                刷新
              </button>
            </div>
            {crawlerMsg && <p className="admin-msg">{crawlerMsg}</p>}
            {crawlerStatus && (
              <div className="admin-crawler-status">
                <span>
                  自动调度：每周{dayName(crawlerStatus.scheduledDay)} {crawlerStatus.scheduledHour}:00
                </span>
                {crawlerStatus.lastRunAt && (
                  <span>上次执行：{crawlerStatus.lastRunAt}</span>
                )}
                {crawlerStatus.running && (
                  <span style={{ color: '#2563eb', fontWeight: 600 }}>正在运行中…</span>
                )}
                {crawlerStatus.lastError && (
                  <span style={{ color: '#dc2626' }}>上次错误：{crawlerStatus.lastError}</span>
                )}
              </div>
            )}
          </div>

          <p className="admin-desc">
            爬取数据：Wikidata 米其林优先；可选环境变量开启 Tabelog 高分槽位；余量由 OpenStreetMap（Overpass）补足。请核实后勾选并「确认进入前端展示」。确认前会自动备份当前前端到兜底表。
            米其林官网、TripAdvisor、携程、大众点评等需各自 API 或授权，当前未直连；可用 DeepSeek 文案兜底（环境变量 <span className="admin-inline-code">CRAWLER_DEEPSEEK_REFINE=1</span> 且配置 <span className="admin-inline-code">DEEPSEEK_API_KEY</span>）。
          </p>

          <div className="admin-panel admin-panel--compact">
            <label className="admin-filter-label">
              <span>按来源筛选（爬取列表）</span>
              <select
                className="admin-filter-select"
                value={crawledPlatformFilter}
                onChange={(e) => setCrawledPlatformFilter(e.target.value)}
              >
                {CRAWLED_PLATFORM_FILTER_OPTS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </label>
          </div>

          {crawledItems.map((g) => {
            const rawList = g.restaurants || [];
            const filtered =
              crawledPlatformFilter === 'all'
                ? rawList
                : rawList.filter((r) => sourcePlatformOf(r) === crawledPlatformFilter);
            const groups =
              filtered.length === 0
                ? []
                : groupCrawledByPlatform(filtered);
            if (rawList.length > 0 && filtered.length === 0) {
              groups.push({ platform: '_empty', label: '当前筛选无结果', list: [] });
            }

            return (
              <div key={g.cityKey} className="admin-media-city">
                <h3>
                  {g.cityZh}（{g.cityKey}）
                  {g.noCoverCount > 0 && (
                    <span className="admin-media-badge" style={{ background: '#fef3c7', color: '#92400e' }}>
                      缺封面 {g.noCoverCount} 家
                    </span>
                  )}
                  {g.crawledAt && <span className="admin-media-count"> 爬取于 {g.crawledAt}</span>}
                </h3>
                {!g.restaurants?.length ? (
                  <p className="admin-media-empty">暂无爬取数据，请点击上方「立即执行爬虫」</p>
                ) : (
                  <>
                    <div className="admin-actions" style={{ marginBottom: 8 }}>
                      <button type="button" className="btn-outline" onClick={() => selectAllInCity(g.cityKey, filtered.length ? filtered : g.restaurants)}>
                        全选（最多10家）
                      </button>
                      <button type="button" className="btn-primary" disabled={confirmingCity === g.cityKey}
                        onClick={() => handleConfirm(g.cityKey)}>
                        {confirmingCity === g.cityKey ? '确认中…' : '确认进入前端展示'}
                      </button>
                    </div>
                    {groups.map((group) => (
                      <div key={group.platform || group.label}>
                        {group.list?.length > 0 && groups.filter((x) => x.list?.length).length > 1 && (
                          <h4 className="admin-crawled-group-title">
                            {group.platform === 'wikidata_michelin' ? '⭐ ' : ''}{group.label}（{group.list.length} 家）
                          </h4>
                        )}
                        {group.list?.length === 0 && group.platform === '_empty' && (
                          <p className="admin-media-empty" style={{ marginBottom: 8 }}>该城市在此来源下暂无条目，请切换筛选。</p>
                        )}
                        <ul className="admin-media-list">
                          {(group.list || []).map((r) => {
                            const key = `${g.cityKey}|${r.name}`;
                            const url = urlByKey[key] ?? '';
                            const saving = savingKey === key;
                            const checked = (selectedIds[g.cityKey] || []).includes(r.id);
                            const plat = sourcePlatformOf(r);
                            const reason = (r.recommend_reason || r.feature || '').trim();
                            const ds = Array.isArray(r.data_sources) ? r.data_sources.join(' · ') : '';
                            return (
                              <li key={r.id || key} className="admin-media-row">
                                <input type="checkbox" checked={checked} onChange={() => toggleSelected(g.cityKey, r.id)}
                                  style={{ marginRight: 8 }} />
                                <div className="admin-media-thumb">
                                  <img src={r.image || FALLBACK_IMG} alt="" />
                                </div>
                                <div className="admin-media-info admin-media-info--wide">
                                  <strong>{r.name}</strong>
                                  {plat === 'wikidata_michelin' && <span className="admin-cover-badge badge-green">米其林</span>}
                                  {plat === 'tabelog' && <span className="admin-cover-badge badge-green">Tabelog</span>}
                                  {plat === 'osm' && <span className="admin-cover-badge badge-blue">OSM</span>}
                                  {plat === 'google' && (
                                    <span className="admin-cover-badge badge-blue">
                                      Google{r.google_rating > 0 ? ` ${r.google_rating}` : ''}
                                    </span>
                                  )}
                                  {!r.has_cover && (
                                    <span className="admin-media-feature" style={{ color: '#dc2626' }}>缺封面</span>
                                  )}
                                  {ds && <span className="admin-media-feature" style={{ color: '#64748b' }}>数据来源：{ds}</span>}
                                  {r.phone && <span className="admin-media-address">电话：{r.phone}</span>}
                                  <span className="admin-media-address">地址：{r.address || '—'}</span>
                                  {r.opening_hours && (
                                    <span className="admin-media-feature" style={{ fontSize: 11, color: '#6b7280' }}>营业：{r.opening_hours}</span>
                                  )}
                                  {reason && <span className="admin-media-feature">推荐：{reason}</span>}
                                  {r.review_snippet && (
                                    <span className="admin-media-feature" style={{ fontStyle: 'italic' }}>评价：{r.review_snippet}</span>
                                  )}
                                  {r.rating_summary && (
                                    <span className="admin-media-feature" style={{ fontSize: 11 }}>{r.rating_summary}</span>
                                  )}
                                  {r.tabelog_url && (
                                    <a className="admin-media-link" href={r.tabelog_url} target="_blank" rel="noreferrer">Tabelog 页面</a>
                                  )}
                                </div>
                                <div className="admin-media-form admin-media-form--wrap">
                                  <input type="text" placeholder="新封面 URL 或上传" value={url}
                                    onChange={(e) => updateUrl(g.cityKey, r.name, e.target.value)}
                                    className="admin-media-input" />
                                  <button type="button" className="btn-ghost btn-tiny" disabled={!r.image || r.image === FALLBACK_IMG}
                                    onClick={() => updateUrl(g.cityKey, r.name, r.image || '')}>
                                    填入当前图
                                  </button>
                                  <button type="button" className="btn-primary" disabled={uploadingKey === key}
                                    onClick={() => handleUploadCover(g.cityKey, r.name)}>
                                    {uploadingKey === key ? '上传中…' : '上传'}
                                  </button>
                                  <button type="button" className="btn-primary" disabled={saving}
                                    onClick={() => handleSaveCover(g.cityKey, r.name, url)}>
                                    {saving ? '保存中…' : '保存封面'}
                                  </button>
                                  <button type="button" className="btn-danger" onClick={() => handleDelete('crawled', g.cityKey, r.name)}>
                                    删除
                                  </button>
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    ))}
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp"
        style={{ display: 'none' }} onChange={onFileSelect} />
    </div>
  );
}
