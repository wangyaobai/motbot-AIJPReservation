/**
 * 为每个城市构建「最多 10 家有封面图」的预加载数据并写入 recommendations_best（历史+精修+DeepSeek）。
 * 用法：
 *   - 本地（后端已启动）：cd backend && node scripts/warm-recommendations.js
 *   - Railway 部署后：BASE_URL=https://你的应用.railway.app node scripts/warm-recommendations.js
 * 若不执行，后端启动后也会自动在后台跑同样逻辑（见 server.js startWarmRecommendations）。
 */
import 'dotenv/config';
import { runBuildPreloadAll } from '../services/buildPreload.js';

const PORT_OR_BASE = process.env.BASE_URL || parseInt(process.env.PORT, 10) || 3000;

async function main() {
  console.log('Building preload (up to 10 with cover per city) at', typeof PORT_OR_BASE === 'number' ? `http://127.0.0.1:${PORT_OR_BASE}` : PORT_OR_BASE);
  const results = await runBuildPreloadAll(PORT_OR_BASE);
  for (const r of results) {
    if (r?.error) console.log(r.cityKey, 'error:', r.error);
    else console.log(r.cityKey, 'ok', r?.count ?? 0, 'restaurants');
  }
  console.log('Done.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
