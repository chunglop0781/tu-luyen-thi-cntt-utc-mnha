import { get, patch, post, del } from '../api.js';
import { h, action, toast, rich, fmtDate, fmtDur, pctClass, confirmBox } from '../ui.js';

export async function submissionPage(ctx, id) {
  let { submission: s } = await get(`/api/submissions/${id}`);
  let aiInfo = null;                       // nhà cung cấp/model + key nào đã có (dùng cho chấm AI tự luận và phân tích AI trắc nghiệm)
  try { const [{ providers }, { vault }] = await Promise.all([get('/api/ai/providers'), get('/api/me/vault')]); aiInfo = { providers, vault }; } catch { aiInfo = null; }
  const root = h('div', { class: 'stack' });
  const draw = () => root.replaceChildren(s.type === 'quiz' ? quizView(s, (n) => { s = n; draw(); }, aiInfo) : essayView(s, (n) => { s = n; draw(); }, aiInfo),
    h('div', { class: 'row' }, h('a', { class: 'btn', href: `#/${s.type}/${s.itemId}` }, 'Làm lại'), h('a', { class: 'btn ghost', href: '#/history' }, 'Lịch sử'),
      h('button', { class: 'btn ghost danger', onclick: async () => { if (await confirmBox('Xoá bài nộp này?')) { try { await del(`/api/submissions/${id}`); toast('Đã xoá', 'ok'); ctx.go('/history'); } catch (e) { toast(e.message, 'err'); } } } }, 'Xoá bài nộp')));
  draw();
  return root;
}

function quizView(s, set, aiInfo) {
  const pct = s.max ? Math.round((s.score / s.max) * 100) : 0;
  const byId = Object.fromEntries(s.results.map((r) => [r.id, r]));
  return h('div', { class: 'stack' },
    h('div', { class: 'card center' }, h('h2', null, s.title), h('div', { class: `bigscore ${pctClass(pct)}` }, `${s.score}/${s.max}`),
      h('p', null, `${s.correctCount}/${s.total} câu đúng · ${pct}% · ${fmtDur(s.durationSec)} · ${fmtDate(s.submittedAt)}`)),
    ...s.snapshot.map((q, i) => {
      const r = byId[q.id] || { chosen: [], ok: false };
      return h('div', { class: `card qcard ${r.ok ? 'right' : 'wrong'}`, id: `qc-${i + 1}` }, h('b', null, `Câu ${i + 1} ${r.ok ? '✅' : '❌'}`), ' ', rich(q.text),
        ...q.options.map((o) => {
          const isC = q.correct.includes(o.id), picked = r.chosen.includes(o.id);
          return h('div', { class: `opt-r ${isC ? 'is-correct' : ''} ${picked && !isC ? 'is-wrong' : ''}` }, h('b', null, o.id + '.'), rich(o.text), picked ? h('small', null, ' ← bạn chọn') : null, isC ? h('small', null, ' ✔') : null);
        }), q.explanation ? h('div', { class: 'expl' }, '💡 ', rich(q.explanation)) : null);
    }),
    ...(s.aiAnalyses || []).map((a, i) => analysisCard(a, i + 1, aiInfo)),
    aiAnalyzePanel(s, set, aiInfo));
}

function essayView(s, set, aiInfo) {
  const sug = s.suggestion || {};
  const score = h('input', { type: 'number', min: 0, max: s.max, step: '0.25', value: s.selfScore ?? '', placeholder: `0–${s.max}` });
  const note = h('textarea', { rows: 3, placeholder: 'Ghi chú sau khi đối chiếu (điểm yếu, cần ôn gì…)' }); note.value = s.note || '';
  const saveBtn = h('button', { class: 'btn primary' }, 'Lưu điểm tự chấm');
  saveBtn.addEventListener('click', action(saveBtn, async () => { const r = await patch(`/api/submissions/${s.id}`, { selfScore: score.value === '' ? null : Number(score.value), note: note.value }); toast('Đã lưu', 'ok'); set(r.submission); }));
  const aiPanel = aiGradePanel(s, set, aiInfo);
  return h('div', { class: 'stack' },
    h('div', { class: 'card center' }, h('h2', null, s.title), h('div', { class: `bigscore ${pctClass(s.score == null ? null : (s.score / s.max) * 100)}` }, s.score == null ? 'Chờ chấm' : `${s.score}/${s.max}`),
      h('p', { class: 'muted' }, `${fmtDate(s.submittedAt)} · ${fmtDur(s.durationSec)}`)),
    h('div', { class: 'card' }, h('h3', null, 'Đề bài'), rich(s.snapshot.prompt)),
    h('div', { class: 'card' }, h('h3', null, 'Bài làm của bạn'), h('div', { class: 'rich' }, s.text)),
    s.snapshot.modelAnswer ? h('div', { class: 'card' }, h('h3', null, 'Đáp án mẫu'), rich(s.snapshot.modelAnswer)) : null,
    sug.score != null ? h('div', { class: 'card' }, h('h3', null, `Gợi ý tự động: ${sug.score}/${sug.max}`), h('p', { class: 'muted' }, sug.method === 'rubric' ? 'Theo từ khoá trong tiêu chí chấm.' : `Theo độ phủ từ khoá của đáp án mẫu (${sug.coverage}%).`),
      ...(sug.details || []).map((d) => h('p', null, h('b', null, `${d.name}: ${d.got}/${d.points}`), d.missing.length ? h('span', { class: 'muted' }, ' — thiếu: ' + d.missing.join(', ')) : ' ✔'))) : null,
    h('div', { class: 'card stack' }, h('h3', null, 'Tự chấm'), h('div', { class: 'row' }, score, saveBtn), note),
    aiPanel);
}


/** Chấm bằng AI: chọn nhà cung cấp/model cho riêng lần này (mặc định theo Cài đặt). */
function aiGradePanel(s, set, info) {
  const lab = (p) => (info ? (info.providers.find((x) => x.id === p) || { label: p }).label : p);
  const result = s.ai ? h('div', null,
    h('p', null, h('b', null, `${s.ai.score}/${s.max}`), ' · ', `${s.ai.provider ? lab(s.ai.provider) + ' · ' : ''}${s.ai.model}`, s.ai.fallbackFrom ? h('small', { class: 'muted' }, ` (model ${s.ai.fallbackFrom} quá tải, đã tự chuyển)`) : null),
    h('p', null, s.ai.feedback),
    s.ai.strengths.length ? h('p', null, '👍 ', s.ai.strengths.join('; ')) : null, s.ai.weaknesses.length ? h('p', null, '⚠️ ', s.ai.weaknesses.join('; ')) : null) : null;
  const card = (...kids) => h('div', { class: 'card stack' }, h('h3', null, 'Chấm bằng AI'), result, ...kids);
  if (!info) return card(h('p', { class: 'muted' }, 'Không tải được cấu hình AI. Thử tải lại trang.'));
  const ready = info.providers.filter((p) => (info.vault.items[p.id] || {}).keySet);
  if (!ready.length) return card(h('p', { class: 'muted' }, 'Chưa có API key AI nào. ', h('a', { href: '#/settings' }, 'Vào Cài đặt → Kết nối AI'), ' để thêm (Gemini, vilao.ai, ChatGPT, DeepSeek, OpenRouter).'));

  let cur = ready.some((p) => p.id === info.vault.provider) ? info.vault.provider : ready[0].id;
  const row = h('div', { class: 'ai-pick' });
  const btn = h('button', { class: 'btn' }, '🤖 Chấm bằng AI');
  let provSel, modelEl;
  const drawPick = () => {
    const p = info.providers.find((x) => x.id === cur), saved = (info.vault.items[cur] || {}).model || '';
    provSel = h('select', { 'aria-label': 'Nhà cung cấp AI' }, ...ready.map((x) => h('option', { value: x.id, selected: x.id === cur }, x.label)));
    provSel.addEventListener('change', () => { cur = provSel.value; drawPick(); });
    if (p.allowCustomModel) modelEl = h('input', { list: 'ai-models-sub', value: saved, placeholder: `Model (mặc định: ${p.defaultModel})`, maxlength: 100, autocomplete: 'off', 'aria-label': 'Model' });
    else modelEl = h('select', { 'aria-label': 'Model' }, h('option', { value: '', selected: !saved }, `Model mặc định (${p.defaultModel})`), ...p.models.map((m) => h('option', { value: m, selected: m === saved }, m)));
    row.replaceChildren(provSel, modelEl, p.allowCustomModel ? h('datalist', { id: 'ai-models-sub' }, ...p.models.map((m) => h('option', { value: m }))) : null, btn);
  };
  drawPick();
  btn.addEventListener('click', action(btn, async () => {
    const r = await post(`/api/submissions/${s.id}/ai-grade`, { provider: cur, model: (modelEl.value || '').trim() || undefined }, { timeout: 70000 });
    toast('AI đã chấm xong', 'ok'); set(r.submission);
  }));
  return card(row, h('p', { class: 'muted' }, s.ai ? 'Chấm lại sẽ ghi đè kết quả AI trước đó.' : 'Mặc định dùng nhà cung cấp/model trong Cài đặt; chọn khác nếu muốn thử.'));
}


// ───────── Phân tích AI cho trắc nghiệm ─────────
const chips = (nums) => (nums || []).map((n) => h('a', { class: 'chip', title: `Tới câu ${n}`, onclick: () => {
  const el = document.getElementById(`qc-${n}`); if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1800);
} }, `Câu ${n}`));

function analysisCard(a, no, info) {
  const lab = (p) => (info ? (info.providers.find((x) => x.id === p) || { label: p }).label : p);
  const r = a.result || {};
  return h('div', { class: 'card an stack' },
    h('h3', null, `🤖 Phân tích AI #${no}`),
    h('div', { class: 'muted' }, h('span', { class: 'tag' }, `${a.provider ? lab(a.provider) + ' · ' : ''}${a.model}`), a.at ? fmtDate(a.at) : '', a.fallbackFrom ? ` · model ${a.fallbackFrom} quá tải, đã tự chuyển` : ''),
    r.summary ? h('div', null, h('h4', null, 'Tổng quan'), h('div', { class: 'sum' }, r.summary)) : null,
    (r.weakTopics || []).length ? h('div', null, h('h4', null, `📚 Chủ đề cần ôn (${r.weakTopics.length})`),
      ...r.weakTopics.map((t) => h('div', { class: 'item' }, h('b', null, t.topic), t.wrongCount != null ? h('span', { class: 'muted' }, ` — sai ${t.wrongCount} câu`) : null,
        t.advice ? h('p', null, t.advice) : null, h('div', null, chips(t.questions))))) : null,
    (r.mistakes || []).length ? h('div', null, h('h4', null, '📝 Phân tích từng câu sai'),
      ...r.mistakes.map((m) => h('div', { class: 'item' }, h('div', null, chips([m.q])),
        m.why ? h('p', null, h('b', null, 'Vì sao sai: '), h('span', { class: 'why' }, m.why)) : null,
        m.correctReasoning ? h('p', null, h('b', null, 'Cách nghĩ đúng: '), h('span', { class: 'ok' }, m.correctReasoning)) : null,
        m.tip ? h('p', null, h('b', null, 'Mẹo: '), m.tip) : null))) : null,
    (r.studyPlan || []).length ? h('div', null, h('h4', null, '🗓️ Kế hoạch ôn tập'), h('ul', null, ...r.studyPlan.map((x) => h('li', null, x)))) : null);
}

const MAX_ANALYSES = 5;
function aiAnalyzePanel(s, set, info) {
  const used = (s.aiAnalyses || []).length;
  const card = (...kids) => h('div', { class: 'card stack' }, h('h3', null, 'Phân tích AI'), ...kids);
  if (!info) return card(h('p', { class: 'muted' }, 'Không tải được cấu hình AI. Thử tải lại trang.'));
  const ready = info.providers.filter((p) => (info.vault.items[p.id] || {}).keySet);
  if (!ready.length) return card(h('p', { class: 'muted' }, 'Chưa có API key AI nào. ', h('a', { href: '#/settings' }, 'Vào Cài đặt → Kết nối AI'), ' để thêm (Gemini, vilao.ai, ChatGPT, DeepSeek, OpenRouter).'));
  if (used >= MAX_ANALYSES) return card(h('p', { class: 'muted' }, `Đã dùng hết ${MAX_ANALYSES} lần phân tích cho bài nộp này.`));

  let cur = ready.some((p) => p.id === info.vault.provider) ? info.vault.provider : ready[0].id;
  const row = h('div', { class: 'ai-pick' });
  const btn = h('button', { class: 'btn' }, '🤖 Phân tích AI');
  let provSel, modelEl;
  const drawPick = () => {
    const p = info.providers.find((x) => x.id === cur), saved = (info.vault.items[cur] || {}).model || '';
    provSel = h('select', { 'aria-label': 'Nhà cung cấp AI' }, ...ready.map((x) => h('option', { value: x.id, selected: x.id === cur }, x.label)));
    provSel.addEventListener('change', () => { cur = provSel.value; drawPick(); });
    if (p.allowCustomModel) modelEl = h('input', { list: 'ai-models-an', value: saved, placeholder: `Model (mặc định: ${p.defaultModel})`, maxlength: 100, autocomplete: 'off', 'aria-label': 'Model' });
    else modelEl = h('select', { 'aria-label': 'Model' }, h('option', { value: '', selected: !saved }, `Model mặc định (${p.defaultModel})`), ...p.models.map((m) => h('option', { value: m, selected: m === saved }, m)));
    row.replaceChildren(provSel, modelEl, p.allowCustomModel ? h('datalist', { id: 'ai-models-an' }, ...p.models.map((m) => h('option', { value: m }))) : null, btn);
  };
  drawPick();
  btn.addEventListener('click', action(btn, async () => {
    const r = await post(`/api/submissions/${s.id}/ai-analyze`, { provider: cur, model: (modelEl.value || '').trim() || undefined }, { timeout: 70000 });
    toast('AI đã phân tích xong', 'ok'); set(r.submission);
    setTimeout(() => { const cards = document.querySelectorAll('.card.an'); if (cards.length) cards[cards.length - 1].scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 50);
  }));
  return card(row, h('p', { class: 'muted' }, `AI chỉ ra chủ đề hay sai, giải thích từng câu sai và gợi ý kế hoạch ôn. Đã dùng ${used}/${MAX_ANALYSES} lần cho bài nộp này.`));
}
