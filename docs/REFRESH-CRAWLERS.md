# 餐厅数据定期刷新（Wikidata 米其林 + OpenStreetMap）

## 概述

`refresh-from-crawlers.js` 与后台「立即执行爬虫」共用 [backend/services/crawlerMergeJob.js](../backend/services/crawlerMergeJob.js) 逻辑：

- **Wikidata SPARQL**：日本米其林名单，按都道府县映射到 `cityKey`（含 **`other`**：无法归入 8 城的店）
- **OpenStreetMap / Overpass**：每城一次 bbox 拉取 `amenity=restaurant` 池（**`other` 不拉全池**，仅米其林 + 按店名检索补全，避免全日本查询超时）
- **写入**：默认只写入 `recommendations_crawled`，需后台「店铺管理」确认后进入前端
- **每城条数上限**：默认 **15** 条（米其林优先，余量由 OSM 池按完整度补足），可用环境变量调整

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

## 频率与合规

- OSM 数据遵循 [ODbL](https://www.openstreetmap.org/copyright)；勿过高频率轰炸公共 Overpass，生产请使用自有实例或合理拉长调度间隔。
- 调度器默认每周触发一次（见 `CRAWLER_SCHEDULE_DAY` / `CRAWLER_SCHEDULE_HOUR`）。

## 数据源

| 来源 | 说明 |
|------|------|
| **Wikidata** | 日本米其林（P166） |
| **Overpass** | 城市 bbox 内餐厅 POI；`other` 仅按店名子串检索补全 |
