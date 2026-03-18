# AI 对话规则（反向整理）

> 本文档从代码中反向整理当前 AI 代客预约电话的对话规则与流程，**日语与英语模式并列完整列出**。

---

## 一、语言选择机制

| 来源 | 字段 | 取值 | 说明 |
|------|------|------|------|
| 用户下单 | `order.call_lang` | `'ja'` / `'en'` | 预约表单选择：日本餐厅·日语 / 欧美餐厅·英语 |
| 默认值 | — | `'ja'` | 未指定时默认日语 |
| 推荐来源 | `recommendations` | `call_lang` | 爬虫/后台可配置餐厅默认通话语言 |

**影响范围**：预生成首句、ASR 转写、LLM 对话、TTS 合成、结束语、录音摘要/翻译。

---

## 二、整体流程

```
用户点击「立即代打电话」
    ↓
twilioCall：发起外呼 + 预生成首句（后台，按 order.call_lang 选日语/英语）
    ↓
对方接听 → Twilio 请求 voiceHandler
    ↓
voiceHandler：Record 5 秒（等对方说「はい」「もしもし」或 "Hello" 等）
    ↓
Record 结束 → voiceRecordHandler
    ↓
ASR 转写（按 order.call_lang 选日语/英语模型）→ 取预生成或 LLM 生成回复 → Play AI 话术 + Record 30 秒
    ↓
循环多轮，直到 done 或达到 MAX_ROUNDS
```

---

## 三、模式切换

| 条件 | 模式 | 说明 |
|------|------|------|
| 配置了 `ALI_APP_KEY_JA` 或 `ALI_APP_KEY_EN` 等 | **多轮对话** | LLM 生成 + 阿里云 TTS，支持多轮；**日语/英语均支持** |
| 未配置上述 AppKey | **固定话术** | Twilio Polly 播报，**仅日语**，无多轮；**英语订单会错误使用日语话术** |

> ⚠️ 固定话术模式（handleLegacy）目前只实现日语，若用户选英语且未配置 `ALI_APP_KEY_EN`，会走日语固定话术。

---

## 四、多轮对话规则（aiDialogue.js）

### 4.1 模型与 API

- **优先**：DeepSeek（`DEEPSEEK_API_KEY`）
- **回退**：OpenAI `gpt-4o-mini`（`OPENAI_API_KEY`）
- **未配置**：
  - 日语：`申し訳ございません。ただいまシステムの準備ができておりません。`
  - 英语：`Sorry, the system is not ready at the moment.`

### 4.2 订单上下文（buildOrderContext）

| 语言 | 字段 |
|------|------|
| **日语** | 第一希望日期时间、第二希望（若有）、人数（大人/儿童）、饮食注意、备注、预约者名、联络电话 |
| **英语** | First choice date/time、Second choice、Party size (adults/children)、Dietary restrictions、Remarks、Contact name、Contact phone (for SMS/payment link) |

### 4.3 系统提示（System Prompt）

#### 日语规则

- **角色**：代客预约日本餐厅的 AI 助手
- **输出**：**必须全部为日语**，禁止中文或英文（专有名词除外）
- **固定策略**：若对方提到「予約金／デポジット／事前決済／前払い」等预付费用：
  - 请求对方将线上支付链接发到订单中的「连络先（SMS等）」号码
  - 说明国际顾客线上支付可能不便，礼貌询问是否可通融「到店支付／当日支払い／店頭決済」
  - **不要编造**支付链接或金额
- 根据对话历史与对方最新回复，生成下一句日语回复（简短礼貌）
- 若对方表示「可以预约」「承知しました」「かしこまりました」→ 回复感谢并结束
- 若对方表示「满席」「いっぱい」「その時間は無理」→ 礼貌结束
- 若对方询问细节 → 用日语简要确认订单内容
- 只输出一句日语，不要中文、不要解释

#### 英语规则

- **角色**：代客预约餐厅的 AI 助手（面向欧美餐厅）
- **输出**：**必须全部为英语**
- **联系信息**：若餐厅询问顾客电话（如发支付链接）→ **必须**使用订单中的 contact phone，禁止占位符
- **固定策略**：若餐厅要求 deposit / prepayment：
  - 请其将支付链接发到 contact phone
  - 礼貌询问国际客人是否可到店支付
  - **不要编造**支付链接或金额
- 根据对话历史与对方最新回复，生成下一句英语回复（简短礼貌）
- 若餐厅确认预约 → 感谢并结束
- 若满席或不可用 → 礼貌结束
- 若询问细节 → 简要确认预约内容
- 只输出英语，不要解释

### 4.4 首句指令（无历史时）

#### 日语

1. 先自然问候（如 お電話ありがとうございます、お忙しいところ失礼します）
2. 再说明是代客预约
3. 必须包含：第一希望日期时间；第二希望（若有）；人数（大人・儿童）；饮食注意；其他备注；结尾礼貌语
4. 语气自然、适合电话朗读，2～4 句，全部日语

#### 英语

1. 自然问候 + 简要介绍（代客预约）
2. 必须包含：第一希望日期时间；第二希望；人数；饮食限制；其他备注
3. 若提联络方式，使用订单中的 contact phone
4. 结尾礼貌语，只输出英语

### 4.5 结束判定（done / call_result）

| 语言 | AI 回复含 | 对方发言含 | 结果 |
|------|-----------|------------|------|
| **日语** | ありがとう、失礼いたします、承知、かしこまりました | いっぱい、満席、無理、できません | `done=true`, `call_result='full'` |
| **日语** | 同上 | 其他 | `done=true`, `call_result='success'` |
| **英语** | thank you、thanks、goodbye、have a nice day | fully booked、no availability、unavailable、sold out | `done=true`, `call_result='full'` |
| **英语** | 同上 | 其他 | `done=true`, `call_result='success'` |

### 4.6 输出约束与兜底

| 语言 | 异常处理 | 默认兜底 |
|------|----------|----------|
| **日语** | 若输出含中文 → 强制再生成一次，要求只输出日语 | `ご確認のほど、よろしくお願いいたします。` |
| **英语** | 无类似中文检测（英语模式无此问题） | 代码中与日语共用兜底，建议补充英语兜底 |

### 4.7 错误回复

| 语言 | 连接错误时 |
|------|------------|
| **日语** | `申し訳ございません。通信に問題が発生しました。` |
| **英语** | `Sorry, there was a connection issue.` |

---

## 五、预生成首句（twilioCall + firstMessageCache）

| 项目 | 日语 | 英语 |
|------|------|------|
| **触发** | 发起外呼时 `setImmediate` 后台执行 | 同左 |
| **输入** | 典型接听语「はい」 | 典型接听语 "Hello" |
| **输出** | 首句日语 + 阿里云 TTS URL | 首句英语 + 阿里云 TTS URL |
| **缓存** | `order_no` → `{ text_ja, ttsUrl, lang }`，5 分钟过期 | 同左 |
| **使用** | 首轮优先取缓存，避免 502 | 同左 |

---

## 六、ASR / TTS 按语言

| 组件 | 日语 | 英语 |
|------|------|------|
| **ASR** | `transcribeJaFromUrl` / `transcribeFromUrl(..., { lang: 'ja' })` | `transcribeEnFromUrl` / `transcribeFromUrl(..., { lang: 'en' })` |
| **TTS** | `synthesizeJaToUrl` | `synthesizeEnToUrl` |
| **阿里云 AppKey** | `ALI_APP_KEY_JA` 或 `ALIYUN_APP_KEY_JA` | `ALI_APP_KEY_EN` 或 `ALIYUN_APP_KEY_EN` |
| **TTS 发音人** | `ALIYUN_TTS_VOICE_JA` | `ALIYUN_TTS_VOICE_EN` |

**voiceRecordHandler**：每轮 Record 结束后，应按 `order.call_lang` 选择对应 ASR 模型转写对方发言。

**recordingHandler**：通话结束后整段录音转写，已按 `order.call_lang` 选择 ASR。

---

## 七、通话时序

| 阶段 | 日语 | 英语 |
|------|------|------|
| 接听 | Record 5 秒，等对方说「はい」「もしもし」等 | Record 5 秒，等对方说 "Hello" / "Yes" 等 |
| 首轮 | ASR(ja) → 预生成或 LLM → TTS(ja) → Play + Record 30 秒 | ASR(en) → 预生成或 LLM → TTS(en) → Play + Record 30 秒 |
| 后续轮 | 同左 | 同左 |
| 结束 | Say 日语结束语 + Hangup | Say 英语结束语 + Hangup |

**结束语**：
- 日语：`ご確認ありがとうございます。失礼いたします。`
- 英语：`Thank you for confirming. Goodbye.`

---

## 八、固定话术模式（handleLegacy）

当未配置阿里云语音 AppKey 时使用，**仅日语**：

1. こんにちは。お客様の代わりにご予約のお電話をさせていただいております。
2. 第一希望は、X月X日のXX時でございます。（第二希望若有）
3. 大人X名様、お子様X名様でご予約をお願いいたします。（或 X名様で）
4. 食事に関するご要望がございます。+ 具体内容（若有）
5. その他、ご要望は以下のとおりです。+ 备注（若有）
6. ご対応のほど、よろしくお願いいたします。
7. Gather（等待按键或 8 秒）
8. 何かご質問がございましたら、お申し付けください。
9. redirect → done：ご確認ありがとうございます。それでは失礼いたします。+ 挂断

> 英语模式无固定话术，需配置 `ALI_APP_KEY_EN` 才能使用多轮对话。

---

## 九、录音后处理（recordingHandler）

| 项目 | 日语 | 英语 |
|------|------|------|
| **ASR** | `transcribeFromUrl(..., { lang: 'ja' })` | `transcribeFromUrl(..., { lang: 'en' })` |
| **摘要** | 日语转写 → 中文摘要（2–4 句） | 英语转写 → 中文摘要（2–4 句） |
| **翻译** | 日语 → 中文 | 英语 → 中文（直接作为 transcript_cn） |

---

## 十、多轮上限

- `MAX_ROUNDS = 8`（voiceRecordHandler.js）
- 即最多 8 轮「餐厅 → AI」交替，共 16 条 call_records

---

## 十一、实现注意（待完善）

1. ~~**voiceRecordHandler ASR**~~：已修复，按 `order.call_lang` 选择 `transcribeJaFromUrl` 或 `transcribeEnFromUrl`。
2. ~~**aiDialogue 兜底**~~：已修复，英语模式使用 `Thank you. We appreciate your help.`。
3. **固定话术模式**：若需支持英语订单在无阿里云配置时使用，需实现 handleLegacy 的英语版本（Polly 英语发音人）。
