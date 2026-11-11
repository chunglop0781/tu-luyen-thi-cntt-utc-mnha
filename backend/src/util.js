'use strict';
const crypto = require('crypto');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nowIso = () => new Date().toISOString();
const randomId = (bytes = 8) => crypto.randomBytes(bytes).toString('hex');
/** id do client/server sinh: 16–32 ký tự hex thường. */
/** id mới: <timestamp ms>_<hex ngẫu nhiên> (vd 1731289315790_9f3a1c07b2d4); id cũ 16–32 hex vẫn hợp lệ. */
const ID_RE = /^(?:[a-f0-9]{16,32}|\d{10,14}_[a-f0-9]{8,24})$/;
const newItemId = () => `${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
const isId = (s) => typeof s === 'string' && ID_RE.test(s);

/** Chuẩn hoá để so khớp từ khoá: bỏ dấu, chữ thường, gộp khoảng trắng. */
function fold(s) {
  return String(s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function clampStr(v, max, { trim = true } = {}) {
  let s = typeof v === 'string' ? v : v == null ? '' : String(v);
  s = s.replace(/\u0000/g, '');
  if (trim) s = s.trim();
  return s.length > max ? s.slice(0, max) : s;
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  }));
  return out;
}

module.exports = { sleep, nowIso, randomId, newItemId, isId, ID_RE, fold, clampStr, mapLimit };
