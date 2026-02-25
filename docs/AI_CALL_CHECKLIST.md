# AI 打电话功能核对清单

## 功能是否已实现？

**是的，代码已完整实现。** 只要按下面配置好环境并满足网络条件，即可使用。

---

## 流程概览

1. 用户提交预约 → 点击「立即代打电话」
2. 后端用 **Twilio** 向**餐厅电话**发起外呼
3. 餐厅接听后，Twilio 向你的服务器请求 **TwiML**（`/twilio/voice/:orderNo`）
4. 服务器返回日语语音内容（Polly.Mizuki）：说明代客预约、日期时间人数、弹性时间、套餐意向
5. 通话**全程录音**
6. 通话结束后 Twilio 回调 **`/twilio/recording`** → 后端保存录音、可选 Whisper 转写 + GPT 摘要、可选 Twilio 发短信给用户

---

## 必须满足的条件

### 1. 环境变量（backend/.env 或 Railway Variables）

| 变量 | 说明 |
|------|------|
| **TWILIO_ACCOUNT_SID** | Twilio 控制台 → Account SID |
| **TWILIO_AUTH_TOKEN** | Twilio 控制台 → Auth Token |
| **TWILIO_PHONE_NUMBER** | 已购买的 Twilio 号码（支持 Voice），如 +1234567890 |
| **BASE_URL** | **公网 HTTPS 地址**，Twilio 用其回调你的服务器，如 `https://你的应用.railway.app`（不要末尾斜杠） |

缺任一项时，点击「立即代打电话」会提示：「电话服务暂未配置…」

### 2. BASE_URL 必须让 Twilio 能访问

- **本地**：Twilio 无法访问 localhost，需用 **ngrok** 等把本机暴露为 HTTPS，再把 ngrok 地址填到 `BASE_URL`
- **Railway**：在 Railway 生成域名后，把该域名（如 `https://xxx.up.railway.app`）填到 **Variables → BASE_URL**

### 3. 可选（增强体验）

| 变量 | 作用 |
|------|------|
| **OPENAI_API_KEY** | 录音转写（Whisper）+ 中文摘要（GPT），并短信发给用户；不填则只存录音、不发摘要短信 |
| Twilio 号码 | 需支持**语音**（Voice），且目标国家/地区在 Twilio 支持范围内 |

---

## 代码已做的修正

- **TwiML 支持 GET 与 POST**：Twilio 拉取 TwiML 时可能用 GET 或 POST，已同时支持，避免接听后无语音。

---

## 如何自测

1. **配置**：在 `.env` 或 Railway Variables 中填齐上述 Twilio 三项 + `BASE_URL`。
2. **提交一单**：在预约页填餐厅电话（可填你自己的手机或测试号）、预约时间、人数、联系人，提交。
3. **点「立即代打电话」**：应不再提示「电话服务暂未配置」，且 Twilio 会向外呼。
4. **接听**：用你填的「餐厅电话」接听，应听到日语预约说明。
5. **挂断后**：若配置了 `OPENAI_API_KEY`，用户手机会收到摘要短信；后台可听录音、看摘要。

---

## 常见问题

- **点击后提示「电话服务暂未配置」** → 检查 `TWILIO_ACCOUNT_SID`、`TWILIO_AUTH_TOKEN`、`TWILIO_PHONE_NUMBER`、`BASE_URL` 是否都填对且生效（改完变量需重启或重新部署）。
- **接听后没有日语** → 确认 `BASE_URL` 是公网 HTTPS，且 Twilio 能访问；看 Twilio 控制台 → Monitor → Logs 里该次调用的 Webhook 是否 200。
- **收不到短信** → 确认 Twilio 号码支持 SMS、用户手机号格式正确（如中国 +86…）；看 Twilio Logs 里 Messaging 是否有错误。
