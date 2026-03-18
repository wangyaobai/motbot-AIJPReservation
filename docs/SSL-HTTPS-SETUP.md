# SSL 证书申请与 HTTPS 配置指南

适用于 aireservation.top，阿里云 + Nginx。

---

## 第一步：申请免费 SSL 证书

### 1.1 进入证书控制台

1. 登录 [阿里云控制台](https://www.aliyun.com)
2. 搜索 **「SSL 证书」** 或 **「数字证书管理服务」**
3. 进入 [SSL 证书控制台](https://yundun.console.aliyun.com/?spm=5176.12818093.ProductAndService--ali--widget-product-recent.dre1.6d6c16d0pLqL0V&p=cas)

### 1.2 购买免费证书

1. 左侧点击 **「SSL 证书」** → **「免费证书」**
2. 点击 **「立即购买」** 或 **「创建证书」**
3. 选择 **「DV 单域名证书」**（免费，每个账号可申请多张）
4. 支付 0 元完成

### 1.3 创建并绑定域名

1. 在免费证书列表中，找到刚购买的证书
2. 点击 **「证书申请」** 或 **「创建」**
3. 填写信息：
   - **域名**：`aireservation.top`（如需 www，可再申请一张 `www.aireservation.top`，或选「通配符」）
   - **域名验证方式**：选择 **「DNS 验证」**（推荐）
4. 提交申请

### 1.4 完成 DNS 验证

1. 证书控制台会显示一条 **TXT 记录**，例如：
   - 主机记录：`_dnsauth` 或 `_dnsauth.aireservation`
   - 记录值：一串随机字符
2. 进入 **云解析 DNS** → 选择 `aireservation.top` → **解析设置**
3. 点击 **「添加记录」**：
   - 记录类型：`TXT`
   - 主机记录：按控制台提示填写（通常是 `_dnsauth`）
   - 记录值：从证书控制台复制
   - TTL：600
4. 保存后，回到证书控制台点击 **「验证」**
5. 等待约 5–15 分钟，状态变为 **「已签发」**

### 1.5 下载证书

1. 证书状态为 **「已签发」** 后，点击 **「下载」**
2. 选择 **「Nginx」** 格式
3. 下载得到压缩包，解压后通常包含：
   - `xxxxx.pem`（证书文件）
   - `xxxxx.key`（私钥文件）

---

## 第二步：上传证书到服务器

### 2.1 创建证书目录

在服务器上执行：

```bash
sudo mkdir -p /etc/nginx/cert
```

### 2.2 上传文件

将本地的 `xxxxx.pem` 和 `xxxxx.key` 上传到服务器的 `/etc/nginx/cert/` 目录。

**方式一：scp（在本地 Mac 终端执行）**

```bash
scp /path/to/xxxxx.pem root@47.90.218.160:/etc/nginx/cert/aireservation.pem
scp /path/to/xxxxx.key root@47.90.218.160:/etc/nginx/cert/aireservation.key
```

**方式二：在服务器上手动创建**

```bash
sudo nano /etc/nginx/cert/aireservation.pem
# 粘贴 .pem 文件内容，保存

sudo nano /etc/nginx/cert/aireservation.key
# 粘贴 .key 文件内容，保存
```

### 2.3 设置权限

```bash
sudo chmod 600 /etc/nginx/cert/aireservation.key
sudo chmod 644 /etc/nginx/cert/aireservation.pem
```

---

## 第三步：配置 Nginx

### 3.1 编辑 motbot 配置

```bash
sudo nano /etc/nginx/sites-enabled/motbot.conf
```

### 3.2 替换为以下内容

```nginx
# HTTP -> HTTPS 重定向
server {
    listen 80;
    server_name aireservation.top www.aireservation.top 47.90.218.160;
    return 301 https://$server_name$request_uri;
}

# HTTPS
server {
    listen 443 ssl;
    server_name aireservation.top www.aireservation.top 47.90.218.160;

    ssl_certificate /etc/nginx/cert/aireservation.pem;
    ssl_certificate_key /etc/nginx/cert/aireservation.key;
    ssl_session_timeout 5m;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-RSA-AES128-GCM-SHA256:HIGH:!aNULL:!MD5:!RC4:!DHE;

    client_max_body_size 20m;

    location / {
        proxy_pass http://127.0.0.1:3006;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

**注意：** 若证书文件名不同，请将 `aireservation.pem` 和 `aireservation.key` 改为实际文件名。

### 3.3 测试并重载 Nginx

```bash
nginx -t
nginx -s reload
```

---

## 第四步：开放 443 端口

### 4.1 阿里云安全组

1. 进入 [ECS 控制台](https://ecs.console.aliyun.com) → **实例**
2. 点击实例 → **安全组** → **配置规则**
3. **入方向** → **手动添加**：
   - 端口：`443/443`
   - 授权对象：`0.0.0.0/0`
   - 描述：HTTPS

### 4.2 服务器防火墙（如有）

```bash
sudo ufw allow 443
sudo ufw reload
```

---

## 第五步：更新 BASE_URL

将 `.env` 中的 `BASE_URL` 改为 HTTPS：

```
BASE_URL=https://aireservation.top
```

然后重启应用：

```bash
pm2 restart motbot-app --update-env
```

---

## 验证

1. 浏览器访问 `https://aireservation.top`
2. 地址栏应显示锁形图标
3. 访问 `http://aireservation.top` 应自动跳转到 `https://`

---

## 常见问题

**Q: 证书有效期多久？**  
A: 免费 DV 证书通常 3 个月，到期前需重新申请并替换。

**Q: 支持 www 吗？**  
A: 单域名证书只覆盖 `aireservation.top` 或 `www.aireservation.top` 其一。如需同时支持，可申请两张证书，或使用通配符证书（付费）。

**Q: 配置后仍提示不安全？**  
A: 检查证书路径、Nginx 配置、443 端口是否开放，以及证书是否已正确签发。
