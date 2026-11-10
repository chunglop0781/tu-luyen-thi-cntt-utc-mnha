import { get, put, post, uploadImage, newId } from '../api.js';
import { h, action, toast, imagePickerButton } from '../ui.js';

const field = (label, el, hint) => h('label', { class: 'field' }, h('span', null, label), el, hint ? h('small', { class: 'muted' }, hint) : null);

async function subjectsList() { try { return (await get('/api/overview')).subjects; } catch { return []; } }

export async function essayEditor(ctx, id) {
  const isNew = !id; id = id || newId();
  const [item, subjects] = await Promise.all([isNew ? null : get(`/api/essays/${id}`).then((r) => r.item), subjectsList()]);
  const e = item || { title: '', subject: '', prompt: '', modelAnswer: '', maxScore: 10, rubric: [] };
  const title = h('input', { value: e.title, maxlength: 200, required: true, placeholder: 'VD: So sánh TCP và UDP' });
  const dl = h('datalist', { id: 'subj' }, subjects.map((s) => h('option', { value: s })));
  const subject = h('input', { value: e.subject, list: 'subj', maxlength: 60, placeholder: 'VD: Mạng máy tính' });
  const maxScore = h('input', { type: 'number', min: 1, max: 100, value: e.maxScore });
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
    field('Đề bài', prompt), imagePickerButton(prompt, uploadImage),
    field('Đáp án mẫu', model), imagePickerButton(model, uploadImage),
    h('h3', null, 'Tiêu chí chấm (tuỳ chọn)'), h('p', { class: 'muted' }, 'Dùng để gợi ý điểm tự động theo từ khoá (không phân biệt hoa/thường, dấu).'), rbox,
    h('button', { type: 'button', class: 'btn small', onclick: () => { rubric.push({ name: '', points: 1, keywords: '' }); drawRubric(); } }, '＋ Thêm tiêu chí'),
    h('div', { class: 'row' }, save, h('a', { class: 'btn ghost', href: '#/' }, 'Huỷ')));
  form.addEventListener('submit', action(save, async () => {
    await put(`/api/essays/${id}`, { title: title.value, subject: subject.value, maxScore: Number(maxScore.value), prompt: prompt.value, modelAnswer: model.value, rubric: rubric.filter((r) => r.name.trim()) });
    toast('Đã lưu', 'ok'); ctx.go('/');
  }));
  return form;
}

export async function quizEditor(ctx, id) {
  const isNew = !id; id = id || newId();
  const [item, subjects] = await Promise.all([isNew ? null : get(`/api/quizzes/${id}`).then((r) => r.item), subjectsList()]);
  const q0 = item || { title: '', subject: '', timeLimitMin: 0, shuffle: false, questions: [] };
  let questions = q0.questions.map((q) => ({ ...q, options: q.options.map((o) => ({ ...o })), correct: [...q.correct] }));
  const blank = () => ({ text: '', explanation: '', options: ['A', 'B', 'C', 'D'].map((x) => ({ id: x, text: '' })), correct: [] });
  if (!questions.length) questions.push(blank());

  const title = h('input', { value: q0.title, maxlength: 200, required: true, placeholder: 'VD: Ôn tập chương 3' });
  const dl = h('datalist', { id: 'subj' }, subjects.map((s) => h('option', { value: s })));
  const subject = h('input', { value: q0.subject, list: 'subj', maxlength: 60 });
  const limit = h('input', { type: 'number', min: 0, max: 600, value: q0.timeLimitMin || 0 });
  const shuffle = h('input', { type: 'checkbox', checked: q0.shuffle });
  const qbox = h('div', { class: 'stack' });

  const draw = () => qbox.replaceChildren(...questions.map((q, qi) => {
    const text = h('textarea', { rows: 2, placeholder: `Câu ${qi + 1}…`, oninput: (ev) => { q.text = ev.target.value; } }); text.value = q.text;
    const expl = h('textarea', { rows: 2, placeholder: 'Giải thích (tuỳ chọn)', oninput: (ev) => { q.explanation = ev.target.value; } }); expl.value = q.explanation || '';
    return h('div', { class: 'card qcard' },
      h('div', { class: 'row between' }, h('b', null, `Câu ${qi + 1}`),
        h('span', { class: 'row' },
          h('button', { type: 'button', class: 'btn small ghost', disabled: qi === 0, onclick: () => { [questions[qi - 1], questions[qi]] = [questions[qi], questions[qi - 1]]; draw(); } }, '↑'),
          h('button', { type: 'button', class: 'btn small ghost', disabled: qi === questions.length - 1, onclick: () => { [questions[qi + 1], questions[qi]] = [questions[qi], questions[qi + 1]]; draw(); } }, '↓'),
          h('button', { type: 'button', class: 'btn small ghost danger', onclick: () => { questions.splice(qi, 1); draw(); } }, '✕'))),
      text, imagePickerButton(text, uploadImage),
      ...q.options.map((o, oi) => h('div', { class: 'row opt' },
        h('input', { type: 'checkbox', title: 'Đáp án đúng', checked: q.correct.includes(o.id), onchange: (ev) => { q.correct = ev.target.checked ? [...new Set([...q.correct, o.id])] : q.correct.filter((c) => c !== o.id); } }),
        h('b', null, o.id + '.'), h('input', { class: 'grow', placeholder: 'Nội dung đáp án', value: o.text, oninput: (ev) => { o.text = ev.target.value; } }),
        h('button', { type: 'button', class: 'btn small ghost', onclick: () => { q.options.splice(oi, 1); q.correct = q.correct.filter((c) => c !== o.id); draw(); } }, '−'))),
      h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn small', disabled: q.options.length >= 10, onclick: () => { const used = new Set(q.options.map((o) => o.id)); const nid = 'ABCDEFGHIJ'.split('').find((c) => !used.has(c)); q.options.push({ id: nid, text: '' }); draw(); } }, '＋ Đáp án'), h('small', { class: 'muted' }, 'Tích ✔ vào đáp án đúng (nhiều đáp án đúng = câu chọn nhiều).')),
      expl);
  }));
  draw();

  const imp = h('textarea', { rows: 7, placeholder: 'Câu 1: Nội dung…\nA. Đáp án A\nB. Đáp án B\nĐáp án: B\nGiải thích: …' });
  const impBtn = h('button', { type: 'button', class: 'btn' }, '📥 Đọc đề & thêm vào');
  impBtn.addEventListener('click', action(impBtn, async () => {
    const r = await post('/api/quizzes/parse', { text: imp.value }, { retry: true });
    questions = questions.filter((q) => q.text.trim() || q.options.some((o) => o.text.trim())).concat(r.questions); imp.value = ''; draw(); toast(`Đã thêm ${r.questions.length} câu — kiểm tra lại đáp án đúng`, 'ok');
  }));
  const save = h('button', { class: 'btn primary', type: 'submit' }, 'Lưu bài');
  const form = h('form', { class: 'stack' },
    h('div', { class: 'card stack' }, h('h2', null, isNew ? 'Tạo bài trắc nghiệm' : 'Sửa bài trắc nghiệm'), field('Tiêu đề', title), dl,
      h('div', { class: 'row' }, field('Môn / chủ đề', subject), field('Giới hạn thời gian (phút, 0 = không)', limit)),
      h('label', { class: 'row' }, shuffle, 'Xáo trộn thứ tự câu hỏi mỗi lần làm')),
    h('details', { class: 'card' }, h('summary', null, '📥 Nhập nhanh từ văn bản'), imp, impBtn),
    qbox,
    h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn', onclick: () => { questions.push(blank()); draw(); } }, '＋ Thêm câu'), save, h('a', { class: 'btn ghost', href: '#/' }, 'Huỷ')));
  form.addEventListener('submit', action(save, async () => {
    await put(`/api/quizzes/${id}`, { title: title.value, subject: subject.value, timeLimitMin: Number(limit.value) || 0, shuffle: shuffle.checked,
      questions: questions.map((q) => ({ id: q.id, text: q.text, explanation: q.explanation, correct: q.correct, options: q.options })) });
    toast('Đã lưu', 'ok'); ctx.go('/');
  }));
  return form;
}
