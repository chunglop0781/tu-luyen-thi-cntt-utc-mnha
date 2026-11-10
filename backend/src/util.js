'use strict';
const crypto = require('crypto');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nowIso = () => new Date().toISOString();
const randomId = (bytes = 8) => crypto.randomBytes(bytes).toString('hex');
/** id do client/server sinh: 16–32 ký tự hex thường. */
const ID_RE = /^[a-f0-9]{16,32}$/;
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

module.exports = { sleep, nowIso, randomId, isId, ID_RE, fold, clampStr, mapLimit };
