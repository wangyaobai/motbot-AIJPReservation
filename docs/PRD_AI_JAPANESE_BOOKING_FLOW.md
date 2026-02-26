# PRD：AI 日语预约流程（由代码整理）

> 本文档由当前代码逻辑整理而成，用于评审「AI 代客致电餐厅（日语）」这一部分的实现与产品设计。

---

## 一、产品目标

用户填写预约信息（餐厅、日期时间、人数、联系人等）后，由系统**代用户用日语**致电餐厅完成预约；通话**全程录音**，结束后自动**转写 + 中文摘要**，并可选**短信通知用户**。

---

## 二、角色与前置条件

| 角色 | 说明 |
|------|------|
| 用户 | 提交预约表单、完成支付（占位）、触发「立即代打电话」、查看订单状态与摘要 |
| 餐厅 | 接听系统外呼，听到日语预约说明 |
| 系统 | 通过 Twilio 外呼、返回 TwiML 日语话术、录音、转写、摘要、短信 |

**前置条件：**

- 用户已提交预约并生成订单（订单状态：待支付）。
- 用户完成「支付」（当前为占位，点击即通过）。
- 仅当订单状态为「预约中（pending）」时，可点击「立即代打电话」。
- 后端需配置：Twilio（SID / Token / 号码）、BASE_URL（公网 HTTPS，供 Twilio 回调）。

---

## 三、订单状态与流程

### 3.1 状态枚举

| 状态值 | 展示名 | 说明 |
|--------|--------|------|
| `pending_pay` | 待支付 | 订单已创建，等待支付（占位） |
| `pending` | 待拨打电话 / 预约中 | 已支付，等待用户点击「立即代打电话」 |
| `calling` | 正在拨打… / 预约中 | 已发起外呼，正在与餐厅通话 |
| `completed` | 预约成功 / 已完成 | 通话结束，已录音、摘要、可选短信 |
| `failed` | 预约失败 | 预留（如未接通、占线等） |
| `cancelled` | 已取消 | 用户或管理员取消 |

### 3.2 状态流转（与代码一致）

```
创建订单 → pending_pay
     ↓ 用户点击「支付」→ POST /orders/:orderNo/confirm-payment
     pending
     ↓ 用户点击「立即代打电话」→ POST /orders/:orderNo/call（Twilio 外呼）
     calling
     ↓ Twilio 录音完成 → POST /twilio/recording（后端回调）
     completed

任意未终态（非 completed/cancelled）→ 可取消 → cancelled
```

---

## 四、用户端操作流程（与前端一致）

1. **预约页**：填写餐厅名称/电话、预约日期时间、人数、是否弹性时间、是否要套餐、联系人姓名与手机 → 提交。
2. **预约结果页**：
   - **待支付**：展示「请完成支付…」+ 按钮「支付」→ 调 `confirm-payment`，成功后变为「预约中」。
   - **预约中（pending）**：展示「立即代打电话」→ 调 `call`，成功后变为「正在拨打餐厅电话…」。
   - **预约中（calling）**：仅展示状态「正在拨打餐厅电话…」，无再次拨打按钮。
   - **预约成功（completed）**：展示 AI 沟通摘要、录音链接；无支付/代打电话按钮。
3. **订单列表/详情**：可对「待支付」订单「去支付」跳转预约页并带 `orderNo`；对「预约中」可「立即代打电话」（详情页）或进入详情再操作；可取消未完成订单。

---

## 五、AI 通话流程（后端 + Twilio）

### 5.1 发起外呼（与 `orders.js` 一致）

- **接口**：`POST /orders/:orderNo/call`
- **约束**：订单状态必须为 `pending`，否则返回「请先完成支付后再发起通话」。
- **配置校验**：缺少 `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_PHONE_NUMBER` / `BASE_URL` 时，返回「电话服务暂未配置…」。
- **逻辑**：
  - 使用 Twilio API `calls.create` 向 **餐厅电话**（`order.restaurant_phone`）外呼。
  - 日本号码：`0` 开头则 `+81` + 去首位 0；否则按长度判断，≤10 位补 `+81`。
  - 外呼时请求的 TwiML URL：`{BASE_URL}/twilio/voice/{orderNo}`（GET/POST 均支持）。
  - 通话参数：`record: 'record-from-answer'`，`recordingStatusCallback: {BASE_URL}/twilio/recording`，`recordingStatusCallbackEvent: ['completed']`，`timeout: 30`。
- **状态更新**：写入 `twilio_call_sid`，订单状态改为 `calling`。

### 5.2 日语话术（TwiML，与 `voiceHandler.js` 一致）

当餐厅接听后，Twilio 请求 `GET/POST /twilio/voice/:orderNo`，服务器返回 TwiML：

1. **开场**（Polly.Mizuki，ja-JP）：  
   「こんにちは。お客様の代わりにご予約のお電話をさせていただいております。」  
   （您好，我们是代客预约服务，代客人致电预约。）

2. **日期·时间·人数**：  
   - 日期：`booking_date`（YYYY-MM-DD）转为「X月X日」日语口语。  
   - 话术：`{dateStr}の{timeStr}、{party}名様でご予約をお願いいたします。`

3. **可选**：  
   - 若 `flexible_hour === 1`：  
     「その時間が難しい場合は、前後1時間のご調整も可能です。」  
   - 若 `want_set_meal === 1`：  
     「人気のコースのご用意もお願いできますでしょうか。」

4. **结尾**：  
   「ご対応のほど、よろしくお願いいたします。」

5. **收尾与挂断**：  
   - `gather`：等待最多 8 秒，收集 1 位按键（可选），`action` 指向 `/twilio/voice/:orderNo/done`。  
   - 补充一句：「何かご質問がございましたら、お申し付けください。」  
   - 随后 `redirect` 到 `.../done`。  
   - **done**（`voiceDoneHandler.js`）：  
     「ご確認ありがとうございます。それでは失礼いたします。」然后挂断。

（若订单不存在，则播放「申し訳ございません。予約情報が見つかりません。」并挂断。）

### 5.3 录音与事后处理（与 `recordingHandler.js` 一致）

- **触发**：Twilio 录音完成时 POST 到 ` /twilio/recording`，body 含 `RecordingSid`、`CallSid`、`RecordingUrl`、`RecordingDuration` 等。
- **逻辑**：
  1. 根据 `CallSid` 查订单，若不存在则忽略。
  2. 录音 URL 存库（`recording_url`，mp3），`recording_duration_sec` 更新。
  3. **若配置了 OPENAI_API_KEY**：  
     - 用 Whisper（`whisper-1`，language: `ja`）对录音 URL 转写。  
     - 用 GPT（`gpt-4o-mini`）根据转写生成**中文摘要**（2–4 句话：是否预约成功、日期时间人数、餐厅其他说明）。  
     - 摘要写入 `summary_text`。  
  4. 订单状态更新为 `completed`。
  5. **若配置了 Twilio 且订单有 `contact_phone`**：  
     - 向用户发送短信：「【日本餐厅预约】您的预约通话已完成。摘要：{summaryText}」。  
     - 用户手机号：国内 `+86`，日本按 `contact_phone_region` 与格式处理。  
     - 发送成功后写 `sms_sent = 1`。

---

## 六、接口汇总（与代码一致）

| 类型 | 方法 | 路径 | 说明 |
|------|------|------|------|
| 用户端 | POST | `/orders/:orderNo/confirm-payment` | 支付完成（占位），pending_pay → pending |
| 用户端 | POST | `/orders/:orderNo/call` | 发起 AI 外呼，pending → calling |
| Twilio | GET/POST | `/twilio/voice/:orderNo` | 外呼时拉取日语 TwiML |
| Twilio | GET/POST | `/twilio/voice/:orderNo/done` | 结束语 + 挂断 |
| Twilio | POST | `/twilio/status` | 通话状态回调（当前仅返回空 Response） |
| Twilio | POST | `/twilio/recording` | 录音完成 → 转写、摘要、completed、短信 |

（上述路径在实际部署时可能带前缀，如 `/api`；Twilio 回调通常挂于 `/twilio` 以便与 Twilio 控制台配置一致。）

---

## 七、环境与依赖

| 变量 | 必填 | 说明 |
|------|------|------|
| TWILIO_ACCOUNT_SID | 是 | Twilio 账号 SID |
| TWILIO_AUTH_TOKEN | 是 | Twilio Auth Token |
| TWILIO_PHONE_NUMBER | 是 | 支持 Voice 的 Twilio 号码 |
| BASE_URL | 是 | 公网 HTTPS，供 Twilio 请求 TwiML 与 recording 回调 |
| OPENAI_API_KEY | 否 | 不填则只存录音，不转写、不摘要、不发摘要短信 |

---

## 八、当前实现的边界与可选增强

- **话术**：固定日语脚本（Polly.Mizuki），无实时 ASR/LLM 对话；`gather` 仅收 1 位数字，未根据按键做分支。
- **支付**：占位逻辑，无真实支付网关。
- **预约失败**：`failed` 状态已预留，尚未在 Twilio 未接通/占线等回调中写入。
- **短信**：使用 Twilio 发短信；若验证码已改用阿里云，此处仍为 Twilio，可后续统一或保留双通道。

以上为从代码反推的「AI 日语预约流程」PRD，便于与产品预期对照和后续迭代。
