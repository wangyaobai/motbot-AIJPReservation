# AI 通话速度优化

多轮对话每轮耗时 = **ASR 识别** + **LLM 生成** + **TTS 合成**。本文说明如何加速。

---

## 一、已实现的优化

| 优化项 | 说明 |
|--------|------|
| **max_tokens 降低** | 默认 80，1～2 句回复足够，减少 LLM 生成时间 |
| **temperature=0.1** | 降低随机性，生成更稳定、略快 |
| **历史截断** | 仅保留最近 3 轮对话，减少输入 token |
| **流式输出（可选）** | `AI_STREAM=1` 时 DeepSeek 走流式，可略减延迟 |
| **NLS Token 预热** | 服务启动时预取阿里云 Token，首轮 ASR/TTS 不等待 |
| **首句预生成** | 外呼时后台预生成首句 LLM+TTS，接听后直接播放 |
| **请求超时** | 15 秒超时，避免长时间挂起 |

---

## 二、环境变量（可选）

在 `backend/.env` 中配置：

| 变量 | 说明 | 推荐 |
|------|------|------|
| `AI_MAX_TOKENS=80` | LLM 最大输出 token 数，越小越快（默认 80） | 保持默认 |
| `AI_MAX_HISTORY_TURNS=3` | 仅保留最近 N 轮对话，减少输入 token | 保持默认 |
| `AI_STREAM=1` | DeepSeek 流式输出，可略减延迟 | 可尝试 |
| `AI_REQUEST_TIMEOUT_MS=15000` | LLM 请求超时（毫秒） | 保持默认 |
| `DEBUG_VOICE=1` | 打印每轮 ASR/LLM/TTS 耗时，便于定位瓶颈 | 调试时开启 |

---

## 三、定位瓶颈

开启 `DEBUG_VOICE=1` 后，每轮通话会在后端日志输出类似：

```
[voice] ASR 1200ms
[voice] LLM 3500ms
[voice] TTS 800ms, total 5500ms
```

- **ASR 慢**：多为 Twilio 录音下载 + ffmpeg 重采样 + 阿里云识别。确保服务器在阿里云同地域（如 cn-shanghai），网络稳定。
- **LLM 慢**：检查 DeepSeek API 延迟与网络；若同时有 OpenAI 可配置 `AI_USE_OPENAI=1` 尝试 gpt-4o-mini。
- **TTS 慢**：阿里云 TTS 通常较快，若慢可检查网络与地域。

---

## 四、架构限制

- 每轮必须串行：ASR → LLM → TTS，无法并行。
- Twilio 录音 URL 在录音结束后才可用，需等待 Twilio 完成写入。
- 阿里云一句话识别为 REST 上传，无实时流式接口。

---

## 五、进阶方案（需改架构）

- **实时 ASR**：阿里云百炼/千问提供 WebSocket 实时识别，需在通话时接入流式音频，改动较大。
- **流式 LLM**：首 token 到达即可开始 TTS，但需改造为「边生成边合成」或「首句预合成」，实现复杂。
