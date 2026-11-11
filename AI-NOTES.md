# Ghi chú cho AI / người sửa code sau này

Đọc file này TRƯỚC khi sửa frontend hoặc backend.

## 1. KHÔNG thêm tính năng "vẽ tay" vào bài tự luận
Chủ dự án **đã chủ động bỏ** các phần sau của bản cũ `luyen-thi-cntt-utc-mnha` — đừng thêm lại, đừng "làm cho đủ bộ":
- Tab **"🎨 Vẽ tay (JS Paint)"** (`drawingPad.js`, `drawing-pad.css`, `drawingService`, `drawingUpload.controller`)
- **Tải ảnh viết tay → chuyển thành nét vẽ** (`photoToPaint.js`)
- **Tải PDF bài làm → ảnh** (`pdfToImage.js`)
- Mọi luồng nộp bài tự luận bằng **ảnh** (kiểm duyệt ảnh Cloudinary, AI đọc ảnh bản vẽ…)

Bài tự luận hiện chỉ có **một tab "⌨️ Nhập chữ"**, nộp là văn bản (`text`, tối đa 30000 ký tự). Backend cũng chỉ nhận `text`.

## 2. Frontend: COPY từ bản cũ, đừng "làm giống"
Khi cần một màn hình có sẵn ở bản cũ (`views/*.pug`, `public/js/*.js`, `public/css/*.css`):
- Chuyển **nguyên** markup / CSS / JS sang đây (như `legacy/quizTake.js`, `legacy/quizEditor.js`, `css/quiz-exam.css`, `scoreChart.js`), chỉ thay chỗ gọi máy chủ bằng API của bản này (`js/api.js`).
- Không tự thiết kế lại giao diện từ ảnh chụp — làm "giống" từng gây lỗi hiển thị (ví dụ đề bài bị giãn dòng).
- Bản cũ render HTML đề bài thẳng, nên HTML đề (`item.prompt`) phải hiển thị bằng `richOrHtml()` / `safeHtml()` trong `js/ui.js` (giữ bảng, căn lề `text-align`, `colspan/rowspan`). CSS `.rich.html` **phải** là `white-space: normal`; chỉ văn bản thường mới `pre-wrap`.

## 3. "Lịch sử làm bài"
- Nút nằm **ngay dưới thanh chuông báo hết giờ** (`js/historyBtn.js`, dùng cho cả trắc nghiệm và tự luận).
- Chủ bài → "Lịch sử làm bài của tất cả sinh viên" (thấy tên từng người đã nộp, có ô tìm theo tên).
- Người khác → "Lịch sử làm bài của tôi": chỉ thấy bài của mình; biểu đồ điểm của cả lớp **ẩn danh** (không tên, không id bài nộp).
- Backend: `GET /api/shares/:sid/history` (`content.sharedHistory`) đã lo phần phân quyền này — đừng đưa tên/id của người khác xuống người làm.
