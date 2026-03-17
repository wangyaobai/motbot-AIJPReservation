# 餐厅数据定期刷新（Tabelog + Wikidata 米其林）

## 概述

`refresh-from-crawlers.js` 从 **Wikidata 米其林** + **Tabelog 高评** 抓取餐厅，写入 `recommendations_best`，每城最多 10 家。

- **主数据源**：米其林官网（Wikidata SPARQL）+ Tabelog 高评
- **保留已有数据**：手动封面、历史 `restaurant_media_best` 继续保留
- **补图**：沿用 Tabelog/Wikidata/Yelp，拉到后**本地化保存**到服务器
- **秒开**：`recommendations_best` + `translate_cache` 仍为缓存，首页加载不受影响

### 数据流说明

- **默认**：爬取数据写入 `recommendations_crawled`，需后台「店铺管理」人工确认后进入前端
- **--auto-merge**：自动合并到 `recommendations_best`（原逻辑，适合 crontab 自动更新）
- **--replace**：与 `--auto-merge` 联用时，完全用爬取数据覆盖（不保留旧数据）

每次 refresh 前会自动备份 `recommendations_best` 到 `recommendations_fallback`（兜底表）。

## 城市范围

| 类型 | 城市 | 数据来源 |
|------|------|----------|
| 8 主城 | 东京、大阪、京都、名古屋、神户、北海道、冲绳、九州 | Tabelog + Wikidata |
| 其他 | 横滨、埼玉、千叶、仙台、广岛等 | Tabelog（归入 other） |

## 用法

```bash
cd backend

# 全城市刷新（9 城）
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

每周日凌晨 3 点执行。如需自动合并到前端，加 `--auto-merge`：

```bash
0 3 * * 0 cd ~/motbot-AIJPReservation/backend && node scripts/refresh-from-crawlers.js --auto-merge >> ~/refresh-crawlers.log 2>&1
```

不加 `--auto-merge` 时，爬取数据仅入库，需后台「店铺管理」确认后进入前端。

## 数据源

| 来源 | 说明 |
|------|------|
| **Wikidata SPARQL** | 日本米其林餐厅（P166 奖状） |
| **Tabelog** | 按 `SrtT=rt` 评分排序，高评价餐厅 |
| **补图** | `resolveRestaurantMediaBatch`（Tabelog/Yelp/官网 og:image） |
| **图片本地化** | 外链保存到 `public/manual-covers/crawled-*.webp` |

## 频率与合规

- 每页/每店间隔 **4 秒**
- User-Agent 伪装浏览器
- 遵守 Tabelog robots.txt
- 建议每周 1 次
