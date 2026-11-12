'use strict';
// Dùng: node cleanup-otp.js <thư-mục-otp>
// Xoá file khi (bây giờ - sentAt) > OTP_MAX_AGE_MIN phút, hoặc exp < bây giờ, hoặc file hỏng/không có sentAt.
const fs = require('fs');
const path = require('path');
const DIR = process.argv[2] || 'otp';
const maxAgeMs = (Number(process.env.OTP_MAX_AGE_MIN) || 10) * 60000;
const now = Date.now();
if (!fs.existsSync(DIR)) { console.log(`Chưa có ${DIR} — không có gì để dọn.`); process.exit(0); }
let removed = 0, kept = 0;
for (const name of fs.readdirSync(DIR)) {
  if (!name.endsWith('.json')) continue;
  const file = path.join(DIR, name);
  let sentAt = 0, exp = 0;
  try { const r = JSON.parse(fs.readFileSync(file, 'utf8')); sentAt = Number(r.sentAt) || 0; exp = Number(r.exp) || 0; } catch { /* hỏng */ }
  const expired = !sentAt || (exp && exp < now) || now - sentAt > maxAgeMs;
  if (expired) { fs.unlinkSync(file); removed++; console.log('xoá', file); } else kept++;
}
console.log(`Đã xoá ${removed}, còn ${kept} mã OTP đang hiệu lực.`);
