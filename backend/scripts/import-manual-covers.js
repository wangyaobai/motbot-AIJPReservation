import path from 'path';
import { fileURLToPath } from 'url';
import { ensureSchema, getDb } from '../db.js';
import { importManualCoversFromJsonFile } from '../services/manualCovers.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function main() {
  ensureSchema();
  const db = getDb();

  // manual_covers.json 默认放在项目根目录：../..
  const rootDir = path.join(__dirname, '..', '..');
  const jsonPath = path.join(rootDir, 'manual_covers.json');
  const { imported, total } = importManualCoversFromJsonFile({ db, jsonPath });
  console.log(`Imported/updated manual covers: ${imported} (source total: ${total})`);
}

main();

