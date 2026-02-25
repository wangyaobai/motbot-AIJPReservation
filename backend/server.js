import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import ordersRouter from './routes/orders.js';
import searchRouter from './routes/search.js';
import twilioRouter from './routes/twilio.js';
import { ensureSchema } from './db.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
ensureSchema();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// API：/api/* 供生产环境同域；/orders 等供本地开发代理
app.use('/api/orders', ordersRouter);
app.use('/api/search', searchRouter);
app.use('/api/twilio', twilioRouter);
app.use('/orders', ordersRouter);
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
