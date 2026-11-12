import { get, patch, post, del, imageCtx } from '../api.js';
import { h, action, toast, rich, fmtDate, fmtDur, pctClass, confirmBox, safeHtml, richOrHtml } from '../ui.js';
import { aiTitle, pickerAttrs, enhancePickers, modelSelect } from '../aiName.js';
import { essayDetail } from './submissionDetail.js';
import { renderQuizResult } from './quizResult.js';

export async function submissionPage(ctx, id) {
  let { submission: s } = await get(`/api/submissions/${id}`);
  if (s.shareId) imageCtx.share = s.shareId;      // bài làm từ đề được chia sẻ: ảnh trong đề tải qua link chia sẻ
  let aiInfo = null;                       // nhà cung cấp/model + key nào đã có (dùng cho chấm AI tự luận và phân tích AI trắc nghiệm)
  try { const [{ providers }, { vault }] = await Promise.all([get('/api/ai/providers'), get('/api/me/vault')]); aiInfo = { providers, vault }; } catch { aiInfo = null; }
  const root = h('div', { class: 'stack' });
  const actions = () => {
    const sid = s.shareId || s.inShare || null;                // bài đã nằm trong lịch sử chia sẻ (qua link, hoặc chủ bài tự làm) → không xoá được
    return h('div', { class: s.type === 'essay' ? 'sd-actions' : 'row qr-actions' },
      h('a', { class: 'btn', href: s.shareId ? `#/s/${s.shareId}/play` : `#/${s.type}/${s.itemId}` }, 'Làm lại'),
      sid ? h('a', { class: 'btn', href: `#/s/${sid}/history` }, s.shareId ? '📊 Biểu đồ điểm của tôi' : '📊 Lịch sử của tất cả người làm') : null,
      h('a', { class: 'btn ghost', href: '#/history' }, 'Lịch sử'),
      sid ? h('span', { class: 'muted sd-lock', title: 'Bài đã nộp vào bài được chia sẻ nên điểm đã nằm trong lịch sử chung' }, '🔒 Không xoá được (bài chia sẻ)')
        : h('button', { class: 'btn ghost danger', onclick: async () => { if (await confirmBox('Xoá bài nộp này?')) { try { await del(`/api/submissions/${id}`); toast('Đã xoá', 'ok'); ctx.go('/history'); } catch (e) { toast(e.message, 'err'); } } } }, 'Xoá bài nộp'));
  };
  const draw = () => {
    const set = (n) => { s = n; draw(); };
    if (s.type === 'essay') {
      // Bài tự luận: giao diện CHÉP NGUYÊN trang bài nộp của luyen-thi (submissionDetail.js) + các khối thao tác của bản này (tự chấm, chấm AI).
      const sid = s.shareId || s.inShare || null;
      root.replaceChildren(h('div', { class: 'sd-page' },
        ...essayDetail(s, { backHref: sid ? `#/s/${sid}/history` : '#/history', backText: 'Quay lại danh sách' }),
        h('div', { class: 'sd-extra stack' }, ...essayExtras(s, set, aiInfo)), actions()));
    } else root.replaceChildren(s.type === 'quiz' ? quizView(s, set, aiInfo) : flashcardView(s), actions());
  };
  draw();
  return root;
}

/** #/s/<sid>/submission/<id> — CHỦ BÀI mở chi tiết bài nộp của người làm (chỉ đọc), như admin xem /submissions/<id> ở luyen-thi. */
export async function sharedSubmissionPage(ctx, sid, id) {
  imageCtx.share = sid;
  const { submission: s, student, mine } = await get(`/api/shares/${sid}/submissions/${id}`);
  const back = `#/s/${sid}/history`;
  if (s.type === 'essay') return h('div', { class: 'sd-page' }, ...essayDetail(s, { student, backHref: back, backText: 'Quay lại danh sách' }));
  const head = h('div', { class: 'row between' }, h('a', { href: back }, '← Quay lại danh sách'), h('span', { class: 'muted' }, `👤 ${student || '(không rõ tên)'} · chỉ đọc`));
  return h('div', { class: 'stack' }, head, s.type === 'quiz' ? quizView(s, () => {}, null, { readOnly: true }) : flashcardView(s));
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

/** Trang chi tiết bài nộp TRẮC NGHIỆM — bố cục chép từ views/student/quiz-submission-detail.pug (tiêu đề + môn → kết quả → bản đồ câu → đáp án) ở quizResult.js;
 *  khối phân tích AI của bản này (chọn AI / model, có kết quả bên dưới) nối thêm phía sau. */
function quizView(s, set, aiInfo, { readOnly = false } = {}) {
  const result = renderQuizResult(s);
  const ana = (s.aiAnalyses || []).slice().reverse();
  return h('div', { class: 'qr-page' },
    h('h1', { class: 'qr-h1' }, s.title), h('div', { class: 'qr-subj' }, s.subject || ''),
    result,
    ...(readOnly ? [] : [h('div', { class: 'qr-ai-wrap' }, aiAnalyzePanel(s, set, aiInfo)),
      ana.length ? h('div', { class: 'qr-card' }, h('div', { class: 'qr-title' }, '🤖 Phân tích AI'), ...ana.map((a) => analysisCard(a, aiInfo, result))) : null]));
}

/** Các khối THAO TÁC dưới trang chi tiết tự luận (bản luyen-thi chấm ở trang làm bài nên không có): gợi ý tự động, tự chấm / ghi chú, chấm bằng AI. */
function essayExtras(s, set, aiInfo) {
  const sug = s.suggestion || {};
  const shared = !!s.shareId;                       // bài từ link chia sẻ: điểm chỉ do AI chấm (key của chính bạn), không tự nhập điểm
  const score = h('input', { type: 'number', min: 0, max: s.max, step: '0.25', value: s.selfScore ?? '', placeholder: `0–${s.max}` });
  const note = h('textarea', { rows: 3, placeholder: 'Ghi chú sau khi đối chiếu (điểm yếu, cần ôn gì…)' }); note.value = s.note || '';
  const saveBtn = h('button', { class: 'btn primary' }, shared ? 'Lưu ghi chú' : 'Lưu điểm tự chấm');
  saveBtn.addEventListener('click', action(saveBtn, async () => { const r = await patch(`/api/submissions/${s.id}`, shared ? { note: note.value } : { selfScore: score.value === '' ? null : Number(score.value), note: note.value }); toast('Đã lưu', 'ok'); set(r.submission); }));
  return [
    !shared && sug.score != null ? h('div', { class: 'card' }, h('h3', null, `Gợi ý tự động: ${sug.score}/${sug.max}`), h('p', { class: 'muted' }, sug.method === 'rubric' ? 'Theo từ khoá trong tiêu chí chấm.' : `Theo độ phủ từ khoá của đáp án mẫu (${sug.coverage}%).`),
      ...(sug.details || []).map((d) => h('p', null, h('b', null, `${d.name}: ${d.got}/${d.points}`), d.missing.length ? h('span', { class: 'muted' }, ' — thiếu: ' + d.missing.join(', ')) : ' ✔'))) : null,
    h('div', { class: 'card stack' }, h('h3', null, shared ? 'Ghi chú' : 'Tự chấm'), shared ? h('p', { class: 'muted' }, 'Bài làm từ link chia sẻ chỉ có điểm do AI chấm; điểm này sẽ lên lịch sử chung.') : null, h('div', { class: 'row' }, shared ? null : score, saveBtn), note),
    aiGradePanel(s, set, aiInfo)];
}


/** Chấm bằng AI: chọn nhà cung cấp/model cho riêng lần này (mặc định theo Cài đặt). */
function aiGradePanel(s, set, info) {
  const lab = (p) => (info ? (info.providers.find((x) => x.id === p) || { label: p }).label : p);
  const result = s.ai ? h('div', null,
    h('p', null, h('b', null, `${s.ai.score}/${s.max}`), ' · ', `${s.ai.keyName ? s.ai.keyName + ' — ' : ''}${s.ai.provider ? lab(s.ai.provider) + ' · ' : ''}${s.ai.model}`, s.ai.promptName ? ` · prompt “${s.ai.promptName}”` : '', s.ai.fallbackFrom ? h('small', { class: 'muted' }, ` (model ${s.ai.fallbackFrom} quá tải, đã tự chuyển)`) : null),
  ) : null;
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


// ───────── Phân tích AI cho trắc nghiệm (giao diện .ai-* của quiz-result.pug) ─────────
const chips = (nums, result) => (nums || []).map((n) => h('a', { class: 'ai-qid', href: `#qc-${n}`, title: `Tới câu ${n}`, onclick: (e) => {
  e.preventDefault(); if (result && result.showAll) result.showAll();
  const el = document.getElementById(`qc-${n}`); if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
} }, `Câu ${n}`));

function analysisCard(a, info, result) {
  const lab = (p) => (info ? (info.providers.find((x) => x.id === p) || { label: p }).label : p);
  const r = a.result || {};
  return h('div', { class: 'ai-item' },
    h('div', { class: 'ai-head' }, h('span', { class: 'ai-chip' }, a.provider ? lab(a.provider) : 'AI'), a.model ? h('span', null, a.model) : null, a.at ? h('span', null, new Date(a.at).toLocaleString('vi-VN')) : null,
      a.promptName ? h('span', null, `Prompt: ${a.promptName}`) : null, a.fallbackFrom ? h('span', null, `model ${a.fallbackFrom} quá tải, đã tự chuyển`) : null),
    r.summary ? h('div', { class: 'ai-summary' }, r.summary) : null,
    (r.weakTopics || []).length ? [h('div', { class: 'ai-sec' }, '📚 Chủ đề cần ôn'),
      ...r.weakTopics.map((t) => { const wc = (t.questions || []).length || t.wrongCount;
        return h('div', { class: 'ai-topic' }, h('div', { class: 'ai-topic-head' }, h('span', { class: 'ai-topic-name' }, t.topic), wc != null ? h('span', { class: 'ai-badge' }, `${wc} câu sai`) : null),
          (t.questions || []).length ? h('div', { class: 'ai-qids' }, chips(t.questions, result)) : null, t.advice ? h('div', { class: 'ai-advice' }, t.advice) : null); })] : null,
    (r.mistakes || []).length ? [h('div', { class: 'ai-sec' }, '🔍 Lỗi cụ thể'),
      ...r.mistakes.map((m) => h('div', { class: 'ai-mistake' }, chips([m.q], result), ` — ${m.why || ''}`,
        m.correctReasoning ? h('div', { class: 'ai-right' }, h('b', null, 'Đúng:'), ` ${m.correctReasoning}`) : null, m.tip ? h('div', { class: 'ai-tip' }, `💡 ${m.tip}`) : null))] : null,
    (r.studyPlan || []).length ? [h('div', { class: 'ai-sec' }, '🗺 Kế hoạch học'), h('ol', { class: 'ai-plan' }, ...r.studyPlan.map((x) => h('li', null, x)))] : null);
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
