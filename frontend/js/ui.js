import { imageUrl } from './api.js';

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
