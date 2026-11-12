import { get, post, patch, imageCtx, session } from '../api.js';
import { h, toast, action, fmtDate, pctClass } from '../ui.js';
import { scoreChart } from '../scoreChart.js';
import { quizPracticePage } from './quiz.js';
import { essayPractice } from './practice.js';
import { flashcardStudyPage } from './flashcards.js';

/** Link chia sẻ: dùng đúng địa chỉ trang đang mở (GitHub Pages) + #/s/<id>. */
export const shareLink = (sid) => `${location.origin}${location.pathname}#/s/${sid}`;
/** Link kiểu luyen-thi: #/lessons/<id bài>/share?id=<id chủ bài>. */
export const lessonLink = (itemId, ownerId, page = 'share') => `${location.origin}${location.pathname}#/lessons/${itemId}/${page}?id=${ownerId}`;

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch { return false; }
}

/** Hộp thoại sau khi bấm "Chia sẻ" trên một bài (trắc nghiệm hoặc tự luận) của mình. */
export async function openShareDialog(item, onChange) {
  const r = await post('/api/shares', { type: item.type, itemId: item.id });
  const sid = r.shareId, owner = session.get().user.id, link = lessonLink(item.id, owner);
  const input = h('input', { readonly: true, value: link, onfocus: (e) => e.target.select() });
  const copy = h('button', { class: 'btn primary', type: 'button' }, '📋 Sao chép link');
  copy.addEventListener('click', async () => { toast((await copyText(link)) ? 'Đã sao chép link' : 'Không tự sao chép được — hãy chọn link và copy thủ công', 'ok'); });
  const off = h('button', { class: 'btn ghost danger', type: 'button' }, 'Tắt chia sẻ');
  const close = () => back.remove();
  off.addEventListener('click', action(off, async () => { await patch(`/api/shares/${sid}`, { enabled: false }); toast('Đã tắt chia sẻ — người khác không mở được link nữa', 'ok'); close(); onChange && onChange(); }));
  const back = h('div', { class: 'modal-back', onclick: (e) => { if (e.target === back) close(); } },
    h('div', { class: 'card modal stack', role: 'dialog', 'aria-label': 'Chia sẻ bài' },
      h('h3', null, '🔗 Chia sẻ “', item.title, '”'),
      h('p', { class: 'muted' }, 'Gửi link này cho người khác. Họ phải đăng nhập (hoặc tạo tài khoản) mới làm được; điểm và bài làm lưu trong tài khoản của họ.'),
      item.type === 'essay' ? h('p', { class: 'muted' }, '🤖 Bài tự luận không chấm lúc nộp: người làm tự bấm “Chấm bằng AI” bằng API key trong tài khoản của họ, rồi điểm mới lên biểu đồ chung.') : null,
      h('div', { class: 'row' }, input, copy),
      h('ul', { class: 'muted share-rules' },
        h('li', null, 'Bạn (người tạo) xem được ai đã nộp, điểm và thời gian nộp.'),
        h('li', null, 'Người làm chỉ xem được bài làm và điểm của chính mình. Chủ bài thấy tên, điểm và mở xem được từng bài đã nộp.'),
        h('li', null, 'Bài đã nộp vào bài chia sẻ không xoá được (điểm nằm trong lịch sử chung).')),
      h('div', { class: 'row between' }, h('a', { class: 'btn', href: `#/s/${sid}/history`, onclick: close }, '📊 Xem lịch sử & biểu đồ'), h('div', { class: 'row' }, off, h('button', { class: 'btn', type: 'button', onclick: close }, 'Đóng')))));
  document.body.append(back);
  const esc = (e) => { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc); } };
  document.addEventListener('keydown', esc);
  input.select();
  onChange && onChange(sid);
}

/** #/s/<id> — trang đón người được chia sẻ. */
export async function sharePage(ctx, sid) {
  imageCtx.share = sid;
  const { share, item } = await get(`/api/shares/${sid}`);
  const essay = item.type === 'essay', flashcard = item.type === 'flashcard';
  const total = essay ? null : flashcard ? item.cards.length : Object.values(item.parts).reduce((n, p) => n + p.questions.length, 0);
  const fact = (v, l) => h('div', null, h('b', null, v), h('span', null, l));
  return h('div', { class: 'stack share-landing' },
    h('div', { class: 'card center stack' },
      h('span', { class: `badge ${essay ? 'essay' : flashcard ? 'flashcard' : 'quiz'}` }, essay ? 'Bài tự luận được chia sẻ' : flashcard ? 'Bộ flashcard được chia sẻ' : 'Bài trắc nghiệm được chia sẻ'),
      h('h2', null, item.title), item.subject ? h('p', { class: 'muted' }, item.subject) : null,
      h('div', { class: 'qx-facts-lite' }, essay ? null : fact(total, flashcard ? 'thẻ' : 'câu hỏi'), flashcard ? null : fact(item.duration === null ? '∞' : item.duration, item.duration === null ? 'không đếm giờ' : 'phút'), fact(flashcard ? 10 : item.maxScore, 'thang điểm')),
      share.isOwner ? h('p', { class: 'muted' }, 'Đây là bài của bạn — bạn thấy tên từng người đã nộp ở trang lịch sử.') : h('p', { class: 'muted' }, 'Điểm và bài làm của bạn được lưu trong tài khoản của bạn. Chủ bài thấy tên bạn, điểm số và xem được bài bạn đã nộp; người làm khác thì không thấy gì của bạn.'),
      essay && !share.isOwner ? h('p', { class: 'muted' }, 'Bài tự luận được AI chấm bằng API key của chính bạn (thêm ở Cài đặt → Nhà cung cấp AI). Bài nộp không xoá được và chỉ chấm một lần.') : null,
      h('div', { class: 'row', style: 'justify-content:center' }, h('a', { class: 'btn primary', href: `#/s/${sid}/play` }, '▶ Làm bài'), h('a', { class: 'btn', href: `#/s/${sid}/history` }, share.isOwner ? '📊 Lịch sử của tất cả người làm' : '📊 Lịch sử & biểu đồ điểm'))));
}

/** #/s/<id>/play — làm bài (đề không có đáp án; chấm phía máy chủ khi nộp). */
export async function sharePlayPage(ctx, sid) {
  const { item, share } = await get(`/api/shares/${sid}`);
  if (item.type === 'essay') return essayPractice(ctx, sid, { shareId: sid, item, isOwner: share.isOwner });
  if (item.type === 'flashcard') return flashcardStudyPage(ctx, sid, { shareId: sid, item, isOwner: share.isOwner });
  return quizPracticePage(ctx, sid, { shareId: sid, item, isOwner: share.isOwner });
}

/** #/s/<id>/history — trang "Lịch sử làm bài" (bố cục chuyển từ views/student/lesson-history.pug của luyen-thi).
 *  Chủ bài: thấy TÊN + điểm từng người đã nộp, mở được chi tiết từng bài (chỉ đọc) + ô tìm theo tên. Người làm: chỉ thấy bài + điểm của CHÍNH MÌNH. */
const PAGE_SIZE = 15;
export async function shareHistoryPage(ctx, sid) {
  imageCtx.share = sid;
  const d = await get(`/api/shares/${sid}/history`);
  const own = d.share.isOwner;
  const stat = (v, l) => h('div', { class: 'stat' }, h('b', null, v), h('span', null, l));
  const norm = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd');
  let q = '', page = 1;
  const listHost = h('div');
  const openHref = (r) => (own && !r.m ? `#/s/${sid}/submission/${r.id}` : `#/submission/${r.id}`);   // chủ bài xem bài của người khác (chỉ đọc); bài của chính mình mở như thường
  const status = (r) => (r.score == null ? h('span', { class: 'badge' }, 'Chờ chấm AI') : h('span', { class: 'badge quiz' }, 'Đã chấm'));
  const draw = () => {
    const rows = d.rows.filter((r) => !own || !q || norm(r.n).includes(norm(q)));
    const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE)); page = Math.min(page, pages);
    const slice = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
    listHost.replaceChildren(rows.length
      ? h('div', { class: 'card tbl' }, h('table', null,
        h('thead', null, h('tr', null, own ? h('th', null, 'Sinh viên') : null, h('th', null, 'Điểm'), h('th', null, 'Thời gian'), h('th', null, 'Trạng thái'), h('th', null, ''))),
        h('tbody', null, slice.map((r) => {
          const pending = r.score == null;
          const pct = !pending && r.max ? (r.score / r.max) * 100 : null;
          return h('tr', null, own ? h('td', null, r.n ? h('b', null, r.n) : h('span', { class: 'muted' }, '(không rõ tên)')) : null,
            h('td', null, pending ? h('span', { class: 'muted' }, '—') : h('b', { class: pctClass(pct) }, `${r.score}/${r.max}`)),
            h('td', { class: 'muted' }, fmtDate(r.at)), h('td', null, status(r)),
            h('td', null, r.id ? h('a', { class: 'btn small', href: openHref(r) }, '👁 Xem chi tiết') : null));
        }))),
        pages > 1 ? h('div', { class: 'hist-pager' },
          h('button', { class: 'btn small', type: 'button', disabled: page <= 1, onclick: () => { page--; draw(); } }, '← Trước'),
          `Trang ${page} / ${pages}`,
          h('button', { class: 'btn small', type: 'button', disabled: page >= pages, onclick: () => { page++; draw(); } }, 'Sau →')) : null)
      : h('div', { class: 'card center' }, h('h3', null, own && q ? 'Không có bài nộp phù hợp' : 'Chưa có bài nộp nào'),
        h('p', { class: 'muted' }, own ? 'Khi sinh viên nộp bài vào bài này, bài nộp sẽ hiện ở đây.' : 'Làm bài và nộp để xem lịch sử ở đây.')));
  };
  draw();
  const search = own ? h('div', { class: 'hist-search' },
    h('input', { type: 'text', placeholder: 'Tìm theo tên sinh viên…', oninput: (e) => { q = e.target.value.trim(); page = 1; draw(); } }),
    h('button', { class: 'btn small ghost', type: 'button', onclick: (e) => { const i = e.target.parentNode.querySelector('input'); i.value = ''; q = ''; page = 1; draw(); } }, 'Xoá lọc')) : null;
  return h('div', { class: 'stack' },
    h('div', { class: 'row between' },
      h('div', null, h('a', { href: d.share.enabled || !own ? `#/s/${sid}/play` : '#/' }, '← Quay lại bài học'), h('h2', null, 'Lịch sử làm bài'),
        h('p', { class: 'muted' }, d.share.title, d.share.subject ? ` • ${d.share.subject}` : '', own ? ' • Bài nộp của tất cả sinh viên' : ' • Tất cả bài bạn đã nộp vào bài này')),
      d.share.enabled || !own ? h('a', { class: 'btn primary', href: `#/s/${sid}/play` }, '✏️ Làm bài') : h('span', { class: 'badge' }, 'Đã tắt chia sẻ')),
    h('div', { class: 'stats' }, stat(d.stats.total, own ? 'Tổng bài nộp' : 'Số lần đã nộp'), own ? stat(d.stats.students, 'Số sinh viên đã nộp') : null, d.stats.pending ? stat(d.stats.pending, 'Chờ AI chấm') : null, stat(d.stats.best == null ? '—' : `${d.stats.best} / 10`, 'Điểm cao nhất (thang 10)')),
    scoreChart({ isOwner: own, points: d.points, onOpen: (p) => ctx.go(own && !p.m ? `/s/${sid}/submission/${p.id}` : `/submission/${p.id}`) }),
    search, listHost);
}

/** #/lessons/<id bài>/(share|history|play)?id=<id chủ bài> — tra ra shareId rồi mở đúng trang. */
export async function lessonLinkPage(ctx, m) {
  const [, itemId, page] = m, owner = ctx.query.get('id') || '';
  if (!/^(?:[a-f0-9]{16,32}|\d{10,14}_[a-f0-9]{8,24})$/.test(owner)) throw new Error('Link chia sẻ thiếu id người tạo (?id=…)');
  const { shareId } = await get(`/api/share-link/${owner}/${itemId}`);
  return page === 'history' ? shareHistoryPage(ctx, shareId) : page === 'play' ? sharePlayPage(ctx, shareId) : sharePage(ctx, shareId);
}
