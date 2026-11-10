import { API, session, on, ping, logout } from './api.js';
import { h, toast, spinner, errorBox, icon } from './ui.js';
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

const NAV = [['#/', 'Bài của tôi', 'book-open'], ['#/history', 'Lịch sử', 'file-check'], ['#/settings', 'Cài đặt', 'settings']];
let menuOpen = null; // 'user' | 'mobile' | null

function renderTop() {
  const s = session.get();
  const cur = '#' + (location.hash.replace(/^#/, '').split('?')[0] || '/');
  const brand = h('a', { class: 'brand', href: '#/' },
    h('img', { src: 'img/logo.png', alt: 'Luyện thi CNTT UTC' }),
    h('div', { class: 'brand-w' }, h('div', { class: 'brand-t' }, 'Luyện thi của MNHA'), h('div', { class: 'brand-s' }, 'UTC')));
  if (!s) { top.replaceChildren(h('div', { class: 'top-in' }, brand)); return; }
  const name = s.user.displayName || s.user.username;
  const link = (n, cls) => h('a', { class: cls + (cur === n[0] ? ' on' : ''), href: n[0] }, icon(n[2], cls === 'nl' ? '' : 'lg'), n[1]);
  const drop = h('div', { class: 'drop', id: 'userDrop', hidden: menuOpen !== 'user' },
    h('div', { class: 'dh' }, h('b', null, name), h('small', null, '@' + s.user.username)),
    ...NAV.map((n) => h('a', { class: 'di', href: n[0] }, icon(n[2]), n[1])), h('hr'),
    h('a', { class: 'di', href: '#/settings' }, icon('lock'), 'Đổi mật khẩu'),
    h('button', { class: 'di red', type: 'button', onclick: async () => { menuOpen = null; await logout(); go('/login'); } }, icon('log-out'), 'Đăng xuất'));
  top.replaceChildren(
    h('div', { class: 'top-in' }, brand,
      h('nav', { class: 'nav-d' }, ...NAV.map((n) => link(n, 'nl'))),
      h('div', { class: 'hright' },
        h('div', { class: 'um' },
          h('button', { class: 'um-btn', type: 'button', 'aria-expanded': String(menuOpen === 'user'), onclick: (e) => { e.stopPropagation(); menuOpen = menuOpen === 'user' ? null : 'user'; renderTop(); } },
            h('span', { class: 'avatar' }, name.charAt(0).toUpperCase()),
            h('span', { class: 'um-t' }, h('b', null, name), h('small', null, '@' + s.user.username)),
            icon('chevron-down')),
          drop),
        h('button', { class: 'mbtn', type: 'button', 'aria-label': 'Mở menu', onclick: (e) => { e.stopPropagation(); menuOpen = menuOpen === 'mobile' ? null : 'mobile'; renderTop(); } }, icon('menu', 'lg')))),
    h('div', { class: 'mnav', hidden: menuOpen !== 'mobile' }, ...NAV.map((n) => link(n, 'mn'))));
}
document.addEventListener('click', () => { if (menuOpen) { menuOpen = null; renderTop(); } });

async function render() {
  const token = ++navToken;
  if (cleanup) { try { cleanup(); } catch { /* bỏ qua */ } cleanup = null; }
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, qs] = raw.split('?');
  const route = routes.find(([re]) => re.test(path));
  const s = session.get();
  menuOpen = null; renderTop();
  const guest = !!(route && route[2] && route[2].guest); top.hidden = guest; app.className = guest ? '' : 'wrap';
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
on('offline', () => { wasOffline = true; conn.hidden = false; conn.className = 'conn bad'; conn.textContent = 'Mất kết nối tới máy chủ, đang tự thử lại…'; });
on('online', () => { if (wasOffline) { wasOffline = false; conn.className = 'conn ok'; conn.textContent = 'Đã kết nối lại'; setTimeout(() => { conn.hidden = true; }, 2500); } });
on('auth', renderTop);

window.addEventListener('hashchange', render);
window.addEventListener('online', () => ping().catch(() => {}));

(async function boot() {
  if (!API || /TEN-PROJECT/.test(API)) {
    app.replaceChildren(h('div', { class: 'card err' }, h('h2', null, 'Chưa cấu hình backend'), h('p', null, 'Mở ', h('code', null, 'config.js'), ' và đặt ', h('code', null, 'API_BASE'), ' = địa chỉ Vercel của bạn (ví dụ https://ten-project.vercel.app).')));
    return;
  }
  // Đánh thức serverless (cold start) song song với việc dựng trang
  conn.hidden = false; conn.className = 'conn'; conn.textContent = 'Đang kết nối máy chủ…';
  ping(() => { conn.textContent = 'Máy chủ đang khởi động (lần đầu có thể mất khoảng 10 giây)…'; })
    .then((j) => { conn.hidden = true; if (j.problems && j.problems.length) toast('Backend chưa cấu hình xong: ' + j.problems.join('; '), 'err', 10000); })
    .catch((e) => { conn.className = 'conn bad'; conn.textContent = e.message; });
  render();
})();
