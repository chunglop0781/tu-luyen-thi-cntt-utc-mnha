import { get, put, newId } from '../api.js';
import { h, action, toast, fmtDur, richOrHtml } from '../ui.js';

const draftKey = (t, id) => `utc.draft.${t}.${id}`;
const loadDraft = (k) => { try { return JSON.parse(localStorage.getItem(k)) || null; } catch { return null; } };
const saveDraft = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* bỏ qua */ } };
const clearDraft = (k) => { try { localStorage.removeItem(k); } catch { /* bỏ qua */ } };

/** Làm bài tự luận — bản nháp tự lưu trong trình duyệt, id bài nộp cố định nên gửi lại khi rớt mạng không bị trùng. */
export async function essayPractice(ctx, id) {
  const { item } = await get(`/api/essays/${id}`);
  const key = draftKey('essay', id);
  const d = loadDraft(key) || { subId: newId(), text: '', startedAt: new Date().toISOString() };
  const ta = h('textarea', { rows: 14, placeholder: 'Viết bài làm của bạn ở đây…' }); ta.value = d.text;
  const timer = h('span', { class: 'timer' }, '0p00s');
  const limit = item.duration ? item.duration * 60 : null;       // đếm ngược nếu bài có đặt thời gian; hết giờ tự nộp phần đã viết
  let up = false;
  const tick = setInterval(() => {
    const used = (Date.now() - new Date(d.startedAt)) / 1000;
    if (!limit) { timer.textContent = fmtDur(used); return; }
    const left = Math.max(0, Math.round(limit - used)); timer.textContent = `⏳ ${String(Math.floor(left / 60)).padStart(2, '0')}:${String(left % 60).padStart(2, '0')}`; timer.classList.toggle('warn', left <= 60);
    if (left === 0 && !up) { up = true; clearInterval(tick); toast('Hết giờ — đang nộp bài…', 'warn'); submit.click(); }
  }, 1000); ctx.setCleanup(() => clearInterval(tick));
  ta.addEventListener('input', () => { d.text = ta.value; saveDraft(key, d); });
  saveDraft(key, d);
  const submit = h('button', { class: 'btn primary' }, 'Nộp bài');
  submit.addEventListener('click', action(submit, async () => {
    if (!ta.value.trim()) { if (up) { clearDraft(key); ctx.go('/'); return; } throw new Error('Bài làm đang trống'); }
    const r = await put(`/api/submissions/${d.subId}`, { itemType: 'essay', itemId: id, text: ta.value, startedAt: d.startedAt, durationSec: (Date.now() - new Date(d.startedAt)) / 1000 }, { retry: true });
    clearDraft(key); toast('Đã nộp bài', 'ok'); ctx.go(`/submission/${r.submission.id}`);
  }));
  return h('div', { class: 'stack' },
    h('div', { class: 'card' }, h('div', { class: 'row between' }, h('h2', null, item.title), timer), item.subject ? h('span', { class: 'badge' }, item.subject) : null, h('h3', null, 'Đề bài'), richOrHtml(item.prompt)),
    h('div', { class: 'card stack' }, h('h3', null, 'Bài làm'), ta, h('small', { class: 'muted' }, '💾 Bản nháp tự lưu trên máy bạn.'), h('div', { class: 'row' }, submit, h('a', { class: 'btn ghost', href: '#/' }, 'Thoát'))));
}
