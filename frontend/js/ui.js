import { imageUrl } from './api.js';

/* DOM gốc: append / prepend / replaceChildren(null) in ra chữ "null" (lỗi từng hiện cạnh nút 🎲 ở thanh AI).
   Lọc null / undefined / false cho mọi nơi gọi, để một biểu thức điều kiện `cond ? node : null` không bao giờ lộ chữ "null". */
for (const m of ['append', 'prepend', 'replaceChildren']) {
  for (const P of [Element.prototype, DocumentFragment.prototype]) {
    const orig = P[m]; if (typeof orig !== 'function' || orig.__nullSafe) continue;
    const safe = function (...a) { return orig.apply(this, a.filter((x) => x != null && x !== false)); }; safe.__nullSafe = true; P[m] = safe;
  }
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

/** Bọc thao tác async cho nút: khoá nút, hiện lỗi bằng toast. */
export function action(btn, fn) {
  return async (ev) => {
    ev && ev.preventDefault();
    if (btn.disabled) return;
    const old = btn.textContent; btn.disabled = true; btn.textContent = '⏳ ' + old;
    try { await fn(); } catch (e) { toast(e.message || 'Có lỗi', 'err', 6000); } finally { btn.disabled = false; btn.textContent = old; }
  };
}

export function spinner(text = 'Đang tải…') { return h('p', { class: 'muted loading' }, '⏳ ' + text); }
export function errorBox(e, retry) {
  return h('div', { class: 'card err' }, h('p', null, '⚠️ ', e.message || String(e)), retry ? h('button', { class: 'btn', onclick: retry }, 'Thử lại') : null);
}

/** Chọn ảnh → tải lên → chèn [img:ID] vào vị trí con trỏ của textarea. */
export function imagePickerButton(textarea, uploadImage) {
  const input = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/gif,image/webp', hidden: true });
  const btn = h('button', { type: 'button', class: 'btn small' }, '🖼️ Chèn ảnh');
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

/** Biểu tượng mũ cử nhân (SVG nội tuyến, không cần thư viện icon). */
export function logo() {
  const d = document.createElement('span'); d.className = 'logo';
  d.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 10 12 5 2 10l10 5 10-5Z"/><path d="M6 12v5c3 2.2 9 2.2 12 0v-5"/><path d="M22 10v6"/></svg>';
  return d;
}

const EYE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3l18 18"/><path d="M10.6 5.1A10.6 10.6 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6A17.4 17.4 0 0 0 2 12s3.6 7 10 7c1.7 0 3.2-.4 4.5-1"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>';

/** Bọc ô mật khẩu bằng nút hiện/ẩn (con mắt). Trả về phần tử bọc; `input` vẫn dùng như cũ. */
export function withToggle(input) {
  const btn = h('button', { type: 'button', class: 'eye', title: 'Hiện mật khẩu', 'aria-label': 'Hiện mật khẩu', 'aria-pressed': 'false' });
  btn.innerHTML = EYE;
  btn.addEventListener('click', () => {
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    btn.innerHTML = show ? EYE_OFF : EYE;
    const t = show ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'; btn.title = t; btn.setAttribute('aria-label', t); btn.setAttribute('aria-pressed', String(show));
    input.focus({ preventScroll: true });
  });
  return h('div', { class: 'pw' }, input, btn);
}

const OK_TAGS = new Set(['B', 'I', 'U', 'STRONG', 'EM', 'BR', 'P', 'UL', 'OL', 'LI', 'CODE', 'PRE', 'SUB', 'SUP', 'SPAN', 'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'TH', 'TD', 'CAPTION', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'DIV', 'BLOCKQUOTE', 'HR', 'FIGURE', 'FIGCAPTION']);
/** Hiển thị HTML ngắn (giải thích, nội dung chùm) qua danh sách thẻ cho phép — không thuộc tính, không script. */
export function safeHtml(html) {
  const box = document.createElement('div');
  const doc = new DOMParser().parseFromString(`<body>${String(html || '')}</body>`, 'text/html');
  const walk = (src, dst) => {
    for (const n of src.childNodes) {
      if (n.nodeType === 3) dst.append(n.textContent);
      else if (n.nodeType === 1) { if (OK_TAGS.has(n.tagName)) {
        const e = document.createElement(n.tagName.toLowerCase());
        const al = ((/text-align\s*:\s*(left|right|center|justify)/i.exec(n.getAttribute('style') || '') || [])[1] || n.getAttribute('align') || '').toLowerCase();
        if (/^(left|right|center|justify)$/.test(al)) e.style.textAlign = al;                       // chỉ giữ căn lề, bỏ mọi style khác
        if (n.tagName === 'TD' || n.tagName === 'TH') for (const k of ['colspan', 'rowspan']) { const v = parseInt(n.getAttribute(k), 10); if (v > 1 && v <= 20) e.setAttribute(k, String(v)); }
        walk(n, e); dst.append(e);
      } else walk(n, dst); }
    }
  };
  walk(doc.body, box);
  return box;
}

/** Đề / lời giải do AI sinh ra thường là HTML ("nhúng html") → hiển thị qua safeHtml; còn văn bản thường (kèm [img:…]) → rich. */
export function richOrHtml(text) {
  const t = String(text || '');
  if (!/<(p|div|h[1-6]|ul|ol|table|br|b|i|strong|em|span|li)\b[^>]*>/i.test(t)) return rich(t);
  const box = h('div', { class: 'rich html' }); box.append(...safeHtml(t).childNodes);
  if (window.MathJax && window.MathJax.typesetPromise) setTimeout(() => window.MathJax.typesetPromise([box]).catch(() => {}), 0);
  return box;
}
