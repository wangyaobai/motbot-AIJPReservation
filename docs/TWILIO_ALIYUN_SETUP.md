# Twilio 电话 + 阿里云语音 配置指南

本文说明在 **Twilio 控制台** 和 **阿里云控制台** 中需要做的操作，以便 AI 代打电话功能正常工作。

---

## 一、Twilio 配置

### 1. 获取凭证（已有可跳过）

1. 登录 [Twilio Console](https://console.twilio.com)
2. 在首页或 **Account** 区域可见：
   - **Account SID** → 填入 `TWILIO_ACCOUNT_SID`
   - **Auth Token**（点击显示）→ 填入 `TWILIO_AUTH_TOKEN`

### 2. 购买/配置电话号码

1. 进入 **Phone Numbers** → **Manage** → **Buy a number**
2. 选择支持 **Voice** 的号码（可同时支持 SMS，用于发摘要短信）
3. 购买后得到如 `+13136312012` → 填入 `TWILIO_PHONE_NUMBER`

> **重要**：本项目是**外呼**（你主动打给餐厅），Webhook URL 在每次发起通话时通过 API 传入，**无需**在 Twilio 控制台为号码配置 Voice URL。

### 3. 试用账号限制（Trial Account）

若为 **Trial** 账号：

- 只能拨打 **已验证号码**
- 进入 **Phone Numbers** → **Manage** → **Verified Caller IDs**
- 添加并验证你要测试的「餐厅电话」（会收到验证码短信/电话）
- 验证通过后，该号码才能被外呼

正式付费账号无此限制，可拨打任意号码。

### 4. Twilio 控制台无需额外设置

- 不需要在号码上配置 Voice Webhook URL
- 不需要在 Console 填写 `https://aireservation.top/...` 等地址
- 所有回调地址由后端在 `calls.create()` 时动态传入

---

## 二、阿里云配置（智能语音 ASR/TTS）

AI 通话的**日语/英语语音识别（ASR）**和**语音合成（TTS）**使用阿里云智能语音交互服务。  
若未配置，系统会退回 Twilio 自带的 Polly 固定话术（仅日语，无多轮对话）。

### 1. 开通智能语音交互服务

1. 登录 [阿里云控制台](https://www.aliyun.com)
2. 搜索「**智能语音交互**」或进入 [产品页](https://ai.aliyun.com/nls)
3. 点击「**开通并购买**」
4. 选择 **免费试用版**（3 个月）或 **商用版**，完成开通

### 2. 创建 AccessKey（可与短信共用）

1. 进入 [RAM 访问控制](https://ram.console.aliyun.com/manage/ak)
2. 创建 AccessKey，得到：
   - **AccessKey ID** → `ALIYUN_ACCESS_KEY_ID`
   - **AccessKey Secret** → `ALIYUN_ACCESS_KEY_SECRET`（创建时仅显示一次，请保存）

> 若已为短信配置过，可直接复用，无需新建。

### 3. 创建语音项目并获取 AppKey

1. 登录 [智能语音交互控制台](https://nls-portal.console.aliyun.com/overview)
2. 左侧点击「**全部项目**」
3. 点击「**创建项目**」
4. 填写：
   - **项目名称**：如 `restaurant-ja`（日语）、`restaurant-en`（英语）
   - **项目类型**：选择「**语音识别+语音合成+语音分析**」
   - **项目场景**：可填「餐厅预约电话」
5. 创建完成后，在项目列表中点击该项目
6. 在项目详情中找到 **AppKey**（一串字符）→ 填入 `.env`：
   - 日语项目 → `ALI_APP_KEY_JA`
   - 英语项目（可选）→ `ALI_APP_KEY_EN`

### 4. 配置项目功能（语音合成发音人）

1. 在项目详情中进入「**项目功能配置**」或「**语音合成**」配置
2. 选择 **语音合成模型**，并选择发音人（如日语「智也」）
3. 在线试听后保存

> 若不配置 `ALIYUN_TTS_VOICE_JA`，将使用控制台该项目的默认发音人。

### 5. 服务器需安装 ffmpeg（录音转写）

Twilio 录音为 22050Hz，阿里云 ASR 仅支持 8000/16000Hz。后端会用 ffmpeg 自动重采样，需在服务器安装：

```bash
# Ubuntu/Debian
apt-get update && apt-get install -y ffmpeg

# 验证
ffmpeg -version
```

### 6. RAM 权限（若用 RAM 用户）

若使用 RAM 子账号的 AccessKey，需为该用户授予 **AliyunNLSFullAccess** 权限：

1. 进入 [RAM 用户管理](https://ram.console.aliyun.com/users)
2. 选择对应用户 → 添加权限 → 搜索 `AliyunNLSFullAccess` → 确定

---

## 三、环境变量汇总

将上述配置填入 `backend/.env`：

```bash
# Twilio
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=你的AuthToken
TWILIO_PHONE_NUMBER=+13136312012

# 公网 HTTPS，供 Twilio 回调
BASE_URL=https://aireservation.top

# 阿里云（可与短信共用 AccessKey）
ALIYUN_ACCESS_KEY_ID=LTAI5txxxxxxxx
ALIYUN_ACCESS_KEY_SECRET=xxxxxxxxxxxxxxxx
ALIYUN_REGION=cn-shanghai

# 阿里云智能语音项目 AppKey
ALI_APP_KEY_JA=xxxxxxxxxxxxxxxx    # 日语项目
ALI_APP_KEY_EN=xxxxxxxxxxxxxxxx    # 英语项目（可选）
```

---

## 四、验证流程

1. 重启后端服务
2. 创建订单，填写**已验证**的测试号码（Trial 账号）
3. 点击「立即代打电话」
4. 接听电话，应听到日语/英语 AI 说明预约内容
5. 在 [Twilio Monitor → Logs](https://console.twilio.com/us1/monitor/logs) 查看 Webhook 请求是否返回 200

---

## 五、常见问题

| 现象 | 可能原因 |
|------|----------|
| 提示「电话服务暂未配置」 | 检查 Twilio 四项 + BASE_URL 是否都填 |
| 403 / 仅允许已验证号码 | Trial 账号，需在 Verified Caller IDs 中验证目标号码 |
| 接听后无语音 / 报错 | BASE_URL 非 HTTPS 或 Twilio 无法访问；查看 Twilio Logs |
| 无多轮对话 / 只有固定话术 | 未配置 `ALI_APP_KEY_JA`，系统退回 Polly 模式 |
| TTS 无声音 | 检查 `ALI_APP_KEY_JA`、AccessKey、项目是否开通语音合成 |
| 录音转写失败 40000009（采样率 22050） | 服务器需安装 ffmpeg：`apt-get install -y ffmpeg`，后端会自动将 Twilio 录音转为 16kHz |
