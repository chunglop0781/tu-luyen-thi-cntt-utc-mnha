'use strict';
const assert = require('assert');
const http = require('http');
const crypto = require('crypto');
const { FakeGitHub } = require('./fakeGithub');
const { createApp } = require('../src/app');

const PAGES = 'https://alice.github.io';
const env = {
  GITHUB_TOKEN: 't', GITHUB_OWNER: 'me', JWT_SECRET: 'j'.repeat(40), ENCRYPTION_KEY: 'k'.repeat(40), GITHUB_WEBHOOK_SECRET: 'whsec',
  CRON_SECRET: 'cron', FRONTEND_ORIGINS: PAGES + ',https://other.github.io/', BCRYPT_ROUNDS: '8',
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
  const aiFetch = async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(aiReply) }] } }] }), { status: 200 });
  const app = createApp({ env, fetchImpl: gh.fetch, aiFetch });
  const server = http.createServer(require('../api/index.js')); // api/index dựng app riêng → dùng handler trực tiếp bên dưới
  server.close();
  const srv = http.createServer(app.handler); await new Promise((r) => srv.listen(0, r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const call = async (method, path, { body, token, origin, raw, headers = {} } = {}) => {
    const res = await fetch(base + path, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(origin ? { Origin: origin } : {}), ...headers }, body: raw || (body ? JSON.stringify(body) : undefined) });
    const ct = res.headers.get('content-type') || '';
    return { status: res.status, headers: res.headers, json: ct.includes('json') ? await res.json() : null, buf: ct.includes('json') ? null : Buffer.from(await res.arrayBuffer()) };
  };
  const reg = async (u, p = 'matkhau123') => (await call('POST', '/api/auth/register', { body: { username: u, password: p, displayName: u.toUpperCase() } })).json;

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
    assert.equal((await call('POST', '/api/auth/register', { body: { username: 'ALICE', password: 'matkhau123' } })).status, 409);
    assert.equal((await call('POST', '/api/auth/register', { body: { username: '../x', password: 'matkhau123' } })).status, 400);
    assert.equal((await call('POST', '/api/auth/register', { body: { username: 'carol', password: 'short' } })).status, 400);
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
