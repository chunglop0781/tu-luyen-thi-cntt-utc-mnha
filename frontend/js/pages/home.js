import { get, del } from '../api.js';
import { h, fmtDate, pctClass, toast, confirmBox } from '../ui.js';
import { openShareDialog } from './share.js';

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
      h('div', { class: 'row' }, h('span', { class: `badge ${i.type}` }, i.type === 'quiz' ? 'Trắc nghiệm' : i.type === 'flashcard' ? 'Flashcard' : 'Tự luận'), i.subject ? h('span', { class: 'badge' }, i.subject) : null),
      h('h3', null, i.title),
      h('p', { class: 'muted' }, i.type === 'quiz' ? `${i.size} câu` : i.type === 'flashcard' ? `${i.size} thẻ` : `Thang ${i.size}`, ` · đã làm ${i.attempts}`, i.bestPct != null ? [' · tốt nhất ', h('b', { class: pctClass(i.bestPct) }, i.bestPct + '%')] : ''),
      i.shareId ? h('p', { class: 'muted' }, '🔗 Đang chia sẻ · ', h('a', { href: `#/s/${i.shareId}/history` }, 'lịch sử của mọi người')) : null,
      h('div', { class: 'row' },
        h('a', { class: 'btn primary', href: `#/${i.type}/${i.id}` }, i.type === 'flashcard' ? '🃏 Học' : 'Làm bài'), h('a', { class: 'btn', href: edit }, 'Sửa'),
        h('a', { class: 'btn', href: i.shareId ? `#/s/${i.shareId}/history` : `#/${i.type}/${i.id}/history`, title: 'Lịch sử nộp & biểu đồ điểm của bài này' }, '📊 Lịch sử'),
        h('button', { class: 'btn', title: 'Tạo link chia sẻ bài này', onclick: async (ev) => { const b = ev.currentTarget; b.disabled = true; try { await openShareDialog(i, (sid) => { if (sid) { i.shareId = sid; draw(); } }); } catch (e) { toast(e.message, 'err', 6000); } finally { b.disabled = false; } } }, '🔗 Chia sẻ'),
        h('button', { class: 'btn ghost danger', onclick: async () => { if (!(await confirmBox(`Xoá "${i.title}"? Không khôi phục được.`))) return; try { await del(`/api/${i.type === 'quiz' ? 'quizzes' : i.type === 'flashcard' ? 'flashcards' : 'essays'}/${i.id}`); ov.items = ov.items.filter((x) => x.id !== i.id); draw(); toast('Đã xoá', 'ok'); } catch (e) { toast(e.message, 'err'); } } }, 'Xoá')));
  };

  const search = h('input', { type: 'search', placeholder: '🔍 Tìm theo tên, môn, thẻ…', oninput: (e) => { q = e.target.value.toLowerCase(); draw(); } });
  const typeSel = h('select', { onchange: (e) => { type = e.target.value; draw(); } }, h('option', { value: '' }, 'Tất cả loại'), h('option', { value: 'essay' }, 'Tự luận'), h('option', { value: 'quiz' }, 'Trắc nghiệm'), h('option', { value: 'flashcard' }, 'Flashcard'));
  const subSel = h('select', { onchange: (e) => { subject = e.target.value; draw(); } }, h('option', { value: '' }, 'Tất cả môn'), ov.subjects.map((s) => h('option', { value: s }, s)));
  draw();

  const s = ov.stats;
  return h('div', null,
    h('div', { class: 'stats' },
      stat(s.essays, 'Bài tự luận'), stat(s.quizzes, 'Bài trắc nghiệm'), stat(s.flashcards || 0, 'Bộ flashcard'), stat(s.submissions, 'Lượt nộp'), stat(s.avgQuizPct == null ? '—' : s.avgQuizPct + '%', 'TB trắc nghiệm')),
    h('div', { class: 'row between' }, h('h2', null, 'Bài của tôi'),
      h('div', { class: 'row' }, h('a', { class: 'btn primary', href: '#/essay/new' }, '＋ Tự luận'), h('a', { class: 'btn primary', href: '#/quiz/new' }, '＋ Trắc nghiệm'), h('a', { class: 'btn primary', href: '#/flashcard/new' }, '＋ Flashcard'))),
    h('div', { class: 'row filters' }, search, typeSel, subSel), list,
    (ov.shared || []).length ? h('div', null, h('h3', null, 'Bài được chia sẻ với tôi'), h('div', { class: 'grid' }, ov.shared.map(sharedCard))) : null,
    ov.recent.length ? h('div', null, h('h3', null, 'Làm gần đây'), h('div', { class: 'card' }, ov.recent.map(subRow))) : null);
}

const sharedCard = (j) => h('div', { class: 'card item' },
  h('div', { class: 'row' }, h('span', { class: `badge ${j.type === 'essay' ? 'essay' : j.type === 'flashcard' ? 'flashcard' : 'quiz'}` }, j.type === 'essay' ? 'Tự luận được chia sẻ' : j.type === 'flashcard' ? 'Flashcard được chia sẻ' : 'Được chia sẻ'), j.subject ? h('span', { class: 'badge' }, j.subject) : null), h('h3', null, j.title),
  h('p', { class: 'muted' }, `đã làm ${j.attempts}`, j.bestPct != null ? [' · tốt nhất ', h('b', { class: pctClass(j.bestPct) }, j.bestPct + '%')] : ''),
  h('div', { class: 'row' }, h('a', { class: 'btn primary', href: `#/s/${j.shareId}/play` }, 'Làm lại'), h('a', { class: 'btn', href: `#/s/${j.shareId}/history` }, '📊 Lịch sử & biểu đồ')));

const stat = (n, label) => h('div', { class: 'stat' }, h('b', null, n), h('span', null, label));
export const subRow = (s) => h('a', { class: 'subrow', href: `#/submission/${s.id}` },
  h('span', { class: `badge ${s.type}` }, s.type === 'quiz' ? 'TN' : s.type === 'flashcard' ? 'FC' : 'TL'), h('span', { class: 'grow' }, s.title), h('span', { class: 'muted' }, fmtDate(s.at)),
  h('b', { class: pctClass(s.pct) }, s.score == null ? 'chờ chấm' : `${s.score}/${s.max}`));

export async function historyPage() {
  const { submissions } = await get('/api/submissions?limit=500');
  return h('div', null, h('h2', null, 'Lịch sử nộp bài'),
    h('div', { class: 'card' }, submissions.length ? submissions.map(subRow) : h('p', { class: 'muted' }, 'Chưa nộp bài nào.')));
}
