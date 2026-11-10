import { get, del } from '../api.js';
import { h, fmtDate, pctClass, toast, confirmBox } from '../ui.js';

export async function homePage() {
  const ov = await get('/api/overview');
  let type = '', subject = '', q = '';
  const list = h('div', { class: 'grid' });

  const draw = () => {
    const items = ov.items.filter((i) => (!type || i.type === type) && (!subject || i.subject === subject) && (!q || (i.title + ' ' + i.subject + ' ' + (i.tags || []).join(' ')).toLowerCase().includes(q)));
    list.replaceChildren(...(items.length ? items.map(card) : [h('p', { class: 'muted' }, ov.items.length ? 'Không có bài khớp bộ lọc.' : 'Chưa có bài nào — hãy tạo bài đầu tiên!')]));
  };
  const card = (i) => {
    const edit = `#/${i.type}/${i.id}/edit`;
    return h('div', { class: 'card item' },
      h('div', { class: 'row' }, h('span', { class: `badge ${i.type}` }, i.type === 'quiz' ? 'Trắc nghiệm' : 'Tự luận'), i.subject ? h('span', { class: 'badge' }, i.subject) : null),
      h('h3', null, i.title),
      h('p', { class: 'muted' }, i.type === 'quiz' ? `${i.size} câu` : `Thang ${i.size}`, ` · đã làm ${i.attempts}`, i.bestPct != null ? [' · tốt nhất ', h('b', { class: pctClass(i.bestPct) }, i.bestPct + '%')] : ''),
      h('div', { class: 'row' },
        h('a', { class: 'btn primary', href: `#/${i.type}/${i.id}` }, 'Làm bài'), h('a', { class: 'btn', href: edit }, 'Sửa'),
        h('button', { class: 'btn ghost danger', onclick: async () => { if (!(await confirmBox(`Xoá "${i.title}"? Không khôi phục được.`))) return; try { await del(`/api/${i.type === 'quiz' ? 'quizzes' : 'essays'}/${i.id}`); ov.items = ov.items.filter((x) => x.id !== i.id); draw(); toast('Đã xoá', 'ok'); } catch (e) { toast(e.message, 'err'); } } }, 'Xoá')));
  };

  const search = h('input', { type: 'search', placeholder: '🔍 Tìm theo tên, môn, thẻ…', oninput: (e) => { q = e.target.value.toLowerCase(); draw(); } });
  const typeSel = h('select', { onchange: (e) => { type = e.target.value; draw(); } }, h('option', { value: '' }, 'Tất cả loại'), h('option', { value: 'essay' }, 'Tự luận'), h('option', { value: 'quiz' }, 'Trắc nghiệm'));
  const subSel = h('select', { onchange: (e) => { subject = e.target.value; draw(); } }, h('option', { value: '' }, 'Tất cả môn'), ov.subjects.map((s) => h('option', { value: s }, s)));
  draw();

  const s = ov.stats;
  return h('div', null,
    h('div', { class: 'stats' },
      stat(s.essays, 'Bài tự luận'), stat(s.quizzes, 'Bài trắc nghiệm'), stat(s.submissions, 'Lượt nộp'), stat(s.avgQuizPct == null ? '—' : s.avgQuizPct + '%', 'TB trắc nghiệm')),
    h('div', { class: 'row between' }, h('h2', null, 'Bài của tôi'),
      h('div', { class: 'row' }, h('a', { class: 'btn primary', href: '#/essay/new' }, '＋ Tự luận'), h('a', { class: 'btn primary', href: '#/quiz/new' }, '＋ Trắc nghiệm'))),
    h('div', { class: 'row filters' }, search, typeSel, subSel), list,
    ov.recent.length ? h('div', null, h('h3', null, 'Làm gần đây'), h('div', { class: 'card' }, ov.recent.map(subRow))) : null);
}

const stat = (n, label) => h('div', { class: 'stat' }, h('b', null, n), h('span', null, label));
export const subRow = (s) => h('a', { class: 'subrow', href: `#/submission/${s.id}` },
  h('span', { class: `badge ${s.type}` }, s.type === 'quiz' ? 'TN' : 'TL'), h('span', { class: 'grow' }, s.title), h('span', { class: 'muted' }, fmtDate(s.at)),
  h('b', { class: pctClass(s.pct) }, s.score == null ? 'chờ chấm' : `${s.score}/${s.max}`));

export async function historyPage() {
  const { submissions } = await get('/api/submissions?limit=500');
  return h('div', null, h('h2', null, 'Lịch sử nộp bài'),
    h('div', { class: 'card' }, submissions.length ? submissions.map(subRow) : h('p', { class: 'muted' }, 'Chưa nộp bài nào.')));
}
