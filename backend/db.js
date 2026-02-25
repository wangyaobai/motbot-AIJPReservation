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
