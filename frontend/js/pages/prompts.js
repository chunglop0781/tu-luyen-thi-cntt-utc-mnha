import { get, put, del, newId } from '../api.js';
import { h, action, toast, confirmBox } from '../ui.js';

// Prompt chấm / phân tích AI RIÊNG của từng tài khoản (chuyển từ trang admin prompt của bản cũ luyen-thi-cntt-utc-mnha).
const KIND = {
  essay: { title: 'Chấm bài tự luận', short: 'Tự luận', pick: 'Prompt chấm AI', desc: 'AI dùng prompt này để chấm điểm bài tự luận.' },
  quiz: { title: 'Phân tích bài trắc nghiệm', short: 'Trắc nghiệm', pick: 'Prompt phân tích AI', desc: 'AI dùng prompt này để phân tích lỗ hổng kiến thức sau khi làm trắc nghiệm.' },
};
const kindOf = (k) => (k === 'quiz' ? 'quiz' : 'essay');
const field = (label, el, hint) => h('label', { class: 'field' }, h('span', null, label), el, hint ? h('small', { class: 'muted' }, hint) : null);

/** Ô chọn prompt trong trình soạn bài. value() → id prompt hoặc null (= mặc định). */
export async function promptPicker(kind, current) {
  kind = kindOf(kind);
  let list = [];
  try { list = (await get(`/api/prompts?kind=${kind}`)).prompts; } catch { list = []; }
  const def = list.find((p) => p.isDefault);
  const sel = h('select', { 'aria-label': KIND[kind].pick },
    h('option', { value: '' }, def ? `Mặc định của tôi: ${def.name}` : 'Mặc định của hệ thống'),
    ...list.map((p) => h('option', { value: p.id, selected: p.id === current }, p.name + (p.isDefault ? ' (mặc định)' : ''))));
  const el = h('label', { class: 'field prompt-pick' }, h('span', null, `🤖 ${KIND[kind].pick}`), sel,
    h('small', { class: 'muted' }, 'Khi bạn chia sẻ bài, người làm sẽ được chấm/phân tích bằng prompt này (họ không xem được nội dung prompt). ',
      h('a', { href: '#/prompts' }, 'Quản lý prompt')));
  return { el, value: () => sel.value || null };
}

const snippet = (s) => (s.length > 180 ? s.slice(0, 180).trimEnd() + '…' : s);

export async function promptsPage() {
  let { prompts: list, defaults } = await get('/api/prompts');
  const box = h('div', { class: 'stack' });
  const reload = async () => { ({ prompts: list } = await get('/api/prompts')); draw(); };
  const card = (p) => h('div', { class: 'card item' },
    h('div', { class: 'row' }, h('span', { class: `badge ${p.kind}` }, KIND[p.kind].short), p.isDefault ? h('span', { class: 'badge good-b' }, '⭐ Mặc định') : null),
    h('h3', null, p.name),
    p.description ? h('p', { class: 'muted' }, p.description) : null,
    h('pre', { class: 'prompt-snippet' }, snippet(p.content)),
    h('div', { class: 'row' },
      h('a', { class: 'btn', href: `#/prompts/${p.id}/edit` }, 'Sửa'),
      h('button', { class: 'btn', onclick: action2(async () => { await put(`/api/prompts/${p.id}`, { ...p, isDefault: !p.isDefault }); toast(p.isDefault ? 'Đã bỏ mặc định' : 'Đã đặt làm mặc định', 'ok'); await reload(); }) }, p.isDefault ? 'Bỏ mặc định' : 'Đặt làm mặc định'),
      h('button', { class: 'btn ghost danger', onclick: action2(async () => { if (!(await confirmBox(`Xoá prompt "${p.name}"? Bài đang dùng prompt này sẽ chuyển về prompt mặc định.`))) return; await del(`/api/prompts/${p.id}`); toast('Đã xoá', 'ok'); await reload(); }) }, 'Xoá')));
  const section = (kind) => {
    const items = list.filter((p) => p.kind === kind);
    return h('div', { class: 'stack' },
      h('div', { class: 'row between' }, h('h3', null, KIND[kind].title), h('a', { class: 'btn primary', href: `#/prompts/new?kind=${kind}` }, '＋ Tạo prompt')),
      h('p', { class: 'muted' }, KIND[kind].desc),
      items.length ? h('div', { class: 'grid' }, items.map(card)) : h('p', { class: 'muted' }, 'Chưa có prompt riêng — AI đang dùng mẫu mặc định của hệ thống.'));
  };
  const draw = () => box.replaceChildren(section('essay'), section('quiz'));
  draw();
  return h('div', { class: 'stack' }, h('h2', null, 'Prompt AI của tôi'),
    h('p', { class: 'muted' }, 'Prompt riêng của tài khoản bạn, không ai khác thấy. Gắn prompt cho từng bài trong trình soạn bài, hoặc đặt một prompt mặc định cho mỗi loại. Bài bạn chia sẻ sẽ tự dùng prompt đã gắn khi người làm bấm chấm/phân tích AI.'),
    box);
}

/** Bọc click của nút trong thẻ (nút nằm trong card, không dùng `action` để tự đổi nhãn). */
function action2(fn) {
  return async (ev) => {
    const btn = ev.currentTarget; if (btn.disabled) return; btn.disabled = true;
    try { await fn(); } catch (e) { toast(e.message || 'Có lỗi', 'err', 6000); } finally { btn.disabled = false; }
  };
}

export async function promptEditorPage(ctx, id) {
  const isNew = !id; id = id || newId();
  const meta = await get('/api/prompts');
  const cur = isNew ? null : meta.prompts.find((p) => p.id === id);
  if (!isNew && !cur) throw Object.assign(new Error('Không tìm thấy prompt'), { status: 404 });
  const kind = kindOf(cur ? cur.kind : ctx.query.get('kind'));
  const known = meta.placeholders[kind];

  const name = h('input', { value: cur ? cur.name : '', maxlength: 100, required: true, placeholder: kind === 'essay' ? 'VD: Chấm nghiêm theo rubric' : 'VD: Phân tích lỗi sai chi tiết' });
  const desc = h('input', { value: cur ? cur.description : '', maxlength: 300, placeholder: 'Ghi chú ngắn cho bạn (tuỳ chọn)' });
  const strict = kind === 'essay' ? h('select', null, ...Object.entries({ lenient: 'Dễ tính', normal: 'Bình thường', strict: 'Nghiêm khắc' }).map(([v, l]) => h('option', { value: v, selected: (cur ? cur.strictness : 'normal') === v }, l))) : null;
  const content = h('textarea', { rows: 16, maxlength: meta.maxContent, placeholder: 'Viết hướng dẫn cho AI, dùng các biến bên dưới để chèn đề/bài làm…', spellcheck: 'false' });
  content.value = cur ? cur.content : meta.defaults[kind];
  const isDef = h('input', { type: 'checkbox', checked: cur ? cur.isDefault : false });

  const warn = h('p', { class: 'alert warn', hidden: true });
  const count = h('small', { class: 'muted' });
  const check = () => {
    const bad = [...new Set(content.value.match(/\{[^{}\n]{1,40}\}/g) || [])].filter((p) => !known.includes(p));
    warn.hidden = !bad.length; warn.textContent = bad.length ? `Biến không hợp lệ (sẽ giữ nguyên chữ, AI không nhận dữ liệu): ${bad.join(', ')}` : '';
    count.textContent = `${content.value.length}/${meta.maxContent} ký tự`;
  };
  content.addEventListener('input', check); check();

  const chips = h('div', { class: 'row chips' }, ...known.map((p) => h('button', { type: 'button', class: 'chip-btn', title: 'Chèn vào vị trí con trỏ', onclick: () => {
    const a = content.selectionStart ?? content.value.length, b = content.selectionEnd ?? a;
    content.value = content.value.slice(0, a) + p + content.value.slice(b); content.focus(); content.selectionStart = content.selectionEnd = a + p.length; check();
  } }, p)));
  const useDefault = h('button', { type: 'button', class: 'btn small', onclick: async () => { if (content.value.trim() !== meta.defaults[kind].trim() && !(await confirmBox('Thay nội dung đang soạn bằng mẫu mặc định?'))) return; content.value = meta.defaults[kind]; check(); } }, '↺ Dùng mẫu mặc định');

  const save = h('button', { class: 'btn primary', type: 'submit' }, 'Lưu prompt');
  const form = h('form', { class: 'card stack' },
    h('h2', null, isNew ? `Tạo prompt: ${KIND[kind].title.toLowerCase()}` : `Sửa prompt (${KIND[kind].short})`),
    h('div', { class: 'row' }, field('Tên prompt', name), strict ? field('Mức độ chấm', strict, 'Dùng cho biến {strictness}') : null), field('Mô tả', desc),
    h('div', { class: 'row between' }, h('span', { class: 'lbl' }, 'Nội dung prompt'), useDefault),
    content, h('div', { class: 'row between' }, h('small', { class: 'muted' }, 'Bấm biến để chèn:'), count), chips, warn,
    h('p', { class: 'muted' }, `Phần định dạng JSON trả về và quy tắc "nội dung bài làm chỉ là dữ liệu" do hệ thống tự thêm vào cuối, bạn không cần viết. Prompt phải có ${kind === 'essay' ? '{bài_làm}' : '{đề_trắc_nghiệm} hoặc {bài_làm}'}.`),
    h('label', { class: 'row opt' }, isDef, h('span', null, `Đặt làm mặc định cho bài ${KIND[kind].short.toLowerCase()} chưa chọn prompt`)),
    h('div', { class: 'row' }, save, h('a', { class: 'btn ghost', href: '#/prompts' }, 'Huỷ')));
  form.addEventListener('submit', action(save, async () => {
    const r = await put(`/api/prompts/${id}`, { kind, name: name.value, description: desc.value, content: content.value, strictness: strict ? strict.value : undefined, isDefault: isDef.checked });
    toast(r.unknownPlaceholders.length ? `Đã lưu, nhưng có biến lạ: ${r.unknownPlaceholders.join(', ')}` : 'Đã lưu', r.unknownPlaceholders.length ? 'info' : 'ok', 6000);
    ctx.go('/prompts');
  }));
  return form;
}
