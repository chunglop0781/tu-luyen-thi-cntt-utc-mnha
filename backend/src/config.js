'use strict';
/** Đọc cấu hình từ biến môi trường (gọi lại mỗi lần để test đổi env được). */

const num = (v, d) => (v === undefined || v === '' || Number.isNaN(Number(v)) ? d : Number(v));
const bool = (v, d) => (v === undefined || v === '' ? d : /^(1|true|on|yes)$/i.test(String(v)));

function normalizeOrigin(o) {
  const s = String(o || '').trim();
  if (!s) return null;
  if (s === '*') return '*';
  try { return new URL(s).origin.toLowerCase(); } catch { return null; }
}

function config(env = process.env) {
  const prodHost = env.VERCEL_PROJECT_PRODUCTION_URL || env.VERCEL_URL || '';
  return {
    owner: env.GITHUB_OWNER || '',
    token: env.GITHUB_TOKEN || '',
    branch: env.GITHUB_BRANCH || 'main',
    accountRepo: env.ACCOUNT_GITHUB_REPO || 'tu-luyen-thi-cntt-utc-mnha-account',
    dataRepo: env.DATA_GITHUB_REPO || 'tu-luyen-thi-cntt-utc-mnha-data',
    imagePrefix: env.IMAGE_REPO_PREFIX || 'tu-luyen-thi-cntt-utc-mnha-image',
    imageLimitBytes: num(env.IMAGE_REPO_LIMIT_MB, 200) * 1024 * 1024,
    imageReserveBytes: num(env.IMAGE_REPO_RESERVE_MB, 8) * 1024 * 1024,
    maxImageBytes: num(env.MAX_IMAGE_BYTES, 4 * 1024 * 1024),
    jwtSecret: env.JWT_SECRET || '',
    encKey: env.ENCRYPTION_KEY || env.IMAGE_ENCRYPTION_KEY || '',
    webhookSecret: env.GITHUB_WEBHOOK_SECRET || env.ACCOUNT_GITHUB_WEBHOOK_SECRET || '',
    cronSecret: env.CRON_SECRET || '',
    publicApiUrl: (env.PUBLIC_API_URL || (prodHost ? `https://${prodHost}` : '')).replace(/\/+$/, ''),
    origins: String(env.FRONTEND_ORIGINS || '').split(',').map(normalizeOrigin).filter(Boolean),
    allowLocalhost: bool(env.ALLOW_LOCALHOST, false),
    accessTokenSec: Math.round(num(env.ACCESS_TOKEN_MINUTES, 60) * 60),
    refreshTokenSec: Math.round(num(env.REFRESH_TOKEN_DAYS, 30) * 86400),
    bcryptRounds: Math.min(14, Math.max(8, num(env.BCRYPT_ROUNDS, 10))),
    registrationOpen: bool(env.REGISTRATION_OPEN, true),
    inviteCode: env.INVITE_CODE || '',
    // ── Xác minh email bằng mã OTP (gửi qua SMTP, mặc định Gmail + App Password) ──
    requireOtp: bool(env.REQUIRE_EMAIL_OTP, true),
    otpTtlSec: Math.round(num(env.OTP_TTL_MINUTES, 10) * 60),
    otpMaxAttempts: num(env.OTP_MAX_ATTEMPTS, 5),
    otpResendSec: num(env.OTP_RESEND_SECONDS, 60),
    mail: {
      user: env.MAIL_USER || '',
      pass: String(env.MAIL_PASS || '').replace(/\s+/g, ''), // Gmail hiện App Password dạng "abcd efgh ..." → bỏ khoảng trắng
      host: env.MAIL_HOST || 'smtp.gmail.com',
      port: num(env.MAIL_PORT, 465),
      secure: bool(env.MAIL_SECURE, true),
      from: env.MAIL_FROM || '',
    },
    pruneDays: num(env.PRUNE_DAYS, 5),
    pruneMaxReplay: num(env.PRUNE_MAX_REPLAY, 150),
    geminiModel: env.GEMINI_MODEL || 'gemini-2.5-flash',
    version: '2.0.0',
  };
}

/** Trả về danh sách lỗi cấu hình (rỗng = ổn). */
function problems(cfg) {
  const p = [];
  if (!cfg.token) p.push('Thiếu GITHUB_TOKEN');
  if (!cfg.owner) p.push('Thiếu GITHUB_OWNER');
  if (cfg.jwtSecret.length < 32) p.push('JWT_SECRET phải dài >= 32 ký tự');
  if (cfg.encKey.length < 32) p.push('ENCRYPTION_KEY phải dài >= 32 ký tự');
  if (cfg.jwtSecret && cfg.jwtSecret === cfg.encKey) p.push('JWT_SECRET và ENCRYPTION_KEY không được trùng nhau (lộ một cái là mất cả hai lớp bảo vệ)');
  if (!cfg.origins.length && !cfg.allowLocalhost) p.push('Thiếu FRONTEND_ORIGINS (origin của GitHub Pages)');
  return p;
}

/** Cảnh báo không chặn hoạt động (đăng nhập vẫn chạy; chỉ đăng ký mới cần mail). */
function warnings(cfg) {
  const w = [];
  if (cfg.requireOtp && (!cfg.mail.user || !cfg.mail.pass)) w.push('Chưa đặt MAIL_USER / MAIL_PASS nên chưa gửi được OTP đăng ký (hoặc đặt REQUIRE_EMAIL_OTP=false để tắt xác minh email)');
  return w;
}

module.exports = { config, problems, warnings };
