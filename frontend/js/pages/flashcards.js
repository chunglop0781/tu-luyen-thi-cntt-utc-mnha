import { get, put, post, del, imageCtx, imageUrl, newId, uploadImage } from '../api.js';
import { h, toast, action, confirmBox, pctClass } from '../ui.js';
import { openShareDialog } from './share.js';
import { historyBtnHtml, historyTarget } from '../historyBtn.js';
import { watchEncryptedImages } from './quiz.js';
import { mountFlashcardStudy } from '../../legacy/flashcardStudy.js';

/* ỨNG DỤNG FLASHCARD — chuyển từ /apps + /flashcards của luyen-thi-cntt-utc-mnha:
     #/apps                    danh sách ứng dụng
     #/flashcards              các bộ thẻ của tôi + bộ được chia sẻ với tôi
     #/flashcard/new | /:id/edit   tạo / sửa (nhập "+) … => …", xem trước, prompt AI, thêm ảnh)
     #/flashcard/:id           học: 🃏 Thẻ học · ✍️ Luyện tập (4 cấp) · 📝 Kiểm tra  (legacy/flashcardStudy.js — chép từ bản cũ)
     #/s/:shareId/play         học bộ thẻ được chia sẻ (share.js gọi flashcardStudyPage)
   Khác bản cũ: không có phân quyền admin/sinh viên — mỗi tài khoản tự tạo bộ thẻ của mình và chia sẻ bằng link giống bài trắc nghiệm / tự luận. */

export const MODE_LABEL = { language: 'Học ngoại ngữ', theory: 'Học lý thuyết' };
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const brk = (s) => String(s == null ? '' : s).replace(/(\\)?\\n(?![A-Za-z])/g, (m, pre) => (pre ? m : '\n'));   // "\n" (2 ký tự) = xuống dòng, không đụng \neq, \nu…
const typeset = (el) => { try { if (window.MathJax && window.MathJax.typesetPromise) { if (window.MathJax.typesetClear) window.MathJax.typesetClear([el]); window.MathJax.typesetPromise([el]).catch(() => {}); } } catch { /* MathJax chưa tải */ } };
function whenConnected(root, fn) { let n = 0; (function tick() { if (root.isConnected) fn(); else if (n++ < 200) requestAnimationFrame(tick); })(); }

let cfgPromise = null;
const getConfig = () => (cfgPromise = cfgPromise || get('/api/flashcards/config').then((r) => r.config).catch((e) => { cfgPromise = null; throw e; }));

// ───────────────────────── #/apps ─────────────────────────
const APPS = [{ id: 'flashcards', icon: '🃏', name: 'Flashcards', href: '#/flashcards', desc: 'Học từ vựng ngoại ngữ (có Nghe & Đọc) hoặc lý thuyết bằng thẻ: lật thẻ, luyện tập 4 cấp độ, kiểm tra thang 10. Tự tạo bộ thẻ và chia sẻ bằng link.' }];

export async function appsPage() {
  return h('div', null,
    h('div', { style: 'margin-bottom:22px' }, h('h2', null, 'Ứng dụng'), h('p', { class: 'muted' }, 'Các ứng dụng học tập bạn có thể dùng.')),
    h('div', { class: 'grid' }, APPS.map((a) => h('a', { class: 'card item app-card', href: a.href },
      h('div', { class: 'bar' }),
      h('div', { class: 'body' }, h('div', { class: 'ico' }, a.icon), h('h3', null, a.name), h('p', { class: 'muted' }, a.desc), h('p', { style: 'margin-top:12px;font-weight:600;color:var(--pri)' }, 'Mở ứng dụng →'))))));
}

// ───────────────────────── #/flashcards ─────────────────────────
export async function flashcardsHubPage() {
  const ov = await get('/api/overview');
  let mode = '', subject = '', q = '';
  const list = h('div', { class: 'grid' });
  const subjects = [...new Set(ov.flashcards.map((f) => f.subject).filter(Boolean))].sort();

  const draw = () => {
    const items = ov.flashcards.filter((f) => (!mode || f.mode === mode) && (!subject || f.subject === subject) && (!q || (f.title + ' ' + f.subject).toLowerCase().includes(q)));
    list.replaceChildren(...(items.length ? items.map(card) : [h('p', { class: 'muted' }, ov.flashcards.length ? 'Không có bộ thẻ khớp bộ lọc.' : 'Chưa có bộ flashcard nào — hãy tạo bộ đầu tiên!')]));
  };
  const card = (f) => h('div', { class: 'card item' },
    h('div', { class: 'row' }, h('span', { class: 'badge flashcard' }, MODE_LABEL[f.mode] || 'Flashcard'), f.subject ? h('span', { class: 'badge' }, f.subject) : null),
    h('h3', null, f.title),
    h('p', { class: 'muted' }, `${f.size} thẻ`, ` · đã kiểm tra ${f.attempts}`, f.bestPct != null ? [' · tốt nhất ', h('b', { class: pctClass(f.bestPct) }, f.bestPct + '%')] : ''),
    f.shareId ? h('p', { class: 'muted' }, '🔗 Đang chia sẻ · ', h('a', { href: `#/s/${f.shareId}/history` }, 'lịch sử của mọi người')) : null,
    h('div', { class: 'row' },
      h('a', { class: 'btn primary', href: `#/flashcard/${f.id}` }, '🃏 Học'), h('a', { class: 'btn', href: `#/flashcard/${f.id}/edit` }, 'Sửa'),
      h('a', { class: 'btn', href: f.shareId ? `#/s/${f.shareId}/history` : `#/flashcard/${f.id}/history`, title: 'Lịch sử kiểm tra & biểu đồ điểm của bộ thẻ này' }, '📊 Lịch sử'),
      h('button', { class: 'btn', title: 'Tạo link chia sẻ bộ thẻ này', onclick: async (ev) => { const b = ev.currentTarget; b.disabled = true; try { await openShareDialog(f, (sid) => { if (sid) { f.shareId = sid; draw(); } }); } catch (e) { toast(e.message, 'err', 6000); } finally { b.disabled = false; } } }, '🔗 Chia sẻ'),
      h('button', { class: 'btn ghost danger', onclick: async () => { if (!(await confirmBox(`Xoá bộ thẻ "${f.title}"? Không khôi phục được.`))) return; try { await del(`/api/flashcards/${f.id}`); ov.flashcards = ov.flashcards.filter((x) => x.id !== f.id); draw(); toast('Đã xoá', 'ok'); } catch (e) { toast(e.message, 'err'); } } }, 'Xoá')));

  const search = h('input', { type: 'search', placeholder: '🔍 Tìm theo tên, môn…', oninput: (e) => { q = e.target.value.toLowerCase(); draw(); } });
  const modeSel = h('select', { onchange: (e) => { mode = e.target.value; draw(); } }, h('option', { value: '' }, 'Mọi hình thức'), h('option', { value: 'language' }, MODE_LABEL.language), h('option', { value: 'theory' }, MODE_LABEL.theory));
  const subSel = h('select', { onchange: (e) => { subject = e.target.value; draw(); } }, h('option', { value: '' }, 'Tất cả môn'), subjects.map((s) => h('option', { value: s }, s)));
  draw();

  const shared = ov.flashcardShared || [];
  return h('div', null,
    h('a', { href: '#/apps' }, '← Ứng dụng'),
    h('div', { class: 'row between', style: 'margin-top:6px' }, h('h2', null, '🃏 Flashcards'), h('a', { class: 'btn primary', href: '#/flashcard/new' }, '＋ Tạo bộ thẻ')),
    h('div', { class: 'row filters' }, search, modeSel, subSel), list,
    shared.length ? h('div', null, h('h3', null, 'Bộ thẻ được chia sẻ với tôi'), h('div', { class: 'grid' }, shared.map((j) => h('div', { class: 'card item' },
      h('div', { class: 'row' }, h('span', { class: 'badge flashcard' }, 'Được chia sẻ'), j.subject ? h('span', { class: 'badge' }, j.subject) : null), h('h3', null, j.title),
      h('p', { class: 'muted' }, `đã kiểm tra ${j.attempts}`, j.bestPct != null ? [' · tốt nhất ', h('b', { class: pctClass(j.bestPct) }, j.bestPct + '%')] : ''),
      h('div', { class: 'row' }, h('a', { class: 'btn primary', href: `#/s/${j.shareId}/play` }, '🃏 Học'), h('a', { class: 'btn', href: `#/s/${j.shareId}/history` }, '📊 Lịch sử & biểu đồ')))))) : null);
}

// ───────────────────────── #/flashcard/new | /:id/edit ─────────────────────────
export async function flashcardEditorPage(ctx, id) {
  const isNew = !id; id = id || newId();
  const [cfg, ov, got] = await Promise.all([getConfig(), get('/api/overview'), isNew ? Promise.resolve(null) : get(`/api/flashcards/${id}`)]);
  const e = (got && got.item) || { title: '', subject: '', description: '', mode: 'language', language: cfg.defaultLanguage, raw: '' };
  let mode = e.mode === 'theory' ? 'theory' : 'language', dirty = false;

  const title = h('input', { value: e.title, maxlength: 200, placeholder: 'VD: Unit 1 – Life stories we admire' });
  const subjList = [...new Set([...(ov.subjects || []), ...ov.flashcards.map((f) => f.subject)].filter(Boolean))].sort();
  const dl = h('datalist', { id: 'fc-subj' }, subjList.map((s) => h('option', { value: s })));
  const subject = h('input', { value: e.subject, list: 'fc-subj', maxlength: 60, placeholder: 'VD: Tiếng Anh 12' });
  const desc = h('input', { value: e.description, maxlength: 1000, placeholder: 'Mô tả ngắn (tuỳ chọn)' });
  const lang = h('select', null, cfg.languages.map((l) => h('option', { value: l.code, selected: l.code === e.language }, `${l.label} — ${l.code}`)));
  const langBox = h('label', { class: 'field' }, h('span', null, 'Ngôn ngữ nghe & đọc'), lang, h('small', { class: 'muted' }, 'Dùng cho nút Nghe (đọc to) và Đọc (nhận giọng nói) của cả bộ thẻ. Cần trình duyệt Google Chrome / Edge.'));
  const content = h('textarea', { class: 'fce-content', rows: 16, spellcheck: 'false', placeholder: '+) admire\n++) ədˈmaɪə\n=> ngưỡng mộ\n\n+) elephant\n=> con voi' }); content.value = e.raw || '';
  const prompt = h('textarea', { rows: 22, readonly: true });
  const msg = h('div', { class: 'alert err', hidden: true });

  const modeBtn = (m, icon, label, hint) => {
    const radio = h('input', { type: 'radio', name: 'fcMode', value: m });
    const lb = h('label', { class: 'fce-mode', 'data-mode': m }, radio, h('b', null, `${icon} ${label}`), h('small', null, hint));
    lb.addEventListener('click', (ev) => {
      ev.preventDefault();
      if (m === mode) return;
      if (m === 'theory' && /^\s*\+\+\)/m.test(content.value) && !window.confirm('Chế độ "Học lý thuyết" không dùng dòng ++) (phiên âm). Các dòng ++) sẽ báo lỗi cho tới khi bạn xoá. Vẫn chuyển?')) return;
      mode = m; dirty = true; applyMode();
    });
    return lb;
  };
  const modes = h('div', { class: 'fce-modes' }, modeBtn('language', '🌐', MODE_LABEL.language, cfg.modes[0].hint), modeBtn('theory', '💡', MODE_LABEL.theory, cfg.modes[1].hint));
  const fmtLang = h('div', null, h('div', null, h('b', null, '+)'), ' từ ngoại ngữ (VD: admire)'), h('div', { class: 'dim' }, '[img:…]  (ảnh — tuỳ chọn, nút “Thêm ảnh” tự chèn dưới dòng +)'), h('div', null, h('b', null, '++)'), ' phiên âm IPA (VD: ədˈmaɪə) — tuỳ chọn'), h('div', null, h('b', null, '=>'), ' nghĩa tiếng Việt (VD: ngưỡng mộ)'));
  const fmtTheory = h('div', null, h('div', null, h('b', null, '+)'), ' câu hỏi'), h('div', { class: 'dim' }, '[img:…]  (ảnh — tuỳ chọn, nút “Thêm ảnh” tự chèn dưới dòng +)'), h('div', null, h('b', null, '=>'), ' câu trả lời'));

  const sum = h('div', { class: 'fce-sum muted' }), errs = h('ul', { class: 'fce-errs' }), hints = h('div', { class: 'fce-hint', hidden: true }), cardsBox = h('div', { class: 'fce-cards' });
  let timer = null, seq = 0;
  const schedule = () => { clearTimeout(timer); timer = setTimeout(runPreview, 350); };
  async function runPreview() {
    const my = ++seq, text = content.value;
    if (!text.trim()) { sum.textContent = 'Chưa có nội dung.'; sum.className = 'fce-sum muted'; errs.replaceChildren(); cardsBox.replaceChildren(); hints.hidden = true; return; }
    let p; try { p = (await post('/api/flashcards/parse', { mode, content: text }, { retry: true })).preview; } catch { return; }   // mạng lỗi: lần gõ sau sẽ thử lại
    if (my !== seq) return;
    const bad = p.errors.length;
    sum.textContent = `${p.total} thẻ hợp lệ` + (bad ? ` · ${bad} lỗi cần sửa` : ' ✓'); sum.className = 'fce-sum ' + (bad ? 'bad' : 'ok');
    errs.replaceChildren(...p.errors.slice(0, 12).map((x) => h('li', null, x.line ? h('b', null, `Dòng ${x.line}: `) : null, x.message)), ...(p.errors.length > 12 ? [h('li', null, `… và ${p.errors.length - 12} lỗi khác`)] : []));
    hints.hidden = !(p.imageHints && p.imageHints.length);
    if (!hints.hidden) hints.textContent = `🖼 AI gợi ý các thẻ nên có ảnh: ${p.imageHints.join(', ')} (đặt con trỏ vào thẻ rồi bấm “Thêm ảnh”).`;
    cardsBox.replaceChildren(...p.cards.slice(0, 6).map((c, i) => {
      const img = c.image ? h('img', { alt: '' }) : null;
      if (img) { const m = /^\[img:(.+)\]$/.exec(c.image); if (m) imageUrl(m[1]).then((u) => { img.src = u; }).catch(() => img.remove()); }
      return h('div', { class: 'fce-card' }, h('small', null, `Thẻ ${i + 1}`), img, h('div', { class: 'f' }, brk(c.front)), c.ipa ? h('div', { class: 'p' }, `/${c.ipa}/`) : null, h('div', { class: 'b' }, brk(c.back)));
    }), ...(p.total > 6 ? [h('div', { class: 'muted', style: 'align-self:center' }, `… và ${p.total - 6} thẻ nữa`)] : []));
    typeset(cardsBox);
  }

  function updatePrompt() {
    let text = mode === 'theory' ? cfg.prompts.theory : cfg.prompts.language;
    if (mode === 'language') { const l = cfg.languages.find((x) => x.code === lang.value); text = text.replace(/\{LANG\}/g, (l ? l.label : 'Tiếng Anh').replace(/^Tiếng /, '')); }
    prompt.value = text;
  }
  function applyMode() {
    modes.querySelectorAll('.fce-mode').forEach((lb) => { const on = lb.dataset.mode === mode; lb.classList.toggle('on', on); lb.querySelector('input').checked = on; });
    langBox.hidden = mode !== 'language'; fmtLang.hidden = mode !== 'language'; fmtTheory.hidden = mode !== 'theory';
    updatePrompt(); schedule();
  }
  lang.addEventListener('change', () => { dirty = true; updatePrompt(); });
  content.addEventListener('input', () => { dirty = true; schedule(); });
  [title, subject, desc].forEach((el) => el.addEventListener('input', () => { dirty = true; }));

  // Chèn token ảnh ngay dưới phần "+)" của thẻ đang đặt con trỏ (thay ảnh cũ của thẻ nếu có)
  function insertImageLine(token) {
    const lines = content.value.split('\n'), pos = content.selectionStart || 0;
    const isFront = (l) => /^\s*\+\)/.test(l), isMarker = (l) => /^\s*(\+\+\)|=>|\+\))/.test(l);
    let start = content.value.slice(0, pos).split('\n').length - 1;
    while (start >= 0 && !isFront(lines[start])) start--;
    if (start < 0) start = lines.findIndex(isFront);
    if (start < 0) return false;
    let end = start + 1; while (end < lines.length && !isMarker(lines[end])) end++;
    const kept = lines.slice(start + 1, end).filter((l) => !/^\s*\[img:[^\]]+\]\s*$/.test(l));
    content.value = lines.slice(0, start + 1).concat(kept, [token], lines.slice(end)).join('\n');
    dirty = true; schedule(); return true;
  }
  const file = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/gif,image/webp', hidden: true });
  const upBtn = h('button', { type: 'button', class: 'btn small' }, '🖼️ Thêm ảnh'), upStatus = h('small', { class: 'muted' });
  upBtn.addEventListener('click', () => { file.value = ''; file.click(); });
  file.addEventListener('change', action(upBtn, async () => {
    const f = file.files[0]; if (!f) return;
    if (!/^\s*\+\)/m.test(content.value)) throw new Error('Hãy nhập ít nhất một dòng "+)" rồi đặt con trỏ vào thẻ cần thêm ảnh.');
    upStatus.textContent = '⏳ Đang nén và tải ảnh (mã hoá)…';
    const img = await uploadImage(f);
    if (!insertImageLine(`[img:${img.id}]`)) throw new Error('Không tìm thấy dòng "+)" để chèn ảnh.');
    upStatus.textContent = '✓ Đã tải ảnh (mã hoá) và chèn dưới dòng "+)" của thẻ.'; toast('Đã chèn ảnh vào thẻ', 'ok');
  }));

  const copy = h('button', { type: 'button', class: 'btn small' }, '📋 Sao chép');
  copy.addEventListener('click', async () => { try { await navigator.clipboard.writeText(prompt.value); toast('Đã sao chép prompt', 'ok'); } catch { prompt.select(); toast('Không tự sao chép được — hãy copy thủ công', 'err'); } });

  const save = h('button', { class: 'btn primary', type: 'button' }, isNew ? 'Tạo flashcard' : 'Lưu thay đổi');
  save.addEventListener('click', action(save, async () => {
    msg.hidden = true;
    const fail = (t, el) => { msg.textContent = t; msg.hidden = false; msg.scrollIntoView({ behavior: 'smooth', block: 'center' }); if (el) el.focus(); throw Object.assign(new Error(t), { handled: true }); };
    if (!title.value.trim()) fail('Vui lòng nhập tiêu đề.', title);
    if (!content.value.trim()) fail('Vui lòng nhập nội dung flashcard.', content);
    try { await put(`/api/flashcards/${id}`, { title: title.value, subject: subject.value, description: desc.value, mode, language: lang.value, content: content.value }); }
    catch (err) { msg.textContent = err.message; msg.hidden = false; msg.scrollIntoView({ behavior: 'smooth', block: 'center' }); throw Object.assign(err, { handled: true }); }
    dirty = false; toast('Đã lưu', 'ok'); ctx.go('/flashcards');
  }).bind(null));

  const beforeUnload = (ev) => { if (dirty) { ev.preventDefault(); ev.returnValue = ''; } };
  window.addEventListener('beforeunload', beforeUnload);
  ctx.setCleanup(() => { clearTimeout(timer); window.removeEventListener('beforeunload', beforeUnload); });

  const field = (label, el) => h('label', { class: 'field' }, h('span', null, label), el);
  const root = h('div', { class: 'stack' },
    h('div', null, h('a', { href: '#/flashcards' }, '← Flashcards'), h('h2', null, isNew ? 'Tạo flashcard' : 'Sửa flashcard'), h('p', { class: 'muted' }, 'Nhập nội dung theo định dạng bên dưới (hoặc nhờ AI chuyển đổi bằng prompt có sẵn).')),
    msg,
    h('div', { class: 'fce-grid' },
      h('div', { class: 'stack' },
        h('div', { class: 'card stack' },
          h('div', { class: 'row' }, field('Tiêu đề *', title), field('Môn / chủ đề', subject)), dl, field('Mô tả (tuỳ chọn)', desc),
          h('div', { class: 'stack' }, h('span', { class: 'lbl' }, 'Hình thức học *'), modes), langBox),
        h('div', { class: 'card stack' },
          h('div', { class: 'row between' }, h('h3', null, 'Nội dung flashcard'), h('div', { class: 'row' }, upBtn, file)), upStatus,
          h('div', { class: 'fce-fmt' }, fmtLang, fmtTheory, h('div', { style: 'margin-top:6px;font-family:inherit;color:var(--muted)' }, 'Mỗi thẻ cách nhau một dòng trống. Nội dung dài có thể viết nhiều dòng. Gõ ', h('code', null, '\\n'), ' để xuống dòng, công thức toán đặt trong ', h('code', null, '$...$'), '.')),
          content,
          h('div', null, sum, errs, hints, cardsBox)),
        h('div', { class: 'row' }, save, h('a', { class: 'btn ghost', href: '#/flashcards' }, 'Huỷ'))),
      h('div', { class: 'fce-side' }, h('div', { class: 'card stack' },
        h('div', { class: 'row between' }, h('h3', null, 'Prompt chuyển đổi bằng AI'), copy),
        h('p', { class: 'muted' }, 'Dán prompt này vào ChatGPT / Gemini kèm nội dung thô (danh sách từ, bài giảng…), rồi dán kết quả vào ô nội dung bên trái. Prompt tự đổi theo hình thức học đang chọn.'), prompt))));
  applyMode(); runPreview();
  return root;
}

// ───────────────────────── #/flashcard/:id  và  #/s/:shareId/play ─────────────────────────
/** opts.shareId + opts.item: học bộ thẻ được chia sẻ (id = shareId) — kết quả Kiểm tra gửi qua /api/shares/:id/submissions. */
export async function flashcardStudyPage(ctx, id, opts = {}) {
  const shared = opts.shareId || null;
  if (shared) imageCtx.share = shared;
  let item = opts.item, siblings = [];
  const cfgP = getConfig().catch(() => null);
  if (!item) {
    const [r, ov] = await Promise.all([get(`/api/flashcards/${id}`), get('/api/overview').catch(() => null)]);
    item = r.item;
    siblings = ov ? ov.flashcards.filter((f) => f.subject === item.subject).map((f) => ({ id: f.id, title: f.title, count: f.size })) : [];
  } else if (shared && !opts.isOwner) post(`/api/shares/${shared}/join`, {}).catch(() => {});   // nhớ bộ thẻ này trong "Được chia sẻ với tôi"
  const cfg = await cfgP;
  const langLabel = ((cfg && cfg.languages.find((l) => l.code === item.language)) || {}).label || item.language;
  const D = { id: shared ? `s_${shared}` : id, title: item.title, description: item.description || '', mode: item.mode, language: item.language, siblings,
    cards: (item.cards || []).map((c) => ({ id: c.id, front: c.front, back: c.back, ipa: c.ipa || '', image: c.image || '' })) };
  const startedAt = Date.now();
  const bridge = {
    onTest: async ({ ok, n }) => {
      const sid = newId(), body = { ok, total: n, startedAt: new Date(startedAt).toISOString(), durationSec: Math.round((Date.now() - startedAt) / 1000) };
      try {
        if (shared) await put(`/api/shares/${shared}/submissions/${sid}`, body, { retry: true });
        else await put(`/api/submissions/${sid}`, { itemType: 'flashcard', itemId: id, ...body }, { retry: true });
        toast('Đã lưu kết quả kiểm tra vào lịch sử', 'ok');
      } catch (e) { toast('Chưa lưu được kết quả kiểm tra: ' + e.message, 'err', 6000); }
    },
  };
  const own = !shared || !!opts.isOwner;
  const back = shared ? '#/flashcards' : '#/flashcards';
  const root = h('div');
  root.innerHTML = `
    ${historyBtnHtml(historyTarget({ type: 'flashcard', id, shareId: shared, ownShareId: item.shareId }), shared ? !!opts.isOwner : !!item.shareId)}
    <div class="fc" id="fcApp" data-mode="${esc(D.mode)}">
      <div class="fc-top">
        <a href="${back}" class="fc-back"><span>← ${esc(item.subject || 'Flashcards')}</span></a>
        <div class="fc-head"><h1>${esc(item.title)}</h1><p>${D.mode === 'language' ? `<span class="fc-badge fc-badge-lang">Học ngoại ngữ · ${esc(langLabel)}</span>` : '<span class="fc-badge fc-badge-theory">Học lý thuyết</span>'}${D.description ? `<span class="fc-desc">${esc(D.description)}</span>` : ''}</p></div>
        <div class="fc-tools"><div id="fcStat" class="fc-stat"></div>
          <div class="fc-zoom" role="group" aria-label="Cỡ chữ"><button type="button" id="fcZm" aria-label="Thu nhỏ chữ">A−</button><button type="button" id="fcZv" aria-label="Về cỡ mặc định">100%</button><button type="button" id="fcZp" aria-label="Phóng to chữ">A+</button></div></div>
      </div>
      <div class="fc-grid">
        <nav id="fcUnits" class="fc-units" aria-label="Các bộ flashcard cùng môn"></nav>
        <div class="fc-pane">
          <div id="fcModes" class="fc-modes" role="tablist">
            <button type="button" data-m="0" class="on" role="tab">🃏 Thẻ học</button><button type="button" data-m="1" role="tab">✍️ Luyện tập</button><button type="button" data-m="2" role="tab">📝 Kiểm tra</button></div>
          <div id="fcFilters" class="fc-filters">
            <button type="button" data-f="all" class="on">Tất cả</button><button type="button" data-f="todo">Chưa thuộc</button><button type="button" data-f="known">Đã thuộc</button>
            <button type="button" id="fcShuffle" class="fc-shuf" title="Xáo trộn thứ tự">🔀 Xáo</button></div>
          <section id="fcCard" class="fc-card"></section>
          <section id="fcRun" class="fc-card" hidden></section>
        </div>
      </div>
    </div>`;
  if (own && !shared) root.querySelector('.lesson-history-btn-wrap').append(h('a', { class: 'lhb', href: `#/flashcard/${id}/edit`, style: 'margin-left:10px' }, '✏️ Sửa bộ thẻ'), h('button', { class: 'lhb', type: 'button', style: 'margin-left:10px;cursor:pointer', onclick: async (ev) => { const b = ev.currentTarget; b.disabled = true; try { await openShareDialog({ type: 'flashcard', id, title: item.title }, (sid) => { if (sid) item.shareId = sid; }); } catch (e) { toast(e.message, 'err', 6000); } finally { b.disabled = false; } } }, '🔗 Chia sẻ'));
  const stopImg = watchEncryptedImages(root);
  let dispose = null;
  whenConnected(root, () => { dispose = mountFlashcardStudy(D, bridge); typeset(root); });
  ctx.setCleanup(() => { stopImg(); if (dispose) dispose(); });
  return root;
}
