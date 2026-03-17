import { useState, useEffect, useRef } from 'react';

const FALLBACK_IMG = 'https://images.pexels.com/photos/4106483/pexels-photo-4106483.jpeg';

export function AdminShops({ apiBase }) {
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
    const res = await fetch(`${apiBase}/admin/shops/fallback`);
    const data = await assertOkJson(res, '加载兜底失败');
    setFallbackItems(data.items || []);
  };

  const fetchCrawled = async () => {
    const res = await fetch(`${apiBase}/admin/shops/crawled`);
    const data = await assertOkJson(res, '加载爬取失败');
    setCrawledItems(data.items || []);
  };

  const fetchAll = async () => {
    setErr('');
    setLoading(true);
    try {
      await Promise.all([fetchFallback(), fetchCrawled()]);
    } catch (e) {
      setErr(e.message || '加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAll();
  }, [apiBase]);

  const runBackup = async () => {
    setBackupMsg('');
    try {
      const res = await fetch(`${apiBase}/admin/shops/fallback/backup`, { method: 'POST' });
      const data = await assertOkJson(res, '备份失败');
      setBackupMsg(data.message || '备份成功');
      fetchFallback();
    } catch (e) {
      setBackupMsg(e.message || '备份失败');
    }
  };

  const handleSaveFallback = async (cityKey, name, url, address, phone) => {
    const key = `${cityKey}|${name}`;
    setSavingKey(key);
    try {
      const res = await fetch(`${apiBase}/admin/shops/fallback/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cityKey,
          name: name.trim(),
          image_url: url?.trim() || '',
          address: address?.trim(),
          phone: phone?.trim(),
        }),
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
    if (!url?.trim()) {
      alert('请填写图片 URL');
      return;
    }
    const trimmed = url.trim();
    if (!trimmed.startsWith('/') && !/^https?:\/\//i.test(trimmed)) {
      alert('请输入 http(s):// 或 /api/manual-covers/...');
      return;
    }
    setSavingKey(key);
    try {
      const res = await fetch(`${apiBase}/admin/media/manual-image`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
    if (!file.type.startsWith('image/')) {
      alert('请选择图片文件');
      return;
    }
    setUploadingKey(key);
    try {
      const form = new FormData();
      form.append('cover', file);
      const res = await fetch(`${apiBase}/admin/media/upload-cover`, { method: 'POST', body: form });
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
        headers: { 'Content-Type': 'application/json' },
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

  if (loading) return <p className="admin-media-loading">加载店铺数据…</p>;

  return (
    <div className="admin-shops">
      <nav className="admin-shops-subtabs">
        <button
          type="button"
          className={subTab === 'fallback' ? 'active' : ''}
          onClick={() => setSubTab('fallback')}
        >
          兜底店铺
        </button>
        <button
          type="button"
          className={subTab === 'crawled' ? 'active' : ''}
          onClick={() => setSubTab('crawled')}
        >
          新爬取数据
        </button>
      </nav>

      {err && <p className="form-error">{err}</p>}

      {subTab === 'fallback' && (
        <div className="admin-shops-fallback">
          <p className="admin-shops-desc">
            兜底店铺为 refresh 前的备份数据，可管理封面和店铺信息。首次使用请先点击「备份当前到兜底」。
          </p>
          <div className="admin-media-actions">
            <button type="button" className="btn-primary" onClick={runBackup}>
              备份当前到兜底
            </button>
            <button type="button" className="btn-refresh" onClick={fetchAll}>
              刷新
            </button>
            {backupMsg && <span style={{ marginLeft: 8, color: '#059669' }}>{backupMsg}</span>}
          </div>
          {fallbackItems.map((g) => (
            <div key={g.cityKey} className="admin-media-city">
              <h3>{g.cityZh}（{g.cityKey}）</h3>
              {!g.restaurants?.length ? (
                <p className="admin-media-empty">暂无兜底数据，请先备份</p>
              ) : (
                <ul className="admin-media-list">
                  {g.restaurants.map((r) => {
                    const key = `${g.cityKey}|${r.name}`;
                    const url = urlByKey[key] ?? '';
                    const addr = addrByKey[key] ?? r.address ?? '';
                    const phone = phoneByKey[key] ?? r.phone ?? '';
                    const saving = savingKey === key;
                    return (
                      <li key={key} className="admin-media-row" style={{ flexWrap: 'wrap' }}>
                        <div className="admin-media-thumb">
                          <img src={r.image || FALLBACK_IMG} alt="" />
                        </div>
                        <div className="admin-media-info" style={{ flex: '1 1 200px' }}>
                          <strong>{r.name}</strong>
                          <input
                            type="text"
                            placeholder="地址"
                            value={addr}
                            onChange={(e) => setAddrByKey((p) => ({ ...p, [key]: e.target.value }))}
                            style={{ width: '100%', marginTop: 4, padding: 4, fontSize: 12 }}
                          />
                          <input
                            type="text"
                            placeholder="电话"
                            value={phone}
                            onChange={(e) => setPhoneByKey((p) => ({ ...p, [key]: e.target.value }))}
                            style={{ width: '100%', marginTop: 4, padding: 4, fontSize: 12 }}
                          />
                        </div>
                        <div className="admin-media-form" style={{ flex: '1 1 100%' }}>
                          <input
                            type="text"
                            placeholder="封面 URL"
                            value={url}
                            onChange={(e) => updateUrl(g.cityKey, r.name, e.target.value)}
                            className="admin-media-input"
                          />
                          <button
                            type="button"
                            className="btn-primary"
                            disabled={uploadingKey === key}
                            onClick={() => handleUploadCover(g.cityKey, r.name)}
                          >
                            {uploadingKey === key ? '上传中…' : '上传'}
                          </button>
                          <button
                            type="button"
                            className="btn-primary"
                            disabled={saving}
                            onClick={() =>
                              handleSaveFallback(g.cityKey, r.name, url || r.image, addr, phone)
                            }
                          >
                            {saving ? '保存中…' : '保存'}
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}

      {subTab === 'crawled' && (
        <div className="admin-shops-crawled">
          <p className="admin-shops-desc">
            新爬取数据来自 Tabelog/Wikidata，缺封面的可在此补填。人工确认后进入前端展示。
          </p>
          <div className="admin-media-actions">
            <button type="button" className="btn-refresh" onClick={fetchAll}>
              刷新
            </button>
          </div>
          {crawledItems.map((g) => (
            <div key={g.cityKey} className="admin-media-city">
              <h3>
                {g.cityZh}（{g.cityKey}）
                {g.noCoverCount > 0 && (
                  <span className="admin-media-badge" style={{ background: '#fef3c7', color: '#92400e' }}>
                    缺封面 {g.noCoverCount} 家
                  </span>
                )}
                {g.crawledAt && (
                  <span className="admin-media-count">爬取于 {g.crawledAt}</span>
                )}
              </h3>
              {!g.restaurants?.length ? (
                <p className="admin-media-empty">暂无爬取数据，请运行 npm run refresh-crawlers</p>
              ) : (
                <>
                  <div className="admin-media-actions" style={{ marginBottom: 8 }}>
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={() => selectAllInCity(g.cityKey, g.restaurants)}
                    >
                      全选（最多10家）
                    </button>
                    <button
                      type="button"
                      className="btn-primary"
                      disabled={confirmingCity === g.cityKey}
                      onClick={() => handleConfirm(g.cityKey)}
                    >
                      {confirmingCity === g.cityKey ? '确认中…' : '确认进入前端展示'}
                    </button>
                  </div>
                  <ul className="admin-media-list">
                    {g.restaurants.map((r) => {
                      const key = `${g.cityKey}|${r.name}`;
                      const url = urlByKey[key] ?? '';
                      const saving = savingKey === key;
                      const checked = (selectedIds[g.cityKey] || []).includes(r.id);
                      return (
                        <li key={r.id || key} className="admin-media-row">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleSelected(g.cityKey, r.id)}
                            style={{ marginRight: 8 }}
                          />
                          <div className="admin-media-thumb">
                            <img src={r.image || FALLBACK_IMG} alt="" />
                          </div>
                          <div className="admin-media-info">
                            <strong>{r.name}</strong>
                            {!r.has_cover && (
                              <span className="admin-media-feature" style={{ color: '#dc2626' }}>
                                缺封面
                              </span>
                            )}
                            <span className="admin-media-address">{r.address}</span>
                            <span className="admin-media-feature">{r.feature}</span>
                            {r.tabelog_url && (
                              <a href={r.tabelog_url} target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>
                                Tabelog
                              </a>
                            )}
                          </div>
                          <div className="admin-media-form">
                            <input
                              type="text"
                              placeholder="补封面 URL"
                              value={url}
                              onChange={(e) => updateUrl(g.cityKey, r.name, e.target.value)}
                              className="admin-media-input"
                            />
                            <button
                              type="button"
                              className="btn-primary"
                              disabled={uploadingKey === key}
                              onClick={() => handleUploadCover(g.cityKey, r.name)}
                            >
                              {uploadingKey === key ? '上传中…' : '上传'}
                            </button>
                            <button
                              type="button"
                              className="btn-primary"
                              disabled={saving}
                              onClick={() => handleSaveCover(g.cityKey, r.name, url)}
                            >
                              {saving ? '保存中…' : '保存封面'}
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        style={{ display: 'none' }}
        onChange={onFileSelect}
      />
    </div>
  );
}
