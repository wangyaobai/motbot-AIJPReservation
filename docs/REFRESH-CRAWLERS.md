# 餐厅数据定期刷新（Tabelog + Wikidata 米其林）

## 概述

`refresh-from-crawlers.js` 从 **Wikidata 米其林** + **Tabelog 高评** 抓取餐厅，写入 `recommendations_best`，每城最多 10 家。

- **主数据源**：米其林官网（Wikidata SPARQL）+ Tabelog 高评
- **保留已有数据**：手动封面、历史 `restaurant_media_best` 继续保留
- **补图**：沿用 Tabelog/Wikidata/Yelp，拉到后**本地化保存**到服务器
- **秒开**：`recommendations_best` + `translate_cache` 仍为缓存，首页加载不受影响

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
```

## 定时任务（crontab）

每周日凌晨 3 点执行：

```bash
0 3 * * 0 cd ~/motbot-AIJPReservation/backend && node scripts/refresh-from-crawlers.js >> ~/refresh-crawlers.log 2>&1
```

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
