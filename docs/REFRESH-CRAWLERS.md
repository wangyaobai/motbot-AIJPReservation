# 餐厅数据定期刷新（Wikidata 米其林 + 可选 Tabelog + OpenStreetMap）

## 概述

`refresh-from-crawlers.js` 与后台「立即执行爬虫」共用 [backend/services/crawlerMergeJob.js](../backend/services/crawlerMergeJob.js) 逻辑：

- **Wikidata SPARQL**：日本米其林名单，按都道府县映射到 `cityKey`（含 **`other`**：无法归入 8 城的店）
- **可选 Tabelog**（`CRAWLER_INCLUDE_TABELOG=1`）：在米其林之后、OSM 之前插入少量高评价槽位（注意站点 ToS 与请求频率）
- **OpenStreetMap / Overpass**：每城一次 bbox 拉取 `amenity=restaurant` 池（**`other` 不拉全池**，仅米其林 + 按店名检索补全，避免全日本查询超时）
- **可选 DeepSeek**（`CRAWLER_DEEPSEEK_REFINE=1` + `DEEPSEEK_API_KEY`）：入库前补全 `recommend_reason` / `review_snippet` 短文案
- **写入**：默认只写入 `recommendations_crawled`，需后台「店铺管理」确认后进入前端
- **每城条数上限**：默认 **15** 条（米其林优先，可选 Tabelog，余量由 OSM 池补足），可用环境变量调整

### 数据流说明

- **默认**：爬取写入 `recommendations_crawled`
- **--auto-merge**：合并到 `recommendations_best`（适合 crontab）
- **--replace**：与 `--auto-merge` 联用时完全覆盖 best

每次 refresh 前会自动备份 `recommendations_best` 到 `recommendations_fallback`。

## 城市范围

共 **9** 个分区：`hokkaido`, `tokyo`, `osaka`, `nagoya`, `kyoto`, `kobe`, `okinawa`, `kyushu`, **`other`**（日本其他地区，对应 Wikidata 映射为 other 的米其林）。

## 用法

```bash
cd backend

# 全部分区刷新
npm run refresh-crawlers

# 仅刷新东京
node scripts/refresh-from-crawlers.js --city=tokyo

# 试跑（不写库）
node scripts/refresh-from-crawlers.js --dry-run

# 自动合并到前端（适合 crontab）
node scripts/refresh-from-crawlers.js --auto-merge

# 完全覆盖 + 自动合并
node scripts/refresh-from-crawlers.js --auto-merge --replace
```

## 定时任务（crontab）

示例（每周日凌晨 3 点，仅入库不自动合并前端）：

```bash
0 3 * * 0 cd ~/motbot-AIJPReservation/backend && node scripts/refresh-from-crawlers.js >> ~/refresh-crawlers.log 2>&1
```

## 环境变量（Overpass 与条数）

| 变量 | 说明 |
|------|------|
| `OVERPASS_API_URL` | Overpass API 地址，默认 `https://overpass-api.de/api/interpreter`。生产建议自建或选用稳定镜像，降低公共实例限流风险。 |
| `OVERPASS_MAX_RETRIES` | 请求失败重试次数，默认 `3`。 |
| `OVERPASS_RETRY_BASE_MS` | 重试基础等待毫秒，默认 `2000`（指数退避）。 |
| `CRAWLER_TARGET_PER_CITY` | 每城写入 crawled 的最大条数，默认 `15`，范围建议 `5`～`50`。 |
| `CRAWLER_INCLUDE_TABELOG` | 设为 `1` 时启用 Tabelog 补充（默认关闭）。 |
| `CRAWLER_DEEPSEEK_REFINE` | 设为 `1` 且配置 `DEEPSEEK_API_KEY` 时，对爬取列表做文案兜底（每城最多处理前 20 条）。 |
| `CRAWLER_DELAY_BETWEEN_CITIES_MS` | 每城爬取结束后到下一城前的休眠（默认 `12000`），减轻公共 Overpass 连续请求导致的 429/504。 |
| `CRAWLER_PAUSE_AFTER_WIKIDATA_MS` | Wikidata 米其林查询结束后、开始 Overpass 前的休眠（默认 `5000`）。 |

## 频率与合规

- OSM 数据遵循 [ODbL](https://www.openstreetmap.org/copyright)；勿过高频率轰炸公共 Overpass。若日志大量 `Overpass HTTP 429/504`，请增大 `CRAWLER_DELAY_BETWEEN_CITIES_MS`（如 `20000`）或改用自建/镜像 Overpass（`OVERPASS_API_URL`）。公共实例列表见 [Overpass API](https://wiki.openstreetmap.org/wiki/Overpass_API#Public_Overpass_API_instances)。
- Wikidata 若连续 `403 Too Many Reqs`，多为出口 IP 被限流：配置 `WIKIDATA_USER_AGENT_CONTACT`、拉长调度间隔、冷却数小时后再跑；长期可考虑换出口 IP 或使用 [数据转储](https://www.wikidata.org/wiki/Wikidata:Database_download) 等合规离线方案。
- Tabelog 等第三方站点请自行评估 robots/服务条款；建议低频、小批量，生产可关闭 `CRAWLER_INCLUDE_TABELOG`。
- 调度器默认每周触发一次（见 `CRAWLER_SCHEDULE_DAY` / `CRAWLER_SCHEDULE_HOUR`）。

## 数据源

| 来源 | 说明 |
|------|------|
| **Wikidata** | 日本米其林（P166）。若出现 `403 Too Many Reqs`，属 WDQS 限流：代码会自动退避重试；请在 `.env` 设置 `WIKIDATA_USER_AGENT_CONTACT`（可联系 URL/邮箱），并避免短时间内重复手动跑同一查询。 |
| **Tabelog**（可选） | 按评分列表抓取少量高评价店，需 `CRAWLER_INCLUDE_TABELOG=1` |
| **Overpass** | 城市 bbox 内餐厅 POI；`other` 仅按店名子串检索补全 |
