import { get, put, post, uploadImage, newId } from '../api.js';
import { h, action, toast, imagePickerButton } from '../ui.js';
import { promptPicker } from './prompts.js';

const field = (label, el, hint) => h('label', { class: 'field' }, h('span', null, label), el, hint ? h('small', { class: 'muted' }, hint) : null);

async function subjectsList() { try { return (await get('/api/overview')).subjects; } catch { return []; } }

const GUIDE_DE = 'dựa vào các ảnh stt theo tên hãy làm ra phần html nội dung đề bài (không cần đầy đủ html vì tôi sẽ nhúng html) nhưng mà phải đúng nội dung trong ảnh không được thêm lung tung';
const GUIDE_DE_LG = 'dựa vào các ảnh stt theo tên hãy chia ra phần html nội dung đề bài với html nội dung chữa bài ra 2 html khác nhau (không cần đầy đủ html vì tôi sẽ nhúng html) nhưng mà phải đúng nội dung trong ảnh không được thêm lung tung và nhận xét ở lời giải đề không nhận xét vào đề';
/** Prompt mẫu (chuyển từ guide/prompt của bản cũ) để nhờ AI chuyển ảnh đề thành HTML rồi dán vào ô Đề bài / Đáp án mẫu. */
function promptGuide() {
  const mk = (label, text) => { const b = h('button', { type: 'button', class: 'btn small' }, `📋 ${label}`); b.addEventListener('click', async () => { try { await navigator.clipboard.writeText(text); toast('Đã sao chép prompt', 'ok'); } catch { toast('Không sao chép được — hãy bôi đen và copy tay', 'err'); } }); return b; };
  return h('details', { class: 'card' }, h('summary', null, '🤖 Prompt mẫu nhờ AI chuyển ảnh đề thành HTML (rồi dán vào ô bên dưới)'),
    h('p', { class: 'muted' }, 'Gửi các ảnh đề (đặt tên theo số thứ tự) kèm prompt cho ChatGPT / Gemini / Claude, rồi dán HTML AI trả về vào “Đề bài” (và “Đáp án mẫu” nếu có lời giải). HTML được hiển thị an toàn (chỉ giữ thẻ văn bản, bảng, danh sách).'),
    h('div', { class: 'row' }, mk('Chỉ lấy đề', GUIDE_DE), mk('Tách đề + lời giải', GUIDE_DE_LG)));
}

export async function essayEditor(ctx, id) {
  const isNew = !id; id = id || newId();
  const item = isNew ? null : (await get(`/api/essays/${id}`)).item;
  const [subjects, picker] = await Promise.all([subjectsList(), promptPicker('essay', item && item.promptId)]);
  const e = item || { title: '', subject: '', prompt: '', modelAnswer: '', maxScore: 10, rubric: [] };
  const title = h('input', { value: e.title, maxlength: 200, required: true, placeholder: 'VD: So sánh TCP và UDP' });
  const dl = h('datalist', { id: 'subj' }, subjects.map((s) => h('option', { value: s })));
  const subject = h('input', { value: e.subject, list: 'subj', maxlength: 60, placeholder: 'VD: Mạng máy tính' });
  const maxScore = h('input', { type: 'number', min: 1, max: 100, value: e.maxScore });
  const untimed = h('input', { type: 'checkbox', checked: item ? item.duration == null : true });
  const duration = h('input', { type: 'number', min: 1, max: 600, step: 1, value: (item && item.duration) || 45, disabled: untimed.checked });
  untimed.addEventListener('change', () => { duration.disabled = untimed.checked; });
  const prompt = h('textarea', { rows: 6, maxlength: 20000, placeholder: 'Đề bài…' }); prompt.value = e.prompt;
  const model = h('textarea', { rows: 8, maxlength: 30000, placeholder: 'Đáp án mẫu để đối chiếu sau khi làm…' }); model.value = e.modelAnswer;
  let rubric = (e.rubric || []).map((r) => ({ name: r.name, points: r.points, keywords: (r.keywords || []).join(', ') }));
  const rbox = h('div', { class: 'stack' });
  const drawRubric = () => rbox.replaceChildren(...rubric.map((r, i) => h('div', { class: 'row rubric' },
    h('input', { placeholder: 'Tiêu chí', value: r.name, oninput: (ev) => { r.name = ev.target.value; } }),
    h('input', { type: 'number', min: 0, step: '0.5', class: 'pts', value: r.points, oninput: (ev) => { r.points = ev.target.value; } }),
    h('input', { class: 'grow', placeholder: 'Từ khoá, cách nhau dấu phẩy', value: r.keywords, oninput: (ev) => { r.keywords = ev.target.value; } }),
    h('button', { type: 'button', class: 'btn small ghost danger', onclick: () => { rubric.splice(i, 1); drawRubric(); } }, '✕'))));
  drawRubric();
  const save = h('button', { class: 'btn primary', type: 'submit' }, 'Lưu bài');
  const form = h('form', { class: 'card stack' },
    h('h2', null, isNew ? 'Tạo bài tự luận' : 'Sửa bài tự luận'),
    field('Tiêu đề', title), h('div', { class: 'row' }, field('Môn / chủ đề', subject), field('Thang điểm', maxScore)), dl,
    h('div', { class: 'row' }, field('⏱ Thời gian làm bài (phút)', duration), h('label', { class: 'row opt' }, untimed, h('span', null, 'Không đếm giờ'))),
    picker.el,
    promptGuide(),
    field('Đề bài', prompt), imagePickerButton(prompt, uploadImage),
    field('Đáp án mẫu', model), imagePickerButton(model, uploadImage),
    h('h3', null, 'Tiêu chí chấm (tuỳ chọn)'), h('p', { class: 'muted' }, 'Dùng để gợi ý điểm tự động theo từ khoá (không phân biệt hoa/thường, dấu).'), rbox,
    h('button', { type: 'button', class: 'btn small', onclick: () => { rubric.push({ name: '', points: 1, keywords: '' }); drawRubric(); } }, '＋ Thêm tiêu chí'),
    h('div', { class: 'row' }, save, h('a', { class: 'btn ghost', href: '#/' }, 'Huỷ')));
  form.addEventListener('submit', action(save, async () => {
    await put(`/api/essays/${id}`, { title: title.value, subject: subject.value, maxScore: Number(maxScore.value), prompt: prompt.value, modelAnswer: model.value, rubric: rubric.filter((r) => r.name.trim()), duration: untimed.checked ? null : Number(duration.value), timerMode: untimed.checked ? 'untimed' : 'timed', promptId: picker.value() });
    toast('Đã lưu', 'ok'); ctx.go('/');
  }));
  return form;
}
