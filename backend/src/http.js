'use strict';
/** Router + tiện ích HTTP thuần Node (tương thích (req,res) của Vercel). Luôn gắn CORS, kể cả khi lỗi. */

class HttpError extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code; }
}

function corsHeaders(req, cfg) {
  const origin = String(req.headers.origin || '').toLowerCase();
  if (!origin) return {};
  const ok = cfg.origins.includes('*') || cfg.origins.includes(origin)
    || (cfg.allowLocalhost && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin));
  if (!ok) return { Vary: 'Origin' };
  return {
    'Access-Control-Allow-Origin': origin,
    Vary: 'Origin',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Image-Name, X-Requested-With',
    'Access-Control-Expose-Headers': 'Content-Type, Content-Length, Retry-After',
    'Access-Control-Max-Age': '86400',
  };
}

/** Đọc toàn bộ body thô (Buffer). Không đụng req.body để giữ nguyên byte cho chữ ký webhook. */
async function readBody(req, limit) {
  if (req.readableEnded || req.complete && req.readable === false) {
    const b = req.rawBody !== undefined ? req.rawBody : req.body;
    if (b === undefined || b === null) return Buffer.alloc(0);
    return Buffer.isBuffer(b) ? b : Buffer.from(typeof b === 'string' ? b : JSON.stringify(b));
  }
  const len = Number(req.headers['content-length'] || 0);
  if (len > limit) throw new HttpError(413, 'Dữ liệu gửi lên quá lớn', 'TOO_LARGE');
  const chunks = []; let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw new HttpError(413, 'Dữ liệu gửi lên quá lớn', 'TOO_LARGE');
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}

function parseJson(buf) {
  if (!buf.length) return {};
  try { const v = JSON.parse(buf.toString('utf8')); return v && typeof v === 'object' ? v : {}; }
  catch { throw new HttpError(400, 'JSON không hợp lệ', 'BAD_JSON'); }
}

class Router {
  constructor() { this.routes = []; }
  add(method, pattern, handler, opts = {}) {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/\/:([a-zA-Z]+)/g, (_, k) => { keys.push(k); return '/([^/]+)'; }) + '/?$');
    this.routes.push({ method, re, keys, handler, opts });
    return this;
  }
  get(p, h, o) { return this.add('GET', p, h, o); }
  post(p, h, o) { return this.add('POST', p, h, o); }
  put(p, h, o) { return this.add('PUT', p, h, o); }
  patch(p, h, o) { return this.add('PATCH', p, h, o); }
  delete(p, h, o) { return this.add('DELETE', p, h, o); }
  match(method, path) {
    let pathMatched = false;
    for (const r of this.routes) {
      const m = r.re.exec(path); if (!m) continue;
      pathMatched = true;
      if (r.method !== method) continue;
      const params = {}; r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      return { route: r, params };
    }
    return { pathMatched };
  }
}

function send(res, status, headers, body) {
  if (res.headersSent) return;
  res.statusCode = status;
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(body);
}

function sendJson(res, status, obj, headers = {}) {
  send(res, status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers }, JSON.stringify(obj));
}

module.exports = { HttpError, corsHeaders, readBody, parseJson, Router, send, sendJson };
