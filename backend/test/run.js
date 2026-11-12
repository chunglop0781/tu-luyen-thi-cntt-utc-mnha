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
    if (!String(url).includes('generativelanguage')) {
      const asked = body.messages[1].content; const text = /only with the word OK/.test(asked) ? 'OK' : '```json\n' + JSON.stringify(aiReply) + '\n```';
      return new Response(JSON.stringify({ choices: [{ message: { content: text } }] }), { status: 200 });
    }
    const asked = body.contents[0].parts[0].text;
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: /only with the word OK/.test(asked) ? 'OK' : JSON.stringify(aiReply) }] } }] }), { status: 200 });
  };
  const outbox = []; let mailFail = false;     // hộp thư giả: test đọc mã OTP từ đây
  const mailer = { configured: true, send: async (m) => { if (mailFail) { const { HttpError } = require('../src/http'); throw new HttpError(502, 'Không gửi được email, thử lại sau', 'MAIL_FAILED'); } outbox.push(m); } };
  const lastCode = (to) => { const m = [...outbox].reverse().find((x) => x.to === to); return m && /(\d{6})/.exec(m.text)[1]; };
  const dnsLookup = async (h) => (/^evil\./.test(h) ? [{ address: '10.0.0.5', family: 4 }] : [{ address: '93.184.216.34', family: 4 }]);   // DNS giả: evil.* → IP nội bộ
  const app = createApp({ env, fetchImpl: gh.fetch, aiFetch, mailer, dnsLookup });
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
  await t('đăng nhập bằng EMAIL (không phân biệt hoa/thường) hoặc tên đăng nhập; sai → 401 chung', async () => {
    const em = A.user.email; assert.ok(em, 'alice phải có email');
    const byMail = await call('POST', '/api/auth/login', { body: { identifier: em.toUpperCase(), password: 'matkhau123' } }); assert.equal(byMail.status, 200, JSON.stringify(byMail.json)); assert.equal(byMail.json.user.username, 'alice');
    assert.equal((await call('POST', '/api/auth/login', { body: { identifier: ' ' + em + ' ', password: 'matkhau123' } })).status, 200);
    assert.equal((await call('POST', '/api/auth/login', { body: { identifier: 'alice', password: 'matkhau123' } })).status, 200);
    assert.equal((await call('POST', '/api/auth/login', { body: { username: em, password: 'matkhau123' } })).status, 200);   // client cũ gửi email trong field username
    assert.equal((await call('POST', '/api/auth/login', { body: { identifier: em, password: 'sai-mat-khau' } })).status, 401);
    assert.equal((await call('POST', '/api/auth/login', { body: { identifier: 'khongco@example.com', password: 'matkhau123' } })).status, 401);
    assert.equal((await call('POST', '/api/auth/login', { body: { identifier: 'a@b', password: 'matkhau123' } })).status, 401);
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
  const QBODY = { title: 'Mạng cơ bản', subject: 'Mạng', maxScore: 10, duration: 20, shuffle: true, 'pointsPerQuestion_mcq': 1, 'pointsPerQuestion_tf': 1, 'pointsPerQuestion_fill': 1, scoring_tf: 'equal', tolerance: 0.01, note: 'Làm tròn 2 chữ số.',
    mcq: '- HTTP dùng cổng nào?\n+)21\n+)80\n+)443\n=> B\n++) Web dùng <b>80</b>.\n- Chọn giao thức tầng giao vận\n+)TCP\n+)IP\n+)UDP\n=> A, C',
    tf: '- Xét TCP/UDP:\n+)TCP tin cậy\n=> Đúng\n++) Có xác nhận.\n+)UDP có bắt tay 3 bước\n=> Sai',
    fill: '- 10/4 bằng?\n=> 2.5 | 2,5\n- Giao thức gửi thư?\n=> SMTP' };
  await t('id bài dạng <timestamp>_<hex ngẫu nhiên>: lưu thành u/<uid>/essays/<id>.json với "id" đúng như tên file; id cũ 16 hex vẫn dùng được', async () => {
    const { newItemId } = require('../src/util'); const id = newItemId(); assert.match(id, /^\d{13}_[a-f0-9]{12}$/);
    const r = await call('PUT', `/api/essays/${id}`, { token: A.accessToken, body: { title: 'Đề id mới', subject: 'HĐH', prompt: 'x', maxScore: 10 } }); assert.equal(r.status, 200, JSON.stringify(r.json)); assert.equal(r.json.item.id, id);
    const f = JSON.parse(gh.file('tu-luyen-thi-cntt-utc-mnha-data', `u/${A.user.id}/essays/${id}.json`).toString()); assert.equal(f.id, id);
    assert.equal((await call('PUT', `/api/essays/${'..%2fx_1'}`, { token: A.accessToken, body: {} })).status, 400);
    assert.equal((await call('DELETE', `/api/essays/${id}`, { token: A.accessToken })).status, 200);
  });
  await t('tự luận: thời gian làm bài (đếm giờ / không đếm giờ) được kiểm tra', async () => {
    const base = { title: 'TL giờ', subject: 'Mạng', prompt: '<p>Đề</p>', maxScore: 10 };
    const a = await call('PUT', `/api/essays/${rid()}`, { token: A.accessToken, body: { ...base, duration: 45 } }); assert.equal(a.json.item.duration, 45);
    const b = await call('PUT', `/api/essays/${rid()}`, { token: A.accessToken, body: { ...base, timerMode: 'untimed', duration: null } }); assert.equal(b.json.item.duration, null);
    assert.equal((await call('PUT', `/api/essays/${rid()}`, { token: A.accessToken, body: { ...base, duration: 0 } })).status, 400);
    assert.equal((await call('PUT', `/api/essays/${rid()}`, { token: A.accessToken, body: { ...base, duration: 9999 } })).status, 400);
    for (const x of [a, b]) await call('DELETE', `/api/essays/${x.json.item.id}`, { token: A.accessToken });
  });
  await t('đề 3 phần: dán prompt/quy luật → xem trước, lưu, sửa lại được (raw), lỗi cú pháp báo dòng', async () => {
    const pv = await call('POST', '/api/quizzes/parse', { token: A.accessToken, body: QBODY }); assert.equal(pv.status, 200, JSON.stringify(pv.json));
    assert.equal(pv.json.preview.parts.mcq.questions.length, 2); assert.equal(pv.json.preview.parts.tf.questions[0].statements.length, 2); assert.deepEqual(pv.json.preview.parts.fill.questions[0].answers, ['2.5', '2,5']);
    const r = await call('PUT', `/api/quizzes/${quizId}`, { token: A.accessToken, body: QBODY }); assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.item.parts.mcq.questions[1].correct.join(), 'A,C'); assert.equal(r.json.item.shuffle, true); assert.equal(r.json.item.duration, 20); assert.equal(r.json.item.parts.fill.tolerance, 0.01);
    const g = (await call('GET', `/api/quizzes/${quizId}`, { token: A.accessToken })).json.item; assert.ok(g.raw.mcq.includes('=> A, C') && g.raw.tf.includes('=> Sai') && g.raw.fill.includes('SMTP'));
    const bad = await call('PUT', `/api/quizzes/${rid()}`, { token: A.accessToken, body: { ...QBODY, mcq: '- q\n+)a\n+)b' } }); assert.equal(bad.status, 400); assert.equal(bad.json.code, 'VALIDATION'); assert.ok(bad.json.errors[0].line >= 1);
    assert.equal((await call('PUT', `/api/quizzes/${rid()}`, { token: A.accessToken, body: { ...QBODY, mcq: '', tf: '', fill: '' } })).status, 400);
    assert.equal((await call('PUT', `/api/quizzes/${rid()}`, { token: A.accessToken, body: { ...QBODY, duration: 0 } })).status, 400);
    const un = await call('PUT', `/api/quizzes/${rid()}`, { token: A.accessToken, body: { ...QBODY, timerMode: 'untimed', duration: null } }); assert.equal(un.json.item.duration, null);
    const xss = await call('PUT', `/api/quizzes/${rid()}`, { token: A.accessToken, body: { ...QBODY, mcq: '- q\n+)a\n+)b\n=> A\n++) <script>alert(1)</script><b>ok</b>' } }); assert.ok(!xss.json.item.parts.mcq.questions[0].explanationHtml.includes('<script'));
    for (const x of [un, xss]) await call('DELETE', `/api/quizzes/${x.json.item.id}`, { token: A.accessToken });
  });
  await t('tài khoản khác KHÔNG thấy bài của alice; overview riêng', async () => {
    assert.equal((await call('GET', `/api/essays/${essayId}`, { token: B.accessToken })).status, 404);
    assert.equal((await call('GET', `/api/quizzes/${quizId}`, { token: B.accessToken })).status, 404);
    assert.equal((await call('GET', '/api/overview', { token: B.accessToken })).json.items.length, 0);
    const ov = (await call('GET', '/api/overview', { token: A.accessToken })).json; assert.ok(ov.items.length >= 2); assert.deepEqual(ov.subjects, ['Mạng']);
  });
  await t('nộp trắc nghiệm 3 phần → chấm (mcq/đúng-sai theo ý/điền có sai số), lưu, idempotent', async () => {
    const answers = { 'mcq-1': ['B'], 'mcq-2': ['A'], 'tf-1-a': true, 'tf-1-b': true, 'fill-1': ' 2,51 ', 'fill-2': 'smtp', 'hack': 1 };
    const sid = rid(); const body = { itemType: 'quiz', itemId: quizId, answers, durationSec: 33 };
    const r = await call('PUT', `/api/submissions/${sid}`, { token: A.accessToken, body }); assert.equal(r.status, 200, JSON.stringify(r.json));
    const sub = r.json.submission; assert.ok(!('hack' in sub.answers));
    // mcq-1 đúng, mcq-2 thiếu C → sai, tf: 1/2 ý → 0.5, fill-1 trong sai số 0.01 → đúng, fill-2 đúng (không phân biệt hoa/thường) ⇒ 1+0+0.5+1+1 = 3.5/5
    assert.equal(sub.result.earnedPoints, 3.5); assert.equal(sub.result.totalPoints, 5); assert.equal(sub.score, 7); assert.equal(sub.max, 10); assert.equal(sub.correctCount, 4); assert.equal(sub.total, 6);
    assert.equal(sub.result.parts.tf.correct, 1); assert.ok(sub.snapshot.parts.mcq.questions[0].correct);
    const again = await call('PUT', `/api/submissions/${sid}`, { token: A.accessToken, body }); assert.equal(again.json.submission.submittedAt, sub.submittedAt);
    const ov = (await call('GET', '/api/overview', { token: A.accessToken })).json; const it = ov.items.find((i) => i.id === quizId);
    assert.equal(it.attempts, 1); assert.equal(it.bestPct, 70); assert.equal(it.size, 5); assert.equal(ov.stats.submissions, 1);
    assert.equal((await call('GET', `/api/submissions/${sid}`, { token: B.accessToken })).status, 404);
  });
  await t('nộp song song 8 bài → chỉ số không mất bản ghi', async () => {
    const rs = await Promise.all(Array.from({ length: 8 }, () => call('PUT', `/api/submissions/${rid()}`, { token: A.accessToken, body: { itemType: 'quiz', itemId: quizId, answers: { 'mcq-1': ['B'] } } })));
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
    // tài khoản mới chỉ có Gemini dựng sẵn; nhà khác do người dùng TỰ THÊM (có mẫu gợi ý)
    assert.deepEqual(pr.json.providers.map((x) => x.id), ['gemini']); assert.ok(pr.json.providers[0].models.includes('gemini-2.5-flash'));
    for (const id of ['vilao', 'openai', 'deepseek', 'openrouter']) assert.ok(pr.json.presets.some((x) => x.id === id), id);
    assert.equal((await call('GET', '/api/ai/providers')).status, 401);
    // thêm nhà cung cấp: kiểm tra đầu vào
    const add = (b, tok = A.accessToken) => call('POST', '/api/ai/providers', { token: tok, body: b });
    assert.equal((await add({ id: 'gemini', label: 'X', baseUrl: 'https://api.x.com', models: 'm1' })).status, 400);
    assert.equal((await add({ id: 'bad id', label: 'X', baseUrl: 'https://api.x.com', models: 'm1' })).status, 400);
    assert.equal((await add({ id: 'httpx', label: 'X', baseUrl: 'http://api.x.com', models: 'm1' })).status, 400);
    assert.equal((await add({ id: 'ipx', label: 'X', baseUrl: 'https://127.0.0.1', models: 'm1' })).status, 400);
    assert.equal((await add({ id: 'lochost', label: 'X', baseUrl: 'https://localhost', models: 'm1' })).status, 400);
    assert.equal((await add({ id: 'nomodel', label: 'X', baseUrl: 'https://api.x.com' })).status, 400);
    for (const pre of pr.json.presets.filter((x) => ['vilao', 'deepseek'].includes(x.id))) { const a = await add(pre); assert.equal(a.status, 201, JSON.stringify(a.json)); }
    assert.equal((await add(pr.json.presets.find((x) => x.id === 'vilao'))).status, 409);
    assert.deepEqual((await call('GET', '/api/ai/providers', { token: A.accessToken })).json.providers.map((x) => x.id), ['gemini', 'vilao', 'deepseek']);
    // lưu riêng từng tài khoản ở AI-database/<uid>/index.json, KHÔNG chứa key; tài khoản khác không thấy
    const doc = JSON.parse(gh.file('tu-luyen-thi-cntt-utc-mnha-account', `AI-database/${A.user.id}/index.json`).toString()); assert.deepEqual(doc.providers.map((x) => x.id), ['vilao', 'deepseek']); assert.ok(!/"(key|apiKey|keys)"/.test(JSON.stringify(doc)));
    assert.deepEqual((await call('GET', '/api/ai/providers', { token: B.accessToken })).json.providers.map((x) => x.id), ['gemini']);
    assert.equal((await call('PUT', '/api/ai/providers/vilao', { token: B.accessToken, body: { label: 'hack' } })).status, 404);
    assert.equal((await call('PUT', '/api/ai/providers/gemini', { token: A.accessToken, body: { label: 'x' } })).status, 400);
    assert.equal((await call('DELETE', '/api/ai/providers/gemini', { token: A.accessToken })).status, 400);
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
    // nhà cung cấp tự thêm với header xác thực riêng + tên miền trỏ vào IP nội bộ bị chặn (SSRF)
    assert.equal((await add({ id: 'myai', label: 'Của tôi', baseUrl: 'https://api.myai.com/', chatPath: '/chat', authHeader: 'X-Api-Key', authScheme: '', models: 'my-1, my-2' })).status, 201);
    await call('PUT', '/api/me/vault', { token: A.accessToken, body: { providers: { myai: { key: 'my-key-12345', model: 'my-2' } } } });
    const mt = await call('POST', '/api/ai/test', { token: A.accessToken, body: { provider: 'myai' } }); assert.equal(mt.status, 200, JSON.stringify(mt.json));
    const lm = aiCalls[aiCalls.length - 1]; assert.equal(lm.url, 'https://api.myai.com/chat'); assert.equal(lm.headers['X-Api-Key'], 'my-key-12345'); assert.equal(lm.headers.Authorization, undefined); assert.equal(lm.body.model, 'my-2');
    assert.equal((await add({ id: 'evil', label: 'Evil', baseUrl: 'https://evil.example.net', models: 'm' })).status, 201);
    await call('PUT', '/api/me/vault', { token: A.accessToken, body: { providers: { evil: { key: 'evil-key-1234' } } } });
    const n2 = aiCalls.length; const ev = await call('POST', '/api/ai/test', { token: A.accessToken, body: { provider: 'evil' } }); assert.equal(ev.status, 400); assert.equal(ev.json.code, 'AI_URL'); assert.equal(aiCalls.length, n2);
    // sửa / xoá: xoá nhà cung cấp cũng xoá key đã lưu
    assert.equal((await call('PUT', '/api/ai/providers/myai', { token: A.accessToken, body: { label: 'Đổi tên', models: 'my-1, my-2, my-3' } })).json.provider.models.length, 3);
    assert.equal((await call('DELETE', '/api/ai/providers/myai', { token: A.accessToken })).status, 200); await call('DELETE', '/api/ai/providers/evil', { token: A.accessToken });
    const after = (await call('GET', '/api/me/vault', { token: A.accessToken })).json.vault; assert.ok(!after.items.myai && !after.items.evil);
    assert.ok(!gh.file('tu-luyen-thi-cntt-utc-mnha-account', `private/${A.user.id}/vault.json`).toString().includes('"myai"'));
    assert.equal((await call('POST', '/api/ai/test', { token: A.accessToken, body: { provider: 'myai' } })).status, 400);
  });
  await t('Phân tích AI trắc nghiệm: prompt rút gọn câu đúng, lưu aiAnalyses, giới hạn lần/giãn cách, chỉ trắc nghiệm', async () => {
    const sid = rid(); const sub = await call('PUT', `/api/submissions/${sid}`, { token: A.accessToken, body: { itemType: 'quiz', itemId: quizId, answers: { 'mcq-1': ['A'], 'tf-1-a': false } } }); assert.equal(sub.status, 200);
    const nq = 5;
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

  console.log('Chia sẻ bài trắc nghiệm');
  let C, shareId;
  await t('chỉ chủ bài tạo được link; loại bài lạ bị từ chối; người lạ không chia sẻ được bài của người khác', async () => {
    C = await reg('carol');
    assert.equal((await call('POST', '/api/shares', { body: { itemId: quizId } })).status, 401);
    assert.equal((await call('POST', '/api/shares', { token: A.accessToken, body: { type: 'poem', itemId: quizId } })).status, 400);
    assert.equal((await call('POST', '/api/shares', { token: B.accessToken, body: { type: 'quiz', itemId: quizId } })).status, 404);
    const r = await call('POST', '/api/shares', { token: A.accessToken, body: { type: 'quiz', itemId: quizId } }); assert.equal(r.status, 200, JSON.stringify(r.json));
    shareId = r.json.shareId; assert.match(shareId, /^[a-f0-9]{24}$/);
    assert.equal((await call('POST', '/api/shares', { token: A.accessToken, body: { type: 'quiz', itemId: quizId } })).json.shareId, shareId);   // gọi lại → cùng link
    assert.equal((await call('GET', '/api/overview', { token: A.accessToken })).json.items.find((i) => i.id === quizId).shareId, shareId);
  });
  await t('phải đăng nhập mới mở được; người làm nhận đề KHÔNG có đáp án/giải thích', async () => {
    assert.equal((await call('GET', `/api/shares/${shareId}`)).status, 401);
    const r = await call('GET', `/api/shares/${shareId}`, { token: B.accessToken }); assert.equal(r.status, 200);
    const txt = JSON.stringify(r.json.item);
    assert.ok(r.json.item.parts.mcq.questions.length === 2 && !r.json.share.isOwner);
    assert.ok(!/"correct"|"answers"|explanationHtml|Web dùng/.test(txt), txt.slice(0, 300));
    assert.equal((await call('GET', `/api/shares/${rid()}${rid().slice(0, 4)}`, { token: B.accessToken })).status, 404);
  });
  await t('link kiểu /lessons/<id>/share?id=<chủ bài> tra ra đúng shareId; phải đăng nhập; id sai → 404', async () => {
    assert.equal((await call('GET', `/api/share-link/${A.user.id}/${quizId}`)).status, 401);
    const r = await call('GET', `/api/share-link/${A.user.id}/${quizId}`, { token: B.accessToken }); assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.shareId, shareId);
    assert.equal((await call('GET', `/api/share-link/${B.user.id}/${quizId}`, { token: B.accessToken })).status, 404);   // sai chủ bài
    assert.equal((await call('GET', `/api/share-link/${A.user.id}/zz`, { token: B.accessToken })).status, 400);
  });
  let bSub, cSub;
  await t('người khác nộp → chấm đúng, bài nằm trong kho CỦA HỌ (không phải của chủ), idempotent', async () => {
    const answers = { 'mcq-1': ['B'], 'mcq-2': ['A', 'C'] };
    bSub = rid(); const r = await call('PUT', `/api/shares/${shareId}/submissions/${bSub}`, { token: B.accessToken, body: { answers, durationSec: 30 } }); assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.submission.shareId, shareId); assert.ok(r.json.submission.score > 0);
    assert.ok(gh.file('tu-luyen-thi-cntt-utc-mnha-data', `u/${B.user.id}/submissions/${bSub}.json`));
    assert.ok(!gh.file('tu-luyen-thi-cntt-utc-mnha-data', `u/${A.user.id}/submissions/${bSub}.json`));
    const again = await call('PUT', `/api/shares/${shareId}/submissions/${bSub}`, { token: B.accessToken, body: { answers } }); assert.equal(again.status, 200);
    cSub = rid(); await call('PUT', `/api/shares/${shareId}/submissions/${cSub}`, { token: C.accessToken, body: { answers: { 'mcq-1': ['A'] } } });
    assert.equal((await call('GET', `/api/submissions/${bSub}`, { token: B.accessToken })).json.submission.shareId, shareId);
    assert.equal((await call('GET', `/api/submissions/${bSub}`, { token: A.accessToken })).status, 404);   // chủ bài không đọc được bài làm
    const ov = (await call('GET', '/api/overview', { token: B.accessToken })).json; assert.equal(ov.shared.length, 1); assert.equal(ov.shared[0].shareId, shareId); assert.equal(ov.items.length, 0);
  });
  await t('lịch sử: chủ bài thấy tên từng người; người làm chỉ thấy bài + điểm của mình, điểm người khác ẩn danh', async () => {
    const o = (await call('GET', `/api/shares/${shareId}/history`, { token: A.accessToken })).json;
    assert.equal(o.share.isOwner, true); assert.equal(o.stats.students, 2); assert.equal(o.points.length, 2);
    assert.deepEqual(o.points.map((p) => p.n).sort(), ['BOB', 'CAROL']); assert.equal(o.rows.length, 2); assert.ok(o.rows.every((r) => r.n && !r.id));
    const b = (await call('GET', `/api/shares/${shareId}/history`, { token: B.accessToken })).json;
    assert.equal(b.share.isOwner, false); assert.equal(b.points.length, 2); assert.equal(b.points.filter((p) => p.m).length, 1);
    assert.ok(b.points.every((p) => p.n === undefined)); assert.equal(b.points.find((p) => p.m).id, bSub); assert.equal(b.points.find((p) => !p.m).id, undefined);
    assert.equal(b.rows.length, 1); assert.equal(b.rows[0].id, bSub); assert.equal(b.rows[0].n, undefined);
    assert.ok(!JSON.stringify(b).includes('carol') && !JSON.stringify(b).toLowerCase().includes('"uid"') && !JSON.stringify(b).includes(C.user.id));
  });
  await t('ảnh trong đề chia sẻ: người làm xem được ảnh của đề, nhưng không xem được ảnh khác của chủ', async () => {
    const up = async () => (await call('POST', '/api/images', { token: A.accessToken, raw: PNG(40), headers: { 'Content-Type': 'image/png' } })).json.image.id;
    const inQuiz = await up(), other = await up();
    const qid = rid(); const put = await call('PUT', `/api/quizzes/${qid}`, { token: A.accessToken, body: { ...QBODY, mcq: `- Hình sau là gì? [img:${inQuiz}]\n+)a\n+)b\n=> A` } }); assert.equal(put.status, 200, JSON.stringify(put.json));
    const sh = (await call('POST', '/api/shares', { token: A.accessToken, body: { itemId: qid } })).json.shareId;
    assert.equal((await call('GET', `/api/images/${inQuiz}`, { token: B.accessToken })).status, 404);
    const ok = await call('GET', `/api/shares/${sh}/images/${inQuiz}`, { token: B.accessToken }); assert.equal(ok.status, 200); assert.ok(ok.buf.length > 40);
    assert.equal((await call('GET', `/api/shares/${sh}/images/${other}`, { token: B.accessToken })).status, 404);
    assert.equal((await call('GET', `/api/shares/${sh}/images/${inQuiz}`)).status, 401);
  });
  await t('chủ tắt chia sẻ → người làm bị chặn, chủ vẫn xem lịch sử; bật lại dùng cùng link; xoá bài nộp bị chặn, điểm vẫn ở biểu đồ', async () => {
    assert.equal((await call('PATCH', `/api/shares/${shareId}`, { token: B.accessToken, body: { enabled: false } })).status, 404);
    assert.equal((await call('PATCH', `/api/shares/${shareId}`, { token: A.accessToken, body: { enabled: false } })).status, 200);
    assert.equal((await call('GET', `/api/shares/${shareId}`, { token: B.accessToken })).status, 404);
    assert.equal((await call('PUT', `/api/shares/${shareId}/submissions/${rid()}`, { token: B.accessToken, body: { answers: {} } })).status, 404);
    assert.equal((await call('GET', `/api/shares/${shareId}/history`, { token: A.accessToken })).status, 200);
    assert.equal((await call('POST', '/api/shares', { token: A.accessToken, body: { itemId: quizId } })).json.shareId, shareId);
    assert.equal((await call('GET', `/api/shares/${shareId}`, { token: B.accessToken })).status, 200);
    const del = await call('DELETE', `/api/submissions/${bSub}`, { token: B.accessToken }); assert.equal(del.status, 403); assert.equal(del.json.code, 'SHARED_LOCKED');   // bài nộp từ link chia sẻ không xoá được
    assert.equal((await call('GET', `/api/submissions/${bSub}`, { token: B.accessToken })).status, 200);
    assert.equal((await call('GET', `/api/shares/${shareId}/history`, { token: A.accessToken })).json.points.length, 2);
    assert.equal((await call('GET', `/api/overview`, { token: B.accessToken })).json.recent.some((x) => x.id === bSub), true);
  });

  console.log('Chia sẻ bài tự luận (AI chấm bằng key của người nộp)');
  let eId, eShare, bEs, cEs;
  await t('chủ chia sẻ tự luận; người làm nhận đề KHÔNG có đáp án mẫu / tiêu chí', async () => {
    eId = rid();
    const put = await call('PUT', `/api/essays/${eId}`, { token: A.accessToken, body: { title: 'Mô hình OSI', subject: 'Mạng', prompt: 'Trình bày mô hình OSI', modelAnswer: 'DAP-AN-MAU-BI-MAT 7 tầng', maxScore: 10, rubric: [{ name: 'Tầng', points: 10, keywords: 'vật lý, liên kết' }] } }); assert.equal(put.status, 200);
    assert.equal((await call('POST', '/api/shares', { token: B.accessToken, body: { type: 'essay', itemId: eId } })).status, 404);   // không chia sẻ được bài của người khác
    const r = await call('POST', '/api/shares', { token: A.accessToken, body: { type: 'essay', itemId: eId } }); assert.equal(r.status, 200, JSON.stringify(r.json));
    eShare = r.json.shareId;
    assert.equal((await call('POST', '/api/shares', { token: A.accessToken, body: { type: 'essay', itemId: eId } })).json.shareId, eShare);   // gọi lại → cùng link
    assert.equal((await call('GET', '/api/overview', { token: A.accessToken })).json.items.find((i) => i.id === eId).shareId, eShare);
    const g = await call('GET', `/api/shares/${eShare}`, { token: B.accessToken }); assert.equal(g.status, 200);
    assert.equal(g.json.share.type, 'essay'); assert.equal(g.json.item.type, 'essay'); assert.match(g.json.item.prompt, /OSI/);
    assert.ok(!JSON.stringify(g.json).includes('DAP-AN-MAU-BI-MAT') && !('rubric' in g.json.item) && !('modelAnswer' in g.json.item));
  });
  await t('nộp tự luận: lưu kho của người làm, KHÔNG tự chấm, chưa lên biểu đồ, không xoá / không tự nhập điểm được', async () => {
    bEs = rid();
    const r = await call('PUT', `/api/shares/${eShare}/submissions/${bEs}`, { token: B.accessToken, body: { text: 'OSI có 7 tầng: vật lý, liên kết dữ liệu…', durationSec: 40 } }); assert.equal(r.status, 200, JSON.stringify(r.json));
    const sub = r.json.submission; assert.equal(sub.type, 'essay'); assert.equal(sub.shareId, eShare); assert.equal(sub.score, null); assert.equal(sub.ai, null);
    assert.ok(gh.file('tu-luyen-thi-cntt-utc-mnha-data', `u/${B.user.id}/submissions/${bEs}.json`));
    assert.ok(!gh.file('tu-luyen-thi-cntt-utc-mnha-data', `u/${A.user.id}/submissions/${bEs}.json`));
    assert.equal((await call('PUT', `/api/shares/${eShare}/submissions/${bEs}`, { token: B.accessToken, body: { text: 'khác' } })).json.submission.text.startsWith('OSI có 7 tầng'), true);   // gửi lại không nhân đôi
    assert.equal((await call('PUT', `/api/shares/${eShare}/submissions/${rid()}`, { token: B.accessToken, body: { text: '   ' } })).status, 400);
    const hb = (await call('GET', `/api/shares/${eShare}/history`, { token: B.accessToken })).json;
    assert.equal(hb.points.length, 0); assert.equal(hb.rows.length, 1); assert.equal(hb.rows[0].score, null); assert.equal(hb.stats.pending, 1);
    const ha = (await call('GET', `/api/shares/${eShare}/history`, { token: A.accessToken })).json; assert.equal(ha.stats.students, 1); assert.equal(ha.stats.pending, 1); assert.equal(ha.points.length, 0);
    assert.equal((await call('GET', `/api/submissions/${bEs}`, { token: A.accessToken })).status, 404);   // chủ bài không đọc được bài làm
    const d = await call('DELETE', `/api/submissions/${bEs}`, { token: B.accessToken }); assert.equal(d.status, 403);
    const self = await call('PATCH', `/api/submissions/${bEs}`, { token: B.accessToken, body: { selfScore: 10 } }); assert.equal(self.status, 403);
    assert.equal((await call('PATCH', `/api/submissions/${bEs}`, { token: B.accessToken, body: { note: 'ghi chú' } })).status, 200);
    assert.equal((await call('GET', `/api/submissions/${bEs}`, { token: B.accessToken })).json.submission.score, null);
  });
  await t('AI chấm bằng KEY CỦA NGƯỜI NỘP → điểm lên biểu đồ; chỉ chấm được một lần', async () => {
    assert.equal((await call('POST', `/api/submissions/${bEs}/ai-grade`, { token: B.accessToken })).status, 400);   // bob chưa có key AI
    assert.equal((await call('PUT', '/api/me/vault', { token: B.accessToken, body: { geminiKey: 'AIza-bob-key-12345' } })).status, 200);
    aiReply = { score: 6, feedback: 'Đủ ý chính', strengths: ['x'], weaknesses: ['y'] };
    const n0 = aiCalls.length;
    const g = await call('POST', `/api/submissions/${bEs}/ai-grade`, { token: B.accessToken }); assert.equal(g.status, 200, JSON.stringify(g.json));
    assert.equal(g.json.submission.ai.score, 6); assert.equal(g.json.submission.score, 6);
    const used = aiCalls.slice(n0); assert.ok(used.length >= 1); assert.ok(JSON.stringify(used.map((x) => [x.url, x.headers])).includes('AIza-bob-key-12345'));   // đúng key của bob
    assert.ok(used.some((x) => JSON.stringify(x.body).includes('DAP-AN-MAU-BI-MAT')));   // AI nhận đáp án mẫu của chủ bài để chấm
    const ha = (await call('GET', `/api/shares/${eShare}/history`, { token: A.accessToken })).json;
    assert.equal(ha.points.length, 1); assert.equal(ha.points[0].s, 6); assert.equal(ha.stats.pending, 0); assert.equal(ha.stats.best, 6); assert.ok(ha.points[0].n);
    const hb = (await call('GET', `/api/shares/${eShare}/history`, { token: B.accessToken })).json; assert.equal(hb.points.length, 1); assert.equal(hb.points[0].m, 1); assert.equal(hb.rows[0].score, 6);
    const again = await call('POST', `/api/submissions/${bEs}/ai-grade`, { token: B.accessToken }); assert.equal(again.status, 409); assert.equal(again.json.code, 'ALREADY_GRADED');
    assert.equal((await call('GET', `/api/submissions/${bEs}`, { token: B.accessToken })).json.submission.ai.score, 6);
  });
  await t('AI lỗi → không mất lượt chấm; chấm lại được; người thứ hai có điểm riêng trên cùng biểu đồ', async () => {
    cEs = rid();
    assert.equal((await call('PUT', `/api/shares/${eShare}/submissions/${cEs}`, { token: C.accessToken, body: { text: 'Mô hình OSI gồm bảy tầng.' } })).status, 200);
    assert.equal((await call('PUT', '/api/me/vault', { token: C.accessToken, body: { geminiKey: 'AIza-carol-key-1234' } })).status, 200);
    aiFail = { status: 401, body: { error: { message: 'bad key' } } };
    const bad = await call('POST', `/api/submissions/${cEs}/ai-grade`, { token: C.accessToken }); assert.ok(bad.status >= 400, String(bad.status));
    aiFail = null; aiReply = { score: 9, feedback: 'Tốt', strengths: [], weaknesses: [] };
    assert.equal((await call('GET', `/api/submissions/${cEs}`, { token: C.accessToken })).json.submission.ai, null);
    const ok = await call('POST', `/api/submissions/${cEs}/ai-grade`, { token: C.accessToken }); assert.equal(ok.status, 200, JSON.stringify(ok.json));
    const h = (await call('GET', `/api/shares/${eShare}/history`, { token: A.accessToken })).json; assert.equal(h.points.length, 2); assert.deepEqual(h.points.map((x) => x.s).sort((a, b) => a - b), [6, 9]);
    assert.equal((await call('GET', `/api/shares/${eShare}/history`, { token: C.accessToken })).json.points.filter((x) => x.m).length, 1);
  });

  console.log('Flashcard (ứng dụng) + chia sẻ như trắc nghiệm / tự luận');
  const FC_RAW = '+) admire\n++) ədˈmaɪə\n=> ngưỡng mộ\n\n+) elephant\n=> con voi\n\n+) tolerate\n=> chịu đựng';
  let fcId, fcShare, fcBSub;
  await t('tạo flashcard (PUT idempotent) → file ở repo DATA; nội dung sai báo lỗi; Học lý thuyết không nhận ++)', async () => {
    fcId = rid();
    const r = await call('PUT', `/api/flashcards/${fcId}`, { token: A.accessToken, body: { title: 'Unit 1', subject: 'Tiếng Anh', mode: 'language', language: 'en-US', content: FC_RAW } });
    assert.equal(r.status, 200, JSON.stringify(r.json)); assert.equal(r.json.item.cards.length, 3); assert.equal(r.json.item.cards[0].ipa, 'ədˈmaɪə');
    assert.ok(gh.file('tu-luyen-thi-cntt-utc-mnha-data', `u/${A.user.id}/flashcards/${fcId}.json`));
    assert.equal((await call('PUT', `/api/flashcards/${fcId}`, { token: A.accessToken, body: { title: 'Unit 1', subject: 'Tiếng Anh', mode: 'language', language: 'en-US', content: FC_RAW } })).status, 200);
    assert.equal((await call('PUT', `/api/flashcards/${rid()}`, { token: A.accessToken, body: { title: 'x', mode: 'language', language: 'en-US', content: '+) chỉ có mặt trước' } })).status, 400);
    assert.equal((await call('PUT', `/api/flashcards/${rid()}`, { token: A.accessToken, body: { title: 'x', mode: 'theory', content: '+) q\n++) ipa\n=> a' } })).status, 400);
    assert.equal((await call('PUT', `/api/flashcards/${rid()}`, { token: A.accessToken, body: { title: '', mode: 'theory', content: '+) q\n=> a' } })).status, 400);
    const p = await call('POST', '/api/flashcards/parse', { token: A.accessToken, body: { mode: 'language', content: FC_RAW } }); assert.equal(p.status, 200); assert.equal(p.json.preview.total, 3);
  });
  await t('flashcard là của riêng từng tài khoản; overview tách riêng flashcards; chưa đăng nhập 401', async () => {
    assert.equal((await call('GET', `/api/flashcards/${fcId}`)).status, 401);
    assert.equal((await call('GET', `/api/flashcards/${fcId}`, { token: B.accessToken })).status, 404);
    assert.equal((await call('DELETE', `/api/flashcards/${fcId}`, { token: B.accessToken })).status, 404);
    const ov = (await call('GET', '/api/overview', { token: A.accessToken })).json;
    assert.equal(ov.flashcards.length, 1); assert.equal(ov.flashcards[0].size, 3); assert.equal(ov.stats.flashcards, 1);
    assert.equal((await call('GET', '/api/overview', { token: B.accessToken })).json.flashcards.length, 0);
  });
  await t('tự học: nộp kết quả Kiểm tra (đúng/tổng → thang 10), kẹp giá trị, lưu vào kho của mình', async () => {
    const id = rid(); const r = await call('PUT', `/api/submissions/${id}`, { token: A.accessToken, body: { itemType: 'flashcard', itemId: fcId, ok: 2, total: 3, durationSec: 20 } });
    assert.equal(r.status, 200, JSON.stringify(r.json)); assert.equal(r.json.submission.score, 6.7); assert.equal(r.json.submission.max, 10);
    const id2 = rid(); const r2 = await call('PUT', `/api/submissions/${id2}`, { token: A.accessToken, body: { itemType: 'flashcard', itemId: fcId, ok: 99, total: 3 } });
    assert.equal(r2.json.submission.correctCount, 3); assert.equal(r2.json.submission.score, 10);
    const ov = (await call('GET', '/api/overview', { token: A.accessToken })).json; assert.equal(ov.flashcards[0].attempts, 2); assert.equal(ov.flashcards[0].bestPct, 100);
  });
  await t('chia sẻ flashcard: chỉ chủ bài tạo link; người làm nhận bộ thẻ, mở được bằng /lessons/<id>/share', async () => {
    assert.equal((await call('POST', '/api/shares', { token: B.accessToken, body: { type: 'flashcard', itemId: fcId } })).status, 404);
    const r = await call('POST', '/api/shares', { token: A.accessToken, body: { type: 'flashcard', itemId: fcId } }); assert.equal(r.status, 200, JSON.stringify(r.json)); fcShare = r.json.shareId;
    assert.equal((await call('POST', '/api/shares', { token: A.accessToken, body: { type: 'flashcard', itemId: fcId } })).json.shareId, fcShare);
    assert.equal((await call('GET', `/api/shares/${fcShare}`)).status, 401);
    const g = await call('GET', `/api/shares/${fcShare}`, { token: B.accessToken }); assert.equal(g.status, 200);
    assert.equal(g.json.share.type, 'flashcard'); assert.equal(g.json.item.cards.length, 3); assert.equal(g.json.item.mode, 'language'); assert.ok(!g.json.share.isOwner);
    assert.equal((await call('GET', `/api/share-link/${A.user.id}/${fcId}`, { token: B.accessToken })).json.shareId, fcShare);
  });
  await t('người khác nộp Kiểm tra qua link → bài nằm kho của HỌ, idempotent, hiện ở "Được chia sẻ với tôi"', async () => {
    fcBSub = rid(); const body = { ok: 1, total: 3, durationSec: 15 };
    const r = await call('PUT', `/api/shares/${fcShare}/submissions/${fcBSub}`, { token: B.accessToken, body }); assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.submission.type, 'flashcard'); assert.equal(r.json.submission.score, 3.3); assert.equal(r.json.submission.shareId, fcShare);
    assert.ok(gh.file('tu-luyen-thi-cntt-utc-mnha-data', `u/${B.user.id}/submissions/${fcBSub}.json`));
    assert.ok(!gh.file('tu-luyen-thi-cntt-utc-mnha-data', `u/${A.user.id}/submissions/${fcBSub}.json`));
    assert.equal((await call('PUT', `/api/shares/${fcShare}/submissions/${fcBSub}`, { token: B.accessToken, body })).status, 200);
    assert.equal((await call('GET', `/api/submissions/${fcBSub}`, { token: A.accessToken })).status, 404);     // chủ bộ thẻ không đọc được bài của người khác
    const ov = (await call('GET', '/api/overview', { token: B.accessToken })).json;
    assert.equal(ov.flashcardShared.length, 1); assert.equal(ov.flashcardShared[0].shareId, fcShare); assert.equal(ov.flashcards.length, 0);
  });
  await t('lịch sử flashcard: chủ thấy tên từng người; người làm chỉ thấy bài mình, điểm người khác ẩn danh', async () => {
    const own = (await call('GET', `/api/shares/${fcShare}/history`, { token: A.accessToken })).json;
    assert.equal(own.share.type, 'flashcard'); assert.equal(own.share.isOwner, true); assert.ok(own.points.some((p) => p.n === B.user.username || p.n === (B.user.displayName || '')) || own.points.some((p) => p.n));
    const mine = (await call('GET', `/api/shares/${fcShare}/history`, { token: B.accessToken })).json;
    assert.equal(mine.share.isOwner, false); assert.equal(mine.stats.total, 1); assert.ok(mine.points.every((p) => p.n === undefined));
    const c = (await call('GET', `/api/shares/${fcShare}/history`, { token: C.accessToken })).json; assert.equal(c.stats.total, 0);
  });
  await t('tắt chia sẻ → người làm bị chặn, bật lại cùng link; xoá bộ thẻ → xoá file + chỉ mục', async () => {
    assert.equal((await call('PATCH', `/api/shares/${fcShare}`, { token: A.accessToken, body: { enabled: false } })).status, 200);
    assert.equal((await call('GET', `/api/shares/${fcShare}`, { token: B.accessToken })).status, 404);
    assert.equal((await call('PUT', `/api/shares/${fcShare}/submissions/${rid()}`, { token: B.accessToken, body: { ok: 1, total: 3 } })).status, 404);
    assert.equal((await call('POST', '/api/shares', { token: A.accessToken, body: { type: 'flashcard', itemId: fcId } })).json.shareId, fcShare);
    assert.equal((await call('GET', `/api/shares/${fcShare}`, { token: B.accessToken })).status, 200);
    assert.equal((await call('DELETE', `/api/flashcards/${fcId}`, { token: A.accessToken })).status, 200);
    assert.ok(!gh.file('tu-luyen-thi-cntt-utc-mnha-data', `u/${A.user.id}/flashcards/${fcId}.json`));
    assert.equal((await call('GET', '/api/overview', { token: A.accessToken })).json.flashcards.length, 0);
    assert.equal((await call('GET', `/api/shares/${fcShare}`, { token: B.accessToken })).status, 404);          // chủ đã xoá bộ thẻ
  });

  console.log('Prompt chấm / phân tích AI riêng của từng tài khoản');
  let P, qP, qShare;     // chủ bài riêng cho phần này (hạn mức chấm AI theo tài khoản của các phần trước đã dùng hết)
  await t('chuẩn bị: tài khoản chủ bài có key AI, 1 đề trắc nghiệm đã chia sẻ', async () => {
    P = await reg('prompter'); assert.ok(P.accessToken);
    assert.equal((await call('PUT', '/api/me/vault', { token: P.accessToken, body: { geminiKey: 'AIza-prompter-key-1' } })).status, 200);
    qP = rid(); assert.equal((await call('PUT', `/api/quizzes/${qP}`, { token: P.accessToken, body: QBODY })).status, 200);
    qShare = (await call('POST', '/api/shares', { token: P.accessToken, body: { type: 'quiz', itemId: qP } })).json.shareId;
  });
  const lastPrompt = () => { const c = aiCalls[aiCalls.length - 1]; return c.body.contents ? c.body.contents[0].parts[0].text : c.body.messages[1].content; };
  const pBody = (o = {}) => ({ kind: 'essay', name: 'Chấm kỹ', description: 'mô tả', content: 'MARK-ESSAY-A chấm {bài_làm} trên {max_score} điểm, mức {strictness}. Đề: {đề_bài}', strictness: 'strict', ...o });
  let pEssay, pQuiz, pEssayB;
  await t('CRUD prompt: kiểm tra nội dung, biến lạ chỉ cảnh báo, mỗi loại một mặc định, người khác không thấy', async () => {
    pEssay = rid(); pQuiz = rid(); pEssayB = rid();
    assert.equal((await call('GET', '/api/prompts')).status, 401);
    const r = await call('PUT', `/api/prompts/${pEssay}`, { token: P.accessToken, body: pBody({ content: 'MARK-ESSAY-A chấm {bài_làm} trên {max_score} điểm, mức {strictness}. Đề: {đề_bài} {gõ_sai}' }) });
    assert.equal(r.status, 200, JSON.stringify(r.json)); assert.deepEqual(r.json.unknownPlaceholders, ['{gõ_sai}']); assert.equal(r.json.prompt.version, 1); assert.equal(r.json.prompt.isDefault, false);
    assert.equal((await call('PUT', `/api/prompts/${pEssay}`, { token: P.accessToken, body: pBody() })).json.prompt.version, 2);   // sửa lại → tăng phiên bản, không nhân đôi
    assert.equal((await call('PUT', `/api/prompts/${rid()}`, { token: P.accessToken, body: pBody({ content: 'không có biến dữ liệu' }) })).status, 400);
    assert.equal((await call('PUT', `/api/prompts/${rid()}`, { token: P.accessToken, body: pBody({ name: '  ' }) })).status, 400);
    assert.equal((await call('PUT', `/api/prompts/${rid()}`, { token: P.accessToken, body: pBody({ kind: 'poem' }) })).status, 400);
    assert.equal((await call('PUT', `/api/prompts/${rid()}`, { token: P.accessToken, body: pBody({ content: '{bài_làm}'.padEnd(8001, 'x') }) })).status, 400);
    assert.equal((await call('PUT', `/api/prompts/${pEssay}`, { token: P.accessToken, body: pBody({ kind: 'quiz', content: '{đề_trắc_nghiệm}' }) })).status, 400);   // không đổi loại
    assert.equal((await call('PUT', `/api/prompts/${pQuiz}`, { token: P.accessToken, body: { kind: 'quiz', name: 'Phân tích sâu', content: 'MARK-QUIZ-A {đề_trắc_nghiệm} | {bài_làm} | {kết_quả} | {student_name}' } })).status, 200);
    const a2 = rid(); await call('PUT', `/api/prompts/${a2}`, { token: P.accessToken, body: pBody({ name: 'Khác', isDefault: true }) });
    await call('PUT', `/api/prompts/${pEssay}`, { token: P.accessToken, body: pBody({ isDefault: true }) });
    const list = (await call('GET', '/api/prompts?kind=essay', { token: P.accessToken })).json;
    assert.equal(list.prompts.length, 2); assert.deepEqual(list.prompts.filter((p) => p.isDefault).map((p) => p.id), [pEssay]);   // chỉ một mặc định mỗi loại
    assert.ok(list.defaults.essay.includes('{bài_làm}') && list.placeholders.quiz.includes('{kết_quả}'));
    assert.equal((await call('GET', '/api/prompts?kind=quiz', { token: P.accessToken })).json.prompts.length, 1);
    assert.equal((await call('GET', '/api/prompts', { token: B.accessToken })).json.prompts.length, 0);   // không thấy prompt của người khác
    assert.equal((await call('DELETE', `/api/prompts/${a2}`, { token: B.accessToken })).status, 404);
    assert.equal((await call('DELETE', `/api/prompts/${a2}`, { token: P.accessToken })).status, 200);
    assert.ok(gh.file('tu-luyen-thi-cntt-utc-mnha-data', `u/${P.user.id}/prompts.json`));
    assert.equal((await call('GET', '/api/export', { token: P.accessToken })).json.prompts.length, 2);
  });
  await t('gắn prompt vào bài: chỉ prompt có thật và đúng loại; đề giao cho người làm không lộ promptId', async () => {
    const base = { title: 'TL prompt', subject: 'Mạng', prompt: 'Trình bày TCP', modelAnswer: 'ĐA', maxScore: 10 };
    assert.equal((await call('PUT', `/api/essays/${rid()}`, { token: P.accessToken, body: { ...base, promptId: rid() } })).status, 400);       // không tồn tại
    assert.equal((await call('PUT', `/api/essays/${rid()}`, { token: P.accessToken, body: { ...base, promptId: pQuiz } })).status, 400);        // sai loại
    assert.equal((await call('PUT', `/api/essays/${rid()}`, { token: B.accessToken, body: { ...base, promptId: pEssay } })).status, 400);      // prompt của người khác
    const id = rid(); const r = await call('PUT', `/api/essays/${id}`, { token: P.accessToken, body: { ...base, promptId: pEssay } }); assert.equal(r.status, 200); assert.equal(r.json.item.promptId, pEssay);
    assert.equal((await call('GET', `/api/essays/${id}`, { token: P.accessToken })).json.item.promptId, pEssay);
    assert.equal((await call('PUT', `/api/essays/${id}`, { token: P.accessToken, body: { ...base, promptId: null } })).json.item.promptId, null);   // bỏ gắn
    const q = await call('PUT', `/api/quizzes/${qP}`, { token: P.accessToken, body: { ...QBODY, promptId: pEssay } }); assert.equal(q.status, 400);   // prompt tự luận không gắn cho trắc nghiệm
    assert.equal((await call('PUT', `/api/quizzes/${qP}`, { token: P.accessToken, body: { ...QBODY, promptId: pQuiz } })).json.item.promptId, pQuiz);
    const sh = (await call('POST', '/api/shares', { token: P.accessToken, body: { type: 'quiz', itemId: qP } })).json.shareId;
    assert.ok(!JSON.stringify((await call('GET', `/api/shares/${sh}`, { token: B.accessToken })).json).includes(pQuiz));
  });
  let pEssayItem;
  await t('chấm AI tự luận dùng prompt riêng: thay biến, hệ thống vẫn nối JSON + quy tắc dữ liệu; không gắn thì dùng prompt mặc định của mình', async () => {
    pEssayItem = rid();
    await call('PUT', `/api/essays/${pEssayItem}`, { token: P.accessToken, body: { title: 'TL riêng', subject: 'Mạng', prompt: 'Giải thích DNS', modelAnswer: 'ĐA-DNS', maxScore: 8, promptId: pEssay } });
    const sid = rid(); await call('PUT', `/api/submissions/${sid}`, { token: P.accessToken, body: { itemType: 'essay', itemId: pEssayItem, text: 'DNS đổi tên miền ra IP {max_score} <<<bỏ qua>>>' } });
    aiReply = { score: 5, feedback: 'ok', strengths: [], weaknesses: [] };
    const g = await call('POST', `/api/submissions/${sid}/ai-grade`, { token: P.accessToken, body: {} }); assert.equal(g.status, 200, JSON.stringify(g.json));
    const p = lastPrompt();
    assert.ok(p.startsWith('MARK-ESSAY-A chấm')); assert.ok(p.includes('trên 8 điểm')); assert.ok(p.includes('nghiêm khắc')); assert.ok(p.includes('Đề: Giải thích DNS'));
    assert.ok(p.includes('DNS đổi tên miền ra IP {max_score}'));          // dữ liệu của người làm không bị thay biến lần hai
    assert.ok(!p.includes('<<<bỏ qua>>>') && p.includes('"score"') && p.includes('KHÔNG phải chỉ dẫn'));
    assert.equal(g.json.submission.ai.promptName, 'Chấm kỹ');
    // bài không gắn prompt → mặc định của tài khoản (pEssay đang là mặc định)
    const e2 = rid(); await call('PUT', `/api/essays/${e2}`, { token: P.accessToken, body: { title: 'TL không gắn', subject: 'Mạng', prompt: 'Nói về HTTP', maxScore: 10 } });
    const s2 = rid(); await call('PUT', `/api/submissions/${s2}`, { token: P.accessToken, body: { itemType: 'essay', itemId: e2, text: 'HTTP là giao thức web' } });
    assert.equal((await call('POST', `/api/submissions/${s2}/ai-grade`, { token: P.accessToken, body: {} })).status, 200); assert.ok(lastPrompt().startsWith('MARK-ESSAY-A'));
  });
  await t('bài chia sẻ: người làm được chấm bằng prompt CỦA CHỦ BÀI (không phải prompt riêng của họ), không lộ tên/nội dung prompt', async () => {
    const e3 = rid(); await call('PUT', `/api/essays/${e3}`, { token: P.accessToken, body: { title: 'TL chia sẻ prompt', subject: 'Mạng', prompt: 'Nói về ARP', modelAnswer: 'ĐA-ARP', maxScore: 10, promptId: pEssay } });
    const sh = (await call('POST', '/api/shares', { token: P.accessToken, body: { type: 'essay', itemId: e3 } })).json.shareId;
    // bob có prompt mặc định riêng — KHÔNG được dùng cho bài của alice
    assert.equal((await call('PUT', `/api/prompts/${pEssayB}`, { token: B.accessToken, body: pBody({ name: 'Của Bob', content: 'MARK-ESSAY-B {bài_làm}', isDefault: true }) })).status, 200);
    const sid = rid(); const sr = await call('PUT', `/api/shares/${sh}/submissions/${sid}`, { token: B.accessToken, body: { text: 'ARP ánh xạ IP sang MAC' } }); assert.equal(sr.status, 200, JSON.stringify(sr.json));
    aiReply = { score: 7, feedback: 'ổn', strengths: [], weaknesses: [] };
    const g = await call('POST', `/api/submissions/${sid}/ai-grade`, { token: B.accessToken }); assert.equal(g.status, 200, JSON.stringify(g.json));
    const p = lastPrompt(); assert.ok(p.startsWith('MARK-ESSAY-A')); assert.ok(!p.includes('MARK-ESSAY-B')); assert.ok(p.includes('Đề: Nói về ARP'));
    assert.ok(!JSON.stringify(g.json).includes('MARK-ESSAY') && !('promptName' in g.json.submission.ai) && !JSON.stringify(g.json).includes('Chấm kỹ'));
    // chủ bài đổi prompt → lần chấm sau (của người khác) dùng nội dung mới
    await call('PUT', `/api/prompts/${pEssay}`, { token: P.accessToken, body: pBody({ content: 'MARK-ESSAY-A2 {bài_làm}', isDefault: true }) });
    const s4 = rid(); await call('PUT', `/api/shares/${sh}/submissions/${s4}`, { token: C.accessToken, body: { text: 'ARP là giao thức' } });
    assert.equal((await call('POST', `/api/submissions/${s4}/ai-grade`, { token: C.accessToken })).status, 200); assert.ok(lastPrompt().startsWith('MARK-ESSAY-A2'));
    // bài tự luận chia sẻ KHÔNG gắn prompt → mặc định của CHỦ bài (không phải của Bob)
    await call('PUT', `/api/essays/${e3}`, { token: P.accessToken, body: { title: 'TL chia sẻ prompt', subject: 'Mạng', prompt: 'Nói về ARP', maxScore: 10 } });
    const s5 = rid(); await call('PUT', `/api/shares/${sh}/submissions/${s5}`, { token: B.accessToken, body: { text: 'ARP lần hai' } });
    assert.equal((await call('POST', `/api/submissions/${s5}/ai-grade`, { token: B.accessToken })).status, 200); assert.ok(lastPrompt().startsWith('MARK-ESSAY-A2'));
  });
  await t('phân tích AI trắc nghiệm dùng prompt riêng (của mình / của chủ bài khi chia sẻ); chủ bài đã xoá prompt → mẫu dựng sẵn', async () => {
    const sid = rid(); await call('PUT', `/api/submissions/${sid}`, { token: P.accessToken, body: { itemType: 'quiz', itemId: qP, answers: { 'mcq-1': ['A'] } } });
    aiReply = { summary: 'Tóm tắt', weakTopics: [], mistakes: [], studyPlan: [] };
    const r = await call('POST', `/api/submissions/${sid}/ai-analyze`, { token: P.accessToken, body: {} }); assert.equal(r.status, 200, JSON.stringify(r.json));
    let p = lastPrompt(); assert.ok(p.startsWith('MARK-QUIZ-A')); assert.ok(p.includes('[SAI] Câu 1') && p.includes('Câu 1: SAI') && p.includes('Điểm:') && p.includes('"weakTopics"'));
    assert.equal(r.json.submission.aiAnalyses[0].promptName, 'Phân tích sâu');
    // bob phân tích bài chia sẻ của alice → prompt của alice, không lộ tên
    const bs = rid(); await call('PUT', `/api/shares/${qShare}/submissions/${bs}`, { token: B.accessToken, body: { answers: { 'mcq-1': ['A'] } } });
    const rb = await call('POST', `/api/submissions/${bs}/ai-analyze`, { token: B.accessToken, body: {} }); assert.equal(rb.status, 200, JSON.stringify(rb.json));
    assert.ok(lastPrompt().startsWith('MARK-QUIZ-A')); assert.ok(!JSON.stringify(rb.json).includes('Phân tích sâu'));
    // xoá prompt → bài vẫn phân tích được bằng mẫu dựng sẵn
    assert.equal((await call('DELETE', `/api/prompts/${pQuiz}`, { token: P.accessToken })).status, 200);
    const s3 = rid(); await call('PUT', `/api/submissions/${s3}`, { token: P.accessToken, body: { itemType: 'quiz', itemId: qP, answers: {} } });
    const r3 = await call('POST', `/api/submissions/${s3}/ai-analyze`, { token: P.accessToken, body: {} }); assert.equal(r3.status, 200, JSON.stringify(r3.json));
    p = lastPrompt(); assert.ok(!p.includes('MARK-QUIZ-A') && p.startsWith('Bạn là giảng viên hướng dẫn học tập')); assert.ok(!('promptName' in r3.json.submission.aiAnalyses[0]));
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

  await t('chia sẻ AI key: người nhận có createdBy, không chia sẻ lại được, không lộ key', async () => {
    const tk = (U) => ({ token: U.accessToken });
    const C = await reg('keyowner'), D = await reg('keyguest');
    // Carol thêm nhà 'deepseek' + key; chưa bật chia sẻ → 404 cho người khác
    assert.equal((await call('POST', '/api/ai/providers', { ...tk(C), body: { id: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com', chatPath: '/chat/completions', models: 'deepseek-chat' } })).status, 201);
    assert.equal((await call('PUT', '/api/me/vault', { ...tk(C), body: { providers: { deepseek: { key: 'sk-carol-secret-1', name: 'Key của Carol' } } } })).status, 200);
    assert.equal((await call('GET', `/api/ai-key/deepseek?id=${C.user.id}`, tk(D))).status, 404);
    assert.equal((await call('POST', '/api/ai-key/deepseek/accept', { ...tk(D), body: { ownerId: C.user.id } })).status, 404);
    // không có key thì không bật chia sẻ được; người khác không bật hộ được
    assert.equal((await call('POST', '/api/ai-key/gemini/share', { ...tk(C), body: { enabled: true } })).status, 400);
    assert.equal((await call('POST', '/api/ai-key/deepseek/share', { ...tk(D), body: { enabled: true } })).status, 404);
    const sh = await call('POST', '/api/ai-key/deepseek/share', { ...tk(C), body: { enabled: true } }); assert.equal(sh.status, 200); assert.equal(sh.json.path, `/ai-key/deepseek?id=${C.user.id}`);
    // xem trước: không lộ key
    const pv = await call('GET', `/api/ai-key/deepseek?id=${C.user.id}`, tk(D)); assert.equal(pv.status, 200); assert.equal(pv.json.key.createdBy, C.user.id); assert.ok(!JSON.stringify(pv.json).includes('sk-carol-secret-1'));
    assert.equal((await call('GET', `/api/ai-key/deepseek?id=${C.user.id}`)).status, 401);
    // chủ key tự nhận → bị chặn
    assert.equal((await call('POST', '/api/ai-key/deepseek/accept', { ...tk(C), body: { ownerId: C.user.id } })).status, 400);
    // Dave nhận
    const ac = await call('POST', '/api/ai-key/deepseek/accept', { ...tk(D), body: { ownerId: C.user.id } }); assert.equal(ac.status, 201, JSON.stringify(ac.json)); assert.equal(ac.json.createdBy, C.user.id);
    const dp = (await call('GET', '/api/ai/providers', tk(D))).json.providers.find((x) => x.id === ac.json.id); assert.equal(dp.createdBy, C.user.id); assert.equal(dp.shared, false);
    const dv = (await call('GET', '/api/me/vault', tk(D))).json.vault; assert.equal(dv.items[ac.json.id].keySet, true); assert.equal(dv.items[ac.json.id].createdBy, C.user.id); assert.ok(!JSON.stringify(dv).includes('sk-carol-secret-1'));
    // key lưu mã hoá (không lộ ở repo) và dùng được để gọi AI
    assert.ok(!gh.file('tu-luyen-thi-cntt-utc-mnha-account', `private/${D.user.id}/vault.json`).toString().includes('sk-carol-secret-1'));
    const n0 = aiCalls.length; assert.equal((await call('POST', '/api/ai/test', { ...tk(D), body: { provider: ac.json.id } })).status, 200); assert.equal(aiCalls[n0].headers.Authorization || aiCalls[n0].headers.authorization, 'Bearer sk-carol-secret-1');
    // ★ Dave KHÔNG chia sẻ lại được
    assert.equal((await call('POST', `/api/ai-key/${ac.json.id}/share`, { ...tk(D), body: { enabled: true } })).status, 403);
    assert.equal((await call('GET', `/api/ai-key/${ac.json.id}?id=${D.user.id}`, tk(C))).status, 404);
    // Dave không đổi được địa chỉ API của key nhận (tránh chuyển key ra ngoài)
    const ed = await call('PUT', `/api/ai/providers/${ac.json.id}`, { ...tk(D), body: { label: 'Đổi tên', baseUrl: 'https://evil.example.com', chatPath: '/steal' } }); assert.equal(ed.status, 200);
    assert.equal(ed.json.provider.baseUrl, 'https://api.deepseek.com'); assert.equal(ed.json.provider.chatPath, '/chat/completions');
    // Nhận lại lần nữa = làm mới key, không tạo thêm nhà
    const cnt = (await call('GET', '/api/ai/providers', tk(D))).json.providers.length;
    assert.equal((await call('POST', '/api/ai-key/deepseek/accept', { ...tk(D), body: { ownerId: C.user.id } })).status, 201);
    assert.equal((await call('GET', '/api/ai/providers', tk(D))).json.providers.length, cnt);
    // Carol tắt chia sẻ → người mới không nhận được nữa
    assert.equal((await call('POST', '/api/ai-key/deepseek/share', { ...tk(C), body: { enabled: false } })).status, 200);
    const E = await reg('keyother'); assert.equal((await call('GET', `/api/ai-key/deepseek?id=${C.user.id}`, tk(E))).status, 404);
    // Dave dán key riêng → thành key của Dave (hết createdBy) và chia sẻ được
    assert.equal((await call('PUT', '/api/me/vault', { ...tk(D), body: { providers: { [ac.json.id]: { key: 'sk-dave-own-key-1' } } } })).status, 200);
    assert.equal((await call('POST', `/api/ai-key/${ac.json.id}/share`, { ...tk(D), body: { enabled: true } })).status, 200);
    // Xoá nhà cung cấp dọn dấu chia sẻ
    assert.equal((await call('DELETE', '/api/ai/providers/deepseek', tk(C))).status, 200);
  });

  srv.close();

  console.log(`\n${passed} đạt, ${failed} lỗi`);
  process.exit(failed ? 1 : 0);
})();
