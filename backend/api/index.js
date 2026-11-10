'use strict';
/**
 * Điểm vào Vercel. Mọi đường dẫn (/api/*, /webhooks/*) được vercel.json rewrite về đây.
 * Quan trọng với GitHub Pages: preflight OPTIONS và mọi lỗi (kể cả lỗi khởi tạo) đều có header CORS,
 * để trình duyệt thấy thông báo lỗi thật thay vì "CORS error" mù mờ.
 */
const { config, problems } = require('../src/config');
const { corsHeaders } = require('../src/http');

let app = null, initError = null;
function getApp() {
  if (app || initError) return app;
  try { app = require('../src/app').createApp(); } catch (e) { initError = e; console.error('[init]', e); }
  return app;
}

module.exports = async (req, res) => {
  const cors = corsHeaders(req, config());
  if (req.method === 'OPTIONS') { res.statusCode = 204; for (const [k, v] of Object.entries(cors)) res.setHeader(k, v); return res.end(); }
  const a = getApp();
  if (!a) {
    res.statusCode = 500;
    for (const [k, v] of Object.entries({ ...cors, 'Content-Type': 'application/json; charset=utf-8' })) res.setHeader(k, v);
    return res.end(JSON.stringify({ ok: false, error: 'Backend khởi tạo lỗi: ' + initError.message, code: 'INIT' }));
  }
  const p = problems(a.cfg);
  const path = String(req.url || '').split('?')[0];
  if (p.length && path !== '/api/health') {           // thiếu biến môi trường → báo rõ, không treo
    res.statusCode = 503;
    for (const [k, v] of Object.entries({ ...cors, 'Content-Type': 'application/json; charset=utf-8' })) res.setHeader(k, v);
    return res.end(JSON.stringify({ ok: false, error: 'Backend chưa cấu hình xong: ' + p.join('; '), code: 'CONFIG' }));
  }
  return a.handler(req, res);
};
