import { get, post, patch, imageCtx, session } from '../api.js';
import { h, toast, action, fmtDate, pctClass } from '../ui.js';
import { scoreChart } from '../scoreChart.js';
import { quizPracticePage } from './quiz.js';
import { essayPractice } from './practice.js';

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
        h('li', null, 'Người làm chỉ xem được bài làm và điểm của chính mình, cùng biểu đồ điểm ẩn danh của mọi người.'),
        h('li', null, 'Bạn không đọc được nội dung bài làm của người khác.')),
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
  const essay = item.type === 'essay';
  const total = essay ? null : Object.values(item.parts).reduce((n, p) => n + p.questions.length, 0);
  const fact = (v, l) => h('div', null, h('b', null, v), h('span', null, l));
  return h('div', { class: 'stack share-landing' },
    h('div', { class: 'card center stack' },
      h('span', { class: `badge ${essay ? 'essay' : 'quiz'}` }, essay ? 'Bài tự luận được chia sẻ' : 'Bài trắc nghiệm được chia sẻ'),
      h('h2', null, item.title), item.subject ? h('p', { class: 'muted' }, item.subject) : null,
      h('div', { class: 'qx-facts-lite' }, essay ? null : fact(total, 'câu hỏi'), fact(item.duration === null ? '∞' : item.duration, item.duration === null ? 'không đếm giờ' : 'phút'), fact(item.maxScore, 'thang điểm')),
      share.isOwner ? h('p', { class: 'muted' }, 'Đây là bài của bạn — bạn thấy tên từng người đã nộp ở trang lịch sử.') : h('p', { class: 'muted' }, 'Điểm và bài làm của bạn được lưu trong tài khoản của bạn. Chủ bài chỉ biết bạn đã nộp và điểm số.'),
      essay && !share.isOwner ? h('p', { class: 'muted' }, 'Bài tự luận được AI chấm bằng API key của chính bạn (thêm ở Cài đặt → Nhà cung cấp AI). Bài nộp không xoá được và chỉ chấm một lần.') : null,
      h('div', { class: 'row', style: 'justify-content:center' }, h('a', { class: 'btn primary', href: `#/s/${sid}/play` }, '▶ Làm bài'), h('a', { class: 'btn', href: `#/s/${sid}/history` }, share.isOwner ? '📊 Lịch sử của tất cả người làm' : '📊 Lịch sử & biểu đồ điểm'))));
}

/** #/s/<id>/play — làm bài (đề không có đáp án; chấm phía máy chủ khi nộp). */
export async function sharePlayPage(ctx, sid) {
  const { item } = await get(`/api/shares/${sid}`);
  if (item.type === 'essay') return essayPractice(ctx, sid, { shareId: sid, item });
  return quizPracticePage(ctx, sid, { shareId: sid, item });
}

/** #/s/<id>/history — giống trang "Lịch sử làm bài của tất cả sinh viên" của luyen-thi. */
export async function shareHistoryPage(ctx, sid) {
  imageCtx.share = sid;
  const d = await get(`/api/shares/${sid}/history`);
  const own = d.share.isOwner;
  const stat = (v, l) => h('div', { class: 'stat' }, h('b', null, v), h('span', null, l));
  const table = d.rows.length
    ? h('div', { class: 'card tbl' }, h('table', null,
      h('thead', null, h('tr', null, own ? h('th', null, 'Người làm') : null, h('th', null, 'Điểm'), h('th', null, 'Thời gian nộp'), own ? null : h('th', null, ''))),
      h('tbody', null, d.rows.map((r) => {
        const pending = r.score == null;
        const pct = !pending && r.max ? (r.score / r.max) * 100 : null;
        return h('tr', null, own ? h('td', null, r.n || '(không rõ tên)') : null,
          h('td', null, pending ? h('span', { class: 'muted' }, 'Chờ chấm AI') : h('b', { class: pctClass(pct) }, `${r.score}/${r.max}`)), h('td', { class: 'muted' }, fmtDate(r.at)),
          own ? null : h('td', null, r.id ? h('a', { class: 'btn small', href: `#/submission/${r.id}` }, 'Xem bài làm') : null));
      }))))
    : h('div', { class: 'card center' }, h('h3', null, 'Chưa có bài nộp nào'), h('p', { class: 'muted' }, own ? 'Khi có người làm bài qua link chia sẻ, kết quả sẽ hiện ở đây.' : 'Làm bài và nộp để xem lịch sử ở đây.'));
  return h('div', { class: 'stack' },
    h('div', { class: 'row between' },
      h('div', null, h('a', { href: `#/s/${sid}` }, '← Về bài chia sẻ'), h('h2', null, 'Lịch sử làm bài'), h('p', { class: 'muted' }, d.share.title, d.share.subject ? ` • ${d.share.subject}` : '', own ? ' • Bài nộp của tất cả người làm' : ' • Các lần bạn đã nộp')),
      h('div', { class: 'row' }, d.share.enabled || !own ? h('a', { class: 'btn primary', href: `#/s/${sid}/play` }, '▶ Làm bài') : h('span', { class: 'badge' }, 'Đã tắt chia sẻ'))),
    h('div', { class: 'stats' }, stat(d.stats.total, own ? 'Tổng bài nộp' : 'Số lần đã nộp'), d.stats.pending ? stat(d.stats.pending, 'Chờ AI chấm') : null, own ? stat(d.stats.students, 'Số người đã nộp') : null, stat(d.stats.best == null ? '—' : `${d.stats.best} / 10`, 'Điểm cao nhất (thang 10)')),
    scoreChart({ isOwner: own, points: d.points, onOpen: (p) => ctx.go(`/submission/${p.id}`) }),
    table);
}

/** #/lessons/<id bài>/(share|history|play)?id=<id chủ bài> — tra ra shareId rồi mở đúng trang. */
export async function lessonLinkPage(ctx, m) {
  const [, itemId, page] = m, owner = ctx.query.get('id') || '';
  if (!/^[a-f0-9]{16,32}$/.test(owner)) throw new Error('Link chia sẻ thiếu id người tạo (?id=…)');
  const { shareId } = await get(`/api/share-link/${owner}/${itemId}`);
  return page === 'history' ? shareHistoryPage(ctx, shareId) : page === 'play' ? sharePlayPage(ctx, shareId) : sharePage(ctx, shareId);
}
