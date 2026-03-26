# Railway 部署步骤（一步一步）

## 前提

- 项目已推送到 GitHub：<https://github.com/wangyaobai/motbot-AIJPReservation>
- 你有 GitHub 账号，并已用该账号登录过 Railway（或准备用 GitHub 登录 Railway）

---

## 第一步：打开 Railway 并登录

1. 浏览器打开：**https://railway.app**
2. 点击右上角 **Login**
3. 选择 **Login with GitHub**，按提示用你的 GitHub 账号授权

---

## 第二步：从 GitHub 创建新项目

1. 登录后，在 Dashboard 点击 **New Project**
2. 选择 **Deploy from GitHub repo**
3. 若第一次用，会提示 **Configure GitHub App**，点进去给 Railway 授权访问你的 GitHub 仓库
4. 在仓库列表里找到 **motbot-AIJPReservation**（或 wangyaobai/motbot-AIJPReservation），点选它
5. 点击 **Deploy now** 或 **Add repository**，Railway 会拉取代码并开始第一次构建

---

## 第三步：确认根目录和构建命令

1. 在项目里点进刚创建的服务（一个卡片）
2. 点 **Settings**（或齿轮图标）
3. 找到 **Build** 或 **Root Directory**：
   - **Root Directory**：留空（表示用仓库根目录，即包含 `package.json`、`frontend`、`backend` 的那一层）
4. 找到 **Build Command**：
   - 填：`npm run build`  
   - 若 Railway 已自动识别，且显示为 `npm run build`，可不动
5. 找到 **Start Command** 或 **Start**：
   - 填：`npm start`  
   - 若已是 `npm start`，可不动
6. 保存（如有 Save 按钮）

---

## 第四步：生成公网域名

1. 在同一服务的 **Settings** 里，找到 **Networking** 或 **Public Networking**
2. 点击 **Generate Domain**（或 **Add domain** → 选 Railway 提供的域名）
3. 记下生成的域名，形如：**`motbot-aijpreservation-production-xxxx.up.railway.app`**  
   或短一点：**`xxx.up.railway.app`**
4. 完整地址就是：**https://你看到的域名**（例如 `https://motbot-aijpreservation-production-xxxx.up.railway.app`）

---

## 第五步：配置环境变量

1. 在服务页面点 **Variables**（或 **Environment** / **Env**）
2. 点 **New Variable** 或 **Add Variable**，逐条添加：

   | 变量名 | 值 | 说明 |
   |--------|-----|------|
   | `NODE_ENV` | `production` | 若不自动带，就手动加 |
   | `BASE_URL` | `https://第四步里的域名` | 把「第四步里的域名」换成你真实域名，不要末尾斜杠 |

   **可选（以后开通电话、搜索、摘要时再填）：**

   | 变量名 | 值 |
   |--------|-----|
   | `TWILIO_ACCOUNT_SID` | 你的 Twilio SID |
   | `TWILIO_AUTH_TOKEN` | 你的 Twilio Token |
   | `TWILIO_PHONE_NUMBER` | 你的 Twilio 号码（如 +1234567890） |
   | `OPENAI_API_KEY` | 你的 OpenAI Key |

3. 每填一条点 **Add** 或确认，全部填完即可

---

## 第六步：等待部署完成

1. 回到 **Deployments** 或 **Overview**
2. 看当前部署状态：
   - **Building**：正在安装依赖、执行 `npm run build`
   - **Success** / **Active**：部署成功
   - **Crashed** / **Error**：点进去看日志，根据报错排查
3. 第一次构建可能 2～5 分钟，成功后会显示 **Deployed**

---

## 第七步：访问你的应用

1. 在 **Networking** 里点你生成的域名，或直接浏览器打开：**https://你的域名**
2. 应看到 **日本餐厅 AI 代预约** 的预约首页
3. 后台地址：**https://你的域名/admin**

---

## 推荐列表秒开（预热）

- 后端启动后会自动在后台预热 9 个城市的推荐列表（约 2 分钟内完成），写入 SQLite。之后用户进入任意城市都会**秒开**（先返回上一份缓存，再后台刷新）。
- 若希望部署后**第一时间**所有城市就秒开，可在部署成功后执行一次预热（需服务已运行）：
  - 在本地执行：`BASE_URL=https://你的域名 node backend/scripts/warm-recommendations.js`  
  或进入 backend 目录执行：`BASE_URL=https://你的域名 npm run warm`
- 若不想自动预热，在 Railway Variables 里加 `SKIP_WARM_RECOMMENDATIONS=1` 即可。

### 预加载数据尽量无兜底图（可选）

1. **预热**：先跑完 `warm`（见上），让每个城市有一份推荐列表写入 `recommendations_best`。
2. **精修**：在 backend 目录执行 `npm run refine-images`，会对列表中仍是兜底图的餐厅用「特色/菜名」模糊搜图补上，并写回 SQLite。
3. **仍有兜底时**：打开后台 **封面图管理**（`/admin` → 封面图管理），列表里会只显示仍缺封面的餐厅，可逐个填写图片 URL 并保存，保存后首页该店会显示你填的图。

---

## 常见问题

- **构建失败**：看 Deployments 里该次部署的 **Build Logs**，常见是 Node 版本或 `npm run build` 报错，按提示改。
- **打开域名空白或 502**：先看 **Deploy Logs**（运行日志），确认 `npm start` 是否正常、是否监听了 `PORT`。
- **BASE_URL 要改**：Variables 里改掉 `BASE_URL`，保存后 Railway 会重新部署；改完后 Twilio 回调地址要用新的 `BASE_URL`。

---

## 小结

| 步骤 | 做什么 |
|------|--------|
| 1 | 打开 railway.app，用 GitHub 登录 |
| 2 | New Project → Deploy from GitHub repo → 选 motbot-AIJPReservation |
| 3 | Settings 里确认 Root 为空、Build 为 `npm run build`、Start 为 `npm start` |
| 4 | Networking → Generate Domain，记下域名 |
| 5 | Variables 里加 `NODE_ENV=production`、`BASE_URL=https://你的域名` |
| 6 | 等部署状态变为 Success |
| 7 | 浏览器打开 https://你的域名 和 https://你的域名/admin |
