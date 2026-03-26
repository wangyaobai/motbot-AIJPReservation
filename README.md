# 日本餐厅 AI 代打电话预约

H5 移动端应用：中国用户填写预约信息后，由 AI 用日语自动致电日本餐厅完成预约，全程录音并向用户短信发送沟通摘要。

## 功能概览

- **页面展示**：目标餐厅（店名搜索 / 手动输入电话）、预约时间人数、弹性时间与套餐选项、联系人信息、免费提交
- **AI 电话**：提交后点击「立即代打电话」，系统向餐厅号码外呼，用日语说明预约内容并录音；结束后根据录音转写生成中文摘要并短信发送给用户
- **后台**：独立地址 `/admin`，按联系人姓名或手机号查询订单，可查看所填信息、AI 沟通摘要与录音链接

## 技术栈

- 前端：React 18 + Vite，H5 移动端适配
- 后端：Node.js + Express
- 数据库：SQLite
- 通话 / 录音 / 短信：Twilio
- AI 摘要：OpenAI（Whisper 转写 + GPT 摘要）

## 本地运行

### 1. 后端

```bash
cd backend
cp .env.example .env
# 编辑 .env，填入 Twilio、OpenAI 等（见下方配置说明）
npm install
npm run init-db
npm run dev
```

服务默认：`http://localhost:3000`

### 2. 前端

```bash
cd frontend
npm install
npm run dev
```

前端默认：`http://localhost:5173`，开发时通过 Vite 代理将 `/api` 转发到后端。  
- 预约首页：`http://localhost:5173/`  
- 后台查询：`http://localhost:5173/admin`

### 3. Twilio Webhook（外呼与录音回调）

发起外呼与录音完成后，Twilio 会请求你服务器的 `/twilio/voice/:orderNo`、`/twilio/recording` 等，**必须是公网可访问的 URL**。

- 本地调试：用 [ngrok](https://ngrok.com/) 等把本机 3000 端口暴露为 HTTPS，在 `.env` 中设置 `BASE_URL=https://xxx.ngrok.io`
- 生产：将 `BASE_URL` 设为实际域名（如 `https://api.xxx.com`）

## 环境变量说明

| 变量 | 必填 | 说明 |
|------|------|------|
| `PORT` | 否 | 后端端口，默认 3000 |
| `BASE_URL` | 是（外呼时） | 公网 base URL，供 Twilio 回调 |
| `TWILIO_ACCOUNT_SID` | 是 | Twilio 账号 SID |
| `TWILIO_AUTH_TOKEN` | 是 | Twilio 认证 Token |
| `TWILIO_PHONE_NUMBER` | 是 | Twilio 主叫号码（需支持语音） |
| `OPENAI_API_KEY` | 推荐 | 用于录音转写与摘要；不填则仅保存录音、不发摘要 |
| `DEEPSEEK_API_KEY` | 推荐 | 用 DeepSeek 从搜索结果中智能提取餐厅电话；不填则仅用正则从片段中解析 |
| `SERPER_API_KEY` | 否 | 搜索片段来源（[Serper](https://serper.dev)）；不填则用 DuckDuckGo 抓取，再配合 DeepSeek 提取电话 |

## 同步到 GitHub

仓库地址：[wangyaobai/motbot-AIJPReservation](https://github.com/wangyaobai/motbot-AIJPReservation)

在项目根目录执行：

```bash
cd /Users/admin_1/Desktop/cursor/restaurant-booking-h5
git init
git add .
git commit -m "Initial commit: 日本餐厅 AI 代预约 H5 + 后端"
git branch -M main
git remote add origin https://github.com/wangyaobai/motbot-AIJPReservation.git
git push -u origin main
```

若仓库已有内容（如 README），可先 `git pull origin main --rebase` 再 push。

## 部署到 Railway

1. **登录** [Railway](https://railway.app/) 并 **New Project** → **Deploy from GitHub repo**，选择 `wangyaobai/motbot-AIJPReservation`。
2. **根目录**：保持为仓库根目录（含 `package.json`、`frontend/`、`backend/`）。
3. **构建与启动**（根目录 `package.json` 已配置）：
   - **Build Command**：`npm run build`（会安装 frontend/backend 依赖并构建前端）
   - **Start Command**：`npm start`（启动后端，并托管前端静态）
4. **环境变量**：在 Railway 项目 → **Variables** 中配置：
   - `NODE_ENV` = `production`（一般会自动设置）
   - `PORT`：由 Railway 自动注入，可不填
   - `BASE_URL` = 你的 Railway 应用域名（如 `https://xxx.up.railway.app`），**开通电话服务时必填**
   - 可选：`TWILIO_*`、`OPENAI_API_KEY`（同本地 .env）
5. **生成域名**：在 **Settings** → **Networking** → **Generate Domain**，得到 `https://xxx.up.railway.app`。将该地址填到 `BASE_URL`，以便 Twilio 回调。
6. 部署完成后访问该域名即为预约首页，`/admin` 为后台。

## 其他部署方式

- **后端**：在服务器上 `npm install --production`、`npm start`（表结构会在首次启动时自动创建），并配置反向代理与 HTTPS。
- **前端**：若单独部署前端，`npm run build` 后将 `dist/` 部署到静态托管，并设置 `VITE_API_BASE` 为后端 API 地址。

## 合规与隐私

- 通话录音前应在页面或条款中明确告知用户「通话将被录音并用于生成预约摘要」。
- 用户姓名、手机号仅用于预约与发送结果短信，请按当地法规撰写隐私政策。

## 项目结构

```
restaurant-booking-h5/
├── backend/           # Express API、Twilio webhook、SQLite
│   ├── routes/         # orders、search、twilio
│   ├── voice/          # 日语 TwiML、录音回调与摘要
│   ├── data/           # bookings.db（运行后生成）
│   └── server.js
├── frontend/           # React H5
│   └── src/            # App、BookingForm、OrderResult、AdminQuery
├── docs/
│   └── DESIGN.md       # 技术方案
└── README.md
```

## 后续扩展

- 单次服务收费：在提交前增加支付（如 Stripe/支付宝），支付成功后再允许「立即代打电话」。
- 更智能的对话：使用 Twilio Media Streams + 实时 STT/TTS，实现多轮日语对话而不仅是固定话术。
