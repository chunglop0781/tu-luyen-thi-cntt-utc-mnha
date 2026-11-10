'use strict';
/** Tài khoản + phiên đăng nhập, lưu trong repo ACCOUNT (private, dọn commit 5 ngày). Mật khẩu: bcryptjs (băm một chiều). */
const bcrypt = require('bcryptjs');
const { HttpError } = require('../http');
const crypto = require('crypto');
const { jwtSign, jwtVerify, sha256Hex, hmacHex, safeEqual } = require('../crypto');
const { otpMessage } = require('./mailer');
const { randomId, nowIso, clampStr } = require('../util');

const USERNAME_RE = /^[a-z0-9][a-z0-9_.-]{2,31}$/;
const userPath = (key) => `users/${key}.json`;
const sessionPath = (uid) => `sessions/${uid}.json`;
const MAX_SESSIONS = 20;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/;
const emailKey = (email) => sha256Hex(email).slice(0, 40);
const emailPath = (email) => `emails/${emailKey(email)}.json`;          // chỉ mục email → tài khoản (đảm bảo email duy nhất)
const otpPath = (purpose, email) => `otp/${purpose}-${emailKey(email)}.json`; // mã OTP đang chờ xác minh
const maskEmail = (e) => { const [a, d] = String(e).split('@'); return `${a.slice(0, 2)}${'*'.repeat(Math.max(1, a.length - 2))}@${d}`; };

function createAuth({ cfg, store, mailer }) {
  // Băm giả để thời gian phản hồi khi "không có user" ≈ khi "sai mật khẩu".
  const dummyHash = bcrypt.hashSync('dummy-password-for-timing', cfg.bcryptRounds);

  const publicUser = (u) => ({ id: u.id, username: u.username, displayName: u.displayName, createdAt: u.createdAt, ...(u.email ? { email: maskEmail(u.email) } : {}) });

  function checkPassword(pw) {
    if (typeof pw !== 'string' || pw.length < 8) throw new HttpError(400, 'Mật khẩu tối thiểu 8 ký tự', 'WEAK_PASSWORD');
    if (Buffer.byteLength(pw) > 72) throw new HttpError(400, 'Mật khẩu tối đa 72 byte (giới hạn của bcrypt)', 'WEAK_PASSWORD');
  }

  async function issue(user, ua) {
    const sid = randomId(8);
    const refreshExp = Math.floor(Date.now() / 1000) + cfg.refreshTokenSec;
    await store.update('account', sessionPath(user.id), (cur) => {
      const now = Math.floor(Date.now() / 1000);
      const list = ((cur && cur.sessions) || []).filter((s) => s.exp > now);
      list.push({ sid, exp: refreshExp, ua: clampStr(ua, 160), createdAt: nowIso() });
      return { sessions: list.slice(-MAX_SESSIONS) };
    }, { message: `session ${user.id}`, defaultValue: { sessions: [] } });
    return tokens(user, sid);
  }

  function tokens(user, sid) {
    return {
      accessToken: jwtSign({ sub: user.id, un: user.username, sid, typ: 'access' }, cfg.jwtSecret, cfg.accessTokenSec),
      refreshToken: jwtSign({ sub: user.id, un: user.username, sid, typ: 'refresh' }, cfg.jwtSecret, cfg.refreshTokenSec),
      expiresIn: cfg.accessTokenSec,
      user: publicUser(user),
    };
  }

  async function register({ username, password, displayName, invite }, ua) {
    if (cfg.requireOtp) throw new HttpError(403, 'Đăng ký cần xác minh email bằng mã OTP', 'OTP_REQUIRED');
    if (!cfg.registrationOpen) throw new HttpError(403, 'Đã đóng đăng ký', 'REG_CLOSED');
    if (cfg.inviteCode && invite !== cfg.inviteCode) throw new HttpError(403, 'Mã mời không đúng', 'BAD_INVITE');
    const key = String(username || '').trim().toLowerCase();
    if (!USERNAME_RE.test(key)) throw new HttpError(400, 'Tên đăng nhập 3–32 ký tự: a-z, 0-9, _ . - (bắt đầu bằng chữ/số)', 'BAD_USERNAME');
    checkPassword(password);
    const user = {
      id: randomId(12), username: key, displayName: clampStr(displayName, 60) || key,
      hash: await bcrypt.hash(password, cfg.bcryptRounds), createdAt: nowIso(),
    };
    try { await store.create('account', userPath(key), user, `register ${key}`); }
    catch (e) { if (e.code === 'EXISTS') throw new HttpError(409, 'Tên đăng nhập đã tồn tại', 'USERNAME_TAKEN'); throw e; }
    return issue(user, ua);
  }


  // ───────────── Xác minh email bằng OTP ─────────────
  const genCode = () => String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  const codeHash = (email, purpose, code) => hmacHex(cfg.jwtSecret, `otp|${purpose}|${email}|${code}`);

  function normEmail(v) {
    const e = String(v || '').trim().toLowerCase();
    if (e.length > 254 || !EMAIL_RE.test(e)) throw new HttpError(400, 'Email không hợp lệ', 'BAD_EMAIL');
    return e;
  }
  function normCode(v) {
    const c = String(v || '').replace(/\s+/g, '');
    if (!/^\d{6}$/.test(c)) throw new HttpError(400, 'Mã OTP gồm đúng 6 chữ số', 'BAD_CODE');
    return c;
  }

  /** Tạo + lưu + gửi mã. Trả { resendIn } hoặc ném lỗi (lỗi gửi mail → xoá bản ghi để không bị kẹt cooldown). */
  async function issueOtp(email, purpose, payload) {
    const path = otpPath(purpose, email);
    const old = await store.read('account', path, { fresh: true });
    if (old) {
      const wait = Math.ceil(old.data.sentAt + cfg.otpResendSec * 1000 - Date.now()) / 1000;
      if (wait > 0) { const e = new HttpError(429, `Vui lòng đợi ${Math.ceil(wait)} giây rồi gửi lại mã`, 'OTP_COOLDOWN'); e.retryAfter = Math.ceil(wait); throw e; }
    }
    const code = genCode();
    const rec = { codeHash: codeHash(email, purpose, code), exp: Date.now() + cfg.otpTtlSec * 1000, sentAt: Date.now(), attempts: 0, payload };
    await store.write('account', path, rec, `otp ${purpose}`);
    try { await mailer.send({ to: email, ...otpMessage(code, purpose, Math.round(cfg.otpTtlSec / 60)) }); }
    catch (e) { try { await store.remove('account', path, `otp ${purpose} lỗi gửi`); } catch { /* bỏ qua */ } throw e; }
    return { resendIn: cfg.otpResendSec, expiresIn: cfg.otpTtlSec };
  }

  /** Kiểm tra mã: mỗi lần thử đều tăng bộ đếm TRƯỚC khi so (chống dò mã). Đúng → xoá bản ghi, trả payload. */
  async function consumeOtp(email, purpose, code) {
    const path = otpPath(purpose, email);
    const rec = await store.update('account', path, (cur) => (cur ? { ...cur, attempts: cur.attempts + 1 } : undefined), { message: `otp ${purpose} thử` });
    if (!rec || rec.exp < Date.now()) { if (rec) await store.remove('account', path, `otp ${purpose} hết hạn`).catch(() => {}); throw new HttpError(400, 'Mã OTP đã hết hạn hoặc chưa được gửi. Hãy gửi lại mã', 'OTP_EXPIRED'); }
    if (rec.attempts > cfg.otpMaxAttempts) { await store.remove('account', path, `otp ${purpose} quá lượt`).catch(() => {}); throw new HttpError(429, 'Nhập sai quá nhiều lần. Hãy gửi lại mã mới', 'OTP_LOCKED'); }
    if (!safeEqual(rec.codeHash, codeHash(email, purpose, code))) {
      const left = cfg.otpMaxAttempts - rec.attempts;
      throw new HttpError(400, left > 0 ? `Mã OTP không đúng (còn ${left} lần thử)` : 'Mã OTP không đúng. Hãy gửi lại mã mới', 'OTP_WRONG');
    }
    await store.remove('account', path, `otp ${purpose} xong`).catch(() => {});
    return rec.payload;
  }

  /** Bước 1 đăng ký: kiểm tra thông tin → gửi OTP. Chưa tạo tài khoản. Gọi lại = gửi lại mã (có cooldown). */
  async function registerStart({ username, email, password, displayName, invite }) {
    if (!cfg.registrationOpen) throw new HttpError(403, 'Đã đóng đăng ký', 'REG_CLOSED');
    if (cfg.inviteCode && invite !== cfg.inviteCode) throw new HttpError(403, 'Mã mời không đúng', 'BAD_INVITE');
    const key = String(username || '').trim().toLowerCase();
    if (!USERNAME_RE.test(key)) throw new HttpError(400, 'Tên đăng nhập 3–32 ký tự: a-z, 0-9, _ . - (bắt đầu bằng chữ/số)', 'BAD_USERNAME');
    const mail = normEmail(email);
    checkPassword(password);
    if (await store.read('account', userPath(key), { fresh: true })) throw new HttpError(409, 'Tên đăng nhập đã tồn tại', 'USERNAME_TAKEN');
    if (await store.read('account', emailPath(mail), { fresh: true })) throw new HttpError(409, 'Email này đã được dùng cho tài khoản khác', 'EMAIL_TAKEN');
    const payload = { username: key, displayName: clampStr(displayName, 60) || key, hash: await bcrypt.hash(password, cfg.bcryptRounds) };
    const r = await issueOtp(mail, 'register', payload);
    return { email: maskEmail(mail), ...r };
  }

  /** Bước 2 đăng ký: đúng OTP → tạo tài khoản + đăng nhập luôn. */
  async function registerVerify({ email, code }, ua) {
    const mail = normEmail(email), c = normCode(code);
    const p = await consumeOtp(mail, 'register', c);
    const user = { id: randomId(12), username: p.username, displayName: p.displayName, email: mail, emailVerified: true, hash: p.hash, createdAt: nowIso() };
    try { await store.create('account', emailPath(mail), { username: user.username, id: user.id }, 'email index'); }
    catch (e) { if (e.code === 'EXISTS') throw new HttpError(409, 'Email này đã được dùng cho tài khoản khác', 'EMAIL_TAKEN'); throw e; }
    try { await store.create('account', userPath(user.username), user, `register ${user.username}`); }
    catch (e) {
      await store.remove('account', emailPath(mail), 'rollback email index').catch(() => {});
      if (e.code === 'EXISTS') throw new HttpError(409, 'Tên đăng nhập vừa bị người khác đăng ký, hãy chọn tên khác', 'USERNAME_TAKEN');
      throw e;
    }
    return issue(user, ua);
  }

  /** Quên mật khẩu bước 1: luôn trả ok (không lộ email nào đã đăng ký). */
  async function resetStart({ email }) {
    const mail = normEmail(email);
    const idx = await store.read('account', emailPath(mail), { fresh: true });
    if (idx) {
      try { await issueOtp(mail, 'reset', { username: idx.data.username }); }
      catch (e) { if (e.code !== 'OTP_COOLDOWN') throw e; }
    }
    return { email: maskEmail(mail), resendIn: cfg.otpResendSec, expiresIn: cfg.otpTtlSec };
  }

  /** Quên mật khẩu bước 2: đúng OTP → đặt mật khẩu mới, đăng xuất mọi thiết bị. */
  async function resetConfirm({ email, code, newPassword }) {
    const mail = normEmail(email), c = normCode(code);
    checkPassword(newPassword);
    const p = await consumeOtp(mail, 'reset', c);
    const hash = await bcrypt.hash(newPassword, cfg.bcryptRounds);
    const u = await store.update('account', userPath(p.username), (cur) => (cur ? { ...cur, hash } : undefined), { message: `reset password ${p.username}` });
    if (!u) throw new HttpError(404, 'Tài khoản không còn tồn tại', 'NO_USER');
    await revoke(u.id, null);
  }

  async function login({ username, password }, ua) {
    const key = String(username || '').trim().toLowerCase();
    const rec = USERNAME_RE.test(key) ? await store.read('account', userPath(key), { fresh: true }) : null;
    const ok = await bcrypt.compare(String(password || ''), rec ? rec.data.hash : dummyHash);
    if (!rec || !ok) throw new HttpError(401, 'Sai tên đăng nhập hoặc mật khẩu', 'BAD_CREDENTIALS');
    return issue(rec.data, ua);
  }

  async function refresh(refreshToken) {
    const p = jwtVerify(refreshToken, cfg.jwtSecret);
    if (!p || p.typ !== 'refresh') throw new HttpError(401, 'Phiên đăng nhập hết hạn', 'BAD_REFRESH');
    const s = await store.read('account', sessionPath(p.sub), { fresh: true });
    if (!s || !s.data.sessions.some((x) => x.sid === p.sid && x.exp > Date.now() / 1000)) throw new HttpError(401, 'Phiên đã bị thu hồi', 'SESSION_REVOKED');
    const u = await store.read('account', userPath(p.un));
    if (!u || u.data.id !== p.sub) throw new HttpError(401, 'Tài khoản không còn tồn tại', 'NO_USER');
    return tokens(u.data, p.sid);
  }

  async function revoke(uid, keepSid) {
    await store.update('account', sessionPath(uid), (cur) => {
      if (!cur) return undefined;
      return { sessions: cur.sessions.filter((s) => s.sid === keepSid) };
    }, { message: `revoke ${uid}` });
  }

  async function logout(refreshToken) {
    const p = jwtVerify(refreshToken, cfg.jwtSecret);
    if (!p) return;
    await store.update('account', sessionPath(p.sub), (cur) => (cur ? { sessions: cur.sessions.filter((s) => s.sid !== p.sid) } : undefined), { message: `logout ${p.sub}` });
  }

  async function changePassword(auth, { oldPassword, newPassword }) {
    checkPassword(newPassword);
    const rec = await store.read('account', userPath(auth.un), { fresh: true });
    if (!rec || !(await bcrypt.compare(String(oldPassword || ''), rec.data.hash))) throw new HttpError(401, 'Mật khẩu hiện tại không đúng', 'BAD_CREDENTIALS');
    const hash = await bcrypt.hash(newPassword, cfg.bcryptRounds);
    await store.update('account', userPath(auth.un), (u) => ({ ...u, hash }), { message: `password ${auth.sub}` });
    await revoke(auth.sub, auth.sid);
  }

  async function updateProfile(auth, { displayName }) {
    const name = clampStr(displayName, 60);
    if (!name) throw new HttpError(400, 'Tên hiển thị không được trống', 'VALIDATION');
    const u = await store.update('account', userPath(auth.un), (cur) => ({ ...cur, displayName: name }), { message: `profile ${auth.sub}` });
    return publicUser(u);
  }

  async function me(auth) {
    const rec = await store.read('account', userPath(auth.un));
    if (!rec || rec.data.id !== auth.sub) throw new HttpError(401, 'Tài khoản không còn tồn tại', 'NO_USER');
    return publicUser(rec.data);
  }

  async function sessions(auth) {
    const s = await store.read('account', sessionPath(auth.sub));
    return ((s && s.data.sessions) || []).map((x) => ({ id: sha256Hex(x.sid).slice(0, 8), current: x.sid === auth.sid, ua: x.ua, createdAt: x.createdAt, exp: x.exp }));
  }

  /** Xác thực access token → { sub, un, sid } hoặc ném 401. */
  function authenticate(req) {
    const h = String(req.headers.authorization || '');
    const p = h.startsWith('Bearer ') ? jwtVerify(h.slice(7), cfg.jwtSecret) : null;
    if (!p || p.typ !== 'access') throw new HttpError(401, 'Cần đăng nhập', 'UNAUTHORIZED');
    return p;
  }

  return { register, registerStart, registerVerify, resetStart, resetConfirm, login, refresh, logout, revoke, changePassword, updateProfile, me, sessions, authenticate };
}

module.exports = { createAuth, USERNAME_RE };
