import { get, put, newId } from '../api.js';
import { h, action, toast, rich, fmtDur, confirmBox } from '../ui.js';

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
  const tick = setInterval(() => { timer.textContent = fmtDur((Date.now() - new Date(d.startedAt)) / 1000); }, 1000); ctx.setCleanup(() => clearInterval(tick));
  ta.addEventListener('input', () => { d.text = ta.value; saveDraft(key, d); });
  saveDraft(key, d);
  const submit = h('button', { class: 'btn primary' }, 'Nộp bài');
  submit.addEventListener('click', action(submit, async () => {
    if (!ta.value.trim()) throw new Error('Bài làm đang trống');
    const r = await put(`/api/submissions/${d.subId}`, { itemType: 'essay', itemId: id, text: ta.value, startedAt: d.startedAt, durationSec: (Date.now() - new Date(d.startedAt)) / 1000 }, { retry: true });
    clearDraft(key); toast('Đã nộp bài', 'ok'); ctx.go(`/submission/${r.submission.id}`);
  }));
  return h('div', { class: 'stack' },
    h('div', { class: 'card stack' }, h('div', { class: 'row between' }, h('h1', { class: 'title' }, item.title), timer), item.subject ? h('div', null, h('span', { class: 'badge essay' }, item.subject)) : null, h('h3', null, 'Đề bài'), rich(item.prompt)),
    h('div', { class: 'card stack' }, h('h3', null, 'Bài làm'), ta, h('small', { class: 'muted' }, 'Bản nháp tự lưu trên máy bạn.'), h('div', { class: 'row' }, submit, h('a', { class: 'btn ghost', href: '#/' }, 'Thoát'))));
}

const shuffled = (a) => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

/** Làm trắc nghiệm — đếm ngược (nếu có), tự nộp khi hết giờ, nháp đáp án tự lưu. */
export async function quizPractice(ctx, id) {
  const { item } = await get(`/api/quizzes/${id}`);
  const key = draftKey('quiz', id);
  let d = loadDraft(key);
  if (!d || d.v !== item.updatedAt) d = { v: item.updatedAt, subId: newId(), startedAt: new Date().toISOString(), answers: {}, order: (item.shuffle ? shuffled(item.questions) : item.questions).map((q) => q.id) };
  saveDraft(key, d);
  const byId = Object.fromEntries(item.questions.map((q) => [q.id, q]));
  const answered = h('span', { class: 'muted' });
  const upd = () => { answered.textContent = `Đã trả lời ${Object.values(d.answers).filter((a) => a.length).length}/${item.questions.length}`; };

  const qs = d.order.map((qid, n) => {
    const q = byId[qid]; if (!q) return null;
    const multi = q.correct.length > 1, name = 'q' + q.id;
    return h('div', { class: 'card qcard' }, h('b', null, `Câu ${n + 1}.`), ' ', rich(q.text), multi ? h('small', { class: 'muted' }, '(chọn nhiều đáp án)') : null,
      ...q.options.map((o) => {
        const inp = h('input', { type: multi ? 'checkbox' : 'radio', name, checked: (d.answers[q.id] || []).includes(o.id), onchange: () => {
          const cur = new Set(d.answers[q.id] || []);
          if (multi) { inp.checked ? cur.add(o.id) : cur.delete(o.id); } else { cur.clear(); cur.add(o.id); }
          d.answers[q.id] = [...cur]; saveDraft(key, d); upd();
        } });
        return h('label', { class: 'choice' }, inp, h('b', null, o.id + '.'), rich(o.text));
      }));
  }).filter(Boolean);
  upd();

  const timer = h('span', { class: 'timer' });
  let sent = false;
  const doSubmit = async (auto) => {
    if (sent) return;
    const left = item.questions.length - Object.values(d.answers).filter((a) => a.length).length;
    if (!auto && left > 0 && !(await confirmBox(`Còn ${left} câu chưa trả lời. Vẫn nộp?`))) return;
    sent = true;
    try {
      const r = await put(`/api/submissions/${d.subId}`, { itemType: 'quiz', itemId: id, answers: d.answers, startedAt: d.startedAt, durationSec: (Date.now() - new Date(d.startedAt)) / 1000 }, { retry: true });
      clearDraft(key); ctx.go(`/submission/${r.submission.id}`);
    } catch (e) { sent = false; throw e; }
  };
  const mkSubmit = () => { const b = h('button', { class: 'btn primary' }, 'Nộp bài'); b.addEventListener('click', action(b, () => doSubmit(false))); return b; };
  if (item.timeLimitMin) {
    const end = new Date(d.startedAt).getTime() + item.timeLimitMin * 60000;
    const tick = setInterval(() => {
      const s = Math.max(0, Math.round((end - Date.now()) / 1000)); timer.textContent = 'Còn ' + fmtDur(s);
      if (s === 0) { clearInterval(tick); toast('Hết giờ — đang nộp bài', 'info'); doSubmit(true).catch((e) => toast(e.message, 'err')); }
    }, 1000); ctx.setCleanup(() => clearInterval(tick));
  }
  return h('div', { class: 'stack' },
    h('div', { class: 'card sticky stack', style: 'gap:.5rem' }, h('div', { class: 'row between' }, h('h2', null, item.title), timer), h('div', { class: 'row between' }, answered, mkSubmit())),
    ...qs, h('div', { class: 'row' }, mkSubmit(), h('a', { class: 'btn ghost', href: '#/' }, 'Thoát')));
}
