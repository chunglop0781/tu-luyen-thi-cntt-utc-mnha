import { get, put, post, newId, imageCtx } from '../api.js';
import { h, action, toast, richOrHtml } from '../ui.js';
import { historyBtn, historyTarget } from '../historyBtn.js';
import { aiTitle, pickerAttrs, enhancePickers } from '../aiName.js';

const draftKey = (t, id) => `utc.draft.${t}.${id}`;
const loadDraft = (k) => { try { return JSON.parse(localStorage.getItem(k)) || null; } catch { return null; } };
const saveDraft = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* bỏ qua */ } };
const clearDraft = (k) => { try { localStorage.removeItem(k); } catch { /* bỏ qua */ } };
const AUDIO_SRC = new URL('../../musics/iphone-17-pro-max.mp3', import.meta.url).href;
const mmss = (sec) => `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;

/** CSS riêng của trang (tiền tố ep-) — không đụng style chung. */
function injectCss() {
  if (document.getElementById('ep-css')) return;
  const s = document.createElement('style'); s.id = 'ep-css';
  s.textContent = `
.ep-page{max-width:1400px;margin:28px auto 60px;padding:0 4%}.ep-page *{box-sizing:border-box}
.ep-prompt{padding:10px 14px;border-radius:10px;border:1px solid #c7d2fe;background:#eef2ff;color:#3730a3;font-size:14px;margin-bottom:14px}
.ep-prompt.fb{background:#f9fafb;border-color:#e5e7eb;color:#374151}.ep-prompt.bad{background:#fef2f2;border-color:#fecaca;color:#991b1b}
.ep-prompt small{opacity:.8}.ep-prompt .w{margin-top:4px;font-size:12px;font-weight:600}
.ep-audio{display:flex;align-items:center;gap:14px;flex-wrap:wrap;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px 16px;margin-bottom:14px}
.ep-audio .ico{font-size:22px}.ep-audio .t{font-weight:700;font-size:14px}.ep-audio .d{font-size:12px;color:var(--muted)}
.ep-audio audio{flex:1;min-width:220px;max-width:420px}
.ep-badge{display:inline-block;margin-left:8px;font-size:11px;font-weight:700;padding:2px 9px;border-radius:99px;background:#f1f5f9;color:#64748b}
.ep-audio.on .ep-badge{background:#fee2e2;color:#b91c1c;animation:ep-pulse 1s infinite}
.ep-bar{display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;background:var(--card);border:1px solid var(--line);border-radius:12px;box-shadow:var(--sh);padding:12px 16px;margin-bottom:14px}
.ep-bar .info{display:flex;align-items:center;gap:10px;min-width:0}.ep-bar .ic{width:36px;height:36px;border-radius:50%;background:var(--soft);display:flex;align-items:center;justify-content:center;font-size:18px;flex:none}
.ep-bar .tt{font-weight:800;font-size:14px}.ep-bar .ds{font-size:12px;color:var(--muted)}
.ep-sel{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.ep-sel label{font-weight:700;font-size:13px}
.ep-sel select,.ep-sel input{width:auto;max-width:240px;padding:6px 10px;font-size:13px}
.ep-st{display:flex;align-items:center;gap:8px}
.ep-pill{display:inline-flex;align-items:center;gap:8px;padding:7px 12px;border-radius:20px;font-size:13px;font-weight:700;border:1px solid #e3e3e3;background:#f8fafc;color:#64748b;white-space:nowrap}
.ep-pill i{width:9px;height:9px;border-radius:50%;background:#94a3b8;display:block}
.ep-pill.checking{background:#eff6ff;color:#2563eb;border-color:#bfdbfe}.ep-pill.checking i{background:#2563eb;animation:ep-pulse 1s infinite}
.ep-pill.ok{background:#f0fdf4;color:#16834b;border-color:#bbf7d0}.ep-pill.ok i{background:#16834b}
.ep-pill.err{background:#fef2f2;color:#dc2626;border-color:#fecaca}.ep-pill.err i{background:#dc2626}
.ep-head{border-left:5px solid var(--pri);margin-bottom:14px}.ep-head h1{font-size:22px;margin:0 0 4px}.ep-head p{margin:0;color:var(--muted);font-size:14px}
.ep-layout{display:grid;grid-template-columns:minmax(0,.95fr) minmax(0,1.25fr);gap:16px;align-items:start}
@media(max-width:900px){.ep-layout{grid-template-columns:1fr}}
.ep-panel{background:var(--card);border:1px solid var(--line);border-radius:12px;box-shadow:var(--sh);overflow:hidden}
.ep-ph{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 20px;border-bottom:1px solid var(--line)}.ep-ph h3{margin:0;font-size:17px}.ep-ph span{color:var(--muted);font-size:13px}
.ep-pb{padding:20px}
.ep-timer{font-weight:800;font-size:14px;min-width:70px;text-align:center;padding:6px 12px;border-radius:8px;border:1px solid #fecdd3;background:#fff1f2;color:#a61c2f;font-variant-numeric:tabular-nums}
.ep-timer.wait{background:#f8fafc;color:#64748b;border-color:#cbd5e1}.ep-timer.warn{background:#fff7ed;color:#d97706;border-color:#fed7aa}
.ep-timer.danger,.ep-timer.fin{background:#fef2f2;color:#dc2626;border-color:#fecaca}.ep-timer.fin{animation:ep-pulse 1s infinite}
.ep-lock{display:none;margin-bottom:12px;padding:10px 13px;border-radius:7px;background:#eff6ff;border:1px solid #bfdbfe;color:#1d4ed8;font-size:13px;font-weight:700}.ep-lock.show{display:block}
.ep-tabs{display:flex;gap:8px;margin-bottom:14px;border-bottom:2px solid #eee}.ep-tab{display:inline-flex;align-items:center;gap:8px;padding:9px 16px;margin-bottom:-2px;border-bottom:3px solid var(--pri);font-size:14px;font-weight:800;color:var(--pri)}
.ep-info{display:flex;justify-content:space-between;gap:15px;color:var(--muted);font-size:13px}.ep-wc{font-weight:700;color:#d97706}.ep-wc.good{color:#16834b}
.ep-actions{display:flex;flex-direction:column;gap:10px;margin-top:6px}.ep-actions .row{gap:10px}.ep-clear{background:#f3f4f6;border:1px solid #e3e3e3;padding:8px 14px;border-radius:7px;font-weight:700;font-size:13px;cursor:pointer;color:#334155}.ep-clear:hover{background:#e5e7eb}.ep-clear:disabled{opacity:.5;cursor:not-allowed}
.ep-submit{min-height:48px;font-size:15px;font-weight:800;border-radius:7px}
.ep-write{width:100%;min-height:440px;resize:vertical;border:1px solid #d7d7d7;border-radius:8px;padding:18px;font:inherit;font-size:16px;line-height:1.8;background:repeating-linear-gradient(to bottom,var(--card) 0,var(--card) 31px,#eeeeee 32px)}
.ep-write:disabled{opacity:.55;cursor:not-allowed}
@keyframes ep-pulse{0%,100%{opacity:1}50%{opacity:.35}}`;
  document.head.append(s);
}

/** ⚠️ KHÔNG thêm tab "Vẽ tay (JS Paint)", tải ảnh viết tay (photoToPaint) hay tải PDF → ảnh vào trang này — chủ dự án đã chủ động bỏ (xem AI-NOTES.md). Bài tự luận CHỈ nhập chữ.
 *  Làm bài tự luận — giống trang làm bài của luyen-thi-cntt-utc-mnha: hiện prompt chấm đang dùng, âm báo hết giờ, thanh AI (chọn nhà cung cấp/model, kiểm tra kết nối),
 *  bố cục 2 cột, khoá làm bài tới khi AI kết nối, nộp xong tự chấm AI. Bản nháp tự lưu trong trình duyệt; id bài nộp cố định nên gửi lại khi rớt mạng không bị trùng.
 *  opts.shareId + opts.item: làm bài được chia sẻ (id = shareId) — nộp qua /api/shares/:id/submissions. (Phần vẽ tay / tải ảnh-PDF của bản cũ không có ở bản này.) */
export async function essayPractice(ctx, id, opts = {}) {
  injectCss();
  const shared = opts.shareId || null;
  if (shared) imageCtx.share = shared;
  const [{ item }, ai, pr] = await Promise.all([
    opts.item ? Promise.resolve({ item: opts.item }) : get(`/api/essays/${id}`),
    Promise.all([get('/api/ai/providers'), get('/api/me/vault')]).then(([a, b]) => ({ providers: a.providers, vault: b.vault })).catch(() => null),
    shared ? Promise.resolve(null) : get(`/api/prompts/resolve?type=essay&itemId=${encodeURIComponent(id)}`).then((r) => r.prompt).catch(() => null),
  ]);
  const key = draftKey('essay', id);
  const d = loadDraft(key) || { subId: newId(), text: '', startedAt: null, started: false };
  const limit = item.duration ? item.duration * 60 : null;           // đếm ngược nếu bài có đặt thời gian; hết giờ tự nộp phần đã viết

  // ── Prompt chấm đang dùng ──
  let banner = null;
  if (pr) {
    const scope = { item: 'gắn riêng cho bài này', default: 'prompt mặc định của bạn', fallback: 'mẫu hệ thống' }[pr.scope] || '';
    const bad = pr.unknownPlaceholders && pr.unknownPlaceholders.length;
    banner = h('div', { class: `ep-prompt${bad ? ' bad' : pr.scope === 'fallback' ? ' fb' : ''}` },
      h('strong', null, '🧠 Prompt chấm đang dùng cho bài này: '), pr.name, ' ', h('small', null, `(${scope})`), ' ', h('a', { href: '#/prompts' }, 'Sửa prompt →'),
      bad ? h('div', { class: 'w' }, `⚠️ Prompt có biến chưa nhận diện: ${pr.unknownPlaceholders.join(', ')} — vào Prompt AI để sửa tên biến.`) : null);
  } else if (shared) banner = h('div', { class: 'ep-prompt fb' }, h('strong', null, '🧠 Prompt chấm: '), 'do chủ bài gắn cho bài này (không thì dùng mẫu hệ thống).');

  // ── Âm thanh báo hết giờ: khoá tới khi đồng hồ về 00:00, phát lặp, tắt khi nộp ──
  const audio = h('audio', { controls: true, preload: 'auto', src: AUDIO_SRC }, 'Trình duyệt không hỗ trợ thẻ audio.'); audio.loop = true;
  const aBadge = h('span', { class: 'ep-badge' }, '🔒 Đang khoá');
  const aBar = h('div', { class: 'ep-audio' }, h('div', { class: 'ico' }, '🔊'),
    h('div', null, h('div', { class: 't' }, 'Âm thanh báo hết giờ', aBadge), h('div', { class: 'd' }, 'Chỉ tự phát lặp khi đồng hồ về 00:00 — tự tắt khi bạn nộp bài.')), audio);
  let timeUp = false;
  audio.addEventListener('play', () => { if (!timeUp) { audio.pause(); toast('Âm thanh chỉ phát khi hết giờ', 'warn', 2000); } });
  const stopAudio = () => { try { audio.pause(); audio.currentTime = 0; } catch { /* bỏ qua */ } aBar.classList.remove('on'); };

  // ── Thanh AI ──
  const ready = ai ? ai.providers.filter((p) => p.enabled !== false && (ai.vault.items[p.id] || {}).keySet) : [];
  let cur = ready.length ? (ready.some((p) => p.id === ai.vault.provider) ? ai.vault.provider : ready[0].id) : null;
  let connected = false;
  const desc = h('div', { class: 'ds' }, ready.length ? 'Chưa kiểm tra kết nối.' : 'Chưa có API key AI nào.');
  const pillTxt = h('span', null, 'Chưa kiểm tra'); const pill = h('div', { class: 'ep-pill' }, h('i'), pillTxt);
  const setPill = (kind, txt, dsc) => { pill.className = `ep-pill ${kind}`; pillTxt.textContent = txt; if (dsc != null) desc.textContent = dsc; };
  const selBox = h('div', { class: 'ep-sel' });
  const checkBtn = h('button', { class: 'btn small', type: 'button' }, '🔄 Kiểm tra AI');
  const rndBtn = h('button', { class: 'btn small', type: 'button', title: 'Chọn ngẫu nhiên model' }, '🎲');
  let provSel = null, modelEl = null;
  const prov = () => (ai ? ai.providers.find((p) => p.id === cur) : null);
  const modelVal = () => (modelEl && modelEl.value || '').trim() || undefined;
  const drawSel = () => {
    if (!ready.length) { selBox.replaceChildren(h('a', { class: 'btn small', href: '#/settings/ai' }, 'Thêm API key AI →')); rndBtn.hidden = true; checkBtn.disabled = true; return; }
    const p = prov(), saved = (ai.vault.items[cur] || {}).model || '';
    provSel = h('select', { id: 'epProv', 'aria-label': 'AI', ...pickerAttrs('ai') }, ...ready.map((x) => h('option', { value: x.id, selected: x.id === cur }, aiTitle(x, ai.vault.items[x.id]))));
    provSel.addEventListener('change', () => { cur = provSel.value; connected = false; lockUi(); drawSel(); setPill('', 'Chưa kiểm tra', 'Đổi nhà cung cấp — hãy kiểm tra lại kết nối.'); });
    if (p.allowCustomModel) modelEl = h('input', { id: 'epModel', list: 'ep-models', value: saved, placeholder: `Model (mặc định: ${p.defaultModel})`, maxlength: 100, autocomplete: 'off', 'aria-label': 'Model' });
    else modelEl = h('select', { id: 'epModel', 'aria-label': 'Model', ...pickerAttrs('model') }, h('option', { value: '', selected: !saved }, `Mặc định (${p.defaultModel})`), ...p.models.map((m) => h('option', { value: m, selected: m === saved }, m)));
    modelEl.addEventListener('change', () => { if (connected) { connected = false; lockUi(); setPill('', 'Chưa kiểm tra', 'Đổi model — hãy kiểm tra lại kết nối.'); } });
    selBox.replaceChildren(h('div', null, h('label', { for: 'epProv' }, '🔑 AI: '), provSel), h('div', null, h('label', { for: 'epModel' }, '🤖 Model: '), modelEl),
      ...(p.allowCustomModel ? [h('datalist', { id: 'ep-models' }, ...p.models.map((m) => h('option', { value: m })))] : []), rndBtn);
    rndBtn.hidden = !(p.models && p.models.length);
    enhancePickers(selBox);          // ô chọn AI / model có tìm kiếm (chép từ subjectPicker.js của luyen-thi)
  };
  rndBtn.addEventListener('click', () => { const p = prov(); if (!p || !p.models.length) return; modelEl.value = p.models[Math.floor(Math.random() * p.models.length)]; modelEl.dispatchEvent(new Event('change')); });

  // ── Bài viết + đồng hồ ──
  const ta = h('textarea', { class: 'ep-write', placeholder: 'Viết bài làm của bạn ở đây…', disabled: true }); ta.value = d.text;
  const timer = h('div', { class: 'ep-timer wait' }, limit ? mmss(limit) : '');
  const lock = h('div', { class: 'ep-lock show' }, limit ? '🔒 Hãy kết nối AI thành công để bắt đầu tính giờ.' : '🔒 Hãy kết nối AI thành công để bắt đầu làm bài.');
  const SUBMIT_LABEL = '🚀 Nộp bài & chấm AI';
  const submit = h('button', { class: 'btn primary ep-submit', disabled: true }, SUBMIT_LABEL);
  const wc = h('span', { class: 'ep-wc' }, '0 từ');
  const countWords = () => { const n = (ta.value.trim().match(/\S+/g) || []).length; wc.textContent = `${n} từ`; wc.className = `ep-wc${n >= 50 ? ' good' : ''}`; };
  const clearBtn = h('button', { class: 'ep-clear', type: 'button', disabled: true }, '🗑 Xoá bài');
  clearBtn.addEventListener('click', () => { if (!ta.value || !confirm('Xoá toàn bộ bài đã viết?')) return; ta.value = ''; d.text = ''; saveDraft(key, d); countWords(); ta.focus(); });
  let tick = null, up = false, busy = false;
  ctx.setCleanup(() => { clearInterval(tick); stopAudio(); });
  const lockUi = () => { ta.disabled = true; submit.disabled = true; clearBtn.disabled = true; lock.classList.add('show'); };
  const unlockUi = () => { ta.disabled = false; submit.disabled = false; clearBtn.disabled = false; lock.classList.remove('show'); };
  function startTimer() {
    if (tick) return;
    const now = Date.now();
    if (!d.started || !d.startedAt || (limit && (now - new Date(d.startedAt)) / 1000 >= limit)) { d.startedAt = new Date(now).toISOString(); d.started = true; }
    saveDraft(key, d);
    if (!limit) return;
    const upd = () => {
      const left = Math.max(0, Math.round(limit - (Date.now() - new Date(d.startedAt)) / 1000));
      timer.textContent = mmss(left); timer.className = `ep-timer${left === 0 ? ' fin' : left <= 60 ? ' danger' : left <= 300 ? ' warn' : ''}`;
      if (left === 0 && !up) {
        up = true; clearInterval(tick); timeUp = true; aBadge.textContent = '🔔 Đang phát'; aBar.classList.add('on');
        audio.play().catch(() => toast('Hết giờ — bấm ▶ để nghe chuông', 'warn'));
        toast('Hết giờ — đang nộp bài…', 'warn'); submit.click();
      }
    };
    upd(); tick = setInterval(upd, 1000);
  }
  ta.addEventListener('input', () => { d.text = ta.value; saveDraft(key, d); countWords(); });
  countWords();

  checkBtn.addEventListener('click', async () => {
    if (!cur || checkBtn.disabled) return;
    checkBtn.disabled = true; setPill('checking', 'Đang kiểm tra…', 'Đang thử kết nối bằng key của bạn…');
    try {
      const r = (await post('/api/ai/test', { provider: cur, model: modelVal() }, { timeout: 60000 })).result;
      connected = true; setPill('ok', 'Đã kết nối', `${r.name ? r.name + ' — ' : ''}${r.label} · model ${r.model} · ${r.ms}ms${r.fallbackFrom ? ` (model ${r.fallbackFrom} quá tải, tự chuyển)` : ''}`);
      if (!up) { unlockUi(); startTimer(); ta.focus(); }
    } catch (e) { connected = false; setPill('err', 'Lỗi kết nối', e.message || 'Không kết nối được AI'); lockUi(); }
    finally { checkBtn.disabled = false; }
  });
  drawSel();

  submit.addEventListener('click', async () => {
    if (busy) return; busy = true; clearInterval(tick); submit.disabled = true; submit.textContent = '⏳ Đang nộp…';
    try {
      if (!ta.value.trim()) { if (up) { clearDraft(key); stopAudio(); ctx.go('/'); return; } throw new Error('Bài làm đang trống'); }
      const body = { text: ta.value, startedAt: d.startedAt, durationSec: (Date.now() - new Date(d.startedAt)) / 1000 };
      const r = shared ? await put(`/api/shares/${shared}/submissions/${d.subId}`, body, { retry: true }) : await put(`/api/submissions/${d.subId}`, { itemType: 'essay', itemId: id, ...body }, { retry: true });
      clearDraft(key); stopAudio();
      submit.textContent = '🤖 AI đang chấm…'; toast('Đã nộp bài — AI đang chấm…', 'ok');
      try { await post(`/api/submissions/${r.submission.id}/ai-grade`, { provider: cur, model: modelVal() }, { timeout: 70000 }); toast('AI đã chấm xong', 'ok'); }
      catch (e) { toast(`Đã nộp nhưng chưa chấm được: ${e.message}. Bạn chấm lại ở trang kết quả.`, 'warn', 7000); }
      ctx.go(`/submission/${r.submission.id}`);
    } catch (e) { toast(e.message, 'err'); busy = false; if (!up && connected) { submit.disabled = false; startTimer(); } submit.textContent = SUBMIT_LABEL; }
  });

  const histHref = historyTarget({ type: 'essay', id, shareId: shared, ownShareId: item.shareId });
  const histOwner = shared ? !!opts.isOwner : !!item.shareId;
  if (ready.length) setTimeout(() => checkBtn.click(), 0);          // tự kiểm tra kết nối khi vào trang
  return h('div', { class: 'ep-page' },
    h('div', { class: 'row between', style: 'margin-bottom:12px' }, h('a', { class: 'btn ghost small', href: '#/' }, '← Quay lại')),
    banner, aBar, historyBtn(histHref, histOwner),
    h('div', { class: 'ep-bar' },
      h('div', { class: 'info' }, h('div', { class: 'ic' }, '🤖'), h('div', null, h('div', { class: 'tt' }, 'Trạng thái AI chấm bài'), desc)),
      selBox, h('div', { class: 'ep-st' }, pill, checkBtn)),
    h('div', { class: 'card ep-head' }, h('h1', null, item.title), h('p', null, item.subject ? `${item.subject} • ` : '', 'Nộp bài — AI chấm tự động')),
    h('div', { class: 'ep-layout' },
      h('div', { class: 'ep-panel' }, h('div', { class: 'ep-ph' }, h('h3', null, 'Đề bài'), h('span', null, limit ? `${item.duration} phút` : 'Không đếm giờ')),
        h('div', { class: 'ep-pb' }, item.prompt ? richOrHtml(item.prompt) : h('p', { class: 'muted' }, '(Chưa có nội dung đề bài)'))),
      h('div', { class: 'ep-panel' }, h('div', { class: 'ep-ph' }, h('h3', null, '✍️ Bài viết của bạn'), limit ? timer : h('span', null, '∞ Không giới hạn thời gian')),
        h('div', { class: 'ep-pb stack' }, lock, h('div', { class: 'ep-tabs' }, h('span', { class: 'ep-tab' }, '⌨️ Nhập chữ')), ta, h('div', { class: 'ep-info' }, wc, h('span', null, 'Mục tiêu: xem đề bài')), h('small', { class: 'muted' }, '💾 Bản nháp tự lưu trên máy bạn.'),
          shared ? h('small', { class: 'muted' }, '🤖 Nộp xong AI tự chấm bằng API key của bạn — bài chia sẻ chỉ chấm một lần, không xoá được.') : null,
          h('div', { class: 'ep-actions' }, h('div', { class: 'row' }, clearBtn, h('a', { class: 'btn ghost', href: '#/' }, 'Thoát')), submit)))));
}
