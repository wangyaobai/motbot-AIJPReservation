# 日本餐厅 AI 代打电话预约 - 技术方案

## 需求概要

- **场景**：中国用户不会日语，日本餐厅多需电话预约，日本人英文普遍较差。
- **产品**：AI 代用户用日语致电餐厅完成预约，录音并短信发送摘要。
- **形态**：H5 移动端，单次服务（先免费）。

## 技术栈

| 层级 | 选型 | 说明 |
|------|------|------|
| 前端 | React 18 + Vite | 稳定、构建快、易做 H5 适配 |
| 后端 | Node.js + Express | 与 Twilio 生态兼容好，便于 webhook |
| 数据库 | SQLite (better-sqlite3) | 单机即可、无需额外服务，后期可迁 PostgreSQL |
| 通话/录音/短信 | Twilio | 行业标准，支持外呼、录音、TTS、SMS |
| AI 摘要 | OpenAI API | 根据录音转写结果生成预约结果摘要 |

## 核心流程

1. **用户提交**：H5 填写餐厅（店名/电话）、预约时间人数、弹性时间、套餐选项、联系人姓名与手机 → 调用后端创建订单。
2. **AI 外呼**：后端用 Twilio 向餐厅号码发起外呼，接听后 TwiML 使用日语 TTS 说明预约意图（时间/人数/套餐等），并用 `<Gather>` 收集对方回复；全程录音。
3. **录音与摘要**：通话结束后 Twilio 回调录音 URL；后端拉取录音、用 Whisper 转写（或 Twilio 转写），再用 OpenAI 生成简短摘要，通过 Twilio SMS 发给用户。
4. **后台**：按用户（姓名/手机）查询订单列表，可听录音、看摘要。

## 餐厅电话获取

- 优先：用户直接填写餐厅电话号码（必填或从搜索选择）。
- 可选：提供“按店名搜索”入口，后端调用 **Google Places API**（Text Search）根据店名+日本地区查询，返回名称、地址、电话；无 API 时仅支持手动输入号码。

## 目录结构

```
restaurant-booking-h5/
├── backend/          # Express API + Twilio webhooks
├── frontend/         # React H5
├── docs/
│   └── DESIGN.md
└── README.md
```

## 环境变量（后端）

- `PORT`：服务端口
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`：Twilio 账号与主叫号码
- `OPENAI_API_KEY`：摘要生成
- `GOOGLE_PLACES_API_KEY`（可选）：餐厅搜索
- `BASE_URL`：当前服务公网 URL（供 Twilio webhook 使用）

## 安全与合规

- 录音需符合当地法律，需在页面/条款中告知“通话将被录音并用于生成预约摘要”。
- 用户手机号、姓名仅用于预约与短信，需在隐私说明中写明。
