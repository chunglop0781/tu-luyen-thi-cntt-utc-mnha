/* Giao diện Sáng / Tối. Mặc định SÁNG; lựa chọn lưu ở localStorage ('utc.theme').
   Thuộc tính data-theme trên <html> được đặt sớm bằng script trong <head> (index.html) để khỏi nháy màu. */
import { h } from './ui.js';
const KEY = 'utc.theme';
export const getTheme = () => { try { return localStorage.getItem(KEY) === 'dark' ? 'dark' : 'light'; } catch { return 'light'; } };
export function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  const m = document.querySelector('meta[name="theme-color"]'); if (m) m.setAttribute('content', t === 'dark' ? '#0f1115' : '#ffffff');
  for (const b of document.querySelectorAll('.theme-toggle')) paint(b);
}
function paint(b) { const d = getTheme() === 'dark'; b.textContent = d ? '☀️' : '🌙'; b.title = d ? 'Chuyển sang giao diện sáng' : 'Chuyển sang giao diện tối'; b.setAttribute('aria-label', b.title); }
export function setTheme(t) { try { localStorage.setItem(KEY, t); } catch { /* bỏ qua */ } applyTheme(t); }
/** Nút 🌙/☀️ đổi giao diện. */
export function themeToggle() {
  const b = h('button', { class: 'btn small ghost theme-toggle', type: 'button' });
  paint(b); b.addEventListener('click', () => setTheme(getTheme() === 'dark' ? 'light' : 'dark'));
  return b;
}
applyTheme(getTheme());
