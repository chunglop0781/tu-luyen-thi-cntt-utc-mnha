'use strict';
// E2E chia sẻ bài (trình duyệt thật): mở link khi chưa đăng nhập → bắt đăng nhập → quay lại đúng bài → làm → biểu đồ; chủ bài thấy tên + mở được bài của người làm, người làm chỉ thấy điểm của mình.
// Chạy: NODE_PATH=test/stubs/node_modules:/opt/npm-tools/node_modules node test/e2e-share.js
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const { FakeGitHub } = require('./fakeGithub');
const { createApp } = require('../src/app');
const FRONT = path.join(__dirname, '..', '..', 'frontend');
const API = 'http://127.0.0.1:4211', WEB = 'http://127.0.0.1:4212/';
const env = { GITHUB_TOKEN: 't', GITHUB_OWNER: 'me', JWT_SECRET: 'j'.repeat(40), ENCRYPTION_KEY: 'k'.repeat(40), GITHUB_WEBHOOK_SECRET: 's', CRON_SECRET: 'c', FRONTEND_ORIGINS: 'http://127.0.0.1:4212', MAIL_USER: 'bot@example.com', MAIL_PASS: 'x', BCRYPT_ROUNDS: '8', OTP_RESEND_SECONDS: '0' };
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.mp3': 'audio/mpeg' };
const ok = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('  ✓', m); };

(async () => {
  const gh = new FakeGitHub('me'); gh.ensure('tu-luyen-thi-cntt-utc-mnha-account'); gh.ensure('tu-luyen-thi-cntt-utc-mnha-data');
  const outbox = []; const mailer = { configured: true, send: async (m) => { outbox.push(m); } };
  const aiFetch = async (url, init) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ score: 6, feedback: 'Đủ ý chính', strengths: ['a'], weaknesses: ['b'] }) }] } }] }), { status: 200 });   // AI giả: luôn chấm 6
  const app = createApp({ env, fetchImpl: gh.fetch, aiFetch, mailer, dnsLookup: async () => [{ address: '93.184.216.34', family: 4 }] });
  const api = http.createServer(app.handler).listen(4211);
  const web = http.createServer((req, res) => {
    let p = req.url.split('?')[0]; if (p === '/') p = '/index.html';
    if (p === '/config.js') { res.setHeader('Content-Type', 'text/javascript'); return res.end(`window.APP_CONFIG={API_BASE:'${API}'};`); }
    const f = path.join(FRONT, p); if (!f.startsWith(FRONT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.statusCode = 404; return res.end('nf'); }
    res.setHeader('Content-Type', mime[path.extname(f)] || 'application/octet-stream'); res.end(fs.readFileSync(f));
  }).listen(4212);
  const J = async (method, p, body, token) => { const r = await fetch(API + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined }); return r.json(); };
  const reg = async (u) => { const email = `${u}@example.com`; await J('POST', '/api/auth/register/start', { username: u, email, password: 'matkhau123', displayName: u.toUpperCase() }); const code = /(\d{6})/.exec(outbox.filter((m) => m.to === email).pop().text)[1]; return J('POST', '/api/auth/register/verify', { email, code }); };
  const A = await reg('alice'); const B = await reg('bob'); await reg('carol');
  const quizId = 'a1b2c3d4e5f60718';
  const q = await J('PUT', `/api/quizzes/${quizId}`, { title: 'Mạng cơ bản', subject: 'Mạng', maxScore: 10, duration: 20, 'pointsPerQuestion_mcq': 5, mcq: '- HTTP dùng cổng nào?\n+)21\n+)80\n+)443\n=> B\n- Giao thức tầng giao vận?\n+)TCP\n+)IP\n=> A' }, A.accessToken);
  if (!q.ok) throw new Error(JSON.stringify(q));
  const sid = (await J('POST', '/api/shares', { type: 'quiz', itemId: quizId }, A.accessToken)).shareId;

  const browser = await chromium.launch(); const errors = [];
  const newPage = async () => { const c = await browser.newContext(); const p = await c.newPage(); p.on('pageerror', (e) => errors.push(e.message)); p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); }); p.on('dialog', (d) => d.accept()); return p; };
  const login = async (page, u) => { await page.fill('input[autocomplete=username]', u); await page.fill('input[autocomplete=current-password]', 'matkhau123'); await page.click('button[type=submit]'); };
  try {
    console.log('Người được chia sẻ (bob)');
    const bob = await newPage();
    await bob.goto(WEB + `#/s/${sid}`); await bob.waitForSelector('.auth');
    ok(true, 'mở link khi chưa đăng nhập → bị chuyển sang trang đăng nhập');
    await login(bob, 'bob'); await bob.waitForSelector('.share-landing h2');
    ok((await bob.textContent('.share-landing h2')).includes('Mạng cơ bản'), 'đăng nhập xong → quay lại đúng bài được chia sẻ');
    ok((await bob.content()).includes('người làm khác thì không thấy gì của bạn') , 'thông báo quyền riêng tư cho người làm');
    await bob.click('text=▶ Làm bài'); await bob.waitForSelector('#qxStartBtn'); await bob.click('#qxStartBtn');
    await bob.waitForSelector('#questionContainer .option-letter'); await bob.locator('#questionContainer .option-letter').nth(1).click();
    await bob.$eval('#submitTop', (e) => e.click()); await bob.waitForSelector('#resultSection:not(.hidden)', { timeout: 15000 });
    ok(true, 'làm bài + nộp → có kết quả (chấm phía máy chủ)');
    await bob.goto(WEB + `#/s/${sid}/history`); await bob.waitForSelector('.hc svg circle');
    ok((await bob.$$('.hc svg circle')).length === 1, 'biểu đồ có điểm của bob');
    ok(!(await bob.content()).includes('carol') && !(await bob.content()).includes('alice'), 'bob không thấy tên người khác');
    ok(await bob.isVisible('a:has-text("Xem chi tiết")'), 'bob có nút xem bài làm của mình');
    await bob.click('a:has-text("Xem chi tiết")'); await bob.waitForSelector('.qr-page .qr-card'); ok((await bob.textContent('.qr-page')).includes('Bản đồ câu hỏi'), 'xem lại bài làm của mình (giao diện kết quả trắc nghiệm bản luyen-thi)');
    await bob.click('.qr-fbtn[data-filter="wrong"]'); await bob.click('.qr-fbtn[data-filter="all"]'); ok(await bob.isVisible('.qr-q'), 'bộ lọc câu hỏi hoạt động');
    if (process.env.SHOT) { await bob.setViewportSize({ width: 1100, height: 1400 }); await bob.screenshot({ path: process.env.SHOT + '/quiz-light.png', fullPage: true }); await bob.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark')); await bob.screenshot({ path: process.env.SHOT + '/quiz-dark.png', fullPage: true }); await bob.evaluate(() => document.documentElement.setAttribute('data-theme', 'light')); }
    await bob.goto(WEB); await bob.waitForSelector('text=Bài được chia sẻ với tôi'); ok(true, 'trang chủ bob có mục "Bài được chia sẻ với tôi"');

    console.log('Người thứ hai (carol) nộp để biểu đồ có nhiều điểm');
    const carol = await newPage(); await carol.goto(WEB + `#/s/${sid}/play`); await carol.waitForSelector('.auth'); await login(carol, 'carol');
    await carol.waitForSelector('#qxStartBtn'); await carol.click('#qxStartBtn'); await carol.waitForSelector('#questionContainer .option-letter'); await carol.$eval('#submitTop', (e) => e.click()); await carol.waitForSelector('#resultSection:not(.hidden)', { timeout: 15000 });
    await carol.goto(WEB + `#/s/${sid}/history`); await carol.waitForSelector('.hc svg circle');
    ok((await carol.$$('.hc svg circle')).length === 1, 'carol chỉ thấy 1 điểm (của mình), không còn điểm ẩn danh của bob');
    await carol.locator('.hc svg circle').first().hover(); ok(/Bài của bạn/.test(await carol.textContent('.hc-tip')) && !/BOB|bob/.test(await carol.textContent('.hc-tip')), 'tooltip chỉ nói bài của bạn, không lộ tên');

    console.log('Chủ bài (alice)');
    const alice = await newPage(); await alice.goto(WEB); await alice.waitForSelector('.auth'); await login(alice, 'alice'); await alice.waitForSelector('text=Bài của tôi');
    await alice.waitForSelector('text=Đang chia sẻ'); ok(true, 'thẻ bài hiện "Đang chia sẻ"');
    await alice.click('.card.item:has-text("Mạng cơ bản") button:has-text("🔗 Chia sẻ")'); await alice.waitForSelector('.modal input');
    ok((await alice.inputValue('.modal input')).endsWith(`#/lessons/${quizId}/share?id=${A.user.id}`), 'hộp thoại chia sẻ hiện đúng link #/lessons/<bài>/share?id=<chủ bài>'); await alice.keyboard.press('Escape');
    await alice.goto(WEB + `#/s/${sid}/history`); await alice.waitForSelector('.hc svg circle');
    ok((await alice.$$('.hc svg circle')).length === 2, 'chủ bài thấy 2 điểm');
    const names = await alice.$$eval('.tbl tbody tr td:first-child', (e) => e.map((x) => x.textContent).sort()); ok(names.join() === 'BOB,CAROL', 'bảng liệt kê tên từng người nộp: ' + names);
    ok(await alice.isVisible('.tbl a:has-text("Xem chi tiết")'), 'chủ bài có nút "Xem chi tiết" cho bài của từng người');
    await alice.locator('.tbl tbody tr:has-text("BOB") a:has-text("Xem chi tiết")').click(); await alice.waitForSelector('.sd-page, .qr-page'); ok(/\/submission\//.test(alice.url()), 'chủ bài mở được chi tiết bài của BOB (chỉ đọc)');
    ok(!(await alice.isVisible('button:has-text("Xoá bài nộp")')), 'trang chi tiết của chủ bài không có nút xoá');
    console.log('Chia sẻ bài tự luận (bob nộp, AI chấm bằng key của bob)');
    const eid = 'b1c2d3e4f5a60718';
    const e = await J('PUT', `/api/essays/${eid}`, { title: 'Mô hình OSI', subject: 'Mạng', prompt: 'Trình bày mô hình OSI', modelAnswer: 'DAP-AN-MAU-BI-MAT', maxScore: 10 }, A.accessToken); if (!e.ok) throw new Error(JSON.stringify(e));
    await alice.goto(WEB); await alice.waitForSelector('.card.item:has-text("Mô hình OSI")');
    await alice.click('.card.item:has-text("Mô hình OSI") button:has-text("🔗 Chia sẻ")'); await alice.waitForSelector('.modal input');
    const elink = await alice.inputValue('.modal input'); const esid = (await J('POST', '/api/shares', { type: 'essay', itemId: eid }, A.accessToken)).shareId; ok(elink.includes(`/lessons/${eid}/share?id=${A.user.id}`) && /^[a-f0-9]+$/.test(esid) && esid !== sid, 'bài tự luận có nút Chia sẻ và link riêng'); await alice.keyboard.press('Escape');
    await bob.goto(WEB + `#/s/${esid}`); await bob.waitForSelector('.share-landing h2'); ok((await bob.content()).includes('Bài tự luận được chia sẻ'), 'bob mở link → trang đón bài tự luận');
    ok(!(await bob.content()).includes('DAP-AN-MAU-BI-MAT'), 'đề không lộ đáp án mẫu trước khi nộp');
    await J('PUT', '/api/me/vault', { geminiKey: 'AIza-bob-key-12345' }, B.accessToken);
    await bob.goto(WEB + `#/s/${esid}/play`); await bob.waitForSelector('#aiCheckBtn'); await bob.click('#aiCheckBtn'); await bob.waitForSelector('#writingInput:not([disabled])', { timeout: 20000 }); await bob.fill('#writingInput', 'OSI có 7 tầng: vật lý, liên kết dữ liệu, mạng…'); await bob.click('#submitBtn');
    await bob.waitForSelector('.sd-page .sd-score'); await bob.waitForFunction(() => /6/.test((document.querySelector('.sd-score .n') || {}).textContent || ''), null, { timeout: 20000 }); ok(true, 'nộp tự luận → AI tự chấm bằng key của bob → 6 điểm (trang chi tiết bản luyen-thi)');
    ok(!(await bob.isVisible('button:has-text("Xoá bài nộp")')), 'bài nộp từ link chia sẻ không có nút xoá');
    await bob.reload(); await bob.waitForSelector('.sd-page .sd-score');
    ok(!(await bob.isVisible('#aiGradeBtn')), 'không chấm lại được');
    await bob.goto(WEB + `#/s/${esid}/history`); await bob.waitForSelector('.hc svg circle'); ok((await bob.$$('.hc svg circle')).length === 1, 'điểm tự luận lên biểu đồ sau khi chấm');
    await alice.goto(WEB + `#/s/${esid}/history`); await alice.waitForSelector('.hc svg circle'); ok((await alice.textContent('.tbl')).includes('BOB'), 'chủ bài thấy bob trong bảng');
    await alice.locator('.tbl tbody tr:has-text("BOB") a:has-text("Xem chi tiết")').click(); await alice.waitForSelector('.sd-page .sd-h1');
    const dt = await alice.textContent('.sd-page'); ok(dt.includes('BOB') && dt.includes('OSI có 7 tầng') && dt.includes('Đủ ý chính') && dt.includes('DAP-AN-MAU-BI-MAT'), 'chủ bài thấy tên, bài làm, nhận xét AI, lời giải mẫu của bob');
    ok(!dt.includes('AIza-bob-key'), 'không lộ API key của bob');
    if (process.env.SHOT) { await alice.setViewportSize({ width: 1100, height: 1500 }); await alice.screenshot({ path: process.env.SHOT + '/owner-light.png', fullPage: true }); await alice.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark')); await alice.screenshot({ path: process.env.SHOT + '/owner-dark.png', fullPage: true });
      await bob.goto(WEB + `#/s/${esid}/history`); await bob.waitForSelector('.tbl'); await bob.click('.tbl a:has-text("Xem chi tiết")'); await bob.waitForSelector('.sd-page'); await bob.setViewportSize({ width: 1100, height: 1500 }); await bob.screenshot({ path: process.env.SHOT + '/student-light.png', fullPage: true }); }
    await bob.goto(WEB + `#/s/${esid}/history`); await bob.waitForSelector('.tbl'); await bob.click('.tbl a:has-text("Xem chi tiết")'); await bob.waitForSelector('.sd-page');
    ok(!(await bob.isVisible('button:has-text("Xoá bài nộp")')) && await bob.isVisible('text=Không xoá được'), 'bob: bài đã nộp không xoá được');
    ok(!(await alice.textContent('.sd-page')).includes('Chấm bằng AI'), 'chủ bài xem bài người khác: không có khối chấm AI');

    ok(errors.length === 0, 'không có lỗi JS/console: ' + errors.join(' | '));
    console.log('\nE2E chia sẻ: OK');
  } catch (e) { console.log('\n' + e.message, errors); process.exitCode = 1; }
  await browser.close(); api.close(); web.close();
})();
