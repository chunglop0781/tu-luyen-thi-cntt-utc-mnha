'use strict';
const assert = require('assert');
const http = require('http');
const crypto = require('crypto');
const { FakeGitHub } = require('./fakeGithub');
const { createApp } = require('../src/app');

const PAGES = 'https://alice.github.io';
const env = {
  GITHUB_TOKEN: 't', GITHUB_OWNER: 'me', JWT_SECRET: 'j'.repeat(40), ENCRYPTION_KEY: 'k'.repeat(40), GITHUB_WEBHOOK_SECRET: 'whsec',
  CRON_SECRET: 'cron', MAIL_USER: 'bot@example.com', MAIL_PASS: 'x', OTP_RESEND_SECONDS: '0', FRONTEND_ORIGINS: PAGES + ',https://other.github.io/', BCRYPT_ROUNDS: '8',
  IMAGE_REPO_LIMIT_MB: '0.02', IMAGE_REPO_RESERVE_MB: '0', PRUNE_DAYS: '5',
};
const PNG = (n = 100) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), crypto.randomBytes(n)]);
const rid = () => crypto.randomBytes(8).toString('hex');

let passed = 0, failed = 0;
async function t(name, fn) { try { await fn(); passed++; console.log('  ✓', name); } catch (e) { failed++; console.log('  ✗', name, '\n   ', e.stack.split('\n').slice(0, 4).join('\n    ')); } }

(async () => {
  const gh = new FakeGitHub('me');
  for (const r of ['tu-luyen-thi-cntt-utc-mnha-account', 'tu-luyen-thi-cntt-utc-mnha-data']) gh.ensure(r);
  let aiReply = { score: 7, feedback: 'Tốt', strengths: ['a'], weaknesses: ['b'] };
  const aiCalls = []; let aiFail = null;
  const aiFetch = async (url, init) => {
    const body = JSON.parse(init.body); aiCalls.push({ url: String(url), headers: init.headers, body });
    if (aiFail) return new Response(JSON.stringify(aiFail.body), { status: aiFail.status });
    if (String(url).includes('chat/completions')) {
      const asked = body.messages[1].content; const text = /only with the word OK/.test(asked) ? 'OK' : '```json\n' + JSON.stringify(aiReply) + '\n```';
      return new Response(JSON.stringify({ choices: [{ message: { content: text } }] }), { status: 200 });
    }
    const asked = body.contents[0].parts[0].text;
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: /only with the word OK/.test(asked) ? 'OK' : JSON.stringify(aiReply) }] } }] }), { status: 200 });
  };
  const outbox = []; let mailFail = false;     // hộp thư giả: test đọc mã OTP từ đây
  const mailer = { configured: true, send: async (m) => { if (mailFail) { const { HttpError } = require('../src/http'); throw new HttpError(502, 'Không gửi được email, thử lại sau', 'MAIL_FAILED'); } outbox.push(m); } };
  const lastCode = (to) => { const m = [...outbox].reverse().find((x) => x.to === to); return m && /(\d{6})/.exec(m.text)[1]; };
  const app = createApp({ env, fetchImpl: gh.fetch, aiFetch, mailer });
  const server = http.createServer(require('../api/index.js')); // api/index dựng app riêng → dùng handler trực tiếp bên dưới
  server.close();
  const srv = http.createServer(app.handler); await new Promise((r) => srv.listen(0, r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const call = async (method, path, { body, token, origin, raw, headers = {} } = {}) => {
    const res = await fetch(base + path, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(origin ? { Origin: origin } : {}), ...headers }, body: raw || (body ? JSON.stringify(body) : undefined) });
    const ct = res.headers.get('content-type') || '';
    return { status: res.status, headers: res.headers, json: ct.includes('json') ? await res.json() : null, buf: ct.includes('json') ? null : Buffer.from(await res.arrayBuffer()) };
  };
  const reg = async (u, p = 'matkhau123') => {      // đăng ký 2 bước: gửi OTP → nhập OTP
    const email = `${u}@example.com`;
    const s1 = await call('POST', '/api/auth/register/start', { body: { username: u, email, password: p, displayName: u.toUpperCase() } }); assert.equal(s1.status, 200, JSON.stringify(s1.json));
    return (await call('POST', '/api/auth/register/verify', { body: { email, code: lastCode(email) } })).json;
  };

  console.log('CORS & kết nối GitHub Pages ↔ Vercel');
  await t('preflight OPTIONS từ GitHub Pages → 204 + header CORS', async () => {
    const r = await call('OPTIONS', '/api/auth/login', { origin: PAGES, headers: { 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type' } });
    assert.equal(r.status, 204); assert.equal(r.headers.get('access-control-allow-origin'), PAGES);
    assert.match(r.headers.get('access-control-allow-headers'), /Authorization/); assert.equal(r.headers.get('access-control-max-age'), '86400');
  });
  await t('origin có dấu / cuối trong env vẫn khớp (https://other.github.io)', async () => {
    const r = await call('GET', '/api/health', { origin: 'https://other.github.io' }); assert.equal(r.headers.get('access-control-allow-origin'), 'https://other.github.io');
  });
  await t('origin lạ bị từ chối (không có Allow-Origin)', async () => {
    const r = await call('GET', '/api/health', { origin: 'https://evil.example' }); assert.equal(r.headers.get('access-control-allow-origin'), null);
  });
  await t('lỗi 401/404 vẫn có CORS (trình duyệt đọc được thông báo)', async () => {
    const a = await call('GET', '/api/me', { origin: PAGES }); assert.equal(a.status, 401); assert.equal(a.headers.get('access-control-allow-origin'), PAGES);
    const b = await call('GET', '/api/khong-co', { origin: PAGES }); assert.equal(b.status, 404); assert.equal(b.headers.get('access-control-allow-origin'), PAGES);
  });
  await t('health ?deep=1 thấy 2 repo GitHub', async () => {
    const r = await call('GET', '/api/health?deep=1'); assert.equal(r.json.ok, true); assert.deepEqual(r.json.github, { account: true, data: true }); assert.deepEqual(r.json.problems, []);
  });

  console.log('Tài khoản (bcryptjs) & phiên');
  let A, B;
  await t('đăng ký → token; mật khẩu lưu dạng băm trong repo ACCOUNT', async () => {
    A = await reg('alice'); assert.ok(A.accessToken && A.refreshToken); assert.equal(A.user.username, 'alice');
    const f = JSON.parse(gh.file('tu-luyen-thi-cntt-utc-mnha-account', 'users/alice.json'));
    assert.ok(f.hash.startsWith('$stub$') || f.hash.startsWith('$2')); assert.ok(!JSON.stringify(f).includes('matkhau123'));
    assert.ok(gh.file('tu-luyen-thi-cntt-utc-mnha-account', `sessions/${f.id}.json`));
    B = await reg('bob');
  });
  await t('trùng tên 409, tên xấu 400, mật khẩu yếu 400', async () => {
    const st = (b) => call('POST', '/api/auth/register/start', { body: b }).then((r) => r.status);
    assert.equal(await st({ username: 'ALICE', email: 'new@example.com', password: 'matkhau123' }), 409);
    assert.equal(await st({ username: '../x', email: 'new@example.com', password: 'matkhau123' }), 400);
    assert.equal(await st({ username: 'carol', email: 'new@example.com', password: 'short' }), 400);
  });

  console.log('Xác minh email bằng OTP');
  await t('đăng ký cũ (không OTP) bị chặn khi REQUIRE_EMAIL_OTP bật', async () => {
    const r = await call('POST', '/api/auth/register', { body: { username: 'zed', password: 'matkhau123' } }); assert.equal(r.status, 403); assert.equal(r.json.code, 'OTP_REQUIRED');
  });
  await t('start: gửi đúng 1 thư có mã 6 số; CHƯA tạo tài khoản; repo lưu băm mã, không lưu mã/mật khẩu thô', async () => {
    const n = outbox.length;
    const r = await call('POST', '/api/auth/register/start', { body: { username: 'dave', email: 'Dave@Example.com', password: 'matkhau123' } });
    assert.equal(r.status, 200); assert.equal(r.json.email, 'da**@example.com'); assert.equal(outbox.length, n + 1);
    const code = lastCode('dave@example.com'); assert.match(code, /^\d{6}$/);
    assert.equal(gh.file('tu-luyen-thi-cntt-utc-mnha-account', 'users/dave.json'), undefined);
    const all = [...gh.repos.get('tu-luyen-thi-cntt-utc-mnha-account').files.keys()].filter((f) => f.startsWith('otp/')); assert.equal(all.length, 1);
    const raw = gh.file('tu-luyen-thi-cntt-utc-mnha-account', all[0]); assert.ok(!raw.includes(code) && !raw.includes('matkhau123'));
  });
  await t('sai mã giảm lượt thử; đúng mã → tạo tài khoản (email lưu chuẩn hoá) + đăng nhập được', async () => {
    const w = await call('POST', '/api/auth/register/verify', { body: { email: 'dave@example.com', code: '000000' === lastCode('dave@example.com') ? '111111' : '000000' } });
    assert.equal(w.status, 400); assert.equal(w.json.code, 'OTP_WRONG'); assert.match(w.json.error, /còn 4 lần/);
    assert.equal((await call('POST', '/api/auth/register/verify', { body: { email: 'dave@example.com', code: 'abc' } })).status, 400);
    const ok = await call('POST', '/api/auth/register/verify', { body: { email: 'dave@example.com', code: lastCode('dave@example.com') } });
    assert.equal(ok.status, 201); assert.equal(ok.json.user.username, 'dave'); assert.equal(ok.json.user.email, 'dave@example.com');
    assert.equal(JSON.parse(gh.file('tu-luyen-thi-cntt-utc-mnha-account', 'users/dave.json')).email, 'dave@example.com');
    assert.equal((await call('POST', '/api/auth/login', { body: { username: 'dave', password: 'matkhau123' } })).status, 200);
    // mã đã dùng không dùng lại được
    assert.equal((await call('POST', '/api/auth/register/verify', { body: { email: 'dave@example.com', code: '123456' } })).json.code, 'OTP_EXPIRED');
  });
  await t('email đã dùng → 409; tên đã dùng → 409', async () => {
    const r = await call('POST', '/api/auth/register/start', { body: { username: 'dave2', email: 'DAVE@example.com', password: 'matkhau123' } }); assert.equal(r.status, 409); assert.equal(r.json.code, 'EMAIL_TAKEN');
  });
  await t('nhập sai quá 5 lần → khoá, phải gửi lại mã mới (mã cũ hết tác dụng)', async () => {
    await call('POST', '/api/auth/register/start', { body: { username: 'erin', email: 'erin@example.com', password: 'matkhau123' } });
    const good = lastCode('erin@example.com'); const bad = good === '123456' ? '654321' : '123456'; let last;
    for (let i = 0; i < 6; i++) last = await call('POST', '/api/auth/register/verify', { body: { email: 'erin@example.com', code: bad } });
    assert.equal(last.status, 429); assert.equal(last.json.code, 'OTP_LOCKED');
    assert.equal((await call('POST', '/api/auth/register/verify', { body: { email: 'erin@example.com', code: good } })).json.code, 'OTP_EXPIRED');
    await call('POST', '/api/auth/register/start', { body: { username: 'erin', email: 'erin@example.com', password: 'matkhau123' } });
    assert.equal((await call('POST', '/api/auth/register/verify', { body: { email: 'erin@example.com', code: lastCode('erin@example.com') } })).status, 201);
  });
  await t('gửi lại mã → mã mới hợp lệ, mã cũ vô hiệu', async () => {
    await call('POST', '/api/auth/register/start', { body: { username: 'finn', email: 'finn@example.com', password: 'matkhau123' } }); const c1 = lastCode('finn@example.com');
    await call('POST', '/api/auth/register/start', { body: { username: 'finn', email: 'finn@example.com', password: 'matkhau123' } }); const c2 = lastCode('finn@example.com');
    if (c1 !== c2) assert.equal((await call('POST', '/api/auth/register/verify', { body: { email: 'finn@example.com', code: c1 } })).status, 400);
    assert.equal((await call('POST', '/api/auth/register/verify', { body: { email: 'finn@example.com', code: c2 } })).status, 201);
  });
  await t('mã hết hạn → OTP_EXPIRED', async () => {
    await call('POST', '/api/auth/register/start', { body: { username: 'gina', email: 'gina@example.com', password: 'matkhau123' } }); const c = lastCode('gina@example.com');
    const real = Date.now; Date.now = () => real() + 11 * 60 * 1000;
    try { assert.equal((await call('POST', '/api/auth/register/verify', { body: { email: 'gina@example.com', code: c } })).json.code, 'OTP_EXPIRED'); } finally { Date.now = real; }
  });
  await t('gửi mail lỗi → 502, không để lại bản ghi OTP kẹt cooldown', async () => {
    mailFail = true; const r = await call('POST', '/api/auth/register/start', { body: { username: 'hank', email: 'hank@example.com', password: 'matkhau123' } }); mailFail = false;
    assert.equal(r.status, 502); assert.equal(r.json.code, 'MAIL_FAILED');
    assert.equal((await call('POST', '/api/auth/register/start', { body: { username: 'hank', email: 'hank@example.com', password: 'matkhau123' } })).status, 200);
  });
  await t('email sai định dạng → 400', async () => {
    assert.equal((await call('POST', '/api/auth/register/start', { body: { username: 'ivy', email: 'khong-phai-email', password: 'matkhau123' } })).json.code, 'BAD_EMAIL');
  });
  await t('quên mật khẩu: email lạ vẫn trả ok nhưng KHÔNG gửi thư; email thật → OTP → đổi mật khẩu, đăng xuất mọi phiên', async () => {
    const n = outbox.length;
    assert.equal((await call('POST', '/api/auth/reset/start', { body: { email: 'khonghave@example.com' } })).status, 200); assert.equal(outbox.length, n);
    const L = (await call('POST', '/api/auth/login', { body: { username: 'dave', password: 'matkhau123' } })).json;
    assert.equal((await call('POST', '/api/auth/reset/start', { body: { email: 'dave@example.com' } })).status, 200); assert.equal(outbox.length, n + 1);
    const code = lastCode('dave@example.com');
    assert.equal((await call('POST', '/api/auth/reset/confirm', { body: { email: 'dave@example.com', code, newPassword: 'ngan' } })).status, 400); // mật khẩu yếu → chưa tiêu mã? (đã kiểm tra trước khi tiêu)
    assert.equal((await call('POST', '/api/auth/reset/confirm', { body: { email: 'dave@example.com', code, newPassword: 'matkhau-moi-1' } })).status, 200);
    assert.equal((await call('POST', '/api/auth/login', { body: { username: 'dave', password: 'matkhau123' } })).status, 401);
    assert.equal((await call('POST', '/api/auth/login', { body: { username: 'dave', password: 'matkhau-moi-1' } })).status, 200);
    assert.equal((await call('POST', '/api/auth/refresh', { body: { refreshToken: L.refreshToken } })).status, 401);
  });
  await t('REQUIRE_EMAIL_OTP=false → đăng ký thẳng như cũ (không cần email)', async () => {
    const g = new FakeGitHub('me'); g.ensure('tu-luyen-thi-cntt-utc-mnha-account'); g.ensure('tu-luyen-thi-cntt-utc-mnha-data');
    const a = createApp({ env: { ...env, REQUIRE_EMAIL_OTP: 'false', MAIL_USER: '', MAIL_PASS: '' }, fetchImpl: g.fetch }); const s = http.createServer(a.handler); await new Promise((r) => s.listen(0, r));
    const r = await fetch(`http://127.0.0.1:${s.address().port}/api/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'legacy', password: 'matkhau123' }) }); s.close();
    assert.equal(r.status, 201);
  });
  await t('đăng nhập đúng/sai; refresh; logout thu hồi phiên', async () => {
    assert.equal((await call('POST', '/api/auth/login', { body: { username: 'alice', password: 'sai-roi-nha' } })).status, 401);
    assert.equal((await call('POST', '/api/auth/login', { body: { username: 'nobody', password: 'sai-roi-nha' } })).status, 401);
    const L = (await call('POST', '/api/auth/login', { body: { username: 'Alice', password: 'matkhau123' } })).json;
    const R = await call('POST', '/api/auth/refresh', { body: { refreshToken: L.refreshToken } }); assert.equal(R.status, 200);
    assert.equal((await call('GET', '/api/me', { token: R.json.accessToken })).json.user.username, 'alice');
    await call('POST', '/api/auth/logout', { body: { refreshToken: L.refreshToken } });
    assert.equal((await call('POST', '/api/auth/refresh', { body: { refreshToken: L.refreshToken } })).status, 401);
  });
  await t('token giả / sai loại bị từ chối', async () => {
    assert.equal((await call('GET', '/api/me', { token: A.refreshToken })).status, 401);
    assert.equal((await call('GET', '/api/me', { token: A.accessToken + 'x' })).status, 401);
  });
  await t('đổi mật khẩu: mật khẩu cũ hết hiệu lực, phiên khác bị thu hồi', async () => {
    const L2 = (await call('POST', '/api/auth/login', { body: { username: 'bob', password: 'matkhau123' } })).json;
    const r = await call('POST', '/api/auth/change-password', { token: B.accessToken, body: { oldPassword: 'matkhau123', newPassword: 'matkhau-moi-456' } }); assert.equal(r.status, 200);
    assert.equal((await call('POST', '/api/auth/login', { body: { username: 'bob', password: 'matkhau123' } })).status, 401);
    assert.equal((await call('POST', '/api/auth/login', { body: { username: 'bob', password: 'matkhau-moi-456' } })).status, 200);
    assert.equal((await call('POST', '/api/auth/refresh', { body: { refreshToken: L2.refreshToken } })).status, 401);
    assert.equal((await call('POST', '/api/auth/refresh', { body: { refreshToken: B.refreshToken } })).status, 200);
  });

  console.log('Bài tự luận / trắc nghiệm theo từng tài khoản');
  const essayId = rid(), quizId = rid();
  await t('tạo tự luận (PUT idempotent) → file nằm ở repo DATA, không ở ACCOUNT', async () => {
    const body = { title: 'TCP vs UDP', subject: 'Mạng', prompt: 'So sánh TCP và UDP', modelAnswer: 'TCP tin cậy hướng kết nối. UDP không kết nối nhanh.', maxScore: 10,
      rubric: [{ name: 'TCP', points: 5, keywords: 'tin cậy, hướng kết nối' }, { name: 'UDP', points: 5, keywords: ['không kết nối', 'nhanh'] }] };
    const r1 = await call('PUT', `/api/essays/${essayId}`, { token: A.accessToken, body }); assert.equal(r1.status, 200);
    const r2 = await call('PUT', `/api/essays/${essayId}`, { token: A.accessToken, body: { ...body, title: 'TCP vs UDP (sửa)' } });
    assert.equal(r2.json.item.title, 'TCP vs UDP (sửa)'); assert.equal(r2.json.item.createdAt, r1.json.item.createdAt);
    assert.ok(gh.file('tu-luyen-thi-cntt-utc-mnha-data', `u/${A.user.id}/essays/${essayId}.json`));
    assert.equal([...gh.repos.get('tu-luyen-thi-cntt-utc-mnha-account').files.keys()].filter((k) => k.startsWith('u/')).length, 0);
  });
  await t('nhập đề trắc nghiệm từ văn bản rồi lưu', async () => {
    const p = await call('POST', '/api/quizzes/parse', { token: A.accessToken, body: { text: 'Câu 1: HTTP port?\nA. 21\nB. 80\nĐáp án: B\nGiải thích: web\nCâu 2: Chọn lớp transport\n*A. TCP\nB. IP\n*C. UDP\n' } });
    assert.equal(p.json.questions.length, 2);
    const r = await call('PUT', `/api/quizzes/${quizId}`, { token: A.accessToken, body: { title: 'Mạng cơ bản', subject: 'Mạng', questions: p.json.questions } });
    assert.equal(r.status, 200); assert.equal(r.json.item.questions.length, 2);
    assert.equal((await call('PUT', `/api/quizzes/${rid()}`, { token: A.accessToken, body: { title: 'x', questions: [{ text: 'q', options: [{ text: 'a' }, { text: 'b' }], correct: [] }] } })).status, 400);
  });
  await t('tài khoản khác KHÔNG thấy bài của alice; overview riêng', async () => {
    assert.equal((await call('GET', `/api/essays/${essayId}`, { token: B.accessToken })).status, 404);
    assert.equal((await call('GET', `/api/quizzes/${quizId}`, { token: B.accessToken })).status, 404);
    assert.equal((await call('GET', '/api/overview', { token: B.accessToken })).json.items.length, 0);
    const ov = (await call('GET', '/api/overview', { token: A.accessToken })).json; assert.equal(ov.items.length, 2); assert.deepEqual(ov.subjects, ['Mạng']);
  });
  await t('nộp trắc nghiệm → chấm, lưu, idempotent khi gửi lại', async () => {
    const q = (await call('GET', `/api/quizzes/${quizId}`, { token: A.accessToken })).json.item.questions;
    const sid = rid(); const body = { itemType: 'quiz', itemId: quizId, answers: { [q[0].id]: 'B', [q[1].id]: ['A'] }, durationSec: 33 };
    const r = await call('PUT', `/api/submissions/${sid}`, { token: A.accessToken, body }); assert.equal(r.status, 200);
    assert.equal(r.json.submission.correctCount, 1); assert.equal(r.json.submission.score, 1); assert.equal(r.json.submission.max, 2);
    const again = await call('PUT', `/api/submissions/${sid}`, { token: A.accessToken, body }); assert.equal(again.json.submission.submittedAt, r.json.submission.submittedAt);
    const ov = (await call('GET', '/api/overview', { token: A.accessToken })).json;
    assert.equal(ov.items.find((i) => i.id === quizId).attempts, 1); assert.equal(ov.items.find((i) => i.id === quizId).bestPct, 50); assert.equal(ov.stats.submissions, 1);
    assert.equal((await call('GET', `/api/submissions/${sid}`, { token: B.accessToken })).status, 404);
  });
  await t('nộp song song 8 bài → chỉ số không mất bản ghi', async () => {
    const q = (await call('GET', `/api/quizzes/${quizId}`, { token: A.accessToken })).json.item.questions;
    const rs = await Promise.all(Array.from({ length: 8 }, () => call('PUT', `/api/submissions/${rid()}`, { token: A.accessToken, body: { itemType: 'quiz', itemId: quizId, answers: { [q[0].id]: 'B' } } })));
    assert.ok(rs.every((r) => r.status === 200), JSON.stringify(rs.map((r) => r.status)));
    const ov = (await call('GET', '/api/overview', { token: A.accessToken })).json; assert.equal(ov.stats.submissions, 9); assert.equal(ov.items.find((i) => i.id === quizId).attempts, 9);
  });
  await t('tự luận: gợi ý theo rubric, tự chấm, chấm AI (khoá Gemini riêng, lưu mã hoá)', async () => {
    const sid = rid();
    const r = await call('PUT', `/api/submissions/${sid}`, { token: A.accessToken, body: { itemType: 'essay', itemId: essayId, text: 'TCP là giao thức tin cậy, hướng kết nối. UDP nhanh hơn.' } });
    assert.equal(r.json.submission.suggestion.method, 'rubric'); assert.equal(r.json.submission.suggestion.score, 7.5);
    const g = await call('PATCH', `/api/submissions/${sid}`, { token: A.accessToken, body: { selfScore: 8, note: 'ổn' } }); assert.equal(g.json.submission.score, 8);
    assert.equal((await call('PATCH', `/api/submissions/${sid}`, { token: A.accessToken, body: { selfScore: 99 } })).status, 400);
    assert.equal((await call('POST', `/api/submissions/${sid}/ai-grade`, { token: A.accessToken })).status, 400);
    const v = await call('PUT', '/api/me/vault', { token: A.accessToken, body: { geminiKey: 'AIza-secret-key', notes: 'riêng tư' } }); assert.equal(v.json.vault.geminiKeySet, true); assert.ok(!JSON.stringify(v.json).includes('AIza'));
    assert.ok(!gh.file('tu-luyen-thi-cntt-utc-mnha-account', `private/${A.user.id}/vault.json`).toString().includes('AIza-secret-key'));
    const ai = await call('POST', `/api/submissions/${sid}/ai-grade`, { token: A.accessToken }); assert.equal(ai.status, 200); assert.equal(ai.json.submission.ai.score, 7); assert.equal(ai.json.submission.score, 8);
  });
  await t('AI nhiều nhà cung cấp: danh sách model, key riêng từng nhà, thử kết nối, chấm bằng vilao.ai / DeepSeek', async () => {
    const pr = await call('GET', '/api/ai/providers', { token: A.accessToken }); assert.equal(pr.status, 200);
    const ids = pr.json.providers.map((x) => x.id); for (const id of ['gemini', 'vilao', 'openai', 'deepseek', 'openrouter']) assert.ok(ids.includes(id), id);
    assert.ok(pr.json.providers.find((x) => x.id === 'gemini').models.includes('gemini-2.5-flash')); assert.ok(!JSON.stringify(pr.json).includes('api.vilao.ai'));
    assert.equal((await call('GET', '/api/ai/providers')).status, 401);
    const sid = rid(); await call('PUT', `/api/submissions/${sid}`, { token: A.accessToken, body: { itemType: 'essay', itemId: essayId, text: 'UDP không đảm bảo, TCP đảm bảo.' } });
    // chưa có key vilao → 400, không gọi AI
    const n0 = aiCalls.length; assert.equal((await call('POST', '/api/ai/test', { token: A.accessToken, body: { provider: 'vilao' } })).status, 400); assert.equal(aiCalls.length, n0);
    // model Gemini gửi cho vilao / tên rác → từ chối khi lưu
    assert.equal((await call('PUT', '/api/me/vault', { token: A.accessToken, body: { providers: { vilao: { model: 'gemini-2.5-flash' } } } })).status, 400);
    assert.equal((await call('PUT', '/api/me/vault', { token: A.accessToken, body: { providers: { vilao: { model: 'a b;c' } } } })).status, 400);
    assert.equal((await call('PUT', '/api/me/vault', { token: A.accessToken, body: { providers: { evil: { key: 'sk-12345678' } } } })).status, 400);
    assert.equal((await call('PUT', '/api/me/vault', { token: A.accessToken, body: { providers: { vilao: { key: 'sk- co khoang trang' } } } })).status, 400);
    const v = await call('PUT', '/api/me/vault', { token: A.accessToken, body: { provider: 'vilao', providers: { vilao: { key: 'sk-vilao-secret-1', model: 'gpt-4o' }, deepseek: { key: 'sk-deep-secret-2' } } } });
    assert.equal(v.status, 200); assert.equal(v.json.vault.provider, 'vilao'); assert.equal(v.json.vault.items.vilao.keySet, true); assert.equal(v.json.vault.items.vilao.model, 'gpt-4o'); assert.equal(v.json.vault.items.gemini.keySet, true);
    assert.ok(!JSON.stringify(v.json).includes('secret'));
    const raw = gh.file('tu-luyen-thi-cntt-utc-mnha-account', `private/${A.user.id}/vault.json`).toString(); assert.ok(!raw.includes('vilao-secret') && !raw.includes('deep-secret') && !raw.includes('AIza-secret'));
    // thử kết nối: đúng URL cố định, Bearer, model đã lưu
    const tr = await call('POST', '/api/ai/test', { token: A.accessToken, body: {} }); assert.equal(tr.status, 200, JSON.stringify(tr.json));
    assert.equal(tr.json.result.provider, 'vilao'); assert.equal(tr.json.result.model, 'gpt-4o'); assert.equal(tr.json.result.response, 'OK');
    const last = aiCalls[aiCalls.length - 1]; assert.equal(last.url, 'https://api.vilao.ai/v1/chat/completions'); assert.equal(last.headers.Authorization, 'Bearer sk-vilao-secret-1'); assert.equal(last.body.model, 'gpt-4o');
    // chấm bài bằng DeepSeek (chọn riêng cho lần này), JSON bọc ``` vẫn đọc được
    const g = await call('POST', `/api/submissions/${sid}/ai-grade`, { token: A.accessToken, body: { provider: 'deepseek', model: 'deepseek-chat' } }); assert.equal(g.status, 200, JSON.stringify(g.json));
    assert.equal(g.json.submission.ai.provider, 'deepseek'); assert.equal(g.json.submission.ai.model, 'deepseek-chat'); assert.equal(g.json.submission.ai.score, 7);
    assert.equal(aiCalls[aiCalls.length - 1].url, 'https://api.deepseek.com/chat/completions');
    // mặc định theo Cài đặt (vilao)
    const g2 = await call('POST', `/api/submissions/${sid}/ai-grade`, { token: A.accessToken }); assert.equal(g2.json.submission.ai.provider, 'vilao');
    // lỗi nhà cung cấp: 401/403 KHÔNG được trả 401 (sẽ làm đăng xuất nhầm); 429 → 429; 5xx → 502
    aiFail = { status: 401, body: { error: { message: 'bad key' } } }; let r = await call('POST', '/api/ai/test', { token: A.accessToken, body: {} }); assert.equal(r.status, 400); assert.equal(r.json.code, 'AI_KEY');
    aiFail = { status: 403, body: { error: { message: 'Please subscribe to model in the API Key: gpt-4o' } } }; r = await call('POST', '/api/ai/test', { token: A.accessToken, body: {} }); assert.equal(r.status, 400); assert.equal(r.json.code, 'AI_MODEL');
    aiFail = { status: 429, body: { error: { message: 'quota' } } }; r = await call('POST', '/api/ai/test', { token: A.accessToken, body: {} }); assert.equal(r.status, 429);
    aiFail = { status: 500, body: { error: 'oops' } }; r = await call('POST', '/api/ai/test', { token: A.accessToken, body: {} }); assert.equal(r.status, 502);
    // Gemini quá tải 503 → tự chuyển model dự phòng
    aiFail = { status: 503, body: { error: { message: 'overloaded' } } }; const n1 = aiCalls.length; r = await call('POST', '/api/ai/test', { token: A.accessToken, body: { provider: 'gemini' } }); assert.equal(r.status, 502); assert.equal(aiCalls.length - n1, 3);
    aiFail = null;
    // xoá key một nhà cung cấp; khoá riêng nhà khác còn nguyên
    const d = await call('PUT', '/api/me/vault', { token: A.accessToken, body: { providers: { vilao: { key: '' } } } }); assert.equal(d.json.vault.items.vilao.keySet, false); assert.equal(d.json.vault.items.deepseek.keySet, true);
    assert.equal((await call('POST', `/api/submissions/${sid}/ai-grade`, { token: A.accessToken })).status, 400);
    // tài khoản khác không dùng được key của alice
    assert.equal((await call('POST', '/api/ai/test', { token: B.accessToken, body: { provider: 'deepseek' } })).status, 400);
  });
  await t('Phân tích AI trắc nghiệm: prompt rút gọn câu đúng, lưu aiAnalyses, giới hạn lần/giãn cách, chỉ trắc nghiệm', async () => {
    const q = (await call('GET', `/api/quizzes/${quizId}`, { token: A.accessToken })).json.item.questions;
    const sid = rid(); const sub = await call('PUT', `/api/submissions/${sid}`, { token: A.accessToken, body: { itemType: 'quiz', itemId: quizId, answers: { [q[0].id]: q[0].options.find((o) => !q[0].correct.includes(o.id)).id } } }); assert.equal(sub.status, 200);
    const nq = sub.json.submission.snapshot.length;
    const prev = aiReply;
    aiReply = { summary: 'Hơi yếu mạng', weakTopics: [{ topic: 'Mạng', wrongCount: 1, questions: [1, 99], advice: 'Ôn TCP' }], mistakes: [{ q: 1, why: 'nhầm', correctReasoning: 'đúng là X', tip: 'nhớ' }, { q: 999, why: 'rác' }], studyPlan: ['Đọc lại chương 3'] };
    try {
      const n0 = aiCalls.length;
      const r = await call('POST', `/api/submissions/${sid}/ai-analyze`, { token: A.accessToken, body: { provider: 'deepseek', model: 'deepseek-chat' } }); assert.equal(r.status, 200, JSON.stringify(r.json));
      const a = r.json.submission.aiAnalyses; assert.equal(a.length, 1); assert.equal(a[0].provider, 'deepseek'); assert.equal(a[0].model, 'deepseek-chat');
      assert.deepEqual(a[0].result.weakTopics[0].questions, [1]); assert.equal(a[0].result.mistakes.length, 1); assert.equal(a[0].result.mistakes[0].q, 1); assert.equal(a[0].result.summary, 'Hơi yếu mạng');
      const sent = aiCalls[aiCalls.length - 1].body.messages[1].content; assert.equal(aiCalls.length - n0, 1);
      assert.ok(sent.includes('[SAI] Câu 1')); assert.ok(sent.includes('Đáp án đúng:')); assert.ok(sent.includes('<<<ĐỀ VÀ BÀI LÀM'));
      assert.equal((sent.match(/\[SAI\] Câu/g) || []).length + (sent.match(/\[ĐÚNG\] Câu/g) || []).length, nq);
      // giãn cách 30 giây giữa hai lần
      assert.equal((await call('POST', `/api/submissions/${sid}/ai-analyze`, { token: A.accessToken, body: { provider: 'deepseek' } })).json.code, 'COOLDOWN');
      // đủ 5 lần thì chặn
      const real = Date.now; let t0 = real(); try { for (let i = 0; i < 4; i++) { t0 += 40000; Date.now = () => t0; assert.equal((await call('POST', `/api/submissions/${sid}/ai-analyze`, { token: A.accessToken, body: { provider: 'deepseek' } })).status, 200); }
        t0 += 40000; Date.now = () => t0; assert.equal((await call('POST', `/api/submissions/${sid}/ai-analyze`, { token: A.accessToken, body: { provider: 'deepseek' } })).json.code, 'LIMIT'); } finally { Date.now = real; }
      // AI trả rác → 502, không lưu
      const sid2 = rid(); await call('PUT', `/api/submissions/${sid2}`, { token: A.accessToken, body: { itemType: 'quiz', itemId: quizId, answers: {} } });
      aiReply = { foo: 1 }; assert.equal((await call('POST', `/api/submissions/${sid2}/ai-analyze`, { token: A.accessToken, body: { provider: 'deepseek' } })).json.code, 'AI_FORMAT');
      assert.equal(((await call('GET', `/api/submissions/${sid2}`, { token: A.accessToken })).json.submission.aiAnalyses || []).length, 0);
      // người khác không phân tích được bài của mình; tự luận bị từ chối
      assert.equal((await call('POST', `/api/submissions/${sid}/ai-analyze`, { token: B.accessToken, body: {} })).status, 404);
      const es = rid(); await call('PUT', `/api/submissions/${es}`, { token: A.accessToken, body: { itemType: 'essay', itemId: essayId, text: 'abc' } });
      assert.equal((await call('POST', `/api/submissions/${es}/ai-analyze`, { token: A.accessToken, body: {} })).json.code, 'BAD_TYPE');
      assert.equal((await call('POST', `/api/submissions/${sid}/ai-analyze`, { body: {} })).status, 401);
    } finally { aiReply = prev; }
  });
  await t('xoá bài nộp & bài; index cập nhật', async () => {
    const list = (await call('GET', '/api/submissions', { token: A.accessToken })).json.submissions;
    assert.equal((await call('DELETE', `/api/submissions/${list[0].id}`, { token: A.accessToken })).status, 200);
    assert.equal((await call('DELETE', `/api/essays/${essayId}`, { token: A.accessToken })).status, 200);
    assert.equal((await call('GET', `/api/essays/${essayId}`, { token: A.accessToken })).status, 404);
    assert.equal((await call('GET', '/api/overview', { token: A.accessToken })).json.items.length, 1);
  });
  await t('reindex dựng lại chỉ mục từ thư mục', async () => {
    gh.repos.get('tu-luyen-thi-cntt-utc-mnha-data').files.delete(`u/${A.user.id}/index.json`);
    app.store.invalidate('tu-luyen-thi-cntt-utc-mnha-data');
    const r = await call('POST', '/api/reindex', { token: A.accessToken }); assert.equal(r.json.items.length, 1); assert.ok(r.json.stats.submissions >= 8);
  });

  console.log('Ảnh mã hoá + tự sinh repo');
  let img1;
  await t('upload → lưu mã hoá (không lộ PNG), tải lại đúng nguyên bản', async () => {
    const png = PNG(300);
    const r = await call('POST', '/api/images', { token: A.accessToken, raw: png, headers: { 'Content-Type': 'image/png' } }); assert.equal(r.status, 201);
    img1 = r.json.image.id; assert.match(img1, /^0\.[a-f0-9]{24}$/);
    const stored = [...gh.repos.get('tu-luyen-thi-cntt-utc-mnha-image').files.values()].find((f) => f.buf.subarray(0, 4).toString() === 'UTC2').buf;
    assert.ok(!stored.includes(png.subarray(8, 40)));
    const d = await call('GET', `/api/images/${img1}`, { token: A.accessToken, origin: PAGES }); assert.equal(d.status, 200); assert.equal(d.headers.get('content-type'), 'image/png'); assert.ok(d.buf.equals(png));
    assert.equal(d.headers.get('access-control-allow-origin'), PAGES);
  });
  await t('tài khoản khác không đọc/xoá được ảnh; chưa đăng nhập 401', async () => {
    assert.equal((await call('GET', `/api/images/${img1}`, { token: B.accessToken })).status, 404);
    assert.equal((await call('DELETE', `/api/images/${img1}`, { token: B.accessToken })).json.removed, false);
    assert.equal((await call('GET', `/api/images/${img1}`)).status, 401);
  });
  await t('không phải ảnh → 415; quá lớn → 413', async () => {
    assert.equal((await call('POST', '/api/images', { token: A.accessToken, raw: Buffer.from('not an image at all') })).status, 415);
    assert.equal((await call('POST', '/api/images', { token: A.accessToken, raw: Buffer.concat([PNG(10), Buffer.alloc(5 * 1024 * 1024)]) })).status, 413);
  });
  await t('đầy dung lượng → tự tạo repo -1, -2 (private) và ảnh đọc lại được', async () => {
    const ids = [];
    for (let i = 0; i < 8; i++) { const r = await call('POST', '/api/images', { token: A.accessToken, raw: PNG(6000) }); assert.equal(r.status, 201, JSON.stringify(r.json)); ids.push(r.json.image.id); }
    const names = [...gh.repos.keys()].filter((n) => n.startsWith('tu-luyen-thi-cntt-utc-mnha-image')).sort();
    assert.ok(names.includes('tu-luyen-thi-cntt-utc-mnha-image-1') && names.includes('tu-luyen-thi-cntt-utc-mnha-image-2'), names.join());
    assert.ok(names.every((n) => gh.repos.get(n).private));
    assert.ok(ids.some((i) => i.startsWith('1.')) && ids.some((i) => i.startsWith('2.')));
    for (const id of ids) assert.equal((await call('GET', `/api/images/${id}`, { token: A.accessToken })).status, 200);
    const pool = JSON.parse(gh.file('tu-luyen-thi-cntt-utc-mnha-data', 'images/pool.json'));
    assert.ok(pool.repos.length >= 3 && pool.repos[0].full === true);
  });
  await t('gỡ ảnh khỏi bài → ảnh bị xoá khỏi repo', async () => {
    const id = rid(); const up = (await call('POST', '/api/images', { token: A.accessToken, raw: PNG(50) })).json.image.id;
    await call('PUT', `/api/essays/${id}`, { token: A.accessToken, body: { title: 'có ảnh', prompt: `xem [img:${up}]` } });
    assert.equal((await call('GET', `/api/images/${up}`, { token: A.accessToken })).status, 200);
    await call('PUT', `/api/essays/${id}`, { token: A.accessToken, body: { title: 'hết ảnh', prompt: 'không ảnh' } });
    await new Promise((r) => setTimeout(r, 100));
    assert.equal((await call('GET', `/api/images/${up}`, { token: A.accessToken })).status, 404);
  });

  console.log('Webhook GitHub (repo private)');
  const sign = (b) => 'sha256=' + crypto.createHmac('sha256', 'whsec').update(b).digest('hex');
  const hook = (event, payload, sig) => { const b = JSON.stringify(payload); return call('POST', '/webhooks/github', { raw: b, headers: { 'Content-Type': 'application/json', 'X-GitHub-Event': event, 'X-Hub-Signature-256': sig || sign(b) } }); };
  await t('chữ ký sai → 401; ping → 200', async () => {
    assert.equal((await hook('push', { x: 1 }, 'sha256=00')).status, 401);
    assert.equal((await hook('ping', { zen: 'ok' })).json.pong, true);
  });
  await t('push làm mới cache (đọc được thay đổi từ ngoài)', async () => {
    const acc = 'tu-luyen-thi-cntt-utc-mnha-account';
    const f = JSON.parse(gh.file(acc, 'users/alice.json')); await app.store.read('account', 'users/alice.json');
    gh.seedCommit(acc, 'users/alice.json', JSON.stringify({ ...f, displayName: 'ĐỔI NGOÀI' }));
    assert.notEqual((await app.store.read('account', 'users/alice.json')).data.displayName, 'ĐỔI NGOÀI');     // cache cũ
    const r = await hook('push', { repository: { name: acc }, commits: [{ modified: ['users/alice.json'] }] }); assert.equal(r.json.invalidated, 1);
    assert.equal((await app.store.read('account', 'users/alice.json')).data.displayName, 'ĐỔI NGOÀI');
  });
  await t('ensureHook gắn webhook cho repo (idempotent)', async () => {
    const wh = createApp({ env: { ...env, PUBLIC_API_URL: 'https://api.vercel.app' }, fetchImpl: gh.fetch }).webhook;
    const g = createApp({ env, fetchImpl: gh.fetch }).gh;
    assert.equal((await wh.ensureHook(g, 'tu-luyen-thi-cntt-utc-mnha-data')).created, true);
    assert.equal((await wh.ensureHook(g, 'tu-luyen-thi-cntt-utc-mnha-data')).updated, true);
    assert.equal(gh.hooks.get('tu-luyen-thi-cntt-utc-mnha-data').length, 1);
    assert.equal(gh.hooks.get('tu-luyen-thi-cntt-utc-mnha-data')[0].config.url, 'https://api.vercel.app/webhooks/github');
  });

  console.log('Dọn commit repo ACCOUNT sau 5 ngày');
  await t('cron cần Bearer CRON_SECRET', async () => {
    assert.equal((await call('GET', '/api/cron/prune')).status, 401);
    assert.equal((await call('GET', '/api/cron/prune', { headers: { Authorization: 'Bearer cron' } })).status, 200);
  });
  const DAY = 86400000;
  await t('gộp commit cũ > 5 ngày, giữ nguyên HEAD; chạy lại = noop', async () => {
    const g2 = new FakeGitHub('me'); const acc = 'tu-luyen-thi-cntt-utc-mnha-account'; g2.ensure('tu-luyen-thi-cntt-utc-mnha-data');
    const now = Date.now(); for (let d = 12; d >= 0; d--) g2.seedCommit(acc, `f${d}.txt`, 'v' + d, now - d * DAY + 1000);
    const before = g2.chainLength(acc), headFiles = [...g2.repos.get(acc).files.keys()].sort().join();
    const a2 = createApp({ env, fetchImpl: g2.fetch }); const s = http.createServer(a2.handler); await new Promise((r) => s.listen(0, r));
    const url = `http://127.0.0.1:${s.address().port}/api/cron/prune`, h = { Authorization: 'Bearer cron' };
    const dry = await (await fetch(url + '?dry=1', { headers: h })).json(); assert.equal(dry.status, 'dry-run'); assert.equal(g2.chainLength(acc), before);
    const r = await (await fetch(url, { headers: h })).json(); assert.equal(r.status, 'pruned', JSON.stringify(r));
    const after = g2.chainLength(acc); assert.ok(after < before && after <= 7, `${before} → ${after}`);
    assert.equal([...g2.repos.get(acc).files.keys()].sort().join(), headFiles);
    assert.equal(g2.file(acc, 'f0.txt').toString(), 'v0'); assert.equal(g2.file(acc, 'f12.txt').toString(), 'v12');
    assert.equal((await (await fetch(url, { headers: h })).json()).status, 'noop');
    s.close();
  });
  await t('quá nhiều commit trong cửa sổ → vẫn dọn được (giữ maxReplay commit mới nhất)', async () => {
    const g3 = new FakeGitHub('me'); const acc = 'tu-luyen-thi-cntt-utc-mnha-account'; g3.ensure('tu-luyen-thi-cntt-utc-mnha-data');
    const now = Date.now(); for (let i = 0; i < 6; i++) g3.seedCommit(acc, `old${i}`, 'o', now - 20 * DAY + i);
    for (let i = 0; i < 30; i++) g3.seedCommit(acc, `new${i}`, 'n', now - 3 * DAY + i * 1000);
    const a3 = createApp({ env: { ...env, PRUNE_MAX_REPLAY: '10' }, fetchImpl: g3.fetch }); const s = http.createServer(a3.handler); await new Promise((r) => s.listen(0, r));
    const r = await (await fetch(`http://127.0.0.1:${s.address().port}/api/cron/prune`, { headers: { Authorization: 'Bearer cron' } })).json();
    assert.equal(r.status, 'pruned'); assert.equal(r.truncated, true); assert.equal(g3.chainLength(acc), 11); assert.ok(g3.file(acc, 'old0') && g3.file(acc, 'new29')); s.close();
  });
  await t('ACCOUNT = DATA (một repo) → cron bỏ qua, không đụng lịch sử bài', async () => {
    const g4 = new FakeGitHub('me'); g4.ensure('one');
    const a4 = createApp({ env: { ...env, ACCOUNT_GITHUB_REPO: 'one', DATA_GITHUB_REPO: 'one' }, fetchImpl: g4.fetch }); const s = http.createServer(a4.handler); await new Promise((r) => s.listen(0, r));
    const r = await (await fetch(`http://127.0.0.1:${s.address().port}/api/cron/prune`, { headers: { Authorization: 'Bearer cron' } })).json(); assert.ok(r.skipped); s.close();
  });

  console.log('Độ bền kết nối GitHub');
  await t('GitHub trả 502 thoáng qua → tự retry và thành công', async () => {
    gh.failures.push(502, 502); app.store.invalidate('tu-luyen-thi-cntt-utc-mnha-data');
    const r = await call('GET', '/api/overview', { token: A.accessToken }); assert.equal(r.status, 200);
  });
  await t('GitHub chết hẳn → 502 JSON có CORS (không treo)', async () => {
    gh.failures.push(500, 500, 500, 500, 500, 500, 500, 500); app.store.invalidate('tu-luyen-thi-cntt-utc-mnha-data');
    const r = await call('GET', '/api/overview', { token: A.accessToken, origin: PAGES }); assert.equal(r.status, 502); assert.equal(r.json.code, 'GITHUB'); assert.equal(r.headers.get('access-control-allow-origin'), PAGES);
    gh.failures.length = 0;
  });
  await t('body JSON hỏng → 400; JSON quá 1MB → 413', async () => {
    assert.equal((await call('POST', '/api/auth/login', { raw: '{oops', headers: { 'Content-Type': 'application/json' } })).status, 400);
    assert.equal((await call('POST', '/api/auth/login', { raw: JSON.stringify({ a: 'x'.repeat(1100000) }), headers: { 'Content-Type': 'application/json' } })).status, 413);
  });

  srv.close();
  console.log(`\n${passed} đạt, ${failed} lỗi`);
  process.exit(failed ? 1 : 0);
})();
