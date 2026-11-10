'use strict';
/**
 * Gửi email qua SMTP bằng nodemailer (nạp lười: chỉ require khi thật sự gửi → test không cần cài).
 * Mặc định Gmail (smtp.gmail.com:465, SSL) + "Mật khẩu ứng dụng" (App Password).
 * Trả về hàm `send({ to, subject, text, html })`; có thể thay bằng hàm giả khi test (createApp({ mailer })).
 */
const { HttpError } = require('../http');

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function createMailer(cfg) {
  let transporter = null;
  const m = cfg.mail;
  const configured = !!(m.user && m.pass);

  function get() {
    if (transporter) return transporter;
    const nodemailer = require('nodemailer');
    transporter = nodemailer.createTransport({
      host: m.host, port: m.port, secure: m.secure, auth: { user: m.user, pass: m.pass },
      connectionTimeout: 10000, greetingTimeout: 8000, socketTimeout: 15000, // serverless: không để treo
    });
    return transporter;
  }

  async function send({ to, subject, text, html }) {
    if (!configured) throw new HttpError(503, 'Máy chủ chưa cấu hình gửi email (MAIL_USER / MAIL_PASS)', 'MAIL_NOT_CONFIGURED');
    try {
      await get().sendMail({ from: m.from || `"Tự luyện thi CNTT UTC" <${m.user}>`, to, subject, text, html });
    } catch (e) {
      console.error('[mail]', e && e.code, e && e.message);
      const bad = e && (e.code === 'EAUTH' || e.responseCode === 535);
      throw new HttpError(502, bad ? 'Máy chủ gửi mail bị từ chối đăng nhập (kiểm tra MAIL_USER / MAIL_PASS là App Password)' : 'Không gửi được email, thử lại sau', 'MAIL_FAILED');
    }
  }

  return { send, configured };
}

/** Nội dung thư OTP (HTML + text). purpose: 'register' | 'reset' */
function otpMessage(code, purpose, ttlMin) {
  const title = purpose === 'reset' ? 'Mã đặt lại mật khẩu' : 'Mã xác minh đăng ký';
  const subject = `${title} — Tự luyện thi CNTT UTC`;
  const text = `${title}: ${code}\nMã có hiệu lực ${ttlMin} phút. Không chia sẻ mã này với bất kỳ ai.\nNếu không phải bạn yêu cầu, hãy bỏ qua email này.`;
  const html = `<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:24px">
<h2 style="color:#2563eb;margin:0 0 12px">Tự luyện thi CNTT UTC</h2>
<p>${esc(title)} của bạn là:</p>
<div style="font-size:32px;font-weight:bold;letter-spacing:6px;color:#1d4ed8;padding:16px;background:#eff6ff;border-radius:8px;text-align:center;margin:16px 0">${esc(code)}</div>
<p>Mã có hiệu lực trong <b>${ttlMin} phút</b>. Không chia sẻ mã này với bất kỳ ai.</p>
<p style="color:#6b7280;font-size:12px">Nếu bạn không thực hiện yêu cầu này, hãy bỏ qua email.</p></div>`;
  return { subject, text, html };
}

module.exports = { createMailer, otpMessage };
