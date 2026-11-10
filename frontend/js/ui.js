import { imageUrl } from './api.js';

// ── Icon SVG (nét Lucide) nhúng sẵn: không cần tải thư viện từ CDN ──
const PATHS = {
  'book-open': '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
  'file-check': '<path d="M4 22h14a2 2 0 0 0 2-2V7l-5-5H6a2 2 0 0 0-2 2v4"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="m3 15 2 2 4-4"/>',
  'settings': '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  'search': '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  'pencil': '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/>',
  'plus': '<path d="M5 12h14"/><path d="M12 5v14"/>',
  'play': '<polygon points="6 3 20 12 6 21 6 3"/>',
  'log-out': '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/>',
  'lock': '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  'chevron-down': '<path d="m6 9 6 6 6-6"/>',
  'menu': '<line x1="4" x2="20" y1="12" y2="12"/><line x1="4" x2="20" y1="6" y2="6"/><line x1="4" x2="20" y1="18" y2="18"/>',
  'graduation-cap': '<path d="M21.42 10.922a1 1 0 0 0-.019-1.838L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.832l8.57 3.908a2 2 0 0 0 1.66 0z"/><path d="M22 10v6"/><path d="M6 12.5V16a6 3 0 0 0 12 0v-3.5"/>',
  'inbox': '<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
  'image': '<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
  'trash': '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>',
  'download': '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>',
  'list-checks': '<path d="m3 17 2 2 4-4"/><path d="m3 7 2 2 4-4"/><path d="M13 6h8"/><path d="M13 12h8"/><path d="M13 18h8"/>',
  'file-text': '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
  'arrow-left': '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
};
/** Tạo icon SVG (chuỗi tĩnh nên an toàn). */
export function icon(name, cls = '') {
  const t = document.createElement('template');
  t.innerHTML = `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true">${PATHS[name] || ''}</svg>`;
  return t.content.firstChild;
}

/** Tạo phần tử DOM an toàn (mọi chuỗi đều qua textContent — không XSS). */
export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === false || v == null) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked' || k === 'disabled' || k === 'selected' || k === 'hidden') el[k] = !!v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) { if (kid == null || kid === false) continue; el.append(kid.nodeType ? kid : document.createTextNode(String(kid))); }
  return el;
}

export function toast(msg, kind = 'info', ms = 4000) {
  const t = h('div', { class: `toast ${kind}`, role: 'status' }, msg);
  document.getElementById('toasts').append(t);
  setTimeout(() => t.remove(), ms);
}

export const fmtDate = (iso) => { try { return new Date(iso).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' }); } catch { return ''; } };
export const fmtDur = (s) => { s = Math.round(s || 0); return `${Math.floor(s / 60)}p${String(s % 60).padStart(2, '0')}s`; };
export const pctClass = (p) => (p == null ? '' : p >= 80 ? 'good' : p >= 50 ? 'mid' : 'low');

/** Hiển thị văn bản có token ảnh [img:ID] (ảnh mã hoá tải qua API). */
export function rich(text) {
  const box = h('div', { class: 'rich' });
  const re = /\[img:([0-9]+\.[a-f0-9]{16,32})\]/g; let last = 0, m;
  const s = String(text || '');
  while ((m = re.exec(s))) {
    if (m.index > last) box.append(s.slice(last, m.index));
    const img = h('img', { alt: 'ảnh', class: 'pic', loading: 'lazy' });
    imageUrl(m[1]).then((u) => { img.src = u; }).catch(() => { img.replaceWith(h('span', { class: 'muted' }, '[không tải được ảnh]')); });
    box.append(img); last = re.lastIndex;
  }
  if (last < s.length) box.append(s.slice(last));
  return box;
}

export function confirmBox(msg) { return Promise.resolve(window.confirm(msg)); }

/** Bọc thao tác async cho nút: khoá nút (hiện vòng xoay), hiện lỗi bằng toast. Không đụng tới nội dung nút. */
export function action(btn, fn) {
  return async (ev) => {
    ev && ev.preventDefault();
    if (btn.disabled || btn.classList.contains('busy')) return;
    btn.classList.add('busy'); btn.setAttribute('aria-busy', 'true');
    try { await fn(); } catch (e) { toast(e.message || 'Có lỗi', 'err', 6000); } finally { btn.classList.remove('busy'); btn.removeAttribute('aria-busy'); }
  };
}

export function spinner(text = 'Đang tải…') { return h('p', { class: 'muted loading' }, text); }
export function errorBox(e, retry) {
  return h('div', { class: 'card err' }, h('p', null, e.message || String(e)), retry ? h('button', { class: 'btn', onclick: retry }, 'Thử lại') : null);
}

/** Chọn ảnh → tải lên → chèn [img:ID] vào vị trí con trỏ của textarea. */
export function imagePickerButton(textarea, uploadImage) {
  const input = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/gif,image/webp', hidden: true });
  const btn = h('button', { type: 'button', class: 'btn small' }, icon('image'), 'Chèn ảnh');
  btn.addEventListener('click', () => input.click());
  input.addEventListener('change', action(btn, async () => {
    const f = input.files[0]; if (!f) return;
    const img = await uploadImage(f); input.value = '';
    const tok = `[img:${img.id}]`, a = textarea.selectionStart ?? textarea.value.length, b = textarea.selectionEnd ?? a;
    textarea.value = textarea.value.slice(0, a) + tok + textarea.value.slice(b);
    textarea.dispatchEvent(new Event('input')); toast('Đã tải ảnh (mã hoá) lên', 'ok');
  }));
  return h('span', null, btn, input);
}
