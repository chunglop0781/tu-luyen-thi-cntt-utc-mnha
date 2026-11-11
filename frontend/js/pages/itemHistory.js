import { get, session } from '../api.js';
import { h, fmtDate, pctClass } from '../ui.js';
import { scoreChart } from '../scoreChart.js';

/** #/quiz/<id>/history và #/essay/<id>/history — lịch sử nộp của CHÍNH BẠN cho một bài, có biểu đồ điểm
 *  (bố cục chuyển từ views/student/lesson-history.pug + historyChart.js của luyen-thi). */
export async function itemHistoryPage(ctx, type, id) {
  const { submissions } = await get(`/api/submissions?itemId=${id}&limit=500`);
  const me = session.get().user;
  const name = me.displayName || me.username || '';
  const title = submissions.length ? submissions[0].title : (type === 'quiz' ? 'Bài trắc nghiệm' : type === 'flashcard' ? 'Bộ flashcard' : 'Bài tự luận');
  const scored = submissions.filter((s) => s.score != null && s.max);
  const points = scored.map((s) => ({ t: Date.parse(s.at), s: Math.max(0, Math.min(10, (s.score / s.max) * 10)), raw: s.score, max: s.max, q: type === 'quiz' ? 1 : 0, m: 1, id: s.id, n: name })).filter((p) => !Number.isNaN(p.t)).sort((a, b) => a.t - b.t);
  const best = scored.length ? Math.round(Math.max(...scored.map((s) => (s.score / s.max) * 10)) * 100) / 100 : null;
  const stat = (v, l) => h('div', { class: 'stat' }, h('b', null, v), h('span', null, l));
  const table = submissions.length
    ? h('div', { class: 'card tbl' }, h('table', null,
      h('thead', null, h('tr', null, h('th', null, 'Điểm'), h('th', null, 'Thời gian nộp'), h('th', null, ''))),
      h('tbody', null, submissions.map((s) => h('tr', null,
        h('td', null, s.score == null ? h('span', { class: 'muted' }, 'Chờ chấm') : h('b', { class: pctClass(s.pct) }, `${s.score}/${s.max}`)),
        h('td', { class: 'muted' }, fmtDate(s.at)),
        h('td', null, h('a', { class: 'btn small', href: `#/submission/${s.id}` }, 'Xem bài làm')))))))
    : h('div', { class: 'card center' }, h('h3', null, 'Chưa có bài nộp nào'), h('p', { class: 'muted' }, 'Làm bài và nộp để xem lịch sử ở đây.'));
  return h('div', { class: 'stack' },
    h('div', { class: 'row between' },
      h('div', null, h('a', { href: type === 'flashcard' ? '#/flashcards' : '#/' }, type === 'flashcard' ? '← Flashcards' : '← Bài của tôi'), h('h2', null, 'Lịch sử làm bài'), h('p', { class: 'muted' }, title, ' • Tất cả bài bạn đã nộp vào bài này')),
      h('a', { class: 'btn primary', href: `#/${type}/${id}` }, '▶ Làm bài')),
    h('div', { class: 'stats' }, stat(submissions.length, 'Số lần đã nộp'), stat(best == null ? '—' : `${best} / 10`, 'Điểm cao nhất (thang 10)')),
    scoreChart({ isOwner: true, points, onOpen: (p) => ctx.go(`/submission/${p.id}`) }),
    table);
}
