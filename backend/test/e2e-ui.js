'use strict';
// E2E giao diện (trình duyệt thật): nền trắng, tên "Tự luyện thi của mnha", nút hiện/ẩn mật khẩu, Cài đặt → Kết nối AI, chấm AI.
// Chạy: NODE_PATH=test/stubs/node_modules:/đường/dẫn/tới/playwright node test/e2e-ui.js
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const { FakeGitHub } = require('./fakeGithub');
const { createApp } = require('../src/app');

const FRONT = path.join(__dirname, '..', '..', 'frontend');
const env = { GITHUB_TOKEN: 't', GITHUB_OWNER: 'me', JWT_SECRET: 'j'.repeat(40), ENCRYPTION_KEY: 'k'.repeat(40), GITHUB_WEBHOOK_SECRET: 's', CRON_SECRET: 'c',
  FRONTEND_ORIGINS: 'http://127.0.0.1:4202', MAIL_USER: 'bot@example.com', MAIL_PASS: 'x', BCRYPT_ROUNDS: '8' };
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
const ok = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('  ✓', m); };

(async () => {
  const gh = new FakeGitHub('me'); gh.ensure('tu-luyen-thi-cntt-utc-mnha-account'); gh.ensure('tu-luyen-thi-cntt-utc-mnha-data');
  const outbox = []; const mailer = { configured: true, send: async (m) => { outbox.push(m); } };
  const aiCalls = [];
  const aiFetch = async (url, init) => {
    const b = JSON.parse(init.body); aiCalls.push({ url: String(url), auth: init.headers.Authorization || init.headers['x-goog-api-key'], model: b.model });
    const ping = /only with the word OK/.test(JSON.stringify(b)); const analysis = /giảng viên hướng dẫn học tập/.test(JSON.stringify(b)); const reply = ping ? 'OK' : analysis ? JSON.stringify({ summary: 'Bạn yếu phần mạng', weakTopics: [{ topic: 'Giao thức', wrongCount: 1, questions: [1], advice: 'Ôn TCP/UDP' }], mistakes: [{ q: 1, why: 'Nhầm UDP với TCP', correctReasoning: 'UDP không kết nối', tip: 'Nhớ: U = Unreliable' }], studyPlan: ['Đọc lại chương giao thức'] }) : JSON.stringify({ score: 6, feedback: 'Khá tốt', strengths: ['đủ ý'], weaknesses: ['thiếu ví dụ'] });
    return new Response(JSON.stringify(String(url).includes('chat/completions') ? { choices: [{ message: { content: reply } }] } : { candidates: [{ content: { parts: [{ text: reply }] } }] }), { status: 200 });
  };
  const app = createApp({ env, fetchImpl: gh.fetch, aiFetch, mailer, dnsLookup: async () => [{ address: '93.184.216.34', family: 4 }] });
  const api = http.createServer(app.handler).listen(4201);
  const web = http.createServer((req, res) => {
    let p = req.url.split('?')[0]; if (p === '/') p = '/index.html';
    if (p === '/config.js') { res.setHeader('Content-Type', 'text/javascript'); return res.end("window.APP_CONFIG={API_BASE:'http://127.0.0.1:4201'};"); }
    const f = path.join(FRONT, p); if (!f.startsWith(FRONT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.statusCode = 404; return res.end('nf'); }
    res.setHeader('Content-Type', mime[path.extname(f)] || 'application/octet-stream'); res.end(fs.readFileSync(f));
  }).listen(4202);

  const browser = await chromium.launch(); const ctx = await browser.newContext({ colorScheme: 'dark' }); // máy ở chế độ tối vẫn phải ra nền trắng
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message)); page.on('response', async (r) => { if (r.status() >= 400 && r.url().includes('/api/')) console.log('  [api]', r.status(), r.url().slice(-60), (await r.text().catch(() => '')).slice(0, 200)); });
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  const B = 'http://127.0.0.1:4202/';
  const type = (sel) => page.$eval(sel, (e) => e.type);
  try {
    await page.goto(B); await page.waitForSelector('.auth');
    console.log('Giao diện');
    ok((await page.title()) === 'Tự luyện thi của mnha', 'tiêu đề tab: Tự luyện thi của mnha');
    ok(await page.isVisible('.auth-brand >> text=Tự luyện thi của mnha'), 'tên hiển thị ở trang đăng nhập');
    ok(!(await page.content()).includes('CNTT UTC'), 'không còn chữ "CNTT UTC"');
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor); ok(bg === 'rgb(255, 255, 255)', 'nền trắng dù hệ thống đang chế độ tối: ' + bg);

    console.log('Hiện/ẩn mật khẩu: đăng nhập');
    await page.fill('input[autocomplete=current-password]', 'bi-mat-123'); ok((await type('input[autocomplete=current-password]')) === 'password', 'mặc định ẩn');
    await page.click('.pw .eye'); ok((await type('.pw input')) === 'text', 'bấm → hiện'); ok((await page.getAttribute('.pw .eye', 'aria-label')) === 'Ẩn mật khẩu', 'nhãn đổi thành "Ẩn mật khẩu"');
    ok((await page.inputValue('.pw input')) === 'bi-mat-123', 'giữ nguyên nội dung đã gõ');
    await page.click('.pw .eye'); ok((await type('.pw input')) === 'password', 'bấm lại → ẩn');

    console.log('Hiện/ẩn mật khẩu: đăng ký');
    await page.click('text=Đăng ký ngay'); await page.waitForSelector('input[type=email]');
    await page.fill('input[autocomplete=username]', 'mnha01'); await page.fill('input[type=email]', 'mnha01@example.com'); await page.fill('input[autocomplete=new-password]', 'matkhau-cu1');
    await page.click('.pw .eye'); ok((await type('.pw input')) === 'text', 'ô mật khẩu đăng ký hiện được');
    await page.click('button[type=submit]'); await page.waitForSelector('input.otp');
    await page.fill('input.otp', /(\d{6})/.exec(outbox[outbox.length - 1].text)[1]); await page.click('button[type=submit]'); await page.waitForSelector('text=Bài của tôi', { timeout: 15000 });
    ok(await page.isVisible('.brand >> text=Tự luyện thi của mnha'), 'thanh trên cùng: Tự luyện thi của mnha');

    console.log('Cài đặt: đổi mật khẩu có hiện/ẩn');
    await page.goto(B + '#/settings'); await page.waitForSelector('text=Đổi mật khẩu');
    const cp = page.locator('.card:has-text("Đổi mật khẩu") .pw');
    ok((await cp.count()) === 2, '2 ô (hiện tại + mới) đều có nút con mắt');
    await cp.nth(1).locator('input').fill('matkhau-moi2'); await cp.nth(1).locator('.eye').click(); ok((await cp.nth(1).locator('input').getAttribute('type')) === 'text', 'ô mật khẩu mới hiện được');
    await cp.nth(0).locator('input').fill('matkhau-cu1'); await page.click('button:has-text("Đổi mật khẩu")'); await page.waitForSelector('.toast.ok:has-text("Đã đổi mật khẩu")'); ok(true, 'đổi mật khẩu thành công');

    console.log('Cài đặt: trang riêng "Nhà cung cấp AI" (tự thêm như bản cũ)');
    ok(await page.isVisible('.tabs a:has-text("Nhà cung cấp AI")'), 'Cài đặt có tab riêng "Nhà cung cấp AI"');
    await page.click('.tabs a:has-text("Nhà cung cấp AI")'); await page.waitForSelector('h3:text-is("Nhà cung cấp AI của bạn")');
    ok((await page.$$('.prov')).length === 1 && await page.isVisible('.prov:has-text("Google Gemini")'), 'tài khoản mới chỉ có Gemini dựng sẵn (nhà khác tự thêm)');
    const geminiModels = await page.$$eval('.prov select[aria-label=Model] option', (o) => o.map((x) => x.value)); ok(geminiModels.includes('gemini-flash-latest') && geminiModels.includes('gemini-2.5-pro'), 'Gemini: danh sách model như bản cũ');
    ok(!(await page.isVisible('.prov:has-text("Google Gemini") >> text=Xoá nhà cung cấp')), 'Gemini dựng sẵn không có nút xoá');
    await page.click('button:has-text("＋ vilao.ai")'); await page.waitForSelector('.prov-form');
    ok((await page.inputValue('.prov-form input[placeholder="https://api.openai.com"]')) === 'https://api.vilao.ai', 'mẫu vilao.ai điền sẵn địa chỉ API');
    await page.fill('.prov-form input[placeholder="https://api.openai.com"]', 'http://api.vilao.ai'); await page.click('.prov-form button.primary'); await page.waitForSelector('.prov-form .alert.err:has-text("https://")'); ok(true, 'địa chỉ http:// bị từ chối ngay trong form');
    await page.fill('.prov-form input[placeholder="https://api.openai.com"]', 'https://api.vilao.ai'); await page.click('.prov-form button.primary'); await page.waitForSelector('.prov:has(h3:has-text("vilao.ai"))'); ok(true, 'thêm nhà cung cấp vilao.ai');
    const card = page.locator('.prov:has(h3:has-text("vilao.ai"))');
    const dl = await page.$$eval('#models-vilao option', (o) => o.map((x) => x.value)); ok(dl.includes('gpt-4o-mini') && dl.includes('chib/deepseek-v4.1-flash'), 'vilao.ai: gợi ý model như bản cũ');
    await card.locator('input[aria-label=Model]').fill('gpt-4o'); await card.locator('.pw input').fill('sk-vilao-abcdefgh');
    await card.locator('button:has-text("Kiểm tra kết nối")').click(); await page.waitForSelector('.alert.ok:has-text("Kết nối được")'); const msg = await page.textContent('.alert.ok');
    ok(/vilao\.ai/.test(msg) && /gpt-4o/.test(msg) && /OK/.test(msg), 'báo kết nối được: ' + msg.trim());
    ok(aiCalls.at(-1).url === 'https://api.vilao.ai/v1/chat/completions' && aiCalls.at(-1).auth === 'Bearer sk-vilao-abcdefgh', 'gọi đúng địa chỉ vilao.ai bằng key vừa nhập');
    await page.click('.prov:has(h3:has-text("vilao.ai")) >> button:has-text("Đặt làm mặc định")'); await page.waitForSelector('.prov:has(h3:has-text("vilao.ai")) >> text=Đang là mặc định'); ok(true, 'đặt vilao.ai làm mặc định');
    ok(await page.isVisible('.prov:has(h3:has-text("vilao.ai")) >> text=✓ có key'), 'nhà đã có key được đánh dấu');
    page.once('dialog', (d) => d.accept()); await page.click('.prov:has(h3:has-text("vilao.ai")) >> button:has-text("Xoá key")'); await page.waitForSelector('.prov:has(h3:has-text("vilao.ai")) >> text=chưa có key'); ok(true, 'xoá key');
    await page.locator('.prov:has(h3:has-text("vilao.ai")) .pw input').fill('sk-vilao-abcdefgh'); await page.click('.prov:has(h3:has-text("vilao.ai")) >> button:has-text("Lưu key & model")'); await page.waitForSelector('.toast.ok:has-text("key được mã hoá")'); ok(true, 'lưu key lại');
    await page.click('.prov:has(h3:has-text("vilao.ai")) >> button:has-text("Sửa nhà cung cấp")'); await page.waitForSelector('.prov-form');
    await page.fill('.prov-form input[placeholder^="Tên hiển thị"]', 'vilao.ai'); await page.click('.prov-form button.primary'); await page.waitForSelector('.prov:has(h3:has-text("vilao.ai"))'); ok(true, 'sửa nhà cung cấp');
    const aiDoc = JSON.parse(gh.file('tu-luyen-thi-cntt-utc-mnha-account', `AI-database/${(await page.evaluate(() => JSON.parse(localStorage.getItem('utc.auth.v2')).user.id))}/index.json`).toString());
    ok(aiDoc.providers.length === 1 && aiDoc.providers[0].id === 'vilao' && !JSON.stringify(aiDoc).includes('sk-vilao-abcdefgh'), 'lưu ở AI-database/<uid>/index.json, không chứa key');

    console.log('Chấm tự luận bằng AI');
    const sess = await page.evaluate(() => JSON.parse(localStorage.getItem('utc.auth.v2'))); const tok = sess.accessToken; const H = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok };
    const eid = 'a1b2c3d4e5f60718', sid = 'b1b2c3d4e5f60718';
    await fetch('http://127.0.0.1:4201/api/essays/' + eid, { method: 'PUT', headers: H, body: JSON.stringify({ title: 'TCP vs UDP', subject: 'Mạng', prompt: 'So sánh TCP và UDP', modelAnswer: 'TCP tin cậy. UDP nhanh.', maxScore: 10, rubric: [] }) });
    await fetch('http://127.0.0.1:4201/api/submissions/' + sid, { method: 'PUT', headers: H, body: JSON.stringify({ itemType: 'essay', itemId: eid, text: 'TCP tin cậy còn UDP nhanh' }) });
    await page.goto(B + '#/submission/' + sid); await page.waitForSelector('text=Chấm bằng AI');
    ok(await page.isVisible('.ai-pick'), 'có bộ chọn nhà cung cấp/model ngay ở trang bài nộp');
    await page.click('button:has-text("Chấm bằng AI")'); await page.waitForSelector('text=Khá tốt'); ok(true, 'AI chấm xong, hiện nhận xét');
    ok(await page.isVisible('.card:has-text("Chấm bằng AI") >> text=vilao.ai · gpt-4o'), 'ghi rõ nhà cung cấp + model đã chấm');
    ok(aiCalls.at(-1).model === 'gpt-4o', 'dùng model đã lưu trong Cài đặt');
    console.log('Thanh trên cùng: email đăng nhập');
    ok((await page.textContent('.top .who')) === 'mnha01@example.com', 'thanh trên cùng hiện email đăng nhập (không phải tên đăng nhập)');
    ok((await page.textContent('.top .avatar')) === 'M', 'avatar lấy chữ cái đầu của email');

    console.log('Tạo đề 3 phần bằng giao diện (dán text như bản cũ)');
    await page.goto(B + '#/quiz/new'); await page.waitForSelector('.qf');
    ok(await page.isVisible('#btnCopyPrompt'), 'có nút Sao chép prompt mẫu'); await page.click('#btnTogglePrompt'); ok((await page.textContent('#promptBox')).includes('KHỐI 1') && (await page.textContent('#promptBox')).includes('KHỐI 3'), 'prompt mẫu mô tả quy luật 3 khối');
    await page.fill('#fTitle', 'Mạng 3 phần'); await page.fill('#fSubject', 'Mạng');
    await page.fill('#paste-mcq', '- UDP là giao thức gì?\n+)Hướng kết nối\n+)Không kết nối\n=> B\n++) UDP <b>không</b> thiết lập kết nối.\n- 1+1?\n+)1\n+)2\n=> B');
    await page.fill('#paste-tf', '- Xét TCP:\n+)TCP tin cậy\n=> Đúng\n+)TCP không có bắt tay\n=> Sai');
    await page.fill('#paste-fill', '- 10/4?\n=> 2.5 | 2,5');
    await page.check('#fShuffle'); await page.click('#btnParse'); await page.waitForSelector('#cards-mcq .qc');
    ok((await page.$$('#cards-mcq .qc')).length === 2 && (await page.$$('#cards-fill .qc')).length === 1, 'chuyển text → thẻ câu hỏi ở cả 3 phần');
    await page.screenshot({ path: '/tmp/ui-editor.png', fullPage: true });
    await page.click('#btnSave'); await page.waitForSelector('h2:text-is("Bài của tôi")', { timeout: 15000 }); ok(true, 'lưu đề 3 phần → quay về danh sách');
    const ov = await (await fetch('http://127.0.0.1:4201/api/overview', { headers: H })).json(); const qid = ov.items.find((i) => i.title === 'Mạng 3 phần').id; ok(ov.items.find((i) => i.id === qid).size === 4, 'đề có 4 câu (2 + 1 + 1)');
    console.log('Làm bài (có màn bắt đầu, xáo trộn, nộp, xem kết quả)');
    await page.goto(B + '#/quiz/' + qid); await page.waitForSelector('#qxStartBtn'); ok(await page.isVisible('.qx-start-card'), 'màn hình bắt đầu hiện thông tin đề');
    await page.click('#qxStartBtn'); await page.waitForSelector('#questionContainer .question-card, #questionContainer *');
    await page.screenshot({ path: '/tmp/ui-take.png' });
    const total = await page.textContent('#questionNumber'); ok(/1 \/ 4/.test(total), 'đánh số câu liền qua các phần: ' + total.trim());
    // trả lời lần lượt: chọn đáp án đúng / điền chữ theo nội dung từng câu
    for (let i = 0; i < 4; i++) {
      const txt = await page.textContent('#questionContainer');
      if (/UDP là giao thức/.test(txt)) await page.click('#questionContainer >> text=Không kết nối');
      else if (/1\+1/.test(txt)) await page.click('#questionContainer >> text=/^\\s*B?\\.?\\s*2$/');
      else if (/10\/4/.test(txt)) await page.fill('#fillInput', '2,5');
      else if (/Xét TCP/.test(txt)) { const btns = await page.$$('#questionContainer button, #questionContainer label'); }
      if (i < 3) await page.click('#nextBtn');
    }
    ok((await page.textContent('#answeredCount')) !== '0', 'đếm số câu đã trả lời');
    page.once('dialog', (d) => d.accept()); await page.click('#submitMain'); await page.waitForSelector('#resultSection:not(.hidden)', { timeout: 15000 }); ok(true, 'nộp bài → hiện kết quả');
    ok(await page.isVisible('#reviewList'), 'có phần đáp án & giải thích'); ok((await page.textContent('#reviewList')).includes('không'), 'hiện giải thích (++) của câu');
    const qsid = (await page.getAttribute('#resultSection a[href^="#/submission/"]', 'href')).split('/').pop(); ok(!!qsid, 'có liên kết sang trang bài nộp');
    console.log('Phân tích AI trắc nghiệm');
    await page.goto(B + '#/submission/' + qsid); await page.waitForSelector('h3:text-is("Phân tích AI")');
    ok(await page.isVisible('.card:has-text("Phân tích AI") .ai-pick'), 'có bộ chọn nhà cung cấp/model + nút Phân tích AI');
    await page.click('button:has-text("Phân tích AI")'); await page.waitForSelector('.card.an');
    ok(await page.isVisible('.card.an >> text=Nhầm UDP với TCP') && await page.isVisible('.card.an >> text=Giao thức'), 'hiện chủ đề cần ôn + phân tích từng câu sai');
    ok(await page.isVisible('.card.an >> text=vilao.ai · gpt-4o'), 'ghi rõ nhà cung cấp + model');
    await page.click('.card.an .chip >> nth=0'); await page.waitForSelector('.qcard.flash'); ok(true, 'bấm chip "Câu 1" cuộn tới đúng câu');
    ok(await page.isVisible('text=Đã dùng 1/5 lần'), 'hiện số lần đã dùng');
    await page.screenshot({ path: '/tmp/ui-analysis.png', fullPage: true });
    ok(errors.length === 0, 'không có lỗi JS/console: ' + JSON.stringify(errors));
    await page.screenshot({ path: '/tmp/ui-submission.png' }); await page.goto(B + '#/settings/ai'); await page.waitForSelector('.prov'); await page.screenshot({ path: '/tmp/ui-settings.png', fullPage: true });
    console.log('Đăng nhập bằng email');
    await page.click('.top button:has-text("Đăng xuất")'); await page.waitForSelector('.auth');
    ok(await page.isVisible('label:has-text("Tên đăng nhập hoặc email")'), 'ô đăng nhập ghi rõ "Tên đăng nhập hoặc email"');
    await page.fill('input[autocomplete=username]', 'MNHA01@Example.com'); await page.fill('input[autocomplete=current-password]', 'matkhau-moi2'); await page.click('button[type=submit]'); await page.waitForSelector('text=Bài của tôi', { timeout: 15000 });
    ok((await page.textContent('.top .who')) === 'mnha01@example.com', 'đăng nhập bằng EMAIL thành công');
    console.log('\nE2E UI: ĐẠT');
  } catch (e) { console.error('\nE2E UI LỖI:', e.message, '\nconsole:', errors); await page.screenshot({ path: '/tmp/e2e-ui-fail.png' }); process.exitCode = 1; }
  await browser.close(); api.close(); web.close();
})();
