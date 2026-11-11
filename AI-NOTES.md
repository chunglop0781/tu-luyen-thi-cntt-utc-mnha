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

## 4. Tên AI + ô chọn AI có tìm kiếm
- **Tên AI** = tên người dùng tự đặt / sửa cho key của từng nhà cung cấp (Cài đặt → Nhà cung cấp AI → ô "Tên AI"). Lưu ở kho key riêng tư: `vault.names[<providerId>]`, đọc ra `vault.items[id].name` (tối đa 60 ký tự, để trống = xoá tên). Bài tự luận được chấm sẽ ghi `ai.keyName` để biết sau này AI nào đã chấm.
- **Ô chọn AI / model có tìm kiếm** là bản **chép nguyên** `public/js/subjectPicker.js` + `public/css/subject-picker.css` của luyen-thi (`legacy/subjectPicker.js`, `css/subject-picker.css`). Dùng qua `js/aiName.js` (`pickerAttrs`, `aiTitle`, `enhancePickers`). Chữ trong ô chọn là "Tên AI — Nhà cung cấp" nên gõ tên nào cũng tìm ra. Đừng viết lại bộ chọn khác.

## 5. Bẫy đã gặp (đừng lặp lại)
- **`legacy/*.js` là ES module**: `'use strict'` đặt trong hàm có **tham số mặc định** (`function f(a, b = {}) { 'use strict'; … }`) là *SyntaxError* → cả web trắng vì `app.js` import tĩnh. Không thêm `'use strict'` vào các hàm `mount…`; chỉnh xong chạy `node --check` (đổi tên .mjs) cho từng file legacy.
- **`import { x } from './quiz.js'` mà `x` không `export`** cũng làm hỏng cả ứng dụng (lỗi liên kết module). Sau khi sửa import/export nhớ kiểm tra lại.
- **DOM gốc `append / replaceChildren(null)` in ra chữ "null"** (hàm `h()` thì đã lọc). `ui.js` có lưới an toàn lọc null/false cho `append/prepend/replaceChildren`; vẫn nên viết `...(cond ? [node] : [])`.
- **Trang chạy trong SPA (đổi `#/…` không tải lại)**: mọi `document/window.addEventListener`, `setInterval`, đọc to… phải gỡ khi rời trang. Module legacy trả về hàm `dispose()` (flashcardStudy, quizTake, quizEditor dùng `_on(...)`), trang gọi qua `ctx.setCleanup`.
- **Độ rộng giống luyen-thi**: khung thường `max-width:1280px` (lề 16/24/32); trang làm bài (`.ep-page` tự luận: 1400px + `padding:0 4%`; `.exam-page` trắc nghiệm: `min(1500px, 100% − 28px)`) nằm ngoài khung đó — `app.js` tự thêm class `wide` cho `<main>` khi trang có `.exam-page`/`.ep-page`.
