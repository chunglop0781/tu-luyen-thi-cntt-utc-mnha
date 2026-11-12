import { h, rich, safeHtml } from '../ui.js';

/* Khối kết quả trắc nghiệm — chuyển NGUYÊN từ mixin renderQuizResult (views/partials/quiz-result.pug) của luyen-thi:
   ① Kết quả (điểm, chip Đúng/Sai/Chưa làm) → Bản đồ câu hỏi + bộ lọc → 🎧 bài nghe → ② từng phần: câu hỏi, đáp án, giải thích.
   Giao diện: css/quiz-result.css (chép nguyên các khối <style> của bản cũ). Dữ liệu (snapshot/result) cùng cấu trúc với bản cũ. */
const PART_KEYS = ['mcq', 'tf', 'fill'];
const PART_TITLE = { mcq: 'Phần 1 — Trắc nghiệm', tf: 'Phần 2 — Đúng/Sai', fill: 'Phần 3 — Điền đáp án' };
const ST = { correct: { icon: '✔', text: 'Đúng' }, wrong: { icon: '✘', text: 'Sai' }, partial: { icon: '◐', text: 'Đúng một phần' }, blank: { icon: '○', text: 'Chưa làm' } };
const fmt = (n) => (n == null || isNaN(Number(n)) ? '' : String(Math.round(Number(n) * 100) / 100).replace('.', ','));
const isBlank = (v) => v == null || v === '' || (Array.isArray(v) && !v.length);
const tfText = (v) => (v === true || v === 'true' ? 'Đúng' : v === false || v === 'false' ? 'Sai' : '(bỏ trống)');
/** "\n" (2 ký tự) và <br> = xuống dòng, trừ lệnh LaTeX bắt đầu bằng \n (\neq, \nu…). */
const brk = (s) => String(s == null ? '' : s).replace(/<br\s*\/?>/gi, '\n').replace(/(?<!\\)\\n(?![A-Za-z])/g, '\n');
/** Văn bản thường: <b>…</b> → chữ đỏ đậm (q-hl), còn lại hiển thị nguyên văn (không XSS). Có [img:…] → dùng rich(). */
function hl(text) {
  const t = brk(text);
  if (/\[img:/.test(t)) return rich(t);
  const box = h('span', { style: 'white-space:pre-line' });
  const re = /<(b|strong)>([\s\S]*?)<\/\1>/gi; let last = 0, m;
  while ((m = re.exec(t))) { if (m.index > last) box.append(t.slice(last, m.index)); box.append(h('span', { class: 'q-hl' }, m[2])); last = re.lastIndex; }
  if (last < t.length) box.append(t.slice(last));
  return box;
}
const expl = (html) => safeHtml(html);
const imgOf = (src) => (src ? (/^\[img:/.test(src) ? rich(src) : h('img', { class: 'qr-img', src, loading: 'lazy', referrerpolicy: 'no-referrer' })) : null);

export function renderQuizResult(s) {
  const quiz = s.snapshot || { parts: {} }, result = s.result || { parts: {}, items: [] };
  const itemById = Object.fromEntries((result.items || []).map((x) => [x.id, x]));
  const tfById = Object.fromEntries((result.tfQuestions || []).map((x) => [x.id, x]));
  const entries = [], meta = {}; let no = 0;
  for (const pk of PART_KEYS) {
    const p = quiz.parts && quiz.parts[pk]; if (!p || !p.questions) continue;
    for (const q of p.questions) {
      no++; let status = 'blank', earned = null, pts = p.pointsPerQuestion != null ? Number(p.pointsPerQuestion) : null;
      if (pk === 'tf') {
        const sts = q.statements || [], sItems = sts.map((x) => itemById[x.id] || {});
        const k = sItems.filter((x) => x.correct).length, allBlank = sItems.length > 0 && sItems.every((x) => isBlank(x.studentAnswer));
        status = sts.length && k === sts.length ? 'correct' : allBlank ? 'blank' : k > 0 ? 'partial' : 'wrong';
        const tq = tfById[q.id]; if (tq) { earned = tq.earned; pts = tq.points; }
      } else {
        const it = itemById[q.id] || {}; status = it.correct ? 'correct' : isBlank(it.studentAnswer) ? 'blank' : 'wrong';
        if (it.earned != null) earned = it.earned;
      }
      meta[q.id] = { no, status, earned, points: pts }; entries.push({ id: q.id, no, status });
    }
  }
  const cnt = { correct: 0, wrong: 0, partial: 0, blank: 0 }; entries.forEach((e) => { cnt[e.status]++; });
  const total = entries.length, answered = total - cnt.blank;
  const root = h('div');

  // ① Tổng quan
  root.append(h('div', { class: 'qr-card' },
    h('div', { class: 'qr-title' }, 'Kết quả'),
    h('div', { class: 'qr-score' }, 'Điểm: ', h('b', null, String(result.score)), ` / ${result.maxScore}`),
    h('div', { class: 'qr-sub' }, `Đúng ${result.correctCount}/${result.totalCount} · Đã làm ${answered}/${total} câu`),
    ...PART_KEYS.map((pk) => { const ps = result.parts && result.parts[pk]; return ps ? h('div', { class: 'qr-sub' }, `${PART_TITLE[pk]}: ${ps.correct}/${ps.total} ${pk === 'tf' ? 'ý' : 'câu'} (${ps.earned}/${ps.points} điểm)`) : null; }),
    h('div', { class: 'qr-chips' },
      h('span', { class: 'qr-chip qr-correct' }, `✔ Đúng: ${cnt.correct}`), h('span', { class: 'qr-chip qr-wrong' }, `✘ Sai: ${cnt.wrong}`),
      cnt.partial ? h('span', { class: 'qr-chip qr-partial' }, `◐ Đúng một phần: ${cnt.partial}`) : null, h('span', { class: 'qr-chip qr-blank' }, `○ Chưa làm: ${cnt.blank}`))));

  // Bản đồ câu hỏi + bộ lọc
  const jump = (id) => { const el = document.getElementById(`review-${id}`); if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'start' }); } };
  const fbtns = [];
  const apply = (f) => {
    fbtns.forEach((b) => b.classList.toggle('active', b.dataset.filter === f));
    root.querySelectorAll('.qr-q').forEach((c) => { const st = c.dataset.status; c.style.display = f === 'all' || (f === 'wrong' ? st === 'wrong' || st === 'partial' : st === f) ? '' : 'none'; });
    root.querySelectorAll('.qr-cluster').forEach((c) => { c.style.display = f === 'all' ? '' : 'none'; });
  };
  root.showAll = () => apply('all');
  const fb = (f, label) => { const b = h('button', { class: `qr-fbtn${f === 'all' ? ' active' : ''}`, type: 'button', 'data-filter': f, onclick: () => apply(f) }, label); fbtns.push(b); return b; };
  if (entries.length) root.append(h('div', { class: 'qr-card' },
    h('div', { class: 'qr-title' }, 'Bản đồ câu hỏi'), h('div', { class: 'qr-sub' }, 'Bấm số câu để nhảy tới phần đáp án và giải thích.'),
    h('div', { class: 'qr-grid' }, entries.map((e) => h('a', { class: `qr-cell qr-${e.status}`, href: `#review-${e.id}`, title: `Câu ${e.no} — ${ST[e.status].text}`, onclick: (ev) => { ev.preventDefault(); apply('all'); jump(e.id); } }, String(e.no)))),
    h('div', { class: 'qr-filter' }, fb('all', `Tất cả (${total})`), fb('wrong', `Sai / một phần (${cnt.wrong + cnt.partial})`), fb('blank', `Chưa làm (${cnt.blank})`), fb('correct', `Đúng (${cnt.correct})`))));

  // 🎧 Bài nghe
  if (typeof quiz.audioUrl === 'string' && /^https:\/\//.test(quiz.audioUrl)) root.append(h('div', { class: 'qr-card' }, h('div', { class: 'qr-title' }, '🎧 Bài nghe'), h('audio', { controls: true, preload: 'metadata', src: quiz.audioUrl, style: 'width:100%' })));

  // ② Đề + bài làm + đáp án + giải thích
  for (const pk of PART_KEYS) {
    const p = quiz.parts && quiz.parts[pk]; if (!p || !p.questions || !p.questions.length) continue;
    const sec = h('section', null, h('h3', { class: 'qr-part-title' }, PART_TITLE[pk]));
    if (pk === 'fill' && p.note) sec.append(h('div', { class: 'qr-sub', style: 'font-style:italic;margin-bottom:8px' }, p.note));
    const clMap = Object.fromEntries((p.clusters || []).map((c) => [c.id, c]));
    p.questions.forEach((q, qi) => {
      const cl = q.clusterId ? clMap[q.clusterId] : null;
      if (cl && (qi === 0 || p.questions[qi - 1].clusterId !== q.clusterId)) {
        const nos = (cl.questionIds || []).map((id) => (meta[id] ? meta[id].no : id)).join(', ');
        sec.append(h('div', { class: 'qr-cluster' }, h('div', { class: 'qr-cluster-title' }, `📖 Dữ kiện dùng chung cho câu ${nos}`), cl.text ? h('div', { style: 'white-space:pre-line' }, hl(cl.text)) : null, imgOf(cl.image)));
      }
      const m = meta[q.id] || { no: '?', status: 'blank', earned: null, points: null }, stt = ST[m.status];
      const art = h('article', { class: `qr-q qr-${m.status}`, id: `review-${q.id}`, 'data-status': m.status },
        h('div', { class: 'qr-q-head' }, h('span', { class: 'qr-q-no', id: `qc-${m.no}` }, `Câu ${m.no}`), h('span', { class: `qr-badge qr-b-${m.status}` }, `${stt.icon} ${stt.text}`),
          m.points != null && m.earned != null ? h('span', { class: 'qr-q-pts' }, `${fmt(m.earned)}/${fmt(m.points)} điểm`) : null),
        h('div', { class: 'qr-q-text' }, hl(q.text)), imgOf(q.image));
      if (pk === 'mcq') {
        const it = itemById[q.id] || {}, chosenArr = Array.isArray(it.studentAnswer) ? it.studentAnswer : isBlank(it.studentAnswer) ? [] : [it.studentAnswer];
        if (q.multi) art.append(h('div', { class: 'qr-sub', style: 'margin-bottom:4px' }, '(Chọn nhiều đáp án — phải chọn đủ và không thừa)'));
        for (const o of q.options || []) {
          const chosen = chosenArr.includes(o.key), isC = (q.correct || []).includes(o.key);
          art.append(h('div', { class: `qr-opt ${isC ? 'is-correct' : ''}${chosen && !isC ? ' is-wrong' : ''}` }, h('span', { class: 'qr-opt-key' }, o.key + '.'), h('span', { class: 'qr-opt-text' }, hl(o.text)),
            chosen ? h('span', { class: 'qr-tag qr-tag-you' }, 'Bạn chọn') : null, isC ? h('span', { class: 'qr-tag qr-tag-ok' }, '✔ Đáp án đúng') : null));
        }
        if (m.status === 'blank') art.append(h('div', { class: 'qr-note' }, 'Bạn chưa chọn đáp án. Đáp án đúng: ', h('b', null, (q.correct || []).join(', '))));
      } else if (pk === 'tf') {
        const sts = q.statements || [], kOk = sts.filter((x) => (itemById[x.id] || {}).correct).length;
        sts.forEach((st, si) => {
          const sit = itemById[st.id] || {}, sStat = sit.correct ? 'correct' : isBlank(sit.studentAnswer) ? 'blank' : 'wrong', lab = String.fromCharCode(97 + si);
          art.append(h('div', { class: `qr-st qr-st-${sStat}`, id: `review-${st.id}` },
            h('div', { class: 'qr-st-main' }, h('span', { class: 'qr-st-key' }, lab + ')'), h('span', { class: 'qr-st-text' }, hl(st.text)), h('span', { class: `qr-badge qr-b-${sStat}` }, `${ST[sStat].icon} ${ST[sStat].text}`)),
            h('div', { class: 'qr-st-ans' }, 'Bạn chọn: ', h('b', null, tfText(sit.studentAnswer)), ' — Đáp án: ', h('b', { class: 'qr-ok' }, tfText(st.correct))),
            st.explanationHtml ? h('div', { class: 'qr-exp' }, h('b', null, `💡 Giải thích ý ${lab}:`), h('div', { class: 'qr-exp-body' }, expl(st.explanationHtml))) : null));
        });
        art.append(h('div', { class: 'qr-note' }, `Đúng ${kOk}/${sts.length} ý`, m.earned != null && m.points != null ? ` → ${fmt(m.earned)}/${fmt(m.points)} điểm` : ''));
      } else {
        const fit = itemById[q.id] || {};
        art.append(h('div', { class: 'qr-fill' }, h('div', null, 'Bạn điền: ', h('b', null, isBlank(fit.studentAnswer) ? '(bỏ trống)' : String(fit.studentAnswer))), h('div', null, 'Đáp án chấp nhận: ', h('b', { class: 'qr-ok' }, (q.answers || []).join(' | ')))));
      }
      const tfHasExp = pk === 'tf' && (q.statements || []).some((x) => x.explanationHtml);
      if (q.explanationHtml) art.append(h('div', { class: 'qr-exp' }, h('b', null, '💡 Giải thích:'), h('div', { class: 'qr-exp-body' }, expl(q.explanationHtml))));
      else if (!tfHasExp) art.append(h('div', { class: 'qr-exp qr-exp-empty' }, 'Câu này chưa có giải thích.'));
      sec.append(art);
    });
    root.append(sec);
  }
  if (window.MathJax && window.MathJax.typesetPromise) setTimeout(() => window.MathJax.typesetPromise([root]).catch(() => {}), 0);
  return root;
}
