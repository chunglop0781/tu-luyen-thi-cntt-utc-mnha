'use strict';
/** AES-256-GCM, JWT HS256, HMAC — chỉ dùng module `crypto` có sẵn của Node. */
const crypto = require('crypto');

const b64u = (buf) => Buffer.from(buf).toString('base64url');

/** Sinh khoá 32 byte từ chuỗi bí mật bất kỳ (HKDF-SHA256) theo từng mục đích. */
function deriveKey(secret, purpose) {
  if (!secret) throw new Error('Thiếu ENCRYPTION_KEY');
  return Buffer.from(crypto.hkdfSync('sha256', Buffer.from(String(secret)), Buffer.from('tu-luyen-thi-cntt-utc-mnha'), Buffer.from(purpose), 32));
}

const MAGIC = Buffer.from('UTC2');

/** [magic 4][iv 12][tag 16][ciphertext] — `aad` gắn dữ liệu với chủ sở hữu (sai chủ → giải mã thất bại). */
function encrypt(key, plain, aad = '') {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  c.setAAD(Buffer.from(String(aad)));
  const ct = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([MAGIC, iv, c.getAuthTag(), ct]);
}

function decrypt(key, blob, aad = '') {
  if (!Buffer.isBuffer(blob) || blob.length < 33 || !blob.subarray(0, 4).equals(MAGIC)) throw new Error('Dữ liệu mã hoá không hợp lệ');
  const d = crypto.createDecipheriv('aes-256-gcm', key, blob.subarray(4, 16));
  d.setAAD(Buffer.from(String(aad)));
  d.setAuthTag(blob.subarray(16, 32));
  return Buffer.concat([d.update(blob.subarray(32)), d.final()]);
}

function encryptText(key, text, aad) { return encrypt(key, Buffer.from(String(text), 'utf8'), aad).toString('base64'); }
function decryptText(key, b64, aad) { return decrypt(key, Buffer.from(String(b64), 'base64'), aad).toString('utf8'); }

function hmacHex(secret, data) { return crypto.createHmac('sha256', secret).update(data).digest('hex'); }
function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function jwtSign(payload, secret, expiresInSec) {
  const now = Math.floor(Date.now() / 1000);
  const body = { ...payload, iat: now, exp: now + expiresInSec };
  const head = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const data = `${head}.${b64u(JSON.stringify(body))}`;
  return `${data}.${crypto.createHmac('sha256', secret).update(data).digest('base64url')}`;
}

/** Trả payload nếu hợp lệ & chưa hết hạn, ngược lại null. */
function jwtVerify(token, secret) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  const expect = crypto.createHmac('sha256', secret).update(`${parts[0]}.${parts[1]}`).digest('base64url');
  if (!safeEqual(parts[2], expect)) return null;
  try {
    const head = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
    if (head.alg !== 'HS256') return null;
    const p = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    if (typeof p.exp !== 'number' || p.exp < Math.floor(Date.now() / 1000)) return null;
    return p;
  } catch { return null; }
}

const sha256Hex = (s) => crypto.createHash('sha256').update(s).digest('hex');

module.exports = { deriveKey, encrypt, decrypt, encryptText, decryptText, hmacHex, safeEqual, jwtSign, jwtVerify, sha256Hex };
