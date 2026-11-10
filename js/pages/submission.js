import { get, patch, post, del } from '../api.js';
import { h, action, toast, rich, fmtDate, fmtDur, pctClass, confirmBox, icon } from '../ui.js';

export async function submissionPage(ctx, id) {
  let { submission: s } = await get(`/api/submissions/${id}`);
  const root = h('div', { class: 'stack' });
  const draw = () => root.replaceChildren(s.type === 'quiz' ? quizView(s) : essayView(s, (n) => { s = n; draw(); }),
    h('div', { class: 'row' }, h('a', { class: 'btn', href: `#/${s.type}/${s.itemId}` }, 'Làm lại'), h('a', { class: 'btn ghost', href: '#/history' }, 'Lịch sử'),
      h('button', { class: 'btn danger', onclick: async () => { if (await confirmBox('Xoá bài nộp này?')) { try { await del(`/api/submissions/${id}`); toast('Đã xoá', 'ok'); ctx.go('/history'); } catch (e) { toast(e.message, 'err'); } } } }, icon('trash'), 'Xoá bài nộp')));
  draw();
  return root;
}

function quizView(s) {
  const pct = s.max ? Math.round((s.score / s.max) * 100) : 0;
  const byId = Object.fromEntries(s.results.map((r) => [r.id, r]));
  return h('div', { class: 'stack' },
    h('div', { class: 'card center' }, h('h2', null, s.title), h('div', { class: `bigscore ${pctClass(pct)}` }, `${s.score}/${s.max}`),
      h('p', null, `${s.correctCount}/${s.total} câu đúng · ${pct}% · ${fmtDur(s.durationSec)} · ${fmtDate(s.submittedAt)}`)),
    ...s.snapshot.map((q, i) => {
      const r = byId[q.id] || { chosen: [], ok: false };
      return h('div', { class: `card qcard ${r.ok ? 'right' : 'wrong'}` }, h('b', null, `Câu ${i + 1} `), h('span', { class: `badge ${r.ok ? 'ok' : 'no'}` }, r.ok ? 'Đúng' : 'Sai'), ' ', rich(q.text),
        ...q.options.map((o) => {
          const isC = q.correct.includes(o.id), picked = r.chosen.includes(o.id);
          return h('div', { class: `opt-r ${isC ? 'is-correct' : ''} ${picked && !isC ? 'is-wrong' : ''}` }, h('b', null, o.id + '.'), rich(o.text), picked ? h('small', { class: 'muted' }, ' (bạn chọn)') : null, isC ? h('small', { class: 'good' }, ' (đáp án đúng)') : null);
        }), q.explanation ? h('div', { class: 'expl' }, h('b', null, 'Giải thích: '), rich(q.explanation)) : null);
    }));
}

function essayView(s, set) {
  const sug = s.suggestion || {};
  const score = h('input', { type: 'number', min: 0, max: s.max, step: '0.25', value: s.selfScore ?? '', placeholder: `0–${s.max}` });
  const note = h('textarea', { rows: 3, placeholder: 'Ghi chú sau khi đối chiếu (điểm yếu, cần ôn gì…)' }); note.value = s.note || '';
  const saveBtn = h('button', { class: 'btn primary' }, 'Lưu điểm tự chấm');
  saveBtn.addEventListener('click', action(saveBtn, async () => { const r = await patch(`/api/submissions/${s.id}`, { selfScore: score.value === '' ? null : Number(score.value), note: note.value }); toast('Đã lưu', 'ok'); set(r.submission); }));
  const aiBtn = h('button', { class: 'btn' }, 'Chấm bằng Gemini');
  aiBtn.addEventListener('click', action(aiBtn, async () => { const r = await post(`/api/submissions/${s.id}/ai-grade`, {}, { timeout: 60000 }); toast('Gemini đã chấm xong', 'ok'); set(r.submission); }));
  return h('div', { class: 'stack' },
    h('div', { class: 'card center' }, h('h2', null, s.title), h('div', { class: `bigscore ${pctClass(s.score == null ? null : (s.score / s.max) * 100)}` }, s.score == null ? 'Chờ chấm' : `${s.score}/${s.max}`),
      h('p', { class: 'muted' }, `${fmtDate(s.submittedAt)} · ${fmtDur(s.durationSec)}`)),
    h('div', { class: 'card' }, h('h3', null, 'Đề bài'), rich(s.snapshot.prompt)),
    h('div', { class: 'card stack' }, h('h3', null, 'Bài làm của bạn'), h('div', { class: 'rich' }, s.text)),
    s.snapshot.modelAnswer ? h('div', { class: 'card' }, h('h3', null, 'Đáp án mẫu'), rich(s.snapshot.modelAnswer)) : null,
    sug.score != null ? h('div', { class: 'card' }, h('h3', null, `Gợi ý tự động: ${sug.score}/${sug.max}`), h('p', { class: 'muted' }, sug.method === 'rubric' ? 'Theo từ khoá trong tiêu chí chấm.' : `Theo độ phủ từ khoá của đáp án mẫu (${sug.coverage}%).`),
      ...(sug.details || []).map((d) => h('p', null, h('b', null, `${d.name}: ${d.got}/${d.points}`), d.missing.length ? h('span', { class: 'muted' }, ' — thiếu: ' + d.missing.join(', ')) : ' (đạt)'))) : null,
    h('div', { class: 'card stack' }, h('h3', null, 'Tự chấm'), h('div', { class: 'row' }, score, saveBtn), note),
    h('div', { class: 'card stack' }, h('h3', null, 'Chấm bằng AI'), s.ai ? h('div', null, h('p', null, h('b', null, `${s.ai.score}/${s.max}`), ' · ', s.ai.model), h('p', null, s.ai.feedback),
      s.ai.strengths.length ? h('p', null, h('b', null, 'Điểm mạnh: '), s.ai.strengths.join('; ')) : null, s.ai.weaknesses.length ? h('p', null, h('b', null, 'Cần cải thiện: '), s.ai.weaknesses.join('; ')) : null) : h('p', { class: 'muted' }, 'Cần lưu Gemini API key của bạn trong Cài đặt.'), aiBtn));
}
