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

module.exports = { assertPublicHost, isPrivateIp };
