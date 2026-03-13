import { useState, useEffect } from 'react';

const API = import.meta.env.VITE_API_BASE || '/api';

export function AdminMediaCover({ apiBase = API }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [urlByKey, setUrlByKey] = useState({});
  const [savingKey, setSavingKey] = useState(null);
  const [refineMsg, setRefineMsg] = useState('');
  const [refining, setRefining] = useState(false);

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
    if (!/^https?:\/\//i.test(url.trim())) {
      alert('请输入以 http:// 或 https:// 开头的链接');
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
          image_url: url.trim(),
          enabled: 1,
        }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.message || '保存失败');
      setUrlByKey((prev) => ({ ...prev, [key]: '' }));
      fetchList();
    } catch (e) {
      alert(e.message || '保存失败');
    } finally {
      setSavingKey(null);
    }
  };

  const updateUrl = (cityKey, name, value) => {
    setUrlByKey((prev) => ({ ...prev, [`${cityKey}|${name}`]: value }));
  };

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
        不足 10 家的城市会列出该城全部未填手动图的店（包括“有链接但前端可能加载失败”的图源），你可以逐个替换为可展示的图片 URL 并保存。
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
      </div>
      {refineMsg && <p className="admin-media-refine-msg">{refineMsg}</p>}
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
                      type="url"
                      placeholder="https://..."
                      value={url}
                      onChange={(e) => updateUrl(group.cityKey, r.name, e.target.value)}
                      className="admin-media-input"
                    />
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
