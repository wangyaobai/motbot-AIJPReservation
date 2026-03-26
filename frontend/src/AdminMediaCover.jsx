import { useState, useEffect, useRef } from 'react';

const API = import.meta.env.VITE_API_BASE || '/api';

export function AdminMediaCover({ apiBase = API, adminToken }) {
  const authHeaders = (extra = {}) => ({ 'x-admin-token': adminToken || '', ...extra });

  const [displayItems, setDisplayItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  const [urlByKey, setUrlByKey] = useState({});
  const [savingKey, setSavingKey] = useState(null);
  const [uploadingKey, setUploadingKey] = useState(null);

  const [refineMsg, setRefineMsg] = useState('');
  const [refining, setRefining] = useState(false);
  const [localizeMsg, setLocalizeMsg] = useState('');
  const [localizing, setLocalizing] = useState(false);

  const [dupOpen, setDupOpen] = useState(false);
  const [dupLoading, setDupLoading] = useState(false);
  const [dupErr, setDupErr] = useState('');
  const [dupGroups, setDupGroups] = useState([]);

  const fileInputRef = useRef(null);
  const fileInputKeyRef = useRef(null);

  const readApiResponse = async (res) => {
    const ct = (res.headers?.get?.('content-type') || '').toLowerCase();
    const isJson = ct.includes('application/json');
    if (isJson) {
      const data = await res.json().catch(() => ({}));
      return { data, text: null, isJson: true };
    }
    const text = await res.text().catch(() => '');
    return { data: null, text, isJson: false };
  };

  const assertOkJson = async (res, fallbackMsg) => {
    const { data, text, isJson } = await readApiResponse(res);
    if (isJson) {
      if (data?.ok) return data;
      throw new Error(data?.message || fallbackMsg || `请求失败（HTTP ${res.status}）`);
    }
    const snippet = String(text || '').slice(0, 200);
    throw new Error(`请求返回非JSON（HTTP ${res.status}）。` + (snippet ? `返回片段：${snippet}` : ''));
  };

  const fetchDisplay = async () => {
    setErr('');
    setLoading(true);
    try {
      const res = await fetch(`${apiBase}/admin/frontend-display`, { headers: authHeaders() });
      const data = await assertOkJson(res, '加载失败');
      setDisplayItems(data.items || []);
    } catch (e) {
      setErr(e.message || '加载失败');
      setDisplayItems([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchDisplay(); }, [apiBase]);

  const handleSave = async (cityKey, name, url) => {
    const key = `${cityKey}|${name}`;
    if (!url || !url.trim()) { alert('请填写图片 URL'); return; }
    const trimmed = url.trim();
    if (!trimmed.startsWith('/') && !/^https?:\/\//i.test(trimmed)) {
      alert('请输入以 http(s):// 开头的链接，或使用「上传图片」得到本机地址');
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
      fetchDisplay();
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
    const [cityKey, ...nameParts] = key.split('|');
    const name = nameParts.join('|');
    if (!file.type.startsWith('image/')) { alert('请选择图片文件（jpg/png/webp）'); return; }
    setUploadingKey(key);
    try {
      const form = new FormData();
      form.append('cover', file);
      const res = await fetch(`${apiBase}/admin/media/upload-cover`, {
        method: 'POST', headers: { 'x-admin-token': adminToken || '' }, body: form,
      });
      const data = await assertOkJson(res, '上传失败');
      updateUrl(cityKey, name, data.url || '');
    } catch (err) {
      alert(err.message || '上传失败');
    } finally {
      setUploadingKey(null);
    }
  };

  const runRefine = async () => {
    setRefineMsg('');
    setRefining(true);
    try {
      const res = await fetch(`${apiBase}/admin/refine-recommendation-images`, { method: 'POST', headers: authHeaders() });
      const { data } = await readApiResponse(res);
      if (data?.ok) {
        setRefineMsg(data.message || '已开始后台补齐，约 1~2 分钟后请刷新查看。');
        setTimeout(() => fetchDisplay(), 95000);
      } else {
        setRefineMsg(data?.message || '操作失败');
      }
    } catch (e) {
      setRefineMsg(e?.message || '请求失败');
    } finally {
      setRefining(false);
    }
  };

  const runLocalize = async () => {
    setLocalizing(true);
    setLocalizeMsg('');
    try {
      const res = await fetch(`${apiBase}/admin/media/localize-covers`, { method: 'POST', headers: authHeaders() });
      await assertOkJson(res, '本地化失败');
      setLocalizeMsg('已开始在后台下载外链封面到服务器，请稍候…');
      const poll = async () => {
        const stRes = await fetch(`${apiBase}/admin/media/localize-covers/status`, { headers: authHeaders() }).catch(() => null);
        const st = stRes ? await readApiResponse(stRes).then((x) => x.data).catch(() => null) : null;
        if (!st?.ok) return;
        const msg = st.running
          ? `本地化中… ${st.localized ?? 0}/${st.total ?? 0}（失败 ${st.failed ?? 0}）`
          : `本地化完成：已保存 ${st.localized ?? 0}/${st.total ?? 0}（失败 ${st.failed ?? 0}）${st.lastError ? `；错误：${st.lastError}` : ''}`;
        setLocalizeMsg(msg);
        if (st.running) setTimeout(poll, 2000);
        else fetchDisplay();
      };
      setTimeout(poll, 800);
    } catch (e) {
      setLocalizeMsg(e.message || '本地化失败');
    } finally {
      setLocalizing(false);
    }
  };

  const fetchDuplicates = async () => {
    setDupErr('');
    setDupGroups([]);
    setDupLoading(true);
    try {
      const qs = new URLSearchParams({ prefix: '/api/manual-covers/best' });
      const res = await fetch(`${apiBase}/admin/media/duplicate-manual-covers?${qs.toString()}`, { headers: authHeaders() });
      const data = await res.json().catch(() => ({}));
      if (!data.ok) throw new Error(data.message || '查询失败');
      setDupGroups(Array.isArray(data.groups) ? data.groups : []);
    } catch (e) {
      setDupErr(e.message || '查询失败');
    } finally {
      setDupLoading(false);
    }
  };

  const handleDeleteBest = async (cityKey, name) => {
    if (!confirm(`确认从前端展示中删除「${name}」？`)) return;
    try {
      const res = await fetch(`${apiBase}/admin/shops/best/delete`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ cityKey, name }),
      });
      await assertOkJson(res, '删除失败');
      fetchDisplay();
    } catch (e) {
      alert(e.message || '删除失败');
    }
  };

  const coverSourceLabel = (src) => {
    if (src === 'manual') return { text: '手动', cls: 'badge-green' };
    if (src === 'auto') return { text: '自动', cls: 'badge-blue' };
    return { text: '缺图', cls: 'badge-red' };
  };

  if (loading) return <p className="admin-media-loading">加载中…</p>;

  return (
    <div className="admin-media-cover">
      <p className="admin-desc">
        展示前端首页各城市当前实际展示的店铺列表。标记为「缺图」的店铺不会显示在前端首页，可上传图片或填写URL补充。
      </p>
      {err && <p className="form-error">{err}</p>}
      <div className="admin-panel">
        <div className="admin-actions">
          <button type="button" className="btn-primary" disabled={refining} onClick={runRefine}>
            {refining ? '提交中…' : '自动补齐封面图'}
          </button>
          <button type="button" className="btn-ghost" onClick={fetchDisplay} disabled={loading}>
            {loading ? '加载中…' : '刷新列表'}
          </button>
          <button type="button" className="btn-outline" disabled={localizing} onClick={runLocalize}>
            {localizing ? '本地化中…' : '外链封面本地化'}
          </button>
        </div>
        {refineMsg && <p className="admin-msg">{refineMsg}</p>}
        {localizeMsg && <p className="admin-msg">{localizeMsg}</p>}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        style={{ display: 'none' }}
        onChange={onFileSelect}
      />

      {displayItems.map((group) => {
        const noCover = (group.restaurants || []).filter((r) => r.coverSource === 'none');
        return (
          <div key={group.cityKey} className="admin-media-city">
            <h3>
              {group.cityZh}（{group.cityKey}）
              {group.noData ? (
                <span className="admin-media-badge" style={{ background: '#fef3c7', color: '#92400e' }}>暂无数据</span>
              ) : (
                <span className="admin-media-count">
                  {' '}共 {group.total} 家，前端展示 {group.displayCount} 家
                  {noCover.length > 0 && <span style={{ color: '#dc2626' }}>，缺图 {noCover.length} 家</span>}
                </span>
              )}
            </h3>
            {group.noData && (
              <p className="admin-media-empty" style={{ fontSize: '0.9rem', color: '#666' }}>
                该城市暂无预加载数据，请先访问首页该城市 Tab 触发推荐。
              </p>
            )}
            <ul className="admin-media-list">
              {(group.restaurants || []).map((r) => {
                const key = `${group.cityKey}|${r.name}`;
                const url = urlByKey[key] ?? '';
                const saving = savingKey === key;
                const badge = coverSourceLabel(r.coverSource);
                const needFill = r.coverSource === 'none';
                return (
                  <li key={key} className="admin-media-row">
                    <div className="admin-media-thumb">
                      {r.image && r.coverSource !== 'none' ? (
                        <img src={r.image} alt="" />
                      ) : (
                        <div style={{ width: 80, height: 60, background: '#f3f4f6', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 6, color: '#9ca3af', fontSize: 12 }}>
                          缺图
                        </div>
                      )}
                    </div>
                    <div className="admin-media-info">
                      <strong>{r.name}</strong>
                      <span className={`admin-cover-badge ${badge.cls}`}>{badge.text}</span>
                      {r.address && <span className="admin-media-address">{r.address}</span>}
                      {r.feature && <span className="admin-media-feature">{r.feature}</span>}
                    </div>
                    <div className="admin-media-form">
                      {needFill && (
                        <>
                          <input
                            type="text"
                            placeholder="https://... 或 /api/manual-covers/..."
                            value={url}
                            onChange={(e) => updateUrl(group.cityKey, r.name, e.target.value)}
                            className="admin-media-input"
                          />
                          <button
                            type="button" className="btn-primary"
                            disabled={uploadingKey === key}
                            onClick={() => handleUploadCover(group.cityKey, r.name)}
                          >
                            {uploadingKey === key ? '上传中…' : '上传图片'}
                          </button>
                          <button
                            type="button" className="btn-primary"
                            disabled={saving}
                            onClick={() => handleSave(group.cityKey, r.name, url)}
                          >
                            {saving ? '保存中…' : '保存'}
                          </button>
                        </>
                      )}
                      <button type="button" className="btn-danger" onClick={() => handleDeleteBest(group.cityKey, r.name)}>
                        删除
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}

      {/* 重复封面排查 - 默认折叠 */}
      <div className="admin-media-city" style={{ marginTop: 24 }}>
        <h3
          style={{ cursor: 'pointer', userSelect: 'none' }}
          onClick={() => { setDupOpen(!dupOpen); if (!dupOpen && dupGroups.length === 0) fetchDuplicates(); }}
        >
          {dupOpen ? '▼' : '▶'} 重复封面排查（串图排查）
        </h3>
        {dupOpen && (
          <div>
            <div className="admin-actions" style={{ marginBottom: 12 }}>
              <button type="button" className="btn-outline" disabled={dupLoading} onClick={fetchDuplicates}>
                {dupLoading ? '查询中…' : '刷新重复列表'}
              </button>
            </div>
            {dupErr && <p className="form-error">{dupErr}</p>}
            {dupGroups.length === 0 && !dupLoading && <p className="admin-media-empty">未发现重复封面。</p>}
            {dupGroups.map((g) => (
              <div key={g.manual_image_url} className="admin-panel" style={{ padding: 14, marginBottom: 12 }}>
                <div className="admin-media-feature" style={{ marginBottom: 8, wordBreak: 'break-all' }}>
                  <strong>URL：</strong>{g.manual_image_url}（重复 {g.cnt}）
                </div>
                <ul className="admin-media-list">
                  {(g.items || []).map((it) => {
                    const cityKey = it.cityKey || 'tokyo';
                    const name = it.restaurant_name;
                    const key = `${cityKey}|${name}`;
                    const url = urlByKey[key] ?? '';
                    const saving = savingKey === key;
                    return (
                      <li key={it.cache_key || key} className="admin-media-row">
                        <div className="admin-media-thumb">
                          <img src={g.manual_image_url} alt="" />
                        </div>
                        <div className="admin-media-info">
                          <strong>{name}</strong>
                          <span className="admin-media-feature">城市：{it.city_hint}{it.cityKey ? `（${it.cityKey}）` : ''}</span>
                        </div>
                        <div className="admin-media-form">
                          <input
                            type="text"
                            placeholder="新封面 URL"
                            value={url}
                            onChange={(e) => updateUrl(cityKey, name, e.target.value)}
                            className="admin-media-input"
                          />
                          <button type="button" className="btn-primary" disabled={uploadingKey === key}
                            onClick={() => handleUploadCover(cityKey, name)}>
                            {uploadingKey === key ? '上传中…' : '上传图片'}
                          </button>
                          <button type="button" className="btn-primary" disabled={saving}
                            onClick={() => handleSave(cityKey, name, url)}>
                            {saving ? '保存中…' : '保存'}
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
