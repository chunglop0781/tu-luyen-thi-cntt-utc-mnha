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

## 3. "Lịch sử làm bài" (chia sẻ)
- Nút nằm **ngay dưới thanh chuông báo hết giờ** (`js/historyBtn.js`, dùng cho cả trắc nghiệm và tự luận).
- Chủ bài → "Lịch sử làm bài của tất cả sinh viên": thấy **tên + điểm + thời gian** từng người, có ô tìm theo tên, và bấm **"👁 Xem chi tiết"** (hoặc bấm chấm trên biểu đồ) để mở bài làm của họ ở `#/s/<sid>/submission/<id>` (chỉ đọc, giống admin xem `/submissions/:id` ở luyen-thi).
- Người làm → "Lịch sử làm bài của tôi": CHỈ thấy bài + điểm của chính mình. **Không** có điểm ẩn danh của người khác trên biểu đồ.
- Bài **chủ bài tự làm** trên bài của mình (sau khi bật chia sẻ) cũng được ghi vào lịch sử chia sẻ (`submission.inShare = <shareId>`, `content.joinOwnShare`; bài cũ được bù khi mở lịch sử / mở chi tiết bài).
- Bài đã nộp vào bài chia sẻ (`shareId` hoặc `inShare`) **không xoá được** (403 `SHARED_LOCKED`; frontend ẩn nút xoá).
- Backend: `GET /api/shares/:sid/history` (`content.sharedHistory`) lo phần phân quyền; `GET /api/shares/:sid/submissions/:id` (`content.sharedSubmission`, chỉ chủ bài) trả bài nộp đã lược ghi chú riêng / điểm tự chấm / tên prompt.
- **Trang chi tiết bài nộp tự luận** (`js/pages/submissionDetail.js` + `css/sub-detail.css`) là bản **chép nguyên** `views/student/submission-detail.pug` của luyen-thi (cùng thứ tự khối, icon lucide vẽ inline). `submission.js` chỉ nối thêm các khối thao tác (tự chấm, chấm AI) bên dưới. Muốn đổi giao diện trang này thì sửa 2 file đó, không viết lại kiểu khác. Màu tối khai báo bằng biến trong `sub-detail.css` (không qua `gen_dark.py`).

## 4. Tên AI + ô chọn AI có tìm kiếm
- **Tên AI** = tên người dùng tự đặt / sửa cho key của từng nhà cung cấp (Cài đặt → Nhà cung cấp AI → ô "Tên AI"). Lưu ở kho key riêng tư: `vault.names[<providerId>]`, đọc ra `vault.items[id].name` (tối đa 60 ký tự, để trống = xoá tên). Bài tự luận được chấm sẽ ghi `ai.keyName` để biết sau này AI nào đã chấm.
- **Ô chọn AI / model có tìm kiếm** là bản **chép nguyên** `public/js/subjectPicker.js` + `public/css/subject-picker.css` của luyen-thi (`legacy/subjectPicker.js`, `css/subject-picker.css`). Dùng qua `js/aiName.js` (`pickerAttrs`, `aiTitle`, `enhancePickers`). Chữ trong ô chọn là "Tên AI — Nhà cung cấp" nên gõ tên nào cũng tìm ra. Đừng viết lại bộ chọn khác.

## 5. Bẫy đã gặp (đừng lặp lại)
- **`legacy/*.js` là ES module**: `'use strict'` đặt trong hàm có **tham số mặc định** (`function f(a, b = {}) { 'use strict'; … }`) là *SyntaxError* → cả web trắng vì `app.js` import tĩnh. Không thêm `'use strict'` vào các hàm `mount…`; chỉnh xong chạy `node --check` (đổi tên .mjs) cho từng file legacy.
- **`import { x } from './quiz.js'` mà `x` không `export`** cũng làm hỏng cả ứng dụng (lỗi liên kết module). Sau khi sửa import/export nhớ kiểm tra lại.
- **DOM gốc `append / replaceChildren(null)` in ra chữ "null"** (hàm `h()` thì đã lọc). `ui.js` có lưới an toàn lọc null/false cho `append/prepend/replaceChildren`; vẫn nên viết `...(cond ? [node] : [])`.
- **Trang chạy trong SPA (đổi `#/…` không tải lại)**: mọi `document/window.addEventListener`, `setInterval`, đọc to… phải gỡ khi rời trang. Module legacy trả về hàm `dispose()` (flashcardStudy, quizTake, quizEditor dùng `_on(...)`), trang gọi qua `ctx.setCleanup`.
- **Độ rộng giống luyen-thi**: khung thường `max-width:1280px` (lề 16/24/32); trang làm bài (`.ep-page` tự luận: 1400px + `padding:0 4%`; `.exam-page` trắc nghiệm: `min(1500px, 100% − 28px)`) nằm ngoài khung đó — `app.js` tự thêm class `wide` cho `<main>` khi trang có `.exam-page`/`.ep-page`.

## 6. Cập nhật mới (giao diện tối/sáng, OTP, tự luận, chia sẻ AI key)
- **Tự luận**: CSS trang làm bài **chép nguyên** từ `luyen-thi-cntt-utc-mnha/views/student/lesson.pug` sang `frontend/css/essay.css` (thêm tiền tố `.lesson-page` vào selector; bỏ phần vẽ tay). `js/pages/practice.js` dùng đúng class/markup của bản cũ (`.ai-bar`, `.lesson-layout`, `.panel`, `.writing-input`, `.audio-bar`…). Không viết lại CSS "giống giống" — sửa giao diện thì sửa `essay.css`.
- **Khoá tua chuông báo hết giờ**: `js/alarmSeekLock.js` (dùng cho chuông ở trang tự luận và `legacy/quizTake.js`). Chuông vẫn phát lặp nhưng kéo thanh tua / đổi tốc độ đều bị đưa về vị trí cũ; trước khi chủ động đặt `currentTime` phải gọi `lock.reset()`.
- **Sáng/Tối** (mặc định SÁNG): `js/theme.js` + `css/theme.css` (biến màu) + `css/theme-dark.css` (**tự sinh**: `python3 tools/gen_dark.py frontend css/style.css css/quiz-exam.css css/quiz-form.css css/flashcards.css css/subject-picker.css css/essay.css js/pages/quiz.js > frontend/css/theme-dark.css`). Sửa CSS gốc xong nhớ chạy lại lệnh này. Lựa chọn lưu ở `localStorage['utc.theme']`.
- **OTP**: mọi màn nhập OTP (đăng ký, quên mật khẩu) có khung nhắc kiểm tra Spam/Thư rác + toast sau khi gửi/gửi lại mã.
- **Chia sẻ AI key**: link `#/ai-key/<id-ai-key>?id=<id-user>`.
  - Chủ key bật chia sẻ ở Cài đặt → Nhà cung cấp AI (`POST /api/ai-key/:kid/share`). Mặc định TẮT.
  - Người nhận mở link (phải đăng nhập) → xem trước (`GET /api/ai-key/:kid?id=`, không lộ key) → `POST /api/ai-key/:kid/accept`: nhà cung cấp + key được sao chép, mã hoá lại bằng khoá của người nhận.
  - Bản nhận được đánh dấu `createdBy: "<id-user>"` (lưu trong `private/<uid>/vault.json` → `createdBy[<id>]`, hiện ra ở `/api/ai/providers` và `/api/me/vault`). Key có `createdBy` **không chia sẻ lại được** (403 `NO_RESHARE`) và không sửa được địa chỉ API (tránh chuyển key ra ngoài). Nếu người nhận dán API key riêng vào thì dấu `createdBy` được gỡ (key đó là của họ).
  - Tắt chia sẻ chỉ chặn người nhận MỚI; bản đã sao chép không bị thu hồi. Key Gemini nhận về luôn thành một mục Gemini riêng (id `gemini-xxxxx`, `kind:'gemini'`) — không đè key Gemini sẵn có của người nhận.
  - Test: `backend/test/run.js` → "chia sẻ AI key…".

## 7. Ô chọn model + bảo mật kết nối AI (bản vá mới)
- **Model KHÔNG dùng `<input list=datalist>` nữa** (danh sách gốc của trình duyệt là hộp đen, không tìm được). Dùng `modelSelect(p, saved)` trong `js/aiName.js` → `<select>` + `SubjectPicker` có tìm kiếm. Nhà cho phép model tự đặt (`allowCustomModel`) thì thêm `data-sp-custom`: gõ tên lạ → hiện mục "✏️ Dùng “…” (nhập tay)". Đã áp dụng ở Cài đặt AI, trang làm bài tự luận, chấm bài và phân tích. Đọc giá trị vẫn là `modelEl.value`.
- **SSRF / DNS-rebinding**: nhà kiểu OpenAI gọi qua `safeFetch` (`services/netguard.js`) — kiểm tra IP lúc kết nối thật, không theo chuyển hướng, giới hạn 2MB. Đừng đổi về `fetch` thường.
- Thông báo lỗi từ nhà cung cấp bị cắt 300 ký tự và che API key (`***`). `subscribeRegex` do người dùng nhập bị từ chối nếu có lặp lồng nhau (ReDoS) và chỉ chạy trên chuỗi ngắn.

## 8. Phiên đăng nhập, IP khách, nơi lưu key (bản vá bảo mật)
- **`auth.authenticate`** chỉ kiểm tra chữ ký + hạn JWT. **`auth.authenticateLive`** (trong `app.js` gọi qua `authedLive(ctx)`) còn tra `sessions/<uid>.json` xem `sid` còn sống không → đăng xuất / đổi mật khẩu / "đăng xuất mọi nơi" có hiệu lực NGAY, không đợi access token hết hạn (mặc định 60 phút). Dùng `authedLive` cho mọi route đụng tới key hoặc mật khẩu: `PUT /api/me/vault`, `/api/ai/providers*` (POST/PUT/DELETE), `/api/ai-key/*` (share/preview/accept), `/api/ai/test`, chấm/phân tích AI, đổi mật khẩu, đăng xuất mọi nơi, danh sách phiên. Route chỉ đọc dữ liệu thường vẫn dùng `authed` (đỡ tốn một lần đọc GitHub).
- **IP khách** (`ip(req)` trong `app.js`): ưu tiên `x-vercel-forwarded-for` / `x-real-ip` (Vercel tự ghi đè, khách không giả được); nếu không có thì lấy phần tử CUỐI của `x-forwarded-for`. KHÔNG lấy phần tử đầu — khách tự gửi header đó để giả IP và né giới hạn đăng nhập. Bộ giới hạn tốc độ nằm trong RAM của từng instance serverless nên chỉ là lớp giảm thiểu, không phải chốt chặn tuyệt đối.
- Đăng nhập: `identifier` / `password` cắt độ dài (254 / 72 byte) trước khi băm; thiếu hoặc sai kiểu → 401, không 500. Đổi mật khẩu bị giới hạn 8 lần / 10 phút mỗi tài khoản.
- `JWT_SECRET` và `ENCRYPTION_KEY` không được trùng nhau (`config.problems`).
- Key AI chỉ nằm trong `private/<uid>/vault.json` (AES-256-GCM, AAD = uid). Frontend không bao giờ nhận lại key (chỉ `keySet`). Refresh token vẫn nằm ở `localStorage` (GitHub Pages ↔ Vercel khác origin nên không dùng cookie HttpOnly được) → tuyệt đối không chèn HTML/JS không kiểm soát vào trang (luôn dùng `safeHtml()`).
- Test: `backend/test/run.js` → nhóm "Phiên đăng nhập & nơi lưu key".
- **Xoá từng phiên + tự xoá phiên không hoạt động (5 ngày)**: mỗi phiên trong `sessions/<uid>.json` có thêm `lastSeen` (giây). `lastSeen` được đặt khi đăng nhập và cập nhật khi `refresh` token (chỉ ghi nếu đã cũ ≥ 1 giờ để đỡ tốn commit). Phiên coi là "còn sống" khi `exp > now` VÀ `now − lastSeen ≤ SESSION_IDLE_DAYS` (mặc định 5 ngày, `cfg.sessionIdleSec`); phiên cũ chưa có `lastSeen` thì lấy `createdAt`. Phiên quá hạn bị loại khi: cấp phiên mới, mở danh sách phiên (`GET /api/me/sessions`, xoá thật khỏi kho), `refresh` (401 `SESSION_EXPIRED`), `authenticateLive`. Không cần cron riêng. `DELETE /api/me/sessions/:id` (`auth.revokeOne`) xoá một phiên theo id 8 ký tự; trả `current:true` nếu xoá chính phiên đang dùng → frontend tự đăng xuất. Test: `backend/test/run.js` → "Phiên đăng nhập & nơi lưu key".
