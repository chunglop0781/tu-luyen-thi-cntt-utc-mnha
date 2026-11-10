import { API, session, on, ping, logout } from './api.js';
import { h, toast, spinner, errorBox } from './ui.js';
import { loginPage } from './pages/auth.js';
import { homePage, historyPage } from './pages/home.js';
import { essayEditor, quizEditor } from './pages/editors.js';
import { essayPractice, quizPractice } from './pages/practice.js';
import { submissionPage } from './pages/submission.js';
import { settingsPage } from './pages/settings.js';

// Định tuyến bằng #hash → đổi trang / tải lại luôn chạy được trên GitHub Pages (không cần server rewrite).
const routes = [
  [/^\/login$/, loginPage, { guest: true }],
  [/^\/$/, homePage],
  [/^\/history$/, historyPage],
  [/^\/settings$/, settingsPage],
  [/^\/essay\/new$/, (c) => essayEditor(c, null)],
  [/^\/essay\/([a-f0-9]+)\/edit$/, (c, m) => essayEditor(c, m[1])],
  [/^\/essay\/([a-f0-9]+)$/, (c, m) => essayPractice(c, m[1])],
  [/^\/quiz\/new$/, (c) => quizEditor(c, null)],
  [/^\/quiz\/([a-f0-9]+)\/edit$/, (c, m) => quizEditor(c, m[1])],
  [/^\/quiz\/([a-f0-9]+)$/, (c, m) => quizPractice(c, m[1])],
  [/^\/submission\/([a-f0-9]+)$/, (c, m) => submissionPage(c, m[1])],
];

const app = document.getElementById('app'), top = document.getElementById('top'), conn = document.getElementById('conn');
let cleanup = null, navToken = 0;

export const go = (path) => { location.hash = '#' + path; };

function renderTop() {
  const s = session.get();
  top.replaceChildren(
    h('a', { class: 'brand', href: '#/' }, '📝 Tự luyện thi CNTT UTC'),
    s ? h('nav', null,
      h('a', { href: '#/' }, 'Bài của tôi'), h('a', { href: '#/history' }, 'Lịch sử'), h('a', { href: '#/settings' }, '👤 ' + s.user.displayName),
      h('button', { class: 'btn small ghost', onclick: async () => { await logout(); go('/login'); } }, 'Đăng xuất')) : null,
  );
}

async function render() {
  const token = ++navToken;
  if (cleanup) { try { cleanup(); } catch { /* bỏ qua */ } cleanup = null; }
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, qs] = raw.split('?');
  const route = routes.find(([re]) => re.test(path));
  const s = session.get();
  renderTop();
  if (!route) { app.replaceChildren(h('div', { class: 'card' }, h('h2', null, 'Không tìm thấy trang'), h('a', { class: 'btn', href: '#/' }, 'Về trang chủ'))); return; }
  if (!route[2] || !route[2].guest) { if (!s) return go('/login'); }
  else if (s) return go('/');
  app.replaceChildren(spinner());
  const ctx = { query: new URLSearchParams(qs || ''), setCleanup: (f) => { cleanup = f; }, go, isCurrent: () => token === navToken };
  try {
    const node = await route[1](ctx, route[0].exec(path));
    if (token !== navToken) return;
    app.replaceChildren(node); window.scrollTo(0, 0);
  } catch (e) {
    if (token !== navToken) return;
    if (e.status === 401) { session.clear(); return go('/login'); }
    app.replaceChildren(errorBox(e, render));
  }
}

// ── Thanh trạng thái kết nối ──
let wasOffline = false;
on('offline', () => { wasOffline = true; conn.hidden = false; conn.className = 'conn bad'; conn.textContent = '⚠️ Mất kết nối tới máy chủ — đang tự thử lại…'; });
on('online', () => { if (wasOffline) { wasOffline = false; conn.className = 'conn ok'; conn.textContent = '✅ Đã kết nối lại'; setTimeout(() => { conn.hidden = true; }, 2500); } });
on('auth', renderTop);

window.addEventListener('hashchange', render);
window.addEventListener('online', () => ping().catch(() => {}));

(async function boot() {
  if (!API || /TEN-PROJECT/.test(API)) {
    app.replaceChildren(h('div', { class: 'card err' }, h('h2', null, 'Chưa cấu hình backend'), h('p', null, 'Mở ', h('code', null, 'frontend/config.js'), ' và đặt ', h('code', null, 'API_BASE'), ' = địa chỉ Vercel của bạn (ví dụ https://ten-project.vercel.app).')));
    return;
  }
  // Đánh thức serverless (cold start) song song với việc dựng trang
  conn.hidden = false; conn.className = 'conn'; conn.textContent = '⏳ Đang kết nối máy chủ…';
  ping(() => { conn.textContent = '⏳ Máy chủ đang khởi động (lần đầu có thể mất ~10 giây)…'; })
    .then((j) => { conn.hidden = true; if (j.problems && j.problems.length) toast('Backend chưa cấu hình xong: ' + j.problems.join('; '), 'err', 10000); })
    .catch((e) => { conn.className = 'conn bad'; conn.textContent = '⚠️ ' + e.message; });
  render();
})();
