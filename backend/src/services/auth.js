'use strict';
/** Tài khoản + phiên đăng nhập, lưu trong repo ACCOUNT (private, dọn commit 5 ngày). Mật khẩu: bcryptjs (băm một chiều). */
const bcrypt = require('bcryptjs');
const { HttpError } = require('../http');
const { jwtSign, jwtVerify, sha256Hex } = require('../crypto');
const { randomId, nowIso, clampStr } = require('../util');

const USERNAME_RE = /^[a-z0-9][a-z0-9_.-]{2,31}$/;
const userPath = (key) => `users/${key}.json`;
const sessionPath = (uid) => `sessions/${uid}.json`;
const MAX_SESSIONS = 20;

function createAuth({ cfg, store }) {
  // Băm giả để thời gian phản hồi khi "không có user" ≈ khi "sai mật khẩu".
  const dummyHash = bcrypt.hashSync('dummy-password-for-timing', cfg.bcryptRounds);

  const publicUser = (u) => ({ id: u.id, username: u.username, displayName: u.displayName, createdAt: u.createdAt });

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

  return { register, login, refresh, logout, revoke, changePassword, updateProfile, me, sessions, authenticate };
}

module.exports = { createAuth, USERNAME_RE };
