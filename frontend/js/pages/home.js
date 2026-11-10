import { get, del } from '../api.js';
import { h, icon, fmtDate, pctClass, toast, confirmBox } from '../ui.js';

const typeName = (t) => (t === 'quiz' ? 'Trắc nghiệm' : 'Tự luận');

export async function homePage() {
  const ov = await get('/api/overview');
  let type = '', subject = '', q = '';
  const list = h('div', { class: 'grid' });

  const empty = (msg, sub) => h('div', { class: 'empty' }, h('div', { class: 'ci' }, icon('inbox', 'lg')), h('h2', null, msg), h('p', null, sub));
  const draw = () => {
    const items = ov.items.filter((i) => (!type || i.type === type) && (!subject || i.subject === subject) && (!q || (i.title + ' ' + i.subject + ' ' + (i.tags || []).join(' ')).toLowerCase().includes(q)));
    list.replaceChildren(...(items.length ? items.map(card)
      : [ov.items.length ? empty('Không có bài khớp bộ lọc', 'Thử đổi từ khoá hoặc bỏ bớt bộ lọc.') : empty('Chưa có bài nào', 'Bấm "Tạo tự luận" hoặc "Tạo trắc nghiệm" để tạo bài đầu tiên.')]));
  };
  const card = (i) => {
    const edit = `#/${i.type}/${i.id}/edit`;
    return h('div', { class: `card item ${i.type}` },
      h('div', { class: 'bar' }),
      h('div', { class: 'in' },
        h('div', { class: 'row', style: 'flex-wrap:nowrap;align-items:flex-start;gap:.75rem' },
          h('div', { class: `ibox ${i.type}` }, icon(i.type === 'quiz' ? 'list-checks' : 'pencil', 'lg')),
          h('div', { style: 'min-width:0;flex:1' }, h('h3', { title: i.title }, i.title),
            h('p', { class: 'muted', style: 'font-size:.75rem;margin-top:2px' }, typeName(i.type), i.subject ? ' · ' + i.subject : ''))),
        h('p', { class: 'muted', style: 'font-size:.875rem' }, i.type === 'quiz' ? `${i.size} câu` : `Thang điểm ${i.size}`, ` · đã làm ${i.attempts} lần`),
        i.bestPct != null ? h('div', { class: `best ${pctClass(i.bestPct)}` }, h('span', null, 'Điểm cao nhất'), h('b', null, i.bestPct + '%')) : null,
        h('div', { class: 'row', style: 'margin-top:auto;padding-top:.25rem;flex-wrap:nowrap' },
          h('a', { class: 'btn primary grow', href: `#/${i.type}/${i.id}` }, icon('play'), i.attempts ? 'Làm lại' : 'Làm bài'),
          h('a', { class: 'btn', href: edit }, 'Sửa'),
          h('button', { class: 'btn icon danger', type: 'button', title: 'Xoá bài', 'aria-label': 'Xoá bài', onclick: async () => {
            if (!(await confirmBox(`Xoá "${i.title}"? Không khôi phục được.`))) return;
            try { await del(`/api/${i.type === 'quiz' ? 'quizzes' : 'essays'}/${i.id}`); ov.items = ov.items.filter((x) => x.id !== i.id); draw(); toast('Đã xoá', 'ok'); } catch (e) { toast(e.message, 'err'); } } }, icon('trash')))));
  };

  const search = h('input', { type: 'search', placeholder: 'Tìm bài theo tên, môn, thẻ…', autocomplete: 'off', oninput: (e) => { q = e.target.value.toLowerCase(); draw(); } });
  const typeSel = h('select', { onchange: (e) => { type = e.target.value; draw(); } }, h('option', { value: '' }, 'Tất cả loại'), h('option', { value: 'essay' }, 'Tự luận'), h('option', { value: 'quiz' }, 'Trắc nghiệm'));
  const subSel = h('select', { onchange: (e) => { subject = e.target.value; draw(); } }, h('option', { value: '' }, 'Tất cả môn học'), ov.subjects.map((s) => h('option', { value: s }, s)));
  draw();

  const s = ov.stats;
  return h('div', null,
    h('div', { class: 'page-h' },
      h('div', null, h('h1', { class: 'title' }, 'Bài của tôi'), h('p', { class: 'sub' }, 'Tự tạo, làm và lưu bài tự luận, trắc nghiệm của riêng bạn.')),
      h('div', { class: 'row' }, h('a', { class: 'btn primary', href: '#/essay/new' }, icon('plus'), 'Tạo tự luận'), h('a', { class: 'btn blue', href: '#/quiz/new' }, icon('plus'), 'Tạo trắc nghiệm'))),
    h('div', { class: 'stats' }, stat(s.essays, 'Bài tự luận'), stat(s.quizzes, 'Bài trắc nghiệm'), stat(s.submissions, 'Lượt nộp'), stat(s.avgQuizPct == null ? '—' : s.avgQuizPct + '%', 'Điểm TB trắc nghiệm')),
    h('div', { class: 'fbar' }, h('div', { class: 'sbox' }, icon('search'), search), typeSel, subSel),
    list,
    ov.recent.length ? h('div', null, h('h2', { class: 'sect-t' }, 'Làm gần đây'), h('div', { class: 'list' }, ov.recent.map(subRow))) : null);
}

const stat = (n, label) => h('div', { class: 'stat' }, h('b', null, n), h('span', null, label));
export const subRow = (s) => h('a', { class: 'subrow', href: `#/submission/${s.id}` },
  h('span', { class: `badge ${s.type}` }, typeName(s.type)), h('span', { class: 'grow', style: 'font-weight:500' }, s.title), h('span', { class: 'muted' }, fmtDate(s.at)),
  h('b', { class: pctClass(s.pct) }, s.score == null ? 'Chờ chấm' : `${s.score}/${s.max}`));

export async function historyPage() {
  const { submissions } = await get('/api/submissions?limit=500');
  const head = h('div', { class: 'page-h' }, h('div', null, h('h1', { class: 'title' }, 'Lịch sử nộp bài'), h('p', { class: 'sub' }, 'Tất cả bài bạn đã nộp và kết quả chấm.')),
    h('a', { class: 'btn primary', href: '#/' }, icon('pencil'), 'Luyện tập'));
  if (!submissions.length) return h('div', null, head, h('div', { class: 'empty' }, h('div', { class: 'ci' }, icon('inbox', 'lg')), h('h2', null, 'Chưa có bài nộp nào'), h('p', null, 'Làm một bài rồi nộp để xem kết quả ở đây.')));
  return h('div', null, head, h('div', { class: 'tbl' }, h('div', { class: 'sc' }, h('table', null,
    h('thead', null, h('tr', null, ['Bài', 'Loại', 'Điểm', 'Thời gian', ''].map((t, i) => h('th', { class: i === 4 ? 'r' : '' }, t)))),
    h('tbody', null, submissions.map((s) => h('tr', null,
      h('td', { class: 't' }, s.title), h('td', null, h('span', { class: `badge ${s.type}` }, typeName(s.type))),
      h('td', null, h('b', { class: pctClass(s.pct) }, s.score == null ? 'Chờ chấm' : `${s.score}/${s.max}`)),
      h('td', { class: 'muted' }, fmtDate(s.at)),
      h('td', { class: 'r' }, h('a', { class: 'btn small', href: `#/submission/${s.id}` }, 'Xem')))))))));
}
