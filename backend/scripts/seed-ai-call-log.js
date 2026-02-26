/**
 * 给指定订单写入模拟的 AI 通话状态日志，便于查看前端 log 展示效果。
 * 用法：node scripts/seed-ai-call-log.js [订单号或手机号]
 * 不传参数时取最新一笔订单。
 */
import { getDb, ensureSchema } from '../db.js';

ensureSchema();
const db = getDb();

function toISO(ms) {
  return new Date(ms).toISOString();
}

function main() {
  const arg = process.argv[2];
  let order;
  if (arg) {
    const byOrderNo = db.prepare('SELECT * FROM orders WHERE order_no = ?').get(arg);
    if (byOrderNo) {
      order = byOrderNo;
    } else {
      const isPhone = /^\d+$/.test(arg.replace(/\D/g, ''));
      if (isPhone) {
        const phone = arg.replace(/\D/g, '');
        order = db.prepare(
          "SELECT * FROM orders WHERE contact_phone LIKE ? OR replace(replace(contact_phone,' ',''),'-','') = ? ORDER BY id DESC LIMIT 1"
        ).get(`%${phone.slice(-11)}%`, phone);
      }
    }
  }
  if (!order) {
    order = db.prepare(
      "SELECT * FROM orders WHERE status IN ('pending','calling','completed','failed') ORDER BY id DESC LIMIT 1"
    ).get();
  }
  if (!order) {
    console.log('没有找到可用的订单，请先创建订单后再运行本脚本。');
    process.exit(1);
  }

  const mode = process.argv[3]; // '1' = 拨打1次成功, '2' = 拨打2次成功, '5' = 拨打5次成功
  const now = Date.now();
  const min = 60 * 1000;
  const hour = 60 * min;

  function buildSuccessMsg(order) {
    const d = order.booking_date || '';
    const t = order.booking_time || '';
    const n = order.party_size ?? 0;
    const m = d.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    const dateStr = m ? `${parseInt(m[2], 10)}月${parseInt(m[3], 10)}日` : '—';
    const [hh, minPart] = (t || '').split(':');
    const timeStr = hh != null ? `${parseInt(hh, 10)}时${minPart ? `${parseInt(minPart, 10)}分` : ''}` : '—';
    return `您的预订已经成功，已经成功预定了${dateStr}${timeStr}${n}人的座位。预约通话过程可查看「AI沟通记录」，就餐可出示「预约凭证」。`;
  }

  let log;
  if (mode === '1') {
    const successMsg = buildSuccessMsg(order);
    log = [
      { at: toISO(now - 5 * min), text: '开始发起拨打' },
      { at: toISO(now - 3 * min), text: '接通，通话完成' },
      { at: toISO(now - 2 * min), text: successMsg },
    ];
    const d = order.booking_date || '';
    const t = order.booking_time || '';
    const n = order.party_size ?? 0;
    const m = d.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    const dateStr = m ? `${parseInt(m[2], 10)}月${parseInt(m[3], 10)}日` : '—';
    const [hh, minPart] = (t || '').split(':');
    const timeStr = hh != null ? `${parseInt(hh, 10)}时${minPart ? `${parseInt(minPart, 10)}分` : ''}` : '—';
    db.prepare('UPDATE orders SET ai_call_status_log = ?, status = \'completed\', summary_text = ? WHERE id = ?').run(
      JSON.stringify(log),
      `模拟：已成功预约${dateStr}${timeStr}${n}人。`,
      order.id
    );
  } else if (mode === '2') {
    const successMsg = buildSuccessMsg(order);
    log = [
      { at: toISO(now - 35 * min), text: '开始发起拨打' },
      { at: toISO(now - 34 * min), text: '未接通，预计再次尝试（第1次）' },
      { at: toISO(now - 5 * min), text: '第2次尝试，开始发起拨打' },
      { at: toISO(now - 3 * min), text: '接通，通话完成' },
      { at: toISO(now - 2 * min), text: successMsg },
    ];
    const d = order.booking_date || '';
    const t = order.booking_time || '';
    const n = order.party_size ?? 0;
    const m = d.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    const dateStr = m ? `${parseInt(m[2], 10)}月${parseInt(m[3], 10)}日` : '—';
    const [hh, minPart] = (t || '').split(':');
    const timeStr = hh != null ? `${parseInt(hh, 10)}时${minPart ? `${parseInt(minPart, 10)}分` : ''}` : '—';
    db.prepare('UPDATE orders SET ai_call_status_log = ?, status = \'completed\', summary_text = ? WHERE id = ?').run(
      JSON.stringify(log),
      `模拟：已成功预约${dateStr}${timeStr}${n}人。`,
      order.id
    );
  } else if (mode === '5') {
    const successMsg = buildSuccessMsg(order);
    log = [
      { at: toISO(now - 48 * hour), text: '开始发起拨打' },
      { at: toISO(now - 48 * hour + 1 * min), text: '未接通，预计再次尝试（第1次）' },
      { at: toISO(now - 47 * hour), text: '第2次尝试，开始发起拨打' },
      { at: toISO(now - 47 * hour + 1 * min), text: '未接通，预计再次尝试（第2次）' },
      { at: toISO(now - 46 * hour), text: '第3次尝试，开始发起拨打' },
      { at: toISO(now - 46 * hour + 1 * min), text: '未接通，今日尝试次数已用完，等待明日营业时间再次尝试。' },
      { at: toISO(now - 2 * hour), text: '第4次尝试，开始发起拨打' },
      { at: toISO(now - 2 * hour + 1 * min), text: '未接通，预计再次尝试（第4次）' },
      { at: toISO(now - 30 * min), text: '第5次尝试，开始发起拨打' },
      { at: toISO(now - 28 * min), text: '接通，通话完成' },
      { at: toISO(now - 27 * min), text: successMsg },
    ];
    const d5 = order.booking_date || '';
    const t5 = order.booking_time || '';
    const n5 = order.party_size ?? 0;
    const m5 = d5.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    const dateStr5 = m5 ? `${parseInt(m5[2], 10)}月${parseInt(m5[3], 10)}日` : '—';
    const [hh5, minPart5] = (t5 || '').split(':');
    const timeStr5 = hh5 != null ? `${parseInt(hh5, 10)}时${minPart5 ? `${parseInt(minPart5, 10)}分` : ''}` : '—';
    db.prepare('UPDATE orders SET ai_call_status_log = ?, status = \'completed\', summary_text = ? WHERE id = ?').run(
      JSON.stringify(log),
      `模拟：已成功预约${dateStr5}${timeStr5}${n5}人。`,
      order.id
    );
  } else {
    log = [
      { at: toISO(now - 35 * min), text: '开始发起拨打' },
      { at: toISO(now - 34 * min), text: '未接通，预计再次尝试（第1次）' },
      { at: toISO(now - 4 * min), text: '第2次尝试，开始发起拨打' },
      { at: toISO(now - 3 * min), text: '未接通，预计再次尝试（第2次）' },
      { at: toISO(now - 1 * min), text: '第3次尝试，开始发起拨打' },
      { at: toISO(now - 0.5 * min), text: '接通，通话完成' },
    ];
    db.prepare('UPDATE orders SET ai_call_status_log = ? WHERE id = ?').run(JSON.stringify(log), order.id);
  }

  console.log('已写入模拟日志，订单号:', order.order_no);
  console.log('请在前端打开该订单详情或管理后台查看「AI 通话状态」的 log 展示。');
  console.log('log 条数:', log.length);
}

main();
