# 订单状态逻辑与前后端联动

## 一、状态枚举与展示名

| 状态值 (status) | 展示名 | 说明 |
|-----------------|--------|------|
| `pending_pay`   | 待支付 | 订单已创建，等待支付（当前为占位，点击「支付」即视为完成） |
| `pending`       | 预约中 | 已支付，等待用户点击「立即代打电话」 |
| `calling`       | 预约中 | 已发起外呼，正在与餐厅通话 |
| `completed`    | 预约成功 | 通话结束，已录音、摘要、短信 |
| `failed`       | 预约失败 | 预留：通话未接通或失败时使用 |
| `cancelled`     | 已取消 | 用户或管理员取消 |

---

## 二、状态前后顺序与流转

```
                    ┌─────────────┐
                    │  创建订单   │
                    │  POST /    │
                    └──────┬──────┘
                           ▼
                    ┌─────────────┐
    ┌───────────────│ 待支付      │───────────────┐
    │ 取消          │ pending_pay│               │ 支付（占位）
    │ POST /cancel  └──────┬──────┘               │ POST /confirm-payment
    │                      │                       ▼
    │                      │                ┌─────────────┐
    │                      │                │ 预约中      │
    │                      │                │ pending    │
    │                      │                └──────┬──────┘
    │                      │                       │ 立即代打电话
    │                      │                       │ POST /call
    │                      │                       ▼
    │                      │                ┌─────────────┐
    │                      │   取消         │ 预约中      │
    │                      └───────────────►│ calling    │
    │                       POST /cancel    └──────┬──────┘
    │                                              │ Twilio 录音回调
    │                                              │ /twilio/recording
    │                                              ▼
    │                                       ┌─────────────┐
    │                                       │ 预约成功    │
    └──────────────────────────────────────►│ completed  │
                (不可再取消)                  └─────────────┘

  failed（预约失败）：预留，可由 Twilio 通话失败/未接通回调写入。
```

**顺序小结**：`待支付` → `预约中(pending)` → `预约中(calling)` → `预约成功`；任意未终态可 → `已取消`。

---

## 三、谁在什么时候改状态（前后台 + 后端）

| 状态变化 | 触发方 | 方式 |
|----------|--------|------|
| → 待支付 | 后端 | 创建订单时写入 `pending_pay` |
| 待支付 → 预约中 | **用户端前端** | 点击「支付」→ 调 `POST /orders/:orderNo/confirm-payment` → 后端改为 `pending` |
| 预约中(pending) → 预约中(calling) | **用户端前端** | 点击「立即代打电话」→ 调 `POST /orders/:orderNo/call` → 后端发起 Twilio 外呼并写入 `calling` |
| 预约中(calling) → 预约成功 | **后端** | Twilio 录音回调 `POST /twilio/recording` → recordingHandler 里写入 `completed`、摘要、短信 |
| → 已取消 | **管理后台前端** 或（后续）用户端 | 点击「取消」→ 调 `POST /orders/:orderNo/cancel` → 后端改为 `cancelled`（仅当非 completed/cancelled） |
| → 预约失败 | **后端**（预留） | 暂未实现，可后续在 Twilio 通话失败/未接通回调里写入 `failed` |

---

## 四、后端接口与状态约束

| 接口 | 方法 | 作用 | 状态约束 |
|------|------|------|----------|
| `/orders` | POST | 创建订单 | - |
| `/orders` | GET | 管理后台列表（支持 ?status= 筛选） | - |
| `/orders/by-user` | GET | 按联系人姓名/手机查订单 | - |
| `/orders/:orderNo` | GET | 单笔详情 | - |
| `/orders/:orderNo/confirm-payment` | POST | 支付完成（占位） | 仅 `pending_pay` → 改为 `pending` |
| `/orders/:orderNo/call` | POST | 发起 AI 外呼 | 仅 `pending` 可调用，否则提示「请先完成支付」 |
| `/orders/:orderNo/cancel` | POST | 取消订单 | 仅当状态不是 `completed`、`cancelled` 时可取消 |

**Twilio 回调（后端自动）**：

| 路径 | 方法 | 作用 | 状态影响 |
|------|------|------|----------|
| `/twilio/voice/:orderNo` | GET/POST | 外呼时拉取 TwiML（日语话术） | 不写库 |
| `/twilio/recording` | POST | 录音结束回调 | 更新录音 URL、摘要、**status → completed**、发短信 |

---

## 五、前端与状态联动

### 用户端（预约页 / 预约结果页）

- **待支付 (pending_pay)**：展示「请完成支付…」+ 按钮「支付」→ 请求 `confirm-payment`，成功后本单变为预约中。
- **预约中 (pending)**：展示「立即代打电话」→ 请求 `call`，成功后变为 calling，可展示「正在拨打…」。
- **预约中 (calling)**：可展示「正在拨打餐厅电话…」；列表/详情可展示 calling。
- **预约成功 (completed)**：展示摘要、录音链接、短信已发等，无「支付」「代打电话」按钮。
- **已取消 (cancelled)**：仅展示状态与信息，无操作按钮。

### 管理后台（/admin）

- **列表**：按「预约状态」筛选，选项对应：全部、待支付、预约中(pending+calling)、预约成功、预约失败、已取消。
- **操作**：「详情」弹窗仅展示；「取消」仅在状态不为 `completed`、`cancelled` 时显示，调用 `POST /orders/:orderNo/cancel`。

---

## 六、后续可扩展

- **真实支付**：支付成功回调或前端支付成功页调 `POST /orders/:orderNo/confirm-payment`，无需改状态枚举。
- **预约失败**：在 Twilio 的 Call 状态回调（如 status=busy/failed/no-answer）中，将对应订单 `status` 更新为 `failed`。
