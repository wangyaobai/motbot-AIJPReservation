# 用户注册登录 & 订单管理 - 实现说明

本文档对应 PRD「用户注册登录&订单管理」的落地实现，便于联调与后续扩展。

## 一、后端

### 1. 数据表

- **users**：uid（主键）、phone（唯一）、password（bcrypt）、nickname、create_time、last_login_time、status（1 正常 0 禁用）
- **login_log**：id、user_id、login_time、ip、device
- **verification_codes**：id、phone、code、expires_at、created_at（验证码 5 分钟有效）
- **orders** 新增：user_id、bind_time

均在 `ensureSchema()` 中创建/迁移，启动即生效。

### 2. 接口一览

| 路径 | 方法 | 说明 | 鉴权 |
|------|------|------|------|
| /api/user/send-code | POST | 发送短信验证码（60s 冷却，1h 最多 5 次） | 否 |
| /api/user/register | POST | 手机号+验证码+密码+同意协议注册 | 否 |
| /api/user/login | POST | 手机号+密码 或 手机号+验证码 | 否 |
| /api/user/refresh-token | POST | 刷新 JWT | Bearer |
| /api/user/info | GET | 当前用户信息（脱敏） | Bearer |
| /api/user/password/reset | POST | 验证码+新密码重置 | 否 |
| /api/order/list | GET | 用户订单列表，?status=&page=&pageSize= | Bearer |
| /api/order/detail/:orderNo | GET | 订单详情（仅本人） | Bearer |
| /api/order/bind-history | POST | 绑定历史订单，body.contact_phone | Bearer |
| /api/orders | POST | 创建订单，请求头带 Token 时写入 user_id | 可选 |
| /api/orders | GET | 后台订单列表，?status=&user_id= | 否 |
| /api/admin/users | GET | 用户列表（脱敏） | 否 |

JWT 有效期 7 天，密钥由环境变量 `JWT_SECRET` 配置（生产务必修改）。

### 3. 验证码与短信

- 验证码存库，5 分钟有效；同一手机 60 秒内不可重复发送，1 小时内最多 5 次。
- 若配置了 `TWILIO_ACCOUNT_SID`、`TWILIO_AUTH_TOKEN`、`TWILIO_SMS_FROM`（或 `TWILIO_PHONE_NUMBER`），则通过 Twilio 发送短信；未配置时仅落库，可用于本地/测试（需自行查库或后续接其他渠道）。

### 4. 订单归属

- 创建订单时若请求带有效 Token，则写入 `user_id`；未登录创建则为空，后续可在「绑定历史订单」中按联系人手机号绑定到当前用户（近 3 个月、手机号完全匹配）。

---

## 二、前端（H5）

### 1. 路由与流程

- **流程**：打开 H5 → 先进入登录/注册页（或首页选择登录/注册）→ 完成后再进入预约页。
- `/` 首页：未登录显示「登录」「注册」入口；已登录自动跳转到 `/book`。
- `/book` 预约页（需登录）：预约表单与订单结果，未登录会跳转 `/login`。
- `/login` 登录，成功后跳转 `/book`。
- `/register` 注册，成功后跳转 `/book`。
- `/forgot-password` 忘记密码
- `/profile` 个人中心（未登录跳转登录）
- `/orders` 我的订单列表
- `/orders/:orderNo` 订单详情
- `/bind-history` 绑定历史订单
- `/admin` 管理后台

### 2. 登录态

- `AuthContext` 管理 Token 与用户信息，Token 存 `localStorage`（key: `booking_token`），请求通过 `fetchWithAuth` 自动带 `Authorization: Bearer <token>`。
- 首页头部：已登录显示「个人中心」，未登录显示「登录」。

### 3. 注册 / 登录 / 忘记密码

- 注册：手机号、验证码、密码（6–16 位字母+数字）、勾选隐私协议；密码强度提示。
- 登录：手机号+密码 或 手机号+验证码快捷登录。
- 忘记密码：手机号+验证码+新密码，成功后跳转登录。

### 4. 个人中心

- 展示昵称、脱敏手机号；入口：我的订单、绑定历史订单、修改密码、退出登录。

### 5. 我的订单

- 按状态筛选（全部/待支付/预约中/成功/失败/已取消），分页每页 10 条，支持加载更多；点击进入订单详情（支付、代打电话、录音等与现有逻辑一致）。

### 6. 绑定历史订单

- 输入「预约时填写的联系人手机号」，将近 3 个月内、未绑定且手机号一致的订单绑定到当前账号。

---

## 三、管理后台

- 订单列表增加「按用户」筛选（下拉为 `/api/admin/users` 用户列表）。
- 表格增加「用户」列（展示 `user_id`）。
- 其余逻辑（状态筛选、详情、取消）不变。

---

## 四、环境变量（后端）

在 `backend/.env` 中建议配置：

- `JWT_SECRET`：生产环境必填，用于签发/校验 JWT。
- 短信验证码（可选）：`TWILIO_ACCOUNT_SID`、`TWILIO_AUTH_TOKEN`、`TWILIO_SMS_FROM` 或 `TWILIO_PHONE_NUMBER`。

---

## 五、后续可扩展

- 登录失败 3 次图形验证码、记住密码（加密存本地）。
- 管理员登录与后台接口鉴权（如 ADMIN_KEY 或独立管理员表）。
- 用户表禁用/启用、订单操作日志表（绑定/支付/状态变更）。
- 真实支付回调后调用 `confirm-payment` 或直接改状态，无需改现有订单状态机。
