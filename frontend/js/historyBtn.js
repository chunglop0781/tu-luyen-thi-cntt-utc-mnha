import { h } from './ui.js';

/* Nút "Lịch sử làm bài" đặt NGAY DƯỚI khối chuông báo hết giờ (#audioBar) —
   chuyển nguyên từ views/partials/lesson-history-btn.pug của bản luyen-thi.
     chủ bài  → "Lịch sử làm bài của tất cả sinh viên" (thấy ai đã nộp)
     người làm → "Lịch sử làm bài của tôi" (chỉ bài của mình + biểu đồ điểm ẩn danh của cả lớp) */

const ICON = '<svg class="lhb-ic" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/></svg>';
export const historyLabel = (isOwner) => (isOwner ? 'Lịch sử làm bài của tất cả sinh viên' : 'Lịch sử làm bài của tôi');

/** Chuỗi HTML (cho trang trắc nghiệm dựng bằng template string). */
export function historyBtnHtml(href, isOwner) {
  const a = String(href || '#/history').replace(/"/g, '&quot;');
  return `<div class="lesson-history-btn-wrap"><a href="${a}" id="lessonHistoryBtn" class="lhb">${ICON}${historyLabel(isOwner)}</a></div>`;
}

/** Phần tử DOM (cho trang tự luận). */
export function historyBtn(href, isOwner) {
  const w = h('div', { class: 'lesson-history-btn-wrap' });
  w.innerHTML = historyBtnHtml(href, isOwner);
  return w.firstChild;
}

/** Đích của nút: bài của mình đã chia sẻ → lịch sử của tất cả người làm; chưa chia sẻ → lịch sử của riêng mình. */
export function historyTarget({ type, id, shareId, ownShareId }) {
  if (shareId) return `#/s/${shareId}/history`;
  if (ownShareId) return `#/s/${ownShareId}/history`;
  return `#/${type}/${id}/history`;
}
