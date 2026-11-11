import { get, put, post, uploadImage, newId, imageUrl, imageCtx } from '../api.js';
import { h, toast, spinner } from '../ui.js';
import { promptPicker } from './prompts.js';
import { mountQuizEditor } from '../../legacy/quizEditor.js';
import { mountQuizTake } from '../../legacy/quizTake.js';

/* Trang tạo / làm trắc nghiệm 3 phần — chuyển nguyên từ bản cũ luyen-thi-cntt-utc-mnha:
   views/admin/quiz-form.pug + public/js/quizEditor.js + css/quiz-form.css (tạo)
   views/student/quiz-lesson.pug + public/js/quizTake.js + css/quiz-exam.css (làm).
   Markup/CSS/JS giữ nguyên; chỉ thay chỗ gọi máy chủ bằng "cầu nối" (bridge) tới API của bản này. */

const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
const PART_TITLES = { mcq: 'Trắc nghiệm nhiều đáp án', tf: 'Đúng / Sai', fill: 'Điền số liệu / đáp án' };

/** Ảnh mã hoá: <img src="[img:ID]"> do mã cũ dựng → tự tải qua API (cần token) rồi thay bằng blob URL. */
function watchEncryptedImages(root) {
  const fix = (img) => {
    const m = /^\[img:([0-9]+\.[a-f0-9]{16,32})\]$/.exec(img.getAttribute('src') || '');
    if (!m) return;
    img.setAttribute('src', ''); img.removeAttribute('src');
    imageUrl(m[1]).then((u) => { img.src = u; }).catch(() => { img.alt = '[không tải được ảnh]'; });
  };
  const scan = (n) => { if (n.nodeType !== 1) return; if (n.tagName === 'IMG') fix(n); n.querySelectorAll && n.querySelectorAll('img').forEach(fix); };
  const mo = new MutationObserver((list) => { for (const r of list) { if (r.type === 'attributes') fix(r.target); else r.addedNodes.forEach(scan); } });
  mo.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['src'] });
  scan(root);
  return () => mo.disconnect();
}

/** Mã cũ dùng document.getElementById → chỉ chạy sau khi trang đã gắn vào DOM. */
function whenConnected(root, fn) { let n = 0; (function tick() { if (root.isConnected) fn(); else if (n++ < 200) requestAnimationFrame(tick); })(); }

const loadScript = (src) => new Promise((res, rej) => { const s = document.createElement('script'); s.src = src + '?v=' + Date.now(); s.onload = () => res(s); s.onerror = rej; document.body.appendChild(s); });

// ───────────────────────── TẠO / SỬA ─────────────────────────
function editorHtml(c) {
  const isEdit = c.mode === 'edit', q0 = c.item || {};
  const untimed = isEdit && q0.duration === null;
  const part = (k, t, hint) => `
    <div class="qf-part" id="part-${k}">
      <div class="qf-parthead"><h3>${t}</h3><span class="qf-msg" id="sum-${k}"></span><span class="qf-count" id="count-${k}">0 câu</span></div>
      <p class="qf-hint">${hint} Điểm / câu nhập được số thập phân (VD 0.1, 0.2, 0.25). Phần Đúng/Sai: điểm / câu là điểm tối đa của cả câu (mọi ý).</p>
      <div class="qf-partcfg">
        <label>Điểm / câu <input type="text" inputmode="decimal" autocomplete="off" id="ppq-${k}" value="${esc((q0.parts && q0.parts[k] && q0.parts[k].pointsPerQuestion) || c.cfg.defaults.ppq)}" placeholder="VD: 0.1 · 0.2 · 0.25 · 1"></label>
        ${k === 'tf' ? (() => { const sc = (q0.parts && q0.parts.tf && q0.parts.tf.scoring) || 'equal'; return `
        <div class="qf-wide qf-scoring"><span class="qf-scoring-title">Cách chia điểm phần Đúng/Sai</span>
          <div class="qf-opts">
            <label class="qf-opt"><input type="radio" name="scoring_tf" value="equal" ${sc === 'equal' ? 'checked' : ''}><span class="qf-opt-body"><strong class="qf-opt-name">Chia đều các ý</strong><span class="qf-opt-desc">Đúng k trên n ý thì được k/n × điểm/câu.</span></span></label>
            <label class="qf-opt"><input type="radio" name="scoring_tf" value="thptqg" ${sc === 'thptqg' ? 'checked' : ''}><span class="qf-opt-body"><strong class="qf-opt-name">THPTQG</strong><span class="qf-opt-rows"><span class="qf-opt-row">Đúng 1 ý<b>0.1 × điểm/câu</b></span><span class="qf-opt-row">Đúng 2 ý<b>0.25 × điểm/câu</b></span><span class="qf-opt-row">Đúng 3 ý<b>0.5 × điểm/câu</b></span><span class="qf-opt-row">Đúng 4 ý<b>điểm/câu</b></span></span></span></label>
          </div></div>`; })() : ''}
        ${k === 'fill' ? `
        <label>Sai số cho phép <input type="text" inputmode="decimal" autocomplete="off" id="tolerance" value="${esc((q0.parts && q0.parts.fill && q0.parts.fill.tolerance) || 0)}" placeholder="VD: 0 · 0.01 · 0.5"></label>
        <label class="qf-wide">Ghi chú hướng dẫn điền (không viết = không hiện) <input type="text" id="fillNote" maxlength="300" value="${esc((q0.parts && q0.parts.fill && q0.parts.fill.note) || '')}" placeholder="Làm tròn 2 chữ số thập phân, chỉ nhập số, không ghi đơn vị."></label>` : ''}
      </div>
      <textarea class="qf-paste" id="paste-${k}" rows="6" spellcheck="false" placeholder="Dán khối text AI tạo cho phần này… (để trống nếu không có phần này)"></textarea>
      <div class="qf-cards" id="cards-${k}"></div>
      <button type="button" class="qf-btn" data-add="${k}">＋ Thêm câu vào phần này</button>
    </div>`;
  return `
  <div class="qf">
    <div class="qf-top"><a href="#/" class="qf-back">← Bài của tôi</a><h1>${isEdit ? 'Sửa bài trắc nghiệm' : 'Tạo bài trắc nghiệm'}</h1>
      <p>Dán đề do AI tạo theo đúng định dạng → bấm “Chuyển” → sửa từng câu (đổi/xoá ảnh, đổi đáp án, giải thích) → Lưu.</p></div>
    ${isEdit && c.submissionCount ? `<div class="qf-alert warn">⚠️ Đã có ${c.submissionCount} bài nộp. Các bài đó giữ nguyên đề cũ (đã lưu snapshot), sửa đề không làm đổi điểm của chúng.</div>` : ''}
    <div id="qfErrors" class="qf-alert err" hidden></div><div id="qfOk" class="qf-alert ok" hidden></div><div id="qfImgNeed" class="qf-alert warn" hidden></div>
    <section class="qf-card"><h2>1. Thông tin chung</h2>
      <div class="qf-grid">
        <div class="qf-field"><label for="fSubject">Môn / chủ đề</label><input id="fSubject" type="text" list="qfSubjects" maxlength="60" value="${esc(q0.subject || '')}" placeholder="VD: Mạng máy tính"><datalist id="qfSubjects">${c.subjects.map((s) => `<option value="${esc(s)}"></option>`).join('')}</datalist></div>
        <div class="qf-field"><label for="fTitle">Tiêu đề bài</label><input id="fTitle" type="text" maxlength="200" value="${esc(q0.title || '')}" placeholder="Kiểm tra chương 1"></div>
        <div class="qf-field"><label for="fMax">Thang điểm tối đa</label><input id="fMax" type="text" inputmode="decimal" autocomplete="off" value="${esc(q0.maxScore || c.cfg.defaults.maxScore)}" placeholder="VD: 10 hoặc 2.5"><small>Có thể nhập số thập phân (VD 10, 2.5, 0.5).</small></div>
        <div class="qf-field"><label>⏱ Thời gian làm bài</label>
          <div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:6px">
            <label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer"><input type="radio" name="fTimerMode" value="timed" ${untimed ? '' : 'checked'}><span>Đếm giờ</span></label>
            <label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer"><input type="radio" name="fTimerMode" value="untimed" ${untimed ? 'checked' : ''}><span>Không đếm giờ</span></label></div>
          <input id="fDuration" type="number" min="1" max="600" step="1" value="${esc(q0.duration || c.cfg.defaults.duration)}" placeholder="20" ${untimed ? 'disabled' : ''}>
          <small>Đếm giờ: số phút dùng để đếm ngược ở trang làm bài (mặc định 20). Không đếm giờ: làm bài không giới hạn thời gian.</small></div>
        <div class="qf-field"><label>🔀 Xáo trộn</label><label style="display:inline-flex;align-items:center;gap:8px;cursor:pointer"><input type="checkbox" id="fShuffle" ${q0.shuffle ? 'checked' : ''}><span>Xáo trộn thứ tự câu hỏi mỗi lần làm (câu hỏi chùm đi liền nhau)</span></label></div>
      </div>
      <div class="qf-field"><label for="fDesc">Mô tả / hướng dẫn chung (tuỳ chọn, HTML ngắn)</label><textarea id="fDesc" rows="3" placeholder="Ví dụ: Thời gian 45 phút, không dùng tài liệu.">${esc(q0.contentHtml || '')}</textarea></div>
      <div class="qf-field qf-audio"><label for="fAudio">🎧 Audio cho bài (tuỳ chọn — bài nghe)</label>
        <input id="fAudio" type="text" autocomplete="off" spellcheck="false" value="${esc(q0.audioUrl || '')}" placeholder="https://raw.githubusercontent.com/<user>/<repo>/main/audio/bai-nghe-1.mp3">
        <small>Để trống = bài không có audio. Chấp nhận .mp3 .wav .ogg .m4a .aac .opus.</small>
        <div id="audioWarn" class="qf-audio-warn" hidden></div><audio id="audioPrev" class="qf-audio-prev" controls preload="metadata" hidden></audio>
        <details class="qf-audio-help"><summary>Cách đưa file audio lên GitHub &amp; lấy link</summary><ol>
          <li>Vào repo GitHub (nên là repo <b>public</b>) → <b>Add file → Upload files</b> → chọn file audio (up qua web tối đa 25 MB/file) → <b>Commit</b>.</li>
          <li>Mở file vừa up → bấm <b>View raw</b> / <b>Download raw file</b> → copy link trên thanh địa chỉ (dạng <code>https://raw.githubusercontent.com/…</code>).</li>
          <li>Dán vào ô trên. Dán link dạng <code>github.com/…/blob/…</code> cũng được — tự đổi sang link raw. Nghe thử bằng player bên dưới trước khi lưu.</li></ol></details></div>
    </section>
    <section class="qf-card"><h2>2. Prompt mẫu nhờ AI tạo đề</h2>
      <ol class="qf-steps"><li>Bấm <b>Sao chép prompt</b> bên dưới.</li><li>Dán vào ChatGPT / Gemini / Claude, thay các chỗ <code>[...]</code> (chủ đề, mức độ, số câu mỗi phần).</li><li>AI trả về <b>3 khối code</b>. Copy <b>từng khối</b> dán vào đúng ô Phần 1 / 2 / 3 ở bước 3.</li></ol>
      <div class="qf-promptbar"><button type="button" id="btnCopyPrompt" class="qf-btn primary">📋 Sao chép prompt</button><button type="button" id="btnTogglePrompt" class="qf-btn">Xem / ẩn prompt</button><span id="copyMsg" class="qf-msg"></span></div>
      <pre id="promptBox" class="qf-prompt" hidden></pre></section>
    <section class="qf-card"><h2>3. Nhập đề &amp; chỉnh từng câu</h2>
      <div class="qf-bar"><button type="button" id="btnParse" class="qf-btn primary">⬇ Chuyển text → câu hỏi</button><button type="button" id="btnExport" class="qf-btn">⬆ Xuất câu hỏi → text</button><span id="syncHint" class="qf-msg"></span></div>
      <p class="qf-hint">🛡 Ảnh câu hỏi: mỗi câu có nút <b>⬆ Tải ảnh lên</b> — ảnh được nén ở trình duyệt rồi lưu <b>mã hoá</b> (AES-256-GCM) vào kho ảnh riêng của tài khoản bạn, mã ảnh <code>[img:…]</code> tự điền. Dòng <code>//image: 5,8,10</code> trong text AI = các câu cần ảnh.</p>
      ${part('mcq', 'Phần 1 · Trắc nghiệm nhiều đáp án', 'Mỗi câu: “- câu hỏi”, các dòng “+)đáp án”, rồi “=> A” (nhiều đáp án đúng: “=> A, C”). Câu hỏi chùm: thêm dòng “*)/1-3/ nội dung chùm” (có thể in đậm/nghiêng bằng &lt;b&gt;, &lt;i&gt;) ngay trước câu 1; không có dòng *) = không phải câu chùm.')}
      ${part('tf', 'Phần 2 · Đúng / Sai', 'Mỗi câu: “- câu dẫn”, rồi nhiều ý: “+)ý a”, “=> Đúng/Sai”, (tuỳ chọn) “++) giải thích ý”; lặp lại cho ý b, c, d.')}
      ${part('fill', 'Phần 3 · Điền số liệu / đáp án', 'Mỗi câu: “- câu hỏi”, rồi “=> đáp án” (nhiều cách viết ngăn bằng |). Câu hỏi chùm: thêm dòng “*)/1-3/ nội dung chùm” ngay trước câu 1 (ghi chú hướng dẫn điền, nếu có, đặt trước dòng *) đầu tiên).')}
    </section>
    <div class="qf-save"><span id="saveSummary" class="qf-msg">Chưa có câu hỏi</span><button type="button" id="btnSave" class="qf-btn primary big">${isEdit ? '💾 Lưu thay đổi' : '💾 Tạo bài trắc nghiệm'}</button></div>
  </div>
  <style>
    .qf-partcfg { align-items: flex-start; gap: 16px 24px; } .qf-partcfg > label:first-child { flex: 0 0 200px; }
    .qf-partcfg > label:first-child input { font-size: 18px; font-weight: 700; padding: 10px 12px; }
    .qf-partcfg .qf-scoring { display: flex; flex-direction: column; gap: 8px; flex: 1 1 440px; min-width: 0; }
    .qf-scoring-title { font-size: 12px; font-weight: 700; color: #555; }
    .qf-opts { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 12px; }
    .qf-partcfg .qf-scoring .qf-opt { position: relative; display: block; min-width: 0; cursor: pointer; font-weight: 400; }
    .qf-opt input { position: absolute; opacity: 0; pointer-events: none; }
    .qf-opt-body { position: relative; display: flex; flex-direction: column; gap: 8px; height: 100%; padding: 12px 14px 12px 42px; border: 1.5px solid #d3d7de; border-radius: 10px; background: #fff; transition: border-color .15s, background .15s, box-shadow .15s; }
    .qf-opt-body::before { content: ""; position: absolute; left: 14px; top: 14px; width: 16px; height: 16px; border: 2px solid #b6bdc9; border-radius: 50%; background: #fff; transition: all .15s; }
    .qf-opt:hover .qf-opt-body { border-color: #a8b3c4; }
    .qf-opt input:checked + .qf-opt-body { border-color: #a61c2f; background: #fff7f8; box-shadow: 0 0 0 3px rgba(166, 28, 47, .08); }
    .qf-opt input:checked + .qf-opt-body::before { border-color: #a61c2f; background: radial-gradient(circle, #a61c2f 0 40%, #fff 45%); }
    .qf-opt-name { font-size: 14px; font-weight: 700; color: #222; line-height: 1.3; } .qf-opt-desc { font-size: 12.5px; color: #6b7280; line-height: 1.5; }
    .qf-opt-rows { display: flex; flex-direction: column; gap: 4px; }
    .qf-opt-row { display: flex; justify-content: space-between; gap: 10px; padding: 4px 8px; border-radius: 6px; background: #f3f5f9; font-size: 12.5px; color: #4b5563; }
    .qf-opt-row b { color: #1c4385; font-weight: 700; white-space: nowrap; } .qf-opt input:checked + .qf-opt-body .qf-opt-row { background: #fdecee; }
    .qf-audio-warn { color: #b91c1c; font-size: 13px; margin-top: 6px; } .qf-audio-prev { display: block; width: 100%; max-width: 520px; margin-top: 10px; }
    .qf-audio-prev[hidden], .qf-audio-warn[hidden] { display: none; } .qf-audio-help { margin-top: 8px; font-size: 13px; color: #475569; }
    .qf-audio-help summary { cursor: pointer; color: #2563eb; } .qf-audio-help ol { margin: 8px 0 0; padding-left: 20px; line-height: 1.7; }
  </style>`;
}

export async function quizEditorPage(ctx, id) {
  const isNew = !id; id = id || newId();
  const [{ config: cfg }, ov, itemR, subsR] = await Promise.all([get('/api/quizzes/config'), get('/api/overview').catch(() => ({ subjects: [] })), isNew ? null : get(`/api/quizzes/${id}`), isNew ? null : get(`/api/submissions?itemId=${id}`).catch(() => ({ submissions: [] }))]);
  const item = itemR ? itemR.item : null;
  const picker = await promptPicker('quiz', item && item.promptId);
  const root = h('div'); root.innerHTML = editorHtml({ mode: isNew ? 'create' : 'edit', item, cfg, subjects: ov.subjects || [], submissionCount: subsR ? subsR.submissions.length : 0 });
  root.prepend(h('div', { class: 'card' }, picker.el));      // chọn prompt phân tích AI (nằm ngoài form của trình soạn; id gắn lúc lưu)
  const stopImg = watchEncryptedImages(root);
  const CFG = { mode: isNew ? 'create' : 'edit', lessonId: id, parts: (item && item.parts) || {}, raw: (item && item.raw) || { mcq: '', tf: '', fill: '' }, authoringPrompt: cfg.authoringPrompt, allowedImageHosts: cfg.allowedImageHosts, audioUrl: (item && item.audioUrl) || '', allowedAudioHosts: cfg.allowedAudioHosts, maxOptions: cfg.maxOptions, tfScoring: (item && item.parts && item.parts.tf && item.parts.tf.scoring) || 'equal', tfMinStatements: cfg.tfMinStatements, tfMaxStatements: cfg.tfMaxStatements, tfThptqgStatements: cfg.tfThptqgStatements, defaults: cfg.defaults, durationLimits: cfg.durationLimits };
  const bridge = {
    save: async (body) => { try { await put(`/api/quizzes/${id}`, { ...body, promptId: picker.value() }, { retry: true }); } catch (e) { const err = new Error(e.message); err.errors = e.errors; throw err; } },
    done: () => { if (ctx.isCurrent()) ctx.go('/'); },     // chỉ quay về nếu người dùng chưa rời trang
    uploadImage: (blob, name) => uploadImage(new File([blob], name || 'anh', { type: blob.type })),
  };
  let dispose; whenConnected(root, () => { dispose = mountQuizEditor(CFG, bridge); });
  ctx.setCleanup(() => { stopImg(); if (dispose) dispose(); });
  return root;
}

// ───────────────────────── LÀM BÀI ─────────────────────────
/** Bỏ đáp án + giải thích khỏi đề trước khi giao cho màn hình làm bài (chuyển từ toStudentView của bản cũ). */
function toStudentView(item) {
  const out = { maxScore: item.maxScore, parts: {} };
  if (item.audioUrl) out.audioUrl = item.audioUrl;
  for (const k of ['mcq', 'tf', 'fill']) {
    const p = item.parts && item.parts[k]; if (!p || !p.questions || !p.questions.length) continue;
    out.parts[k] = { pointsPerQuestion: p.pointsPerQuestion, questions: p.questions.map((q) => {
      const v = { id: q.id, text: q.text, image: q.image || null };
      if (k === 'mcq') { v.options = (q.options || []).map((o) => ({ key: o.key, text: o.text })); v.multi = !!q.multi; }
      if (k === 'tf') v.statements = (q.statements || []).map((st) => ({ id: st.id, text: st.text }));
      v.clusterId = k === 'tf' ? undefined : (q.clusterId || null);
      return v;
    }) };
    if (k === 'tf') out.parts[k].scoring = p.scoring || 'equal';
    if (k === 'fill') out.parts[k].note = p.note || '';
    if (k !== 'tf' && p.clusters && p.clusters.length) out.parts[k].clusters = p.clusters.map((c) => ({ id: c.id, from: c.from, to: c.to, text: c.text || '', image: c.image || null, questionIds: c.questionIds || [] }));
  }
  return out;
}

const shuffled = (a) => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
/** Xáo trộn trong từng phần; câu hỏi chùm là một khối đi liền nhau (giữ nguyên thứ tự bên trong). Thứ tự giữ cố định trong một lượt làm (lưu cùng nháp). */
function shuffleParts(view, orderMap) {
  const order = orderMap || {};
  for (const k of Object.keys(view.parts)) {
    const p = view.parts[k], byId = Object.fromEntries(p.questions.map((q) => [q.id, q]));
    if (!order[k] || order[k].length !== p.questions.length || order[k].some((x) => !byId[x])) {
      const units = []; let last = null;
      for (const q of p.questions) { if (q.clusterId && last && last[0].clusterId === q.clusterId) last.push(q); else { last = [q]; units.push(last); } }
      order[k] = shuffled(units).flat().map((q) => q.id);
    }
    p.questions = order[k].map((x) => byId[x]);
  }
  return order;
}

function takeHtml(item, view, cfg) {
  const PART_KEYS = ['mcq', 'tf', 'fill'].filter((k) => view.parts[k]);
  const total = PART_KEYS.reduce((n, k) => n + view.parts[k].questions.length, 0);
  const untimed = item.duration === null, duration = untimed ? null : (item.duration || 20), maxScore = item.maxScore || 10;
  const subjectName = item.subject || '';
  const audioUrl = /^https:\/\//.test(view.audioUrl || '') ? view.audioUrl : '';
  const who = esc(cfg.studentName);
  if (!PART_KEYS.length) return '<div class="exam-page"><div class="lock-msg show">Bài trắc nghiệm này chưa có câu hỏi nào.</div></div>';
  return `
  <div class="quiz-pre"><a href="${cfg.backHref || '#/'}" class="quiz-back">${cfg.backText || '← Quay lại bài của tôi'}</a></div>
  <div class="exam-page qx-pending">
    <div class="qx-start" id="qxStart"><div class="qx-start-card"><span class="qx-kicker">BÀI TRẮC NGHIỆM</span><h2>${esc(item.title)}</h2>${subjectName ? `<p class="qx-sub">${esc(subjectName)}</p>` : ''}
      <div class="qx-facts"><div><strong>${total}</strong><span>câu hỏi</span></div><div>${untimed ? '<strong>∞</strong><span>không giới hạn</span>' : `<strong>${duration}</strong><span>phút</span>`}</div><div><strong>${esc(maxScore)}</strong><span>thang điểm</span></div></div>
      <ul class="qx-rules"><li>Câu hỏi chỉ hiện sau khi bạn bấm nút bên dưới.</li><li>Đồng hồ đếm ngược bắt đầu chạy ngay khi bấm.</li><li>Hết giờ chuông sẽ reo, hãy nộp bài trước khi hết giờ.</li><li>Không tải lại trang khi đang làm bài.</li>${audioUrl ? '<li>🎧 Bài có phần nghe — audio sẽ tự phát ngay khi bạn bấm bắt đầu, hãy chuẩn bị tai nghe / loa trước.</li>' : ''}</ul>
      <button type="button" id="qxStartBtn" class="qx-start-btn">${cfg.resume ? '▶ TIẾP TỤC LÀM BÀI' : '▶ BẮT ĐẦU LÀM BÀI'}</button></div></div>
    <div id="audioBar" class="audio-bar locked"><div class="audio-bar-icon">🔊</div><div class="audio-bar-info"><div class="title">Chuông báo hết giờ<span id="audioBadge" class="audio-badge">🔒 Đang khoá</span></div><div class="desc">Chỉ tự động reo lặp khi đồng hồ về 00:00 — tự tắt khi bạn nộp bài.</div></div>
      <audio id="timeUpAudio" controls preload="auto" src="musics/iphone-17-pro-max.mp3">Trình duyệt của bạn không hỗ trợ thẻ audio.</audio></div>
    <div id="lockMessage" class="lock-msg"></div>
    <section class="exam-bar"><div class="student-info"><strong>${who}</strong><span>Môn: ${esc(subjectName || '—')}</span><span>Bài: ${esc(item.title)}</span></div>
      <div class="exam-status"><div id="timerWrap" class="timer-wrap"><span class="timer-icon">◷</span><span id="timer">${untimed ? 'Không đếm giờ' : String(duration).padStart(2, '0') + ':00'}</span></div><span id="connectionDot" class="connection-dot"></span><span id="statusText" class="connection-text">Đang làm bài</span>
      <button type="button" class="submit-top" id="submitTop">NỘP BÀI</button><button type="button" class="fullscreen-btn" id="fullscreenBtn" title="Toàn màn hình">⛶</button></div></section>
    ${audioUrl ? `<section class="listen-bar" id="listenBar"><div class="listen-head"><span class="listen-icon">🎧</span><div><strong>Bài nghe</strong><small>Audio tự phát khi bắt đầu — có thể tạm dừng, không tua được cho tới khi nộp bài.</small></div></div><audio id="quizAudio" controls preload="metadata" controlsList="nodownload noplaybackrate" src="${esc(audioUrl)}">Trình duyệt của bạn không hỗ trợ thẻ audio.</audio><div id="listenMsg" class="listen-msg" hidden></div></section>` : ''}
    <div class="toolbar" id="toolbar"><button type="button" class="tool-btn" id="prevBtn">← Câu trước</button><button type="button" class="tool-btn primary" id="nextBtn">Câu tiếp theo →</button>
      <div class="progress-info"><span>Số câu đã trả lời:</span><strong id="answeredCount">0</strong><span>/ ${total}</span></div><span id="saveHint" class="save-hint"></span><button type="button" class="tool-btn save" id="saveBtn" style="margin-left:0">Lưu nháp</button></div>
    <main class="exam-content" id="examContent">
      <aside class="chapter-panel"><div class="panel-heading"><span>${esc(item.title)}</span><small>${esc((subjectName ? subjectName.toUpperCase() + ' • ' : '') + total + ' CÂU • ' + (untimed ? 'KHÔNG ĐẾM GIỜ' : duration + ' PHÚT') + ' • THANG ' + maxScore)}</small></div>
        <div class="chapter-summary"><h3>Cấu trúc đề</h3>${PART_KEYS.map((k, i) => `<div class="summary-item"><span>0${i + 1}</span><p>${PART_TITLES[k]}<small>${view.parts[k].questions.length} câu${view.parts[k].pointsPerQuestion ? ' • ' + view.parts[k].pointsPerQuestion + ' điểm/câu' : ''}</small></p></div>`).join('')}</div>
        ${item.contentHtml ? `<div class="lesson-desc">${item.contentHtml}</div>` : ''}
        <div class="exam-note"><h3>Hướng dẫn</h3><ul>${untimed ? '<li>Bài này <b>không đếm giờ</b>: bạn làm bài không giới hạn thời gian, nộp khi nào xong thì bấm "NỘP BÀI".</li>' : `<li>Thời gian làm bài: ${duration} phút (đồng hồ đếm ngược ở góc trên).</li>`}<li>Câu có ô vuông: chọn <b>tất cả</b> đáp án đúng. Câu có ô tròn: chọn <b>một</b> đáp án.</li><li>Chuyển câu bằng nút, phím ← → hoặc bấm số câu phía dưới.</li><li>Hết giờ chuông sẽ reo lặp cho tới khi bạn nộp bài.</li><li>Sau khi nộp, hệ thống hiện đáp án, giải thích; phân tích AI ở trang bài nộp.</li><li>Điểm quy đổi theo thang ${esc(maxScore)}.</li></ul></div>
        <div class="left-progress"><div class="progress-title"><span>TIẾN ĐỘ</span><b id="progressPercent">0%</b></div><div class="progress-track"><div class="progress-fill" id="progressFill"></div></div></div></aside>
      <section class="question-panel"><div class="question-top"><div><span class="question-label">CÂU HỎI</span><strong id="questionNumber">1 / ${total}</strong></div><button type="button" class="flag-btn" id="flagBtn">⚑ Đánh dấu</button></div><div id="questionContainer"></div></section></main>
    <section class="question-nav" id="questionNav"><div class="nav-title"><strong>DANH SÁCH CÂU HỎI</strong><span>● Đã trả lời &nbsp;&nbsp; ○ Chưa trả lời &nbsp;&nbsp; ⚑ Đánh dấu</span></div><div class="question-numbers" id="questionNumbers"></div></section>
    <section class="submit-area" id="submitArea"><div><h3>Đã hoàn thành bài?</h3><p>Kiểm tra lại các câu chưa trả lời trước khi nộp.</p></div><button type="button" class="submit-main" id="submitMain">NỘP BÀI & XEM KẾT QUẢ</button></section>
    <section class="result-section hidden" id="resultSection"><div class="result-header"><div><span class="result-kicker">KẾT QUẢ BÀI LÀM</span><h2>${esc(item.title)}</h2></div><div class="score-box"><span>ĐIỂM</span><strong id="scoreValue">0</strong><small id="scoreMax">/ ${esc(maxScore)}</small></div></div>
      <div class="result-stats"><div class="stat correct"><span>Đúng</span><strong id="correctCount">0</strong></div><div class="stat wrong"><span>Sai</span><strong id="wrongCount">0</strong></div><div class="stat unanswered"><span>Chưa trả lời</span><strong id="unansweredCount">0</strong></div><div class="stat percent"><span>Tỷ lệ đúng</span><strong id="resultPercent">0%</strong></div></div>
      <div class="parts-breakdown" id="partsBreakdown"></div><div class="result-message" id="resultMessage"></div>
      <div class="review-heading"><h3>ĐÁP ÁN & GIẢI THÍCH</h3><p>Đáp án đúng được tô xanh; đáp án bạn chọn sai được tô đỏ.</p></div><div class="review-list" id="reviewList"></div>
      <button type="button" class="retry-btn" id="retryBtn">LÀM LẠI BÀI</button></section>
  </div>
  <style>
    .exam-page.qx-pending > *:not(.qx-start) { display: none !important; } .qx-start { display: flex; justify-content: center; padding: 32px 16px; }
    .qx-start-card { width: 100%; max-width: 560px; background: #fff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 32px 28px; text-align: center; box-shadow: 0 8px 30px rgba(15, 23, 42, .08); }
    .qx-kicker { display: inline-block; font-size: 12px; font-weight: 700; letter-spacing: .08em; color: #2563eb; margin-bottom: 8px; } .qx-start-card h2 { margin: 0 0 4px; font-size: 24px; color: #0f172a; } .qx-sub { margin: 0 0 20px; color: #64748b; }
    .qx-facts { display: flex; gap: 12px; justify-content: center; margin: 20px 0; } .qx-facts > div { flex: 1; background: #f1f5f9; border-radius: 12px; padding: 14px 8px; }
    .qx-facts strong { display: block; font-size: 28px; color: #0f172a; line-height: 1.1; } .qx-facts span { font-size: 13px; color: #64748b; }
    .qx-rules { text-align: left; margin: 0 0 24px; padding-left: 20px; color: #334155; line-height: 1.7; font-size: 14px; }
    .qx-start-btn { width: 100%; padding: 14px 20px; border: 0; border-radius: 12px; background: #2563eb; color: #fff; font-size: 17px; font-weight: 700; cursor: pointer; } .qx-start-btn:hover { background: #1d4ed8; }
    .quiz-pre { max-width: 1100px; margin: 0 auto 10px; } .quiz-back { color: #64748b; font-size: 14px; }
    .listen-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 12px 16px; margin: 12px 0; }
    .listen-head { display: flex; align-items: center; gap: 10px; min-width: 180px; } .listen-head small { display: block; color: #64748b; font-size: 12px; } .listen-icon { font-size: 24px; }
    .listen-bar audio { flex: 1 1 280px; min-width: 0; max-width: 100%; } .listen-msg { flex-basis: 100%; color: #b91c1c; font-size: 13px; } .listen-msg[hidden] { display: none; }
    .cluster-box { margin: 14px 0; padding: 14px 16px; background: #fffbeb; border: 1px solid #fcd34d; border-left: 4px solid #f59e0b; border-radius: 10px; }
    .cluster-label { font-size: 12px; font-weight: 700; letter-spacing: .04em; color: #b45309; margin-bottom: 8px; text-transform: uppercase; } .cluster-text { color: #1e293b; line-height: 1.7; white-space: pre-line; }
    .cluster-text b, .cluster-text strong { font-weight: 700; } .cluster-text ul, .cluster-text ol { margin: 6px 0 6px 20px; white-space: normal; } .cluster-image { display: block; max-width: 100%; max-height: 360px; margin-top: 10px; border-radius: 8px; }
  </style>`;
}

/** opts.shareId + opts.item: làm bài được chia sẻ (id = shareId) — nộp qua /api/shares/:id/submissions, đề đã bị bỏ đáp án. */
export async function quizPracticePage(ctx, id, opts = {}) {
  const shared = opts.shareId || null;
  if (shared) imageCtx.share = shared;
  const [{ item }, sess] = await Promise.all([opts.item ? { item: opts.item } : get(`/api/quizzes/${id}`), Promise.resolve(JSON.parse(localStorage.getItem('utc.auth.v2') || '{}'))]);
  const key = `utc.quizorder.${id}.${item.updatedAt}`;
  const view = toStudentView(item);
  let order = null; try { order = JSON.parse(localStorage.getItem(key)); } catch { order = null; }
  const draftRaw = (() => { try { return JSON.parse(localStorage.getItem('quiz-draft:' + id) || 'null'); } catch { return null; } })();
  if (!draftRaw) order = null;                                   // lượt mới → xáo lại
  if (item.shuffle) { order = shuffleParts(view, order); try { localStorage.setItem(key, JSON.stringify(order)); } catch { /* bỏ qua */ } }
  const user = (sess.user || {});
  const root = h('div'); root.innerHTML = takeHtml(item, view, { studentName: (user.displayName || user.username || 'THÍ SINH').toUpperCase(), resume: !!(draftRaw && draftRaw.endAt && Date.now() < draftRaw.endAt + 30 * 60 * 1000), ...(shared ? { backHref: `#/s/${shared}`, backText: '← Về trang bài chia sẻ (lịch sử & biểu đồ điểm)' } : {}) });
  const stopImg = watchEncryptedImages(root);
  const CFG = { lessonId: id, title: item.title, duration: item.duration === null ? null : (item.duration || 20), maxScore: item.maxScore, readOnly: false, parts: view.parts, audioUrl: view.audioUrl || '', alarmSrc: 'musics/iphone-17-pro-max.mp3' };
  let dispose = null, started = false;
  const subId = (() => { const k = 'utc.quizsub.' + id; let v = localStorage.getItem(k); if (!v || !draftRaw) { v = newId(); localStorage.setItem(k, v); } return v; })();
  const startedAt = new Date().toISOString();
  const bridge = {
    submit: async (answers) => {
      const body = { answers, startedAt, durationSec: (Date.now() - new Date(startedAt)) / 1000 };
      const r = shared ? await put(`/api/shares/${shared}/submissions/${subId}`, body, { retry: true }) : await put(`/api/submissions/${subId}`, { itemType: 'quiz', itemId: id, ...body }, { retry: true });
      const sub = r.submission; const expl = {};
      for (const k of ['mcq', 'tf', 'fill']) for (const q of ((sub.snapshot.parts[k] || {}).questions || [])) { expl[q.id] = q.explanationHtml || null; (q.statements || []).forEach((st) => { expl[st.id] = st.explanationHtml || null; }); }
      const result = { ...sub.result, items: sub.result.items.map((it) => ({ ...it, explanationHtml: expl[it.id] || null })) };
      try { localStorage.removeItem(key); localStorage.removeItem('utc.quizsub.' + id); } catch { /* bỏ qua */ }
      return { success: true, submissionId: sub.id, status: 'committed', syncStatus: 'committed', result };
    },
    retry: () => { if (!ctx.isCurrent()) return; try { localStorage.removeItem(key); localStorage.removeItem('quiz-draft:' + id); localStorage.removeItem('utc.quizsub.' + id); } catch { /* bỏ qua */ } ctx.go('/'); setTimeout(() => ctx.go(shared ? `/s/${shared}/play` : `/quiz/${id}`), 30); },
  };
  whenConnected(root, () => {
    const btn = root.querySelector('#qxStartBtn'), page = root.querySelector('.exam-page'); if (!btn) return;
    btn.addEventListener('click', async () => {
      if (started) return; started = true; btn.disabled = true; btn.textContent = 'Đang tải đề…';
      const start = root.querySelector('#qxStart'); page.classList.remove('qx-pending'); if (start) start.style.display = 'none';
      const listen = root.querySelector('#quizAudio');
      if (listen) {                                                  // phải gọi play() ngay trong cú click (Safari/iOS)
        try { const pr = listen.play(); if (pr && pr.catch) pr.catch(() => { const m = root.querySelector('#listenMsg'); if (m && listen.error == null) { m.textContent = 'Trình duyệt chặn tự phát — bấm ▶ ở thanh Bài nghe để nghe.'; m.hidden = false; listen.addEventListener('playing', () => { m.hidden = true; }, { once: true }); } }); } catch { /* bỏ qua */ }
        try { await loadScript('legacy/quizAudioLock.js'); } catch { /* bỏ qua */ }
      }
      dispose = mountQuizTake(CFG, bridge); if (start) start.remove(); window.scrollTo(0, 0);
    });
  });
  ctx.setCleanup(() => { stopImg(); if (dispose) dispose(); });
  return root;
}
