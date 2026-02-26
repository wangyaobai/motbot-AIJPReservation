import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import ordersRouter from './routes/orders.js';
import orderRouter from './routes/order.js';
import userRouter from './routes/user.js';
import adminRouter from './routes/admin.js';
import searchRouter from './routes/search.js';
import twilioRouter from './routes/twilio.js';
import { ensureSchema } from './db.js';
import { optionalAuth } from './middleware/auth.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
ensureSchema();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 用户认证与用户端订单（需登录）
app.use('/api/user', userRouter);
app.use('/api/order', orderRouter);

// 订单创建/列表/详情等：创建时可选携带 Token 以绑定 user_id
app.use('/api/orders', optionalAuth, ordersRouter);
app.use('/api/admin', adminRouter);
app.use('/api/search', searchRouter);
app.use('/api/twilio', twilioRouter);
app.use('/orders', optionalAuth, ordersRouter);
app.use('/search', searchRouter);
app.use('/twilio', twilioRouter);

app.get('/health', (req, res) => res.json({ ok: true }));

// 生产环境：托管前端静态文件（Railway 等单服务部署）
const frontendDist = path.join(__dirname, '..', 'frontend', 'dist');
if (process.env.NODE_ENV === 'production' && fs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path === '/health') return next();
    res.sendFile(path.join(frontendDist, 'index.html'));
  });
}

const PORT = parseInt(process.env.PORT, 10) || 3000;
const MAX_TRY = 10;

function tryListen(port, attempt = 0) {
  if (attempt >= MAX_TRY) {
    console.error(`Ports ${PORT}～${PORT + MAX_TRY - 1} 均被占用，请先结束占用进程或设置 PORT=其他端口`);
    process.exit(1);
  }
  const server = app.listen(port, () => {
    console.log(`Server running on port ${port}`);
    if (port !== PORT) {
      console.warn(`前端代理请指向: http://localhost:${port}（修改 frontend/vite.config.js 的 proxy["/api"].target）`);
    }
  });
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`Port ${port} in use, trying ${port + 1}...`);
      tryListen(port + 1, attempt + 1);
    } else {
      throw err;
    }
  });
}

tryListen(PORT);
