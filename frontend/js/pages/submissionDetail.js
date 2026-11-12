import { h, fmtDur, richOrHtml } from '../ui.js';

/* Trang chi tiết bài nộp TỰ LUẬN — chuyển NGUYÊN từ views/student/submission-detail.pug của luyen-thi
   (cùng thứ tự khối: nút quay lại → tiêu đề + điểm → lỗi chấm → đề bài → bài làm → chi tiết điểm → nhận xét AI → lời giải mẫu).
   Icon = bộ lucide mà bản cũ dùng (vẽ inline SVG, không tải thư viện ngoài). Giao diện: css/sub-detail.css.
   Dùng cho cả HAI trường hợp (như bản cũ dùng một view cho sinh viên và admin):
     • người làm xem bài của mình  → kèm các khối thao tác (chấm AI, tự chấm) do submission.js nối thêm phía dưới
     • chủ bài xem bài của người làm (isAdmin) → chỉ đọc, có tên người nộp ở phần meta. */
const ICONS = {
  'arrow-left': '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
  user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  bot: '<path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/>',
  'key-round': '<path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z"/><circle cx="16.5" cy="7.5" r=".5" fill="currentColor"/>',
  timer: '<line x1="10" x2="14" y1="2" y2="2"/><line x1="12" x2="15" y1="14" y2="11"/><circle cx="12" cy="14" r="8"/>',
  'file-text': '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
  pencil: '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>',
  'list-checks': '<path d="m3 17 2 2 4-4"/><path d="m3 7 2 2 4-4"/><path d="M13 6h8"/><path d="M13 12h8"/><path d="M13 18h8"/>',
  lightbulb: '<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/>',
  'circle-alert': '<circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/>',
};
export function icon(name, size = '') {
  const w = document.createElement('span');
  w.innerHTML = `<svg class="sd-ic ${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
  return w.firstChild;
}
const vnTime = (iso) => { try { return new Date(iso).toLocaleString('vi-VN'); } catch { return ''; } };
const card = (cls, ...kids) => h('div', { class: `sd-card ${cls || ''}`.trim() }, ...kids);
const h2 = (ic, text, cls = '') => h('h2', { class: `sd-h2 ${cls}`.trim() }, icon(ic), text);

/** s: bài nộp tự luận. opts: { student, backHref, backText }. Trả về mảng khối (chưa gồm các khối thao tác). */
export function essayDetail(s, { student = '', backHref = '#/history', backText = 'Quay lại danh sách' } = {}) {
  const ai = s.ai || null;
  const graded = s.score != null;
  const blocks = [];

  blocks.push(h('div', { class: 'sd-top' }, h('a', { class: 'sd-back', href: backHref }, icon('arrow-left'), backText)));

  // HEADER — Bài nộp + Điểm
  const meta = h('div', { class: 'sd-meta' },
    student ? h('span', null, icon('user', 'sm'), student) : null,
    s.submittedAt ? h('span', null, icon('clock', 'sm'), vnTime(s.submittedAt)) : null,
    ai && ai.model ? h('span', { class: 'pill model' }, icon('bot', 'xs'), ai.model) : null,
    ai && ai.keyName ? h('span', { class: 'pill key' }, icon('key-round', 'xs'), ai.keyName) : null,
    s.durationSec ? h('span', null, icon('timer', 'sm'), fmtDur(s.durationSec)) : null);
  blocks.push(card('', h('div', { class: 'sd-head' },
    h('div', { class: 'l' }, h('h1', { class: 'sd-h1' }, s.title || 'Bài nộp'), s.subject ? h('p', { class: 'sd-sub' }, s.subject) : null, meta),
    h('div', { class: 'sd-score' }, graded
      ? [h('div', { class: 'n' }, h('b', null, String(s.score)), h('i', null, `/ ${s.max}`)), h('p', null, 'Đã chấm')]
      : h('span', { class: 'sd-badge wait' }, 'Chờ chấm')))));

  // ĐỀ BÀI
  if (s.snapshot && s.snapshot.prompt) blocks.push(card('', h2('file-text', 'Đề bài'), h('div', { class: 'sd-prose' }, richOrHtml(s.snapshot.prompt))));

  // BÀI LÀM (text thô, giữ xuống dòng, hiển thị đúng < >)
  blocks.push(card('', h2('pencil', 'Bài làm'),
    h('div', { class: 'sd-box' }, s.text ? h('pre', null, s.text) : h('p', { class: 'empty' }, '(Không có nội dung)'))));

  // BREAKDOWN — Chi tiết điểm: bản này AI trả điểm mạnh / điểm yếu thay cho tiêu chí
  const good = (ai && ai.strengths) || [], bad = (ai && ai.weaknesses) || [];
  if (good.length || bad.length) blocks.push(card('', h2('list-checks', 'Chi tiết điểm theo tiêu chí', 'mb4'),
    h('div', { class: 'sd-crit' },
      good.length ? h('div', null, h('div', { class: 'row' }, h('p', null, 'Điểm mạnh')), h('p', { class: 'cm' }, good.join('\n'))) : null,
      bad.length ? h('div', null, h('div', { class: 'row' }, h('p', null, 'Cần cải thiện')), h('p', { class: 'cm' }, bad.join('\n'))) : null)));

  // NHẬN XÉT CHUNG
  if (ai && ai.feedback) blocks.push(card('', h2('bot', 'Nhận xét của AI'), h('div', { class: 'sd-text' }, ai.feedback)));

  // LỜI GIẢI MẪU (chỉ hiện khi đã chấm)
  if (graded && s.snapshot && s.snapshot.modelAnswer) blocks.push(card('green', h2('lightbulb', 'Lời giải mẫu', 'green'), h('div', { class: 'sd-prose ok' }, richOrHtml(s.snapshot.modelAnswer))));
  return blocks;
}
