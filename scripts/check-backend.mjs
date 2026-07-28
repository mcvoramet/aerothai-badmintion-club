#!/usr/bin/env node
// Smoke-tests a deployed Apps Script Web App before wiring it into the frontend.
//   node scripts/check-backend.mjs "https://script.google.com/macros/s/XXXX/exec"
// Falls back to VITE_APPS_SCRIPT_URL from .env.local when no argument is given.

import { readFileSync } from 'node:fs';

function resolveUrl() {
  if (process.argv[2]) return process.argv[2];
  try {
    const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
    const match = env.match(/^VITE_APPS_SCRIPT_URL=(.+)$/m);
    if (match) return match[1].trim();
  } catch {
    /* no .env.local yet */
  }
  return null;
}

const BASE = resolveUrl();
if (!BASE) {
  console.error('ไม่พบ URL — ใส่เป็น argument หรือตั้ง VITE_APPS_SCRIPT_URL ใน .env.local');
  process.exit(1);
}
if (!/\/exec$/.test(BASE)) {
  console.warn('⚠  URL ควรลงท้ายด้วย /exec (ไม่ใช่ /dev) — ตรวจสอบอีกครั้ง\n');
}

async function get(action, params = {}) {
  const url = new URL(BASE);
  url.searchParams.set('action', action);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const res = await fetch(url, { redirect: 'follow' });
  const text = await res.text();
  if (text.trimStart().startsWith('<')) {
    throw new Error(
      'ได้ HTML กลับมาแทน JSON — มักแปลว่า deployment ตั้ง access ไม่เป็น "Anyone" ' +
        '(Google ส่งหน้า login มาแทน)'
    );
  }
  const json = JSON.parse(text);
  if (!json.ok) throw new Error(json.error);
  return json.data;
}

const checks = [
  ['getSettings', () => get('getSettings')],
  ['getPlayers', () => get('getPlayers')],
  ['getOutstanding', () => get('getOutstanding')],
  ['getSummary', () => get('getSummary', { period: 'monthly' })],
  [
    'getGamesInRange',
    () => {
      const now = new Date();
      return get('getGamesInRange', {
        start: new Date(now.getFullYear(), now.getMonth(), 1).toISOString(),
        end: new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString(),
      });
    },
  ],
];

let failed = 0;
console.log(`ทดสอบ: ${BASE}\n`);

for (const [name, run] of checks) {
  try {
    const data = await run();
    const detail = Array.isArray(data) ? `${data.length} รายการ` : JSON.stringify(data).slice(0, 90);
    console.log(`✓ ${name.padEnd(16)} ${detail}`);
  } catch (err) {
    failed++;
    console.log(`✗ ${name.padEnd(16)} ${err.message}`);
  }
}

console.log(
  failed === 0
    ? '\n✅ Backend พร้อมใช้งาน — นำ URL นี้ไปตั้งเป็น VITE_APPS_SCRIPT_URL บน Vercel ได้เลย'
    : `\n❌ ล้มเหลว ${failed} รายการ — ดู README หัวข้อ "แก้ปัญหาที่พบบ่อย"`
);
process.exit(failed === 0 ? 0 : 1);
