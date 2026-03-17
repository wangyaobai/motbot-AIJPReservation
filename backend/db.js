import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const dbPath = path.join(dataDir, 'bookings.db');
const db = new Database(dbPath);

export function ensureSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_no TEXT UNIQUE NOT NULL,
      restaurant_name TEXT,
      restaurant_phone TEXT NOT NULL,
      booking_date TEXT NOT NULL,
      booking_time TEXT NOT NULL,
      party_size INTEGER NOT NULL,
      flexible_hour INTEGER DEFAULT 0,
      want_set_meal INTEGER DEFAULT 0,
      contact_name TEXT NOT NULL,
      contact_phone TEXT NOT NULL,
      contact_phone_region TEXT DEFAULT 'cn',
      status TEXT DEFAULT 'pending',
      twilio_call_sid TEXT,
      recording_url TEXT,
      recording_duration_sec INTEGER,
      summary_text TEXT,
      sms_sent INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_orders_contact ON orders(contact_name, contact_phone);
    CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
  `);
  try { db.exec('ALTER TABLE orders ADD COLUMN adult_count INTEGER'); } catch {}
  try { db.exec('ALTER TABLE orders ADD COLUMN child_count INTEGER'); } catch {}
  try { db.exec('ALTER TABLE orders ADD COLUMN user_id TEXT'); } catch {}
  try { db.exec('ALTER TABLE orders ADD COLUMN bind_time TEXT'); } catch {}
  try { db.exec('ALTER TABLE orders ADD COLUMN ai_call_status_text TEXT'); } catch {}
  try { db.exec('ALTER TABLE orders ADD COLUMN ai_call_status_updated_at TEXT'); } catch {}
  try { db.exec('ALTER TABLE orders ADD COLUMN ai_call_attempt_count INTEGER'); } catch {}
  try { db.exec('ALTER TABLE orders ADD COLUMN ai_last_attempt_at TEXT'); } catch {}
  try { db.exec('ALTER TABLE orders ADD COLUMN ai_call_est_at TEXT'); } catch {}
  try { db.exec('ALTER TABLE orders ADD COLUMN ai_call_status_type TEXT'); } catch {}
  try { db.exec('ALTER TABLE orders ADD COLUMN ai_call_status_log TEXT'); } catch {}
  try { db.exec('ALTER TABLE orders ADD COLUMN second_booking_date TEXT'); } catch {}
  try { db.exec('ALTER TABLE orders ADD COLUMN second_booking_time TEXT'); } catch {}
  try { db.exec('ALTER TABLE orders ADD COLUMN dietary_notes TEXT'); } catch {}
  try { db.exec('ALTER TABLE orders ADD COLUMN booking_remark TEXT'); } catch {}
  try { db.exec('ALTER TABLE orders ADD COLUMN restaurant_address TEXT'); } catch {}
  try { db.exec('ALTER TABLE orders ADD COLUMN sms_body TEXT'); } catch {}
  try { db.exec('ALTER TABLE orders ADD COLUMN call_lang TEXT'); } catch {}
  try { db.exec('ALTER TABLE orders ADD COLUMN call_records TEXT'); } catch {}
  try { db.exec('ALTER TABLE orders ADD COLUMN call_result TEXT'); } catch {}
  try { db.exec('ALTER TABLE orders ADD COLUMN transcript_full TEXT'); } catch {}
  try { db.exec('ALTER TABLE orders ADD COLUMN transcript_cn TEXT'); } catch {}

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      uid TEXT PRIMARY KEY,
      phone TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      nickname TEXT,
      create_time TEXT DEFAULT (datetime('now')),
      last_login_time TEXT,
      status INTEGER DEFAULT 1
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_phone ON users(phone);
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS login_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      login_time TEXT DEFAULT (datetime('now')),
      ip TEXT,
      device TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_login_log_user ON login_log(user_id);
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS verification_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone TEXT NOT NULL,
      code TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_vc_phone ON verification_codes(phone);
  `);

  // 推荐餐厅“最佳媒体”缓存：一旦命中非兜底图就持久化保存，加速首页加载
  db.exec(`
    CREATE TABLE IF NOT EXISTS restaurant_media_best (
      cache_key TEXT PRIMARY KEY,
      city_hint TEXT,
      restaurant_name TEXT,
      data_json TEXT NOT NULL,
      manual_image_url TEXT,
      manual_enabled INTEGER DEFAULT 1,
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_restaurant_media_best_city ON restaurant_media_best(city_hint);
  `);

  // 兼容旧库：补充手动封面字段
  try { db.exec('ALTER TABLE restaurant_media_best ADD COLUMN manual_image_url TEXT'); } catch {}
  try { db.exec('ALTER TABLE restaurant_media_best ADD COLUMN manual_enabled INTEGER DEFAULT 1'); } catch {}

  // 推荐餐厅列表持久缓存（SWR）：用于“秒回上一份列表”，再后台刷新
  db.exec(`
    CREATE TABLE IF NOT EXISTS recommendations_best (
      cache_key TEXT PRIMARY KEY,
      country TEXT NOT NULL,
      city_key TEXT NOT NULL,
      city_zh TEXT,
      restaurants_json TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_recommendations_best_cc ON recommendations_best(country, city_key);
  `);

  // 翻译结果持久缓存：避免英文模式重复调用外部翻译服务（重启也秒回）
  db.exec(`
    CREATE TABLE IF NOT EXISTS translate_cache (
      cache_key TEXT PRIMARY KEY,
      translated TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // 兜底数据：refresh 前备份 recommendations_best，供后台管理
  db.exec(`
    CREATE TABLE IF NOT EXISTS recommendations_fallback (
      cache_key TEXT PRIMARY KEY,
      country TEXT NOT NULL,
      city_key TEXT NOT NULL,
      city_zh TEXT,
      restaurants_json TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_recommendations_fallback_cc ON recommendations_fallback(country, city_key);
  `);

  // 爬取原始数据：供后台查看、补封面、人工确认后进入前端展示
  db.exec(`
    CREATE TABLE IF NOT EXISTS recommendations_crawled (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cache_key TEXT NOT NULL UNIQUE,
      country TEXT NOT NULL,
      city_key TEXT NOT NULL,
      city_zh TEXT,
      restaurants_json TEXT NOT NULL,
      crawled_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_recommendations_crawled_cc ON recommendations_crawled(country, city_key);
  `);
}

export function getDb() {
  return db;
}

export function generateOrderNo() {
  const t = new Date();
  const y = t.getFullYear();
  const m = String(t.getMonth() + 1).padStart(2, '0');
  const d = String(t.getDate()).padStart(2, '0');
  const h = String(t.getHours()).padStart(2, '0');
  const min = String(t.getMinutes()).padStart(2, '0');
  const s = String(t.getSeconds()).padStart(2, '0');
  const r = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `RB${y}${m}${d}${h}${min}${s}${r}`;
}

/** 生成唯一用户 UID（10 位字母数字） */
export function generateUid() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let uid = 'u';
  for (let i = 0; i < 9; i++) uid += chars[Math.floor(Math.random() * chars.length)];
  const db = getDb();
  const exists = db.prepare('SELECT 1 FROM users WHERE uid = ?').get(uid);
  return exists ? generateUid() : uid;
}
