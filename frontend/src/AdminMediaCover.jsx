import { useState, useEffect, useRef } from 'react';

const API = import.meta.env.VITE_API_BASE || '/api';

export function AdminMediaCover({ apiBase = API }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [urlByKey, setUrlByKey] = useState({});
  const [savingKey, setSavingKey] = useState(null);
  const [refineMsg, setRefineMsg] = useState('');
  const [refining, setRefining] = useState(false);
  const [uploadingKey, setUploadingKey] = useState(null);
  const [localizeMsg, setLocalizeMsg] = useState('');
  const [localizing, setLocalizing] = useState(false);
  const [adminToken, setAdminToken] = useState(() => typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('adminToken') || '' : '');
  const [dupLoading, setDupLoading] = useState(false);
  const [dupErr, setDupErr] = useState('');
  const [dupGroups, setDupGroups] = useState([]);
  const [dupQuery, setDupQuery] = useState(null); // { url?: string, prefix?: string }
  const fileInputRef = useRef(null);
  const fileInputKeyRef = useRef(null);

  const fetchList = async () => {
    setErr('');
    setLoading(true);
    try {
      const res = await fetch(`${apiBase}/admin/restaurants-without-cover`);
      const data = await res.json();
      if (!data.ok) throw new Error(data.message || '加载失败');
      setItems(data.items || []);
      setUrlByKey({});
      if (data.items && data.items.length > 0) setErr('');
      else setErr(data.message || '');
    } catch (e) {
      setErr(e.message || '加载失败');
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchList();
  }, [apiBase]);

  const handleSave = async (cityKey, name, url) => {
    const key = `${cityKey}|${name}`;
    if (!url || !url.trim()) {
      alert('请填写图片 URL');
      return;
    }
    const trimmed = url.trim();
    if (!trimmed.startsWith('/') && !/^https?:\/\//i.test(trimmed)) {
      alert('请输入以 http(s):// 开头的链接，或使用「上传图片」得到本机地址');
      return;
    }
    setSavingKey(key);
    try {
      const res = await fetch(`${apiBase}/admin/media/manual-image`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cityKey,
          name: name.trim(),
          image_url: trimmed,
          enabled: 1,
        }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.message || '保存失败');
      setUrlByKey((prev) => ({ ...prev, [key]: '' }));
      fetchList();
      // 如果当前正在做“重复封面排查”，保存成功后自动刷新重复列表，
      // 使已修复（不再重复）的餐厅/分组自动从页面消失。
      if (dupQuery) {
        fetchDuplicates(dupQuery).catch(() => {});
      }
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
    if (!file.type.startsWith('image/')) {
      alert('请选择图片文件（jpg/png/webp）');
      return;
    }
    setUploadingKey(key);
    try {
      const form = new FormData();
      form.append('cover', file);
      const res = await fetch(`${apiBase}/admin/media/upload-cover`, { method: 'POST', body: form });
      const data = await res.json();
      if (!data.ok) throw new Error(data.message || '上传失败');
      updateUrl(cityKey, name, data.url || '');
    } catch (err) {
      alert(err.message || '上传失败');
    } finally {
      setUploadingKey(null);
    }
  };

  const runLocalize = async () => {
    const token = (typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('adminToken') : null) || adminToken?.trim();
    if (!token) {
      alert('请先填写 Admin Token（与服务器 Variables 中 ADMIN_TOKEN 一致），用于执行本地化操作');
      return;
    }
    setLocalizing(true);
    setLocalizeMsg('');
    try {
      const res = await fetch(`${apiBase}/admin/media/localize-covers`, {
        method: 'POST',
        headers: { 'x-admin-token': token },
      });
      const data = await res.json().catch(() => ({}));
      if (!data.ok) throw new Error(data.message || '本地化失败（可能超时或服务异常）');
      setLocalizeMsg('已开始在后台下载外链封面到服务器，请稍候…');

      // 轮询进度，避免一次性请求超时导致 HTML 返回
      const poll = async () => {
        const st = await fetch(`${apiBase}/admin/media/localize-covers/status`, {
          headers: { 'x-admin-token': token },
        }).then((r) => r.json()).catch(() => null);
        if (!st?.ok) return;
        const msg = st.running
          ? `本地化中… ${st.localized ?? 0}/${st.total ?? 0}（失败 ${st.failed ?? 0}）`
          : `本地化完成：已保存 ${st.localized ?? 0}/${st.total ?? 0}（失败 ${st.failed ?? 0}）${st.lastError ? `；错误：${st.lastError}` : ''}`;
        setLocalizeMsg(msg);
        if (st.running) {
          setTimeout(poll, 2000);
        } else {
          fetchList();
        }
      };
      setTimeout(poll, 800);
    } catch (e) {
      setLocalizeMsg(e.message || '本地化失败');
    } finally {
      setLocalizing(false);
    }
  };

  const fetchDuplicates = async ({ url, prefix } = {}) => {
    const token = (typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('adminToken') : null) || adminToken?.trim();
    if (!token) {
      alert('请先填写 Admin Token（用于查询重复封面）');
      return;
    }
    setDupErr('');
    setDupGroups([]);
    setDupLoading(true);
    try {
      const qs = new URLSearchParams();
      if (url) qs.set('url', url);
      else qs.set('prefix', prefix || '/api/manual-covers/best');
      setDupQuery(url ? { url } : { prefix: prefix || '/api/manual-covers/best' });
      const res = await fetch(`${apiBase}/admin/media/duplicate-manual-covers?${qs.toString()}`, {
        headers: { 'x-admin-token': token },
      });
      const data = await res.json().catch(() => ({}));
      if (!data.ok) throw new Error(data.message || '查询失败');
      setDupGroups(Array.isArray(data.groups) ? data.groups : []);
    } catch (e) {
      setDupErr(e.message || '查询失败');
    } finally {
      setDupLoading(false);
    }
  };

  useEffect(() => {
    if (adminToken && typeof sessionStorage !== 'undefined') sessionStorage.setItem('adminToken', adminToken);
  }, [adminToken]);

  const runRefine = async () => {
    setRefineMsg('');
    setRefining(true);
    try {
      const res = await fetch(`${apiBase}/admin/refine-recommendation-images`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (data.ok) {
        setRefineMsg(data.message || '已开始后台补齐，约 1～2 分钟后请点击刷新查看。');
        setTimeout(() => fetchList(), 95000);
      } else {
        setRefineMsg(data.message || '操作失败');
      }
    } catch (e) {
      setRefineMsg(e?.message || '请求失败');
    } finally {
      setRefining(false);
    }
  };

  if (loading) return <p className="admin-media-loading">加载无封面餐厅列表…</p>;

  const total = items.reduce((n, g) => n + (g.restaurants?.length || 0), 0);
  if (items.length === 0) {
    return (
      <div className="admin-media-cover">
        {err ? (
          <p className="admin-media-empty" style={{ color: 'var(--text-muted)', whiteSpace: 'pre-wrap' }}>{err}</p>
        ) : (
          <p className="admin-media-empty">当前没有需要填写封面图的餐厅。</p>
        )}
        <button type="button" className="btn-refresh" onClick={fetchList}>刷新</button>
      </div>
    );
  }

  return (
    <div className="admin-media-cover">
      <p className="admin-media-summary">
        {total > 0 ? `共 ${total} 家餐厅可补充封面。` : '下方为各城市；暂无数据的城市请先访问首页对应 Tab 或运行 warm 脚本生成数据。'}
        不足 10 家的城市会列出该城全部未填手动图的店（包括“有链接但前端可能加载失败”的图源），可粘贴外链，或使用「上传图片」存到服务器（避免外链失效）。
      </p>
      {err && <p className="form-error">{err}</p>}
      <div className="admin-media-actions">
        <button
          type="button"
          className="btn-primary"
          disabled={refining}
          onClick={runRefine}
        >
          {refining ? '提交中…' : '用特色/菜名自动补齐封面图'}
        </button>
        <button type="button" className="btn-refresh" onClick={fetchList} disabled={loading}>
          {loading ? '加载中…' : '刷新列表'}
        </button>
        <span style={{ marginLeft: 8 }}>
          <input
            type="password"
            placeholder="Admin Token（用于下方本地化）"
            value={adminToken}
            onChange={(e) => setAdminToken(e.target.value)}
            style={{ width: 180, marginRight: 6, padding: '4px 8px' }}
          />
          <button
            type="button"
            className="btn-primary"
            disabled={localizing}
            onClick={runLocalize}
          >
            {localizing ? '本地化中…' : '将已填外链封面下载到服务器'}
          </button>
        </span>
      </div>
      {refineMsg && <p className="admin-media-refine-msg">{refineMsg}</p>}
      {localizeMsg && <p className="admin-media-refine-msg">{localizeMsg}</p>}

      <div className="admin-media-actions" style={{ marginTop: 12 }}>
        <button
          type="button"
          className="btn-primary"
          disabled={dupLoading}
          onClick={() => fetchDuplicates()}
          title="找出所有 manual_image_url 指向同一个 best...webp 的餐厅（历史覆盖导致串图）"
        >
          {dupLoading ? '查询重复中…' : '查找重复 best 封面（串图排查）'}
        </button>
        <button
          type="button"
          className="btn-refresh"
          disabled={dupLoading}
          onClick={() => fetchDuplicates({ url: '/api/manual-covers/best________.webp' })}
          title="只查 best________.webp 这一张"
          style={{ marginLeft: 8 }}
        >
          {dupLoading ? '查询中…' : '只查 best________.webp'}
        </button>
      </div>
      {dupErr && <p className="form-error">{dupErr}</p>}
      {dupGroups && dupGroups.length > 0 && (
        <div className="admin-media-city" style={{ marginTop: 10 }}>
          <h3>重复封面排查（共 {dupGroups.length} 组）</h3>
          {dupGroups.map((g) => (
            <div key={g.manual_image_url} style={{ margin: '10px 0', padding: 10, border: '1px solid rgba(0,0,0,0.08)', borderRadius: 10 }}>
              <div style={{ marginBottom: 8, wordBreak: 'break-all' }}>
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
                        <span className="admin-media-feature" style={{ color: '#a16207' }}>
                          当前手动图：{it.manual_image_url}
                        </span>
                        <span className="admin-media-feature">
                          城市：{it.city_hint}{it.cityKey ? `（${it.cityKey}）` : ''}
                        </span>
                      </div>
                      <div className="admin-media-form">
                        <input
                          type="text"
                          placeholder="上传图片后会自动填入 /api/manual-covers/..."
                          value={url}
                          onChange={(e) => updateUrl(cityKey, name, e.target.value)}
                          className="admin-media-input"
                        />
                        <button
                          type="button"
                          className="btn-primary"
                          disabled={uploadingKey === key}
                          onClick={() => handleUploadCover(cityKey, name)}
                          title="上传图片到服务器并写入本地 URL"
                        >
                          {uploadingKey === key ? '上传中…' : '上传图片'}
                        </button>
                        <button
                          type="button"
                          className="btn-primary"
                          disabled={saving}
                          onClick={() => handleSave(cityKey, name, url)}
                        >
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

      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        style={{ display: 'none' }}
        onChange={onFileSelect}
      />
      {items.map((group) => (
        <div key={group.cityKey} className="admin-media-city">
          <h3>
            {group.cityZh}（{group.cityKey}）
            {group.needFill != null && group.needFill && !group.noData && (
              <span className="admin-media-badge">不足10家，请补充</span>
            )}
            {group.noData && (
              <span className="admin-media-badge" style={{ background: '#fef3c7', color: '#92400e' }}>暂无数据</span>
            )}
            {group.withCoverCount != null && !group.noData && (
              <span className="admin-media-count"> 共 {group.totalInCity || 0} 家，已有封面 {group.withCoverCount} 家</span>
            )}
          </h3>
          {group.noData && group.message && (
            <p className="admin-media-empty" style={{ marginBottom: 8, fontSize: '0.9rem', color: '#666' }}>{group.message}</p>
          )}
          <ul className="admin-media-list">
            {(group.restaurants || []).map((r) => {
              const key = `${group.cityKey}|${r.name}`;
              const url = urlByKey[key] ?? '';
              const saving = savingKey === key;
              return (
                <li key={key} className="admin-media-row">
                  <div className="admin-media-thumb">
                    <img src={r.image} alt="" />
                  </div>
                  <div className="admin-media-info">
                    <strong>{r.name}</strong>
                    {Array.isArray(r.reasons) && r.reasons.length > 0 && (
                      <span className="admin-media-feature" style={{ color: '#a16207' }}>
                        原因：{r.reasons.join('、')}
                      </span>
                    )}
                    {r.address && <span className="admin-media-address">{r.address}</span>}
                    {r.feature && <span className="admin-media-feature">{r.feature}</span>}
                    {r.image_url && (
                      <span className="admin-media-feature" style={{ wordBreak: 'break-all' }}>
                        当前：{r.image_url}
                      </span>
                    )}
                  </div>
                  <div className="admin-media-form">
                    <input
                      type="text"
                      placeholder="https://... 或 /api/manual-covers/..."
                      value={url}
                      onChange={(e) => updateUrl(group.cityKey, r.name, e.target.value)}
                      className="admin-media-input"
                    />
                    <button
                      type="button"
                      className="btn-primary"
                      disabled={uploadingKey === key}
                      onClick={() => handleUploadCover(group.cityKey, r.name)}
                      title="上传图片到服务器，避免外链失效"
                    >
                      {uploadingKey === key ? '上传中…' : '上传图片'}
                    </button>
                    <button
                      type="button"
                      className="btn-primary"
                      disabled={saving}
                      onClick={() => handleSave(group.cityKey, r.name, url)}
                    >
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
  );
}
