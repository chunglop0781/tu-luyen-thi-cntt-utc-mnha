'use strict';
/** Chặn gọi AI tới địa chỉ nội bộ: phân giải DNS rồi từ chối nếu có IP riêng/loopback/link-local (chống SSRF khi người dùng tự nhập địa chỉ API). */
const dns = require('dns').promises;
const net = require('net');
const { HttpError } = require('../http');

function privateV4(ip) {
  const [a, b] = ip.split('.').map(Number);
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
}
function isPrivateIp(ip) {
  const v = net.isIP(ip);
  if (v === 4) return privateV4(ip);
  if (v === 6) {
    const s = ip.toLowerCase();
    if (s === '::' || s === '::1') return true;
    const m = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(s); if (m) return privateV4(m[1]);
    return /^f[cd]/.test(s) || /^fe[89ab]/.test(s) || s.startsWith('ff');
  }
  return true;
}

const defaultLookup = (host) => dns.lookup(host, { all: true });

async function assertPublicHost(hostname, lookup = defaultLookup) {
  let addrs;
  try { addrs = await lookup(hostname); } catch { throw new HttpError(400, `Không phân giải được tên miền ${hostname}`, 'AI_URL'); }
  if (!addrs || !addrs.length || addrs.some((a) => isPrivateIp(a.address))) throw new HttpError(400, 'Địa chỉ API trỏ vào mạng nội bộ — không được phép', 'AI_URL');
}

/**
 * fetch an toàn cho địa chỉ API do người dùng nhập: kiểm tra IP ngay LÚC KẾT NỐI (không phân giải DNS lần hai như fetch thường)
 * → chống DNS-rebinding (lần kiểm tra trả IP công khai, lần kết nối thật trả 127.0.0.1 / 169.254.169.254…).
 * Trả về đối tượng có { ok, status, text() } đủ cho callAi. Không theo chuyển hướng.
 */
function safeFetch(url, init = {}) {
  const https = require('https');
  const u = new URL(url);
  if (u.protocol !== 'https:') return Promise.reject(new Error('chỉ cho phép https'));
  return new Promise((resolve, reject) => {
    const lookup = (host, opts, cb) => {
      if (typeof opts === 'function') { cb = opts; opts = {}; }
      dns.lookup(host, { all: true }).then((addrs) => {
        if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) return cb(new Error('Địa chỉ API trỏ vào mạng nội bộ — bị chặn'));
        const a = addrs[0]; return opts && opts.all ? cb(null, [a]) : cb(null, a.address, a.family);
      }, cb);
    };
    const req = https.request(u, { method: init.method || 'GET', headers: init.headers, lookup, signal: init.signal }, (res) => {
      const chunks = []; let size = 0;
      res.on('data', (c) => { size += c.length; if (size > 2e6) { req.destroy(new Error('phản hồi quá lớn')); } else chunks.push(c); });
      res.on('end', () => { const raw = Buffer.concat(chunks).toString('utf8'); resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, text: async () => raw }); });
      res.on('error', reject);
    });
    req.on('error', reject);
    if (init.body) req.write(init.body);
    req.end();
  });
}

module.exports = { assertPublicHost, isPrivateIp, safeFetch };
