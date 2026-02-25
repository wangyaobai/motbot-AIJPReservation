import Database from 'better-sqlite3';
import fs from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
const dbPath = path.join(dataDir, 'bookings.db');

const db = new Database(dbPath);

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

console.log('Database initialized at', dbPath);
db.close();
