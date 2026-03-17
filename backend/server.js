import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import ordersRouter from './routes/orders.js';
import orderRouter from './routes/order.js';
import userRouter from './routes/user.js';
import adminRouter from './routes/admin.js';
import searchRouter from './routes/search.js';
import recommendationsRouter from './routes/recommendations.js';
import twilioRouter from './routes/twilio.js';
import translateRouter from './routes/translate.js';
import { ensureSchema } from './db.js';
import { optionalAuth } from './middleware/auth.js';
import { startRetryCallScheduler } from './scheduler/retryCall.js';
import { runBuildPreloadAll } from './services/buildPreload.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
ensureSchema();
if (process.env.DISABLE_RETRY_SCHEDULER !== '1') {
  startRetryCallScheduler();
} else {
  console.warn('[server] retryCall scheduler disabled by DISABLE_RETRY_SCHEDULER=1');
}

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// 静态提供 TTS 音频文件，供 Twilio <Play> 访问
app.use('/tts', express.static(path.join(__dirname, 'public', 'tts')));
// 试听接口返回同源 URL 时由前端 /api 代理请求到此，避免跨域/ngrok 导致播放失败
app.use('/api/tts', express.static(path.join(__dirname, 'public', 'tts')));
// 后台上传的封面图（存服务器本地，避免外链失效）
const manualCoversDir = path.join(__dirname, 'public', 'manual-covers');
if (!fs.existsSync(manualCoversDir)) fs.mkdirSync(manualCoversDir, { recursive: true });
// 给封面图加长缓存：中英文切换/刷新时可直接命中浏览器缓存，显著提升加载速度
app.use('/api/manual-covers', express.static(manualCoversDir, { maxAge: '30d', immutable: true }));

// 用户认证与用户端订单（需登录）
app.use('/api/user', userRouter);
app.use('/api/order', orderRouter);

// 订单创建/列表/详情等：创建时可选携带 Token 以绑定 user_id
app.use('/api/orders', optionalAuth, ordersRouter);
app.use('/api/admin', adminRouter);
app.use('/api/search', searchRouter);
app.use('/api/recommendations', recommendationsRouter);
app.use('/api/twilio', twilioRouter);
app.use('/api/translate', translateRouter);
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

function startWarmRecommendations(port) {
  setImmediate(async () => {
    console.log('[warm] 开始构建预加载（每城最多 10 家有封面图：历史+精修+DeepSeek）…');
    try {
      const results = await runBuildPreloadAll(port);
      for (const r of results) {
        if (r?.error) console.log('[warm] %s error:', r.cityKey, r.error);
        else console.log('[warm] %s ok (%d 家)', r.cityKey, r?.count ?? 0);
      }
      console.log('[warm] 预加载构建完成');
    } catch (e) {
      console.warn('[warm] 预加载构建失败', e?.message);
    }
  });
}

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
    if (process.env.SKIP_WARM_RECOMMENDATIONS !== '1') {
      startWarmRecommendations(port);
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
