/**
 * 将后端返回的日期时间（视为 UTC）格式化为用户所在地时间显示。
 * 后端 SQLite datetime('now') 为 UTC，前端按用户浏览器时区（如北京时间）展示。
 * @param {string} serverDateTime - 如 "2025-02-25 12:30:00" 或 "2025-02-25T12:30:00Z"
 * @returns {string} 本地时间字符串，如 "2025/2/25 20:30:00"（北京时间）
 */
export function formatLocalDateTime(serverDateTime) {
  if (!serverDateTime || typeof serverDateTime !== 'string') return '-';
  const s = serverDateTime.trim();
  if (!s) return '-';
  // 统一成 ISO 格式并视为 UTC（无 Z 时按 UTC 解析）
  const iso = s.includes('T') ? s : s.replace(' ', 'T') + (s.includes('Z') || s.includes('+') ? '' : 'Z');
  let date;
  try {
    date = new Date(iso);
  } catch {
    return serverDateTime;
  }
  if (Number.isNaN(date.getTime())) return serverDateTime;
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

/**
 * 将 UTC 时间格式化为本地「X月X日 HH:mm」（用于预计拨打时间等）
 * @param {string} isoOrServerDateTime - ISO 或 "YYYY-MM-DD HH:mm:ss"
 * @returns {string} 如 "2月26日 15:33"
 */
export function formatLocalEstimate(isoOrServerDateTime) {
  if (!isoOrServerDateTime || typeof isoOrServerDateTime !== 'string') return '';
  const s = isoOrServerDateTime.trim();
  if (!s) return '';
  const iso = s.includes('T') ? s : s.replace(' ', 'T') + (s.includes('Z') || s.includes('+') ? '' : 'Z');
  try {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    const mm = date.getMonth() + 1;
    const dd = date.getDate();
    const hh = String(date.getHours()).padStart(2, '0');
    const min = String(date.getMinutes()).padStart(2, '0');
    return `${mm}月${dd}日 ${hh}:${min}`;
  } catch {
    return '';
  }
}

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/**
 * 将 UTC 时间格式化为日本时间 JST「X月X日 HH:mm」（预计拨打时间按餐厅营业时间，显示日本时间）
 * @param {string} isoOrServerDateTime - 后端存的 UTC ISO 或 "YYYY-MM-DD HH:mm:ss"
 * @returns {string} 如 "2月27日 11:00"
 */
export function formatEstimateJst(isoOrServerDateTime) {
  if (!isoOrServerDateTime || typeof isoOrServerDateTime !== 'string') return '';
  const s = isoOrServerDateTime.trim();
  if (!s) return '';
  const iso = s.includes('T') ? s : s.replace(' ', 'T') + (s.includes('Z') || s.includes('+') ? '' : 'Z');
  try {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    const jst = new Date(date.getTime() + JST_OFFSET_MS);
    const mm = jst.getUTCMonth() + 1;
    const dd = jst.getUTCDate();
    const hh = String(jst.getUTCHours()).padStart(2, '0');
    const min = String(jst.getUTCMinutes()).padStart(2, '0');
    return `${mm}月${dd}日 ${hh}:${min}`;
  } catch {
    return '';
  }
}
