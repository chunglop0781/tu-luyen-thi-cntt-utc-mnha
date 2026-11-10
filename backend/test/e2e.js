'use strict';
// E2E trình duyệt thật: frontend (origin A) ↔ backend (origin B) khác cổng = khác origin như GitHub Pages ↔ Vercel.
// Chạy: NODE_PATH=test/stubs/node_modules:/đường/dẫn/tới/playwright node test/e2e.js
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const { FakeGitHub } = require('./fakeGithub');
const { createApp } = require('../src/app');

const FRONT = path.join(__dirname, '..', '..', 'frontend');
const env = { GITHUB_TOKEN: 't', GITHUB_OWNER: 'me', JWT_SECRET: 'j'.repeat(40), ENCRYPTION_KEY: 'k'.repeat(40), GITHUB_WEBHOOK_SECRET: 's', CRON_SECRET: 'c',
  FRONTEND_ORIGINS: 'http://127.0.0.1:4102', MAIL_USER: 'bot@example.com', MAIL_PASS: 'x', BCRYPT_ROUNDS: '8', ACCESS_TOKEN_MINUTES: '0.05' /* 3 giây: ép chạy đường refresh */ };
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
const ok = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('  ✓', m); };

(async () => {
  const gh = new FakeGitHub('me'); gh.ensure('tu-luyen-thi-cntt-utc-mnha-account'); gh.ensure('tu-luyen-thi-cntt-utc-mnha-data');
  const outbox = []; const mailer = { configured: true, send: async (m) => { outbox.push(m); } };
  const app = createApp({ env, fetchImpl: gh.fetch, mailer });
  const api = http.createServer(app.handler).listen(4101);
  const web = http.createServer((req, res) => {
    let p = req.url.split('?')[0]; if (p === '/') p = '/index.html';
    if (p === '/config.js') { res.setHeader('Content-Type', 'text/javascript'); return res.end("window.APP_CONFIG={API_BASE:'http://127.0.0.1:4101'};"); }
    const f = path.join(FRONT, p); if (!f.startsWith(FRONT) || /\/(backend|\.env)/.test(p) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.statusCode = 404; return res.end('nf'); }
    res.setHeader('Content-Type', mime[path.extname(f)] || 'application/octet-stream'); res.end(fs.readFileSync(f));
  }).listen(4102);

  const browser = await chromium.launch(); const page = await browser.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push('pageerror: ' + e.message)); page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  const B = 'http://127.0.0.1:4102/';
  try {
    await page.goto(B); await page.waitForSelector('.auth');
    console.log('Đăng ký / đăng nhập qua CORS');
    await page.click('text=Đăng ký'); await page.fill('input[autocomplete=username]', 'sv01'); await page.fill('input[type=email]', 'sv01@example.com'); await page.fill('input[type=password]', 'matkhau-xin'); await page.fill('input[placeholder^="Tên hiển thị"]', 'Sinh viên 01');
    await page.click('button[type=submit]'); await page.waitForSelector('input.otp');   // bước nhập OTP
    await page.fill('input.otp', /(\d{6})/.exec(outbox[outbox.length - 1].text)[1]);
    await page.click('button[type=submit]'); await page.waitForSelector('text=Bài của tôi', { timeout: 15000 });
    ok(page.url().endsWith('#/'), 'đăng ký xong vào trang chủ (hash router)');

    console.log('Tạo trắc nghiệm bằng nhập văn bản');
    await page.click('a:has-text("Tạo trắc nghiệm")'); await page.waitForSelector('text=Tạo bài trắc nghiệm');
    await page.fill('input[placeholder^="VD: Ôn tập"]', 'Mạng cơ bản'); await page.fill('input[list=subj]', 'Mạng máy tính');
    await page.click('summary'); await page.fill('textarea[placeholder^="Câu 1: Nội dung"]', 'Câu 1: Cổng HTTP?\nA. 21\nB. 80\nĐáp án: B\nGiải thích: web\nCâu 2: Chọn giao thức tầng giao vận\n*A. TCP\nB. IP\n*C. UDP');
    await page.click('text=Đọc đề và thêm vào'); await page.waitForSelector('text=Đã thêm 2 câu');
    await page.click('button:has-text("Lưu bài")'); await page.waitForSelector('.card.item h3:has-text("Mạng cơ bản")'); ok(true, 'lưu trắc nghiệm → hiện trong danh sách');

    console.log('Làm bài trắc nghiệm (token hết hạn giữa chừng → tự refresh)');
    await page.waitForTimeout(3500);               // access token 3 giây đã hết hạn
    await page.click('.card.item >> text=Làm bài'); await page.waitForSelector('text=Câu 1.');
    await page.click('label.choice:has-text("80")'); page.once('dialog', (d) => d.accept());
    await page.click('.sticky button:has-text("Nộp bài")'); await page.waitForSelector('.bigscore', { timeout: 15000 });
    ok((await page.textContent('.bigscore')).trim() === '1/2', 'chấm đúng 1/2 điểm');
    ok(await page.isVisible('text=Giải thích:'), 'hiện giải thích');

    console.log('Tạo + làm tự luận, tự chấm');
    await page.goto(B + '#/essay/new'); await page.waitForSelector('text=Tạo bài tự luận');
    await page.fill('input[placeholder^="VD: So sánh"]', 'TCP vs UDP'); await page.fill('textarea[placeholder="Đề bài…"]', 'So sánh TCP và UDP');
    await page.click('text=Thêm tiêu chí'); await page.fill('input[placeholder="Tiêu chí"]', 'TCP'); await page.fill('input[placeholder^="Từ khoá"]', 'tin cậy, hướng kết nối');
    await page.click('button:has-text("Lưu bài")'); await page.waitForSelector('.card.item h3:has-text("TCP vs UDP")');
    await page.click('.card.item:has-text("TCP vs UDP") >> text=Làm bài'); await page.waitForSelector('text=Bài làm');
    await page.fill('textarea[placeholder^="Viết bài"]', 'TCP tin cậy và hướng kết nối');
    await page.reload(); await page.waitForSelector('textarea[placeholder^="Viết bài"]');
    ok((await page.inputValue('textarea[placeholder^="Viết bài"]')) === 'TCP tin cậy và hướng kết nối', 'tải lại trang (hash route) vẫn ở đúng trang, giữ bản nháp');
    await page.click('button:has-text("Nộp bài")'); await page.waitForSelector('text=Gợi ý tự động');
    await page.fill('input[type=number]', '8'); await page.click('text=Lưu điểm tự chấm'); await page.waitForSelector('.bigscore:has-text("8/10")'); ok(true, 'tự chấm 8/10');

    console.log('Upload ảnh mã hoá qua trình duyệt');
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    await page.goto(B + '#/essay/new'); await page.waitForSelector('text=Tạo bài tự luận');
    await page.fill('input[placeholder^="VD: So sánh"]', 'Có ảnh'); await page.fill('textarea[placeholder="Đề bài…"]', 'Xem hình');
    await page.setInputFiles('input[type=file] >> nth=0', { name: 'a.png', mimeType: 'image/png', buffer: png }); await page.waitForSelector('text=Đã tải ảnh');
    const prompt = await page.inputValue('textarea[placeholder="Đề bài…"]'); ok(/\[img:0\.[a-f0-9]{24}\]/.test(prompt), 'chèn token ảnh vào đề');
    await page.click('button:has-text("Lưu bài")'); await page.waitForSelector('.card.item h3:has-text("Có ảnh")');
    await page.click('.card.item:has-text("Có ảnh") >> text=Làm bài'); await page.waitForSelector('img.pic'); await page.waitForFunction(() => document.querySelector('img.pic').src.startsWith('blob:') && document.querySelector('img.pic').naturalWidth === 1);
    ok(true, 'ảnh giải mã & hiển thị (blob URL, kèm Authorization)');
    ok([...gh.repos.get('tu-luyen-thi-cntt-utc-mnha-image').files.keys()].some((k) => k.endsWith('.enc')), 'ảnh nằm mã hoá (.enc) trong repo ảnh');

    console.log('Cài đặt & chẩn đoán kết nối, đăng xuất');
    await page.goto(B + '#/settings'); await page.waitForSelector('text=Kiểm tra kết nối'); await page.click('button:has-text("Kiểm tra kết nối")'); await page.waitForSelector('.diag:has-text("\\"ok\\": true")'); ok(true, 'health deep OK từ GitHub Pages origin');
    await page.click('.um-btn'); await page.click('.drop >> text=Đăng xuất'); await page.waitForSelector('.auth'); ok(page.url().endsWith('#/login'), 'đăng xuất → trang đăng nhập');
    await page.goto(B + '#/'); await page.waitForSelector('.auth'); ok(true, 'chưa đăng nhập vào trang riêng → bị chuyển sang đăng nhập');

    console.log('Đăng nhập lại');
    await page.fill('input[autocomplete=username]', 'sv01'); await page.fill('input[type=password]', 'matkhau-xin');
    await page.click('button[type=submit]'); await page.waitForSelector('text=Bài của tôi'); ok(true, 'đăng nhập lại');
    console.log('Backend sập tạm thời → thanh cảnh báo, tự retry, tự phục hồi');
    api.closeAllConnections(); await new Promise((r) => api.close(r));
    await page.click('a:has-text("Lịch sử")'); await page.waitForSelector('.conn.bad', { timeout: 8000 }); ok(true, 'hiện thanh "Mất kết nối"');
    api.listen(4101); await page.waitForSelector('text=Lịch sử nộp bài', { timeout: 20000 }); ok(true, 'backend sống lại → trang tự tải xong nhờ retry');
    await page.waitForSelector('.conn.ok'); ok(true, 'hiện "Đã kết nối lại"');
    ok(errors.length === 0, 'không có lỗi JS/console: ' + JSON.stringify(errors));
    console.log('\nE2E: ĐẠT');
  } catch (e) { console.error('\nE2E LỖI:', e.message, '\nconsole:', errors); await page.screenshot({ path: '/tmp/e2e-fail.png' }); process.exitCode = 1; }
  await browser.close(); api.close(); web.close();
})();
