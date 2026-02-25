import { Router } from 'express';

const router = Router();

// 根据店名搜索餐厅（可选：接入 Google Places API）
// 无 GOOGLE_PLACES_API_KEY 时返回空数组，前端仍可让用户手动输入电话
router.get('/restaurant', async (req, res) => {
  const { q } = req.query;
  if (!q || typeof q !== 'string' || q.trim().length === 0) {
    return res.json({ ok: true, places: [] });
  }

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    return res.json({ ok: true, places: [], message: '未配置餐厅搜索，请直接输入电话号码' });
  }

  try {
    const url = new URL('https://maps.googleapis.com/maps/api/place/textsearch/json');
    url.searchParams.set('query', q.trim() + ' 日本 餐厅');
    url.searchParams.set('language', 'ja');
    url.searchParams.set('key', apiKey);
    const resp = await fetch(url.toString());
    const data = await resp.json();
    if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
      return res.json({ ok: true, places: [], message: data.error_message || '搜索异常' });
    }
    const places = (data.results || []).slice(0, 10).map((p) => ({
      name: p.name,
      address: p.formatted_address,
      place_id: p.place_id,
    }));

    // 获取电话需要 place details，这里只返回名称与地址；电话可再调 details 或让用户自行填写
    const withPhone = await Promise.all(
      places.map(async (place) => {
        const detailUrl = new URL('https://maps.googleapis.com/maps/api/place/details/json');
        detailUrl.searchParams.set('place_id', place.place_id);
        detailUrl.searchParams.set('fields', 'name,formatted_address,formatted_phone_number');
        detailUrl.searchParams.set('key', apiKey);
        const dr = await fetch(detailUrl.toString());
        const d = await dr.json();
        const tel = d.result?.formatted_phone_number || null;
        return { ...place, phone: tel };
      })
    );

    res.json({ ok: true, places: withPhone });
  } catch (e) {
    console.error(e);
    res.json({ ok: true, places: [], message: e.message || '搜索失败' });
  }
});

export default router;
