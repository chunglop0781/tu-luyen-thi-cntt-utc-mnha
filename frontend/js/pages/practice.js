import { get, put, post, newId, imageCtx } from '../api.js';
import { h, action, toast, richOrHtml } from '../ui.js';
import { historyBtn, historyTarget } from '../historyBtn.js';
import { aiTitle, pickerAttrs, enhancePickers, modelSelect } from '../aiName.js';
import { lockSeek } from '../alarmSeekLock.js';

const draftKey = (t, id) => `utc.draft.${t}.${id}`;
const loadDraft = (k) => { try { return JSON.parse(localStorage.getItem(k)) || null; } catch { return null; } };
const saveDraft = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* bỏ qua */ } };
const clearDraft = (k) => { try { localStorage.removeItem(k); } catch { /* bỏ qua */ } };
const AUDIO_SRC = new URL('../../musics/iphone-17-pro-max.mp3', import.meta.url).href;
const mmss = (sec) => `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;

/** ⚠️ KHÔNG thêm tab "Vẽ tay (JS Paint)", tải ảnh viết tay (photoToPaint) hay tải PDF → ảnh vào trang này — chủ dự án đã chủ động bỏ (xem AI-NOTES.md). Bài tự luận CHỈ nhập chữ.
 *  Làm bài tự luận — giống trang làm bài của luyen-thi-cntt-utc-mnha: hiện prompt chấm đang dùng, âm báo hết giờ, thanh AI (chọn nhà cung cấp/model, kiểm tra kết nối),
 *  bố cục 2 cột, khoá làm bài tới khi AI kết nối, nộp xong tự chấm AI. Bản nháp tự lưu trong trình duyệt; id bài nộp cố định nên gửi lại khi rớt mạng không bị trùng.
 *  opts.shareId + opts.item: làm bài được chia sẻ (id = shareId) — nộp qua /api/shares/:id/submissions. (Phần vẽ tay / tải ảnh-PDF của bản cũ không có ở bản này.) */
export async function essayPractice(ctx, id, opts = {}) {
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
    banner = h('div', { class: `prompt-banner${bad ? ' bad' : pr.scope === 'fallback' ? ' fb' : ''}` },
      h('strong', null, '🧠 Prompt chấm đang dùng cho bài này: '), pr.name, ' ', h('small', null, `(${scope})`), ' ', h('a', { href: '#/prompts' }, 'Sửa prompt →'),
      bad ? h('div', { class: 'w', style: 'margin-top:4px;font-size:12px;font-weight:600' }, `⚠️ Prompt có biến chưa nhận diện: ${pr.unknownPlaceholders.join(', ')} — vào Prompt AI để sửa tên biến.`) : null);
  } else if (shared) banner = h('div', { class: 'prompt-banner fb' }, h('strong', null, '🧠 Prompt chấm: '), 'do chủ bài gắn cho bài này (không thì dùng mẫu hệ thống).');

  // ── Âm thanh báo hết giờ (markup/class chép từ lesson.pug): khoá tới 00:00, phát lặp, KHOÁ TUA, tắt khi nộp ──
  let up = false, busy = false, done = false, tick = null;
  const audio = h('audio', { controls: true, preload: 'auto', src: AUDIO_SRC }, 'Trình duyệt của bạn không hỗ trợ thẻ audio.'); audio.loop = true;
  const seek = lockSeek(audio);
  const aBadge = h('span', { class: 'audio-badge' }, '🔒 Đang khoá');
  const aBar = h('div', { id: 'audioBar', class: 'audio-bar locked' }, h('div', { class: 'audio-bar-icon' }, '🔊'),
    h('div', { class: 'audio-bar-info' }, h('div', { class: 'title' }, 'Âm thanh báo hết giờ', aBadge), h('div', { class: 'desc' }, 'Chỉ tự động phát lặp khi đồng hồ về 00:00 — tự tắt khi bạn nộp bài.')), audio);
  const canPlayAlarm = () => up && !done;
  const audioState = () => {
    if (canPlayAlarm()) { aBar.classList.remove('locked'); aBar.classList.add('unlocked'); aBadge.textContent = '🔓 Đã mở khoá'; }
    else { aBar.classList.add('locked'); aBar.classList.remove('unlocked'); aBadge.textContent = done ? '✓ Đã nộp' : '🔒 Đang khoá'; }
  };
  let intentionalStop = false;
  const hardStop = () => { intentionalStop = true; seek.reset(); try { audio.loop = false; audio.pause(); audio.currentTime = 0; } catch { /* bỏ qua */ } setTimeout(() => { intentionalStop = false; }, 60); };
  const playAlarm = () => { try { audio.loop = true; seek.reset(); audio.currentTime = 0; audio.play().catch(() => toast('Hết giờ — bấm ▶ để nghe chuông', 'warn')); } catch { /* bỏ qua */ } };
  const stopAudio = () => { hardStop(); audioState(); };
  audio.addEventListener('play', () => { if (!canPlayAlarm()) { hardStop(); toast('Âm thanh chỉ phát khi đồng hồ về 00:00 (hết giờ)', 'warn', 2000); } });
  audio.addEventListener('pause', () => {      // đang hết giờ mà bấm tạm dừng → tự phát lại để chuông lặp liên tục
    if (intentionalStop || !canPlayAlarm()) return;
    setTimeout(() => { if (canPlayAlarm() && audio.paused) { try { audio.loop = true; audio.play().catch(() => {}); } catch { /* bỏ qua */ } } }, 400);
  });

  // ── Thanh AI ──
  const ready = ai ? ai.providers.filter((p) => p.enabled !== false && (ai.vault.items[p.id] || {}).keySet) : [];
  let cur = ready.length ? (ready.some((p) => p.id === ai.vault.provider) ? ai.vault.provider : ready[0].id) : null;
  let connected = false;
  const desc = h('div', { class: 'ai-desc', id: 'aiDesc' }, ready.length ? 'Chưa kiểm tra kết nối.' : 'Chưa có API key AI nào.');
  const pillTxt = h('span', { id: 'aiStatusText' }, 'Chưa kiểm tra'); const pill = h('div', { id: 'aiStatusPill', class: 'ai-status-pill' }, h('span', { class: 'dot' }), pillTxt);
  const setPill = (kind, txt, dsc) => { pill.className = `ai-status-pill ${kind}`; pillTxt.textContent = txt; if (dsc != null) desc.textContent = dsc; };
  const selBox = h('div', { class: 'ai-selectors' });
  const checkBtn = h('button', { class: 'btn-check', id: 'aiCheckBtn', type: 'button' }, '🔄 Kiểm tra AI');
  const rndBtn = h('button', { class: 'btn-outline', type: 'button', title: 'Chọn ngẫu nhiên model' }, '🎲');
  let provSel = null, modelEl = null;
  const prov = () => (ai ? ai.providers.find((p) => p.id === cur) : null);
  const modelVal = () => (modelEl && modelEl.value || '').trim() || undefined;
  const drawSel = () => {
    if (!ready.length) { selBox.replaceChildren(h('a', { class: 'btn-outline', href: '#/settings/ai', style: 'text-decoration:none' }, 'Thêm API key AI →')); rndBtn.hidden = true; checkBtn.disabled = true; return; }
    const p = prov(), saved = (ai.vault.items[cur] || {}).model || '';
    provSel = h('select', { id: 'epProv', 'aria-label': 'AI', ...pickerAttrs('ai') }, ...ready.map((x) => h('option', { value: x.id, selected: x.id === cur }, aiTitle(x, ai.vault.items[x.id]))));
    provSel.addEventListener('change', () => { cur = provSel.value; connected = false; lockUi(); drawSel(); setPill('', 'Chưa kiểm tra', 'Đổi nhà cung cấp — hãy kiểm tra lại kết nối.'); });
    modelEl = modelSelect(p, saved); modelEl.id = 'epModel';
    modelEl.addEventListener('change', () => { if (connected) { connected = false; lockUi(); setPill('', 'Chưa kiểm tra', 'Đổi model — hãy kiểm tra lại kết nối.'); } });
    selBox.replaceChildren(h('div', { class: 'field' }, h('label', { for: 'epProv' }, '🔑 AI Key:'), provSel), h('div', { class: 'field' }, h('label', { for: 'epModel' }, '🤖 Model:'), modelEl),
      rndBtn);
    rndBtn.hidden = !(p.models && p.models.length);
    enhancePickers(selBox);          // ô chọn AI / model có tìm kiếm (chép từ subjectPicker.js của luyen-thi)
  };
  rndBtn.addEventListener('click', () => { const p = prov(); if (!p || !p.models.length) return; modelEl.value = p.models[Math.floor(Math.random() * p.models.length)]; modelEl.dispatchEvent(new Event('change')); });

  // ── Bài viết + đồng hồ ──
  const ta = h('textarea', { id: 'writingInput', class: 'writing-input', placeholder: 'Nhập bài làm của bạn vào đây...', disabled: true }); ta.value = d.text;
  const timer = h('div', { id: 'timer', class: 'timer waiting' }, limit ? mmss(limit) : '');
  const lock = h('div', { id: 'lockMessage', class: 'lock-msg show' }, limit ? '🔒 Hãy kết nối AI thành công để bắt đầu tính giờ.' : '🔒 Hãy kết nối AI thành công để bắt đầu làm bài.');
  const SUBMIT_LABEL = '🚀 Nộp bài & chấm AI';
  const submit = h('button', { id: 'submitBtn', class: 'btn-submit', disabled: true }, SUBMIT_LABEL);
  const wc = h('span', { id: 'wordCount', class: 'word-count low' }, '0 từ');
  const countWords = () => { const n = (ta.value.trim().match(/\S+/g) || []).length; wc.textContent = `${n} từ`; wc.className = `word-count ${n >= 80 ? 'good' : 'low'}`; };
  const clearBtn = h('button', { id: 'clearBtn', class: 'btn-outline', type: 'button', disabled: true }, '🗑 Xoá bài');
  clearBtn.addEventListener('click', () => { if (!ta.value || !confirm('Xoá toàn bộ bài đã viết?')) return; ta.value = ''; d.text = ''; saveDraft(key, d); countWords(); ta.focus(); });
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
      timer.textContent = mmss(left); timer.className = `timer${left === 0 ? ' finished' : left <= 60 ? ' danger' : left <= 300 ? ' warning' : ''}`;
      if (left === 0 && !up) {
        up = true; clearInterval(tick); audioState(); lock.textContent = '⏰ Hết giờ! Đang nộp bài…'; lock.className = 'lock-msg show timeup';
        playAlarm();
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
      connected = true; setPill('connected', 'Đã kết nối', `${r.name ? r.name + ' — ' : ''}${r.label} · model ${r.model} · ${r.ms}ms${r.fallbackFrom ? ` (model ${r.fallbackFrom} quá tải, tự chuyển)` : ''}`);
      if (!up) { unlockUi(); startTimer(); ta.focus(); }
    } catch (e) { connected = false; setPill('error', 'Lỗi kết nối', e.message || 'Không kết nối được AI'); lockUi(); }
    finally { checkBtn.disabled = false; }
  });
  drawSel();

  submit.addEventListener('click', async () => {
    if (busy) return; busy = true; clearInterval(tick); submit.disabled = true; submit.textContent = '⏳ Đang nộp…';
    try {
      if (!ta.value.trim()) { if (up) { clearDraft(key); done = true; stopAudio(); ctx.go('/'); return; } throw new Error('Bài làm đang trống'); }
      const body = { text: ta.value, startedAt: d.startedAt, durationSec: (Date.now() - new Date(d.startedAt)) / 1000 };
      const r = shared ? await put(`/api/shares/${shared}/submissions/${d.subId}`, body, { retry: true }) : await put(`/api/submissions/${d.subId}`, { itemType: 'essay', itemId: id, ...body }, { retry: true });
      clearDraft(key); done = true; stopAudio();
      submit.textContent = '🤖 AI đang chấm…'; toast('Đã nộp bài — AI đang chấm…', 'ok');
      try { await post(`/api/submissions/${r.submission.id}/ai-grade`, { provider: cur, model: modelVal() }, { timeout: 70000 }); toast('AI đã chấm xong', 'ok'); }
      catch (e) { toast(`Đã nộp nhưng chưa chấm được: ${e.message}. Bạn chấm lại ở trang kết quả.`, 'warn', 7000); }
      ctx.go(`/submission/${r.submission.id}`);
    } catch (e) { toast(e.message, 'err'); busy = false; if (!up && connected) { submit.disabled = false; startTimer(); } submit.textContent = SUBMIT_LABEL; }
  });

  const histHref = historyTarget({ type: 'essay', id, shareId: shared, ownShareId: item.shareId });
  const histOwner = shared ? !!opts.isOwner : !!item.shareId;
  if (ready.length) setTimeout(() => checkBtn.click(), 0);          // tự kiểm tra kết nối khi vào trang
  return h('div', { class: 'lesson-page' },
    h('div', { style: 'margin-bottom:20px' }, h('a', { class: 'btn ghost small', href: '#/' }, '← Quay lại')),
    banner, aBar, historyBtn(histHref, histOwner),
    h('div', { class: 'ai-bar' },
      h('div', { class: 'ai-bar-info' }, h('div', { class: 'ai-icon' }, '🤖'), h('div', null, h('div', { class: 'ai-title' }, 'Trạng thái AI chấm bài'), desc)),
      selBox, h('div', { class: 'ai-status-wrap' }, pill, checkBtn)),
    h('div', { class: 'lesson-header' }, h('h1', null, item.title), h('p', null, item.subject ? `${item.subject} • ` : '', 'Nộp bài — AI chấm tự động')),
    h('div', { class: 'lesson-layout' },
      h('div', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h3', null, 'Đề bài'), h('span', null, limit ? `${item.duration} phút` : 'Không đếm giờ')),
        h('div', { class: 'panel-body' }, item.prompt ? richOrHtml(item.prompt) : h('p', { style: 'color:#6f6f6f;font-style:italic' }, '(Chưa có nội dung đề bài)'))),
      h('div', { class: 'panel writing-panel' }, h('div', { class: 'panel-head' }, h('h3', null, '✍️ Bài viết của bạn'), limit ? timer : h('span', { style: 'font-size:12px;font-weight:600' }, '∞ Không giới hạn thời gian')),
        h('div', { class: 'panel-body' }, lock, h('div', { class: 'write-tabs', role: 'tablist' }, h('button', { type: 'button', class: 'write-tab active', role: 'tab' }, '⌨️ Nhập chữ')), ta,
          h('div', { class: 'writing-info' }, wc, h('span', null, 'Mục tiêu: xem đề bài')),
          h('small', { class: 'muted', style: 'display:block;margin-top:8px' }, '💾 Bản nháp tự lưu trên máy bạn.'),
          shared ? h('small', { class: 'muted', style: 'display:block;margin-top:4px' }, '🤖 Nộp xong AI tự chấm bằng API key của bạn — bài chia sẻ chỉ chấm một lần, không xoá được.') : null,
          h('div', { class: 'actions' }, clearBtn, h('a', { class: 'btn-outline', href: '#/', style: 'text-decoration:none;display:inline-flex;align-items:center' }, 'Thoát'), submit)))));
}
