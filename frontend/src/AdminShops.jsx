import { useState, useEffect, useRef } from 'react';

const FALLBACK_IMG = 'https://images.pexels.com/photos/4106483/pexels-photo-4106483.jpeg';

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
    if (!url?.trim()) { alert('请填写图片 URL'); return; }
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
            爬取数据来自 Wikidata 米其林 + OpenStreetMap（Overpass，免费开源），请核实信息后选择店铺点击「确认进入前端展示」。
            系统会自动将当前前端数据备份到兜底表，然后写入新数据。
          </p>

          {crawledItems.map((g) => {
            const michelinList = (g.restaurants || []).filter((r) => r.source === 'michelin');
            const osmList = (g.restaurants || []).filter((r) => r.source !== 'michelin');
            const groups = [];
            if (michelinList.length > 0) groups.push({ label: '米其林餐厅', list: michelinList });
            if (osmList.length > 0) groups.push({ label: 'OpenStreetMap 餐厅', list: osmList });
            if (groups.length === 0 && g.restaurants?.length > 0) groups.push({ label: '餐厅列表', list: g.restaurants });

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
                      <button type="button" className="btn-outline" onClick={() => selectAllInCity(g.cityKey, g.restaurants)}>
                        全选（最多10家）
                      </button>
                      <button type="button" className="btn-primary" disabled={confirmingCity === g.cityKey}
                        onClick={() => handleConfirm(g.cityKey)}>
                        {confirmingCity === g.cityKey ? '确认中…' : '确认进入前端展示'}
                      </button>
                    </div>
                    {groups.map((group) => (
                      <div key={group.label}>
                        {groups.length > 1 && (
                          <h4 style={{ margin: '12px 0 6px', fontSize: '0.9rem', color: '#374151', borderBottom: '1px solid #e5e7eb', paddingBottom: 4 }}>
                            {group.label === '米其林餐厅' ? '⭐ ' : ''}{group.label}（{group.list.length} 家）
                          </h4>
                        )}
                        <ul className="admin-media-list">
                          {group.list.map((r) => {
                            const key = `${g.cityKey}|${r.name}`;
                            const url = urlByKey[key] ?? '';
                            const saving = savingKey === key;
                            const checked = (selectedIds[g.cityKey] || []).includes(r.id);
                            return (
                              <li key={r.id || key} className="admin-media-row">
                                <input type="checkbox" checked={checked} onChange={() => toggleSelected(g.cityKey, r.id)}
                                  style={{ marginRight: 8 }} />
                                <div className="admin-media-thumb">
                                  <img src={r.image || FALLBACK_IMG} alt="" />
                                </div>
                                <div className="admin-media-info">
                                  <strong>{r.name}</strong>
                                  {r.source === 'michelin' && <span className="admin-cover-badge badge-green">米其林</span>}
                                  {r.source === 'osm' && (
                                    <span className="admin-cover-badge badge-blue">OSM</span>
                                  )}
                                  {r.source === 'google' && r.google_rating > 0 && (
                                    <span className="admin-cover-badge badge-blue">Google {r.google_rating}</span>
                                  )}
                                  {!r.has_cover && (
                                    <span className="admin-media-feature" style={{ color: '#dc2626' }}>缺封面</span>
                                  )}
                                  {r.phone && <span className="admin-media-address">TEL: {r.phone}</span>}
                                  <span className="admin-media-address">{r.address}</span>
                                  {r.opening_hours && (
                                    <span className="admin-media-feature" style={{ fontSize: 11, color: '#6b7280' }}>{r.opening_hours}</span>
                                  )}
                                  <span className="admin-media-feature">{r.feature}</span>
                                </div>
                                <div className="admin-media-form">
                                  <input type="text" placeholder="补封面 URL" value={url}
                                    onChange={(e) => updateUrl(g.cityKey, r.name, e.target.value)}
                                    className="admin-media-input" />
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
