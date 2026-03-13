/**
 * 精修预加载数据：对 recommendations_best 里仍是兜底图的餐厅，
 * 用「特色/菜名」模糊搜图补上，并写回 SQLite。
 * 用法：先跑完 warm（npm run warm），再执行 node backend/scripts/refine-recommendation-images.js
 */
import 'dotenv/config';
import { ensureSchema } from '../db.js';
import { runRefineRecommendationImages } from '../services/refineRecommendationImages.js';

async function main() {
  ensureSchema();
  const { updated, cities } = await runRefineRecommendationImages();
  console.log('[refine] done. updated', updated, 'cities', cities.join(', ') || '-');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
