import { get, patch, post, del, imageCtx } from '../api.js';
import { h, action, toast, rich, fmtDate, fmtDur, pctClass, confirmBox, safeHtml, richOrHtml } from '../ui.js';
import { aiTitle, pickerAttrs, enhancePickers, modelSelect } from '../aiName.js';

export async function submissionPage(ctx, id) {
  let { submission: s } = await get(`/api/submissions/${id}`);
  if (s.shareId) imageCtx.share = s.shareId;      // bài làm từ đề được chia sẻ: ảnh trong đề tải qua link chia sẻ
  let aiInfo = null;                       // nhà cung cấp/model + key nào đã có (dùng cho chấm AI tự luận và phân tích AI trắc nghiệm)
  try { const [{ providers }, { vault }] = await Promise.all([get('/api/ai/providers'), get('/api/me/vault')]); aiInfo = { providers, vault }; } catch { aiInfo = null; }
  const root = h('div', { class: 'stack' });
  const draw = () => root.replaceChildren(s.type === 'quiz' ? quizView(s, (n) => { s = n; draw(); }, aiInfo) : s.type === 'flashcard' ? flashcardView(s) : essayView(s, (n) => { s = n; draw(); }, aiInfo),
    h('div', { class: 'row' }, h('a', { class: 'btn', href: s.shareId ? `#/s/${s.shareId}/play` : `#/${s.type}/${s.itemId}` }, 'Làm lại'), s.shareId ? h('a', { class: 'btn', href: `#/s/${s.shareId}/history` }, '📊 Biểu đồ điểm của nhóm') : null, h('a', { class: 'btn ghost', href: '#/history' }, 'Lịch sử'),
      s.shareId ? h('span', { class: 'muted', title: 'Bài nộp từ link chia sẻ đã nằm trong biểu đồ chung nên không xoá được' }, '🔒 Không xoá được (bài chia sẻ)')
        : h('button', { class: 'btn ghost danger', onclick: async () => { if (await confirmBox('Xoá bài nộp này?')) { try { await del(`/api/submissions/${id}`); toast('Đã xoá', 'ok'); ctx.go('/history'); } catch (e) { toast(e.message, 'err'); } } } }, 'Xoá bài nộp')));
  draw();
  return root;
}


function flashcardView(s) {
  const pct = s.max ? Math.round((s.score / s.max) * 100) : 0;
  const cards = (s.snapshot && s.snapshot.cards) || [];
  return h('div', { class: 'stack' },
    h('div', { class: 'card center' }, h('h2', null, s.title),
      h('div', { class: `bigscore ${pctClass(pct)}` }, `${s.score}/${s.max}`),
      h('p', { class: 'muted' }, `${s.correctCount}/${s.total} đúng · ${pct}% · ${fmtDate(s.submittedAt)} · ${fmtDur(s.durationSec)}`)),
    h('div', { class: 'card' }, h('h3', null, 'Bộ flashcard đã làm'),
      cards.length ? cards.map((c, i) => h('div', { class: 'subrow' }, h('span', { class: 'badge flashcard' }, `Thẻ ${i + 1}`), h('span', { class: 'grow' }, c.front), h('span', { class: 'muted' }, c.back))) : h('p', { class: 'muted' }, 'Không có dữ liệu thẻ trong bản lưu.'))
  );
}

const PART_TITLES = { mcq: 'Phần 1 · Trắc nghiệm nhiều đáp án', tf: 'Phần 2 · Đúng / Sai', fill: 'Phần 3 · Điền số liệu / đáp án' };
const tfWord = (v) => (v === true ? 'Đúng' : v === false ? 'Sai' : 'Bỏ trống');
const expl = (html) => (html ? h('div', { class: 'expl' }, '💡 ', safeHtml(html)) : null);
const imgOf = (src) => (src ? (/^\[img:/.test(src) ? rich(src) : null) : null);

/** Kết quả đề 3 phần (đáp án đúng/sai từng câu, từng ý Đúng-Sai, ô điền) — cùng cách đánh số "Câu N" với màn làm bài và phân tích AI. */
function quizView(s, set, aiInfo) {
  const res = s.result || { items: [], parts: {} };
  const pct = s.max ? Math.round((s.score / s.max) * 100) : 0;
  const items = Object.fromEntries((res.items || []).map((r) => [r.id, r]));
  const parts = (s.snapshot && s.snapshot.parts) || {};
  const cards = []; let n = 0;
  for (const k of ['mcq', 'tf', 'fill']) {
    const p = parts[k]; if (!p || !p.questions.length) continue;
    const ps = (res.parts || {})[k];
    cards.push(h('h3', null, PART_TITLES[k], ps ? h('small', { class: 'muted' }, ` — ${ps.correct}/${ps.total} đúng · ${ps.earned}/${ps.points} điểm`) : null));
    const clusters = Object.fromEntries((p.clusters || []).map((c) => [c.id, c])); let lastCl = null;
    for (const q of p.questions) {
      n++;
      if (q.clusterId && q.clusterId !== lastCl && clusters[q.clusterId]) cards.push(h('div', { class: 'card rubric' }, h('b', null, 'Dữ kiện chung'), safeHtml(clusters[q.clusterId].text), imgOf(clusters[q.clusterId].image)));
      lastCl = q.clusterId || null;
      const it = items[q.id] || {};
      let body, ok;
      if (k === 'mcq') {
        const chosen = Array.isArray(it.studentAnswer) ? it.studentAnswer : []; ok = !!it.correct;
        body = [...q.options.map((o) => { const isC = (q.correct || []).includes(o.key), picked = chosen.includes(o.key);
          return h('div', { class: `opt-r ${isC ? 'is-correct' : ''} ${picked && !isC ? 'is-wrong' : ''}` }, h('b', null, o.key + '.'), ' ', rich(o.text), picked ? h('small', null, ' ← bạn chọn') : null, isC ? h('small', null, ' ✔') : null); }), expl(q.explanationHtml)];
      } else if (k === 'tf') {
        const sts = q.statements.map((st) => ({ st, r: items[st.id] || {} })); ok = sts.every((x) => x.r.correct);
        body = sts.map(({ st, r }) => h('div', { class: `opt-r ${r.correct ? 'is-correct' : 'is-wrong'}` }, rich(st.text), h('small', null, ` — đáp án: ${tfWord(st.correct)} · bạn chọn: ${tfWord(r.studentAnswer)} ${r.correct ? '✔' : '✘'}`), expl(st.explanationHtml)));
      } else {
        ok = !!it.correct;
        body = [h('div', { class: `opt-r ${ok ? 'is-correct' : 'is-wrong'}` }, h('b', null, 'Bạn điền: '), it.studentAnswer || '(bỏ trống)', ok ? ' ✔' : null), ok ? null : h('div', { class: 'opt-r is-correct' }, h('b', null, 'Đáp án: '), (q.answers || []).join(' | ')), expl(q.explanationHtml)];
      }
      cards.push(h('div', { class: `card qcard ${ok ? 'right' : 'wrong'}`, id: `qc-${n}` }, h('b', null, `Câu ${n} ${ok ? '✅' : '❌'}`), ' ', rich(q.text), imgOf(q.image), ...body));
    }
  }
  const root = h('div', { class: 'stack' },
    h('div', { class: 'card center' }, h('h2', null, s.title), h('div', { class: `bigscore ${pctClass(pct)}` }, `${s.score}/${s.max}`),
      h('p', null, `${s.correctCount}/${s.total} đúng · ${pct}% · ${fmtDur(s.durationSec)} · ${fmtDate(s.submittedAt)}`)),
    ...cards, ...(s.aiAnalyses || []).map((a, i) => analysisCard(a, i + 1, aiInfo)), aiAnalyzePanel(s, set, aiInfo));
  if (window.MathJax && window.MathJax.typesetPromise) setTimeout(() => window.MathJax.typesetPromise([root]).catch(() => {}), 0);
  return root;
}

function essayView(s, set, aiInfo) {
  const sug = s.suggestion || {};
  const shared = !!s.shareId;                       // bài từ link chia sẻ: điểm chỉ do AI chấm (key của chính bạn), không tự nhập điểm
  const score = h('input', { type: 'number', min: 0, max: s.max, step: '0.25', value: s.selfScore ?? '', placeholder: `0–${s.max}` });
  const note = h('textarea', { rows: 3, placeholder: 'Ghi chú sau khi đối chiếu (điểm yếu, cần ôn gì…)' }); note.value = s.note || '';
  const saveBtn = h('button', { class: 'btn primary' }, s.shareId ? 'Lưu ghi chú' : 'Lưu điểm tự chấm');
  saveBtn.addEventListener('click', action(saveBtn, async () => { const r = await patch(`/api/submissions/${s.id}`, shared ? { note: note.value } : { selfScore: score.value === '' ? null : Number(score.value), note: note.value }); toast('Đã lưu', 'ok'); set(r.submission); }));
  const aiPanel = aiGradePanel(s, set, aiInfo);
  return h('div', { class: 'stack' },
    h('div', { class: 'card center' }, h('h2', null, s.title), h('div', { class: `bigscore ${pctClass(s.score == null ? null : (s.score / s.max) * 100)}` }, s.score == null ? (shared ? 'Chờ chấm AI' : 'Chờ chấm') : `${s.score}/${s.max}`),
      h('p', { class: 'muted' }, `${fmtDate(s.submittedAt)} · ${fmtDur(s.durationSec)}`)),
    h('div', { class: 'card' }, h('h3', null, 'Đề bài'), richOrHtml(s.snapshot.prompt)),
    h('div', { class: 'card' }, h('h3', null, 'Bài làm của bạn'), h('div', { class: 'rich' }, s.text)),
    s.snapshot.modelAnswer ? h('div', { class: 'card' }, h('h3', null, 'Đáp án mẫu'), richOrHtml(s.snapshot.modelAnswer)) : null,
    !shared && sug.score != null ? h('div', { class: 'card' }, h('h3', null, `Gợi ý tự động: ${sug.score}/${sug.max}`), h('p', { class: 'muted' }, sug.method === 'rubric' ? 'Theo từ khoá trong tiêu chí chấm.' : `Theo độ phủ từ khoá của đáp án mẫu (${sug.coverage}%).`),
      ...(sug.details || []).map((d) => h('p', null, h('b', null, `${d.name}: ${d.got}/${d.points}`), d.missing.length ? h('span', { class: 'muted' }, ' — thiếu: ' + d.missing.join(', ')) : ' ✔'))) : null,
    h('div', { class: 'card stack' }, h('h3', null, shared ? 'Ghi chú' : 'Tự chấm'), shared ? h('p', { class: 'muted' }, 'Bài làm từ link chia sẻ chỉ có điểm do AI chấm; điểm này sẽ lên biểu đồ chung.') : null, h('div', { class: 'row' }, shared ? null : score, saveBtn), note),
    aiPanel);
}


/** Chấm bằng AI: chọn nhà cung cấp/model cho riêng lần này (mặc định theo Cài đặt). */
function aiGradePanel(s, set, info) {
  const lab = (p) => (info ? (info.providers.find((x) => x.id === p) || { label: p }).label : p);
  const result = s.ai ? h('div', null,
    h('p', null, h('b', null, `${s.ai.score}/${s.max}`), ' · ', `${s.ai.keyName ? s.ai.keyName + ' — ' : ''}${s.ai.provider ? lab(s.ai.provider) + ' · ' : ''}${s.ai.model}`, s.ai.promptName ? ` · prompt “${s.ai.promptName}”` : '', s.ai.fallbackFrom ? h('small', { class: 'muted' }, ` (model ${s.ai.fallbackFrom} quá tải, đã tự chuyển)`) : null),
    h('p', null, s.ai.feedback),
    s.ai.strengths.length ? h('p', null, '👍 ', s.ai.strengths.join('; ')) : null, s.ai.weaknesses.length ? h('p', null, '⚠️ ', s.ai.weaknesses.join('; ')) : null) : null;
  const card = (...kids) => h('div', { class: 'card stack' }, h('h3', null, 'Chấm bằng AI'), result, ...kids);
  if (!info) return card(h('p', { class: 'muted' }, 'Không tải được cấu hình AI. Thử tải lại trang.'));
  const ready = info.providers.filter((p) => p.enabled !== false && (info.vault.items[p.id] || {}).keySet);
  if (s.shareId && s.ai) return card(h('p', { class: 'muted' }, 'Bài từ link chia sẻ chỉ được chấm AI một lần — điểm đã lên biểu đồ chung.'));
  if (!ready.length) return card(h('p', { class: 'muted' }, 'Chưa có API key AI nào. ', h('a', { href: '#/settings/ai' }, 'Vào Cài đặt → Nhà cung cấp AI'), ' để thêm nhà cung cấp và dán key.'));

  let cur = ready.some((p) => p.id === info.vault.provider) ? info.vault.provider : ready[0].id;
  const row = h('div', { class: 'ai-pick' });
  const btn = h('button', { class: 'btn', id: 'aiGradeBtn' }, '🤖 Chấm bằng AI');
  let provSel, modelEl;
  const drawPick = () => {
    const p = info.providers.find((x) => x.id === cur), saved = (info.vault.items[cur] || {}).model || '';
    provSel = h('select', { 'aria-label': 'AI', ...pickerAttrs('ai') }, ...ready.map((x) => h('option', { value: x.id, selected: x.id === cur }, aiTitle(x, info.vault.items[x.id]))));
    provSel.addEventListener('change', () => { cur = provSel.value; drawPick(); });
    modelEl = modelSelect(p, saved, { defaultLabel: `Model mặc định (${p.defaultModel})` });
    row.replaceChildren(provSel, modelEl, btn);
    enhancePickers(row);
  };
  drawPick();
  btn.addEventListener('click', action(btn, async () => {
    const r = await post(`/api/submissions/${s.id}/ai-grade`, { provider: cur, model: (modelEl.value || '').trim() || undefined }, { timeout: 70000 });
    toast('AI đã chấm xong', 'ok'); set(r.submission);
  }));
  return card(row, h('p', { class: 'muted' }, s.shareId ? 'Dùng API key của bạn. Chỉ chấm được MỘT lần — chọn nhà cung cấp/model rồi bấm chấm.' : s.ai ? 'Chấm lại sẽ ghi đè kết quả AI trước đó.' : 'Mặc định dùng nhà cung cấp/model trong Cài đặt; chọn khác nếu muốn thử.'));
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
    h('div', { class: 'muted' }, h('span', { class: 'tag' }, `${a.provider ? lab(a.provider) + ' · ' : ''}${a.model}`), a.promptName ? h('span', { class: 'tag' }, `prompt: ${a.promptName}`) : null, a.at ? fmtDate(a.at) : '', a.fallbackFrom ? ` · model ${a.fallbackFrom} quá tải, đã tự chuyển` : ''),
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
  const ready = info.providers.filter((p) => p.enabled !== false && (info.vault.items[p.id] || {}).keySet);
  if (!ready.length) return card(h('p', { class: 'muted' }, 'Chưa có API key AI nào. ', h('a', { href: '#/settings/ai' }, 'Vào Cài đặt → Nhà cung cấp AI'), ' để thêm nhà cung cấp và dán key.'));
  if (used >= MAX_ANALYSES) return card(h('p', { class: 'muted' }, `Đã dùng hết ${MAX_ANALYSES} lần phân tích cho bài nộp này.`));

  let cur = ready.some((p) => p.id === info.vault.provider) ? info.vault.provider : ready[0].id;
  const row = h('div', { class: 'ai-pick' });
  const btn = h('button', { class: 'btn' }, '🤖 Phân tích AI');
  let provSel, modelEl;
  const drawPick = () => {
    const p = info.providers.find((x) => x.id === cur), saved = (info.vault.items[cur] || {}).model || '';
    provSel = h('select', { 'aria-label': 'Nhà cung cấp AI' }, ...ready.map((x) => h('option', { value: x.id, selected: x.id === cur }, x.label)));
    provSel.addEventListener('change', () => { cur = provSel.value; drawPick(); });
    modelEl = modelSelect(p, saved, { defaultLabel: `Model mặc định (${p.defaultModel})` });
    row.replaceChildren(provSel, modelEl, btn);
  };
  drawPick();
  btn.addEventListener('click', action(btn, async () => {
    const r = await post(`/api/submissions/${s.id}/ai-analyze`, { provider: cur, model: (modelEl.value || '').trim() || undefined }, { timeout: 70000 });
    toast('AI đã phân tích xong', 'ok'); set(r.submission);
    setTimeout(() => { const cards = document.querySelectorAll('.card.an'); if (cards.length) cards[cards.length - 1].scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 50);
  }));
  return card(row, h('p', { class: 'muted' }, `AI chỉ ra chủ đề hay sai, giải thích từng câu sai và gợi ý kế hoạch ôn. Đã dùng ${used}/${MAX_ANALYSES} lần cho bài nộp này.`));
}
