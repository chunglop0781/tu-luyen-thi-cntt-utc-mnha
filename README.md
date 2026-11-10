# Tự luyện thi của mnha (tu-luyen-thi-cntt-utc-mnha — bản theo từng tài khoản)

👉 **Cài đặt từng bước: xem [HUONG-DAN-CAI-DAT.md](HUONG-DAN-CAI-DAT.md)**

Mỗi tài khoản **tự tạo và tự lưu** bài **tự luận** + **trắc nghiệm** của mình để tự ôn; không ai xem được bài của ai.

```
GitHub Pages (giao diện tĩnh ở thư mục gốc)       ──HTTPS + Bearer token──▶  Vercel (backend, thư mục backend/)
                                                                              │
                              ┌───────────────────────────────────────────────┼───────────────────────────────┐
                              ▼                                               ▼                               ▼
              repo PRIVATE  …-account                         repo PRIVATE  …-data                 repo PRIVATE  …-image, -image-1, -image-2 …
       tài khoản, phiên đăng nhập, kho riêng tư              bài tự luận / trắc nghiệm / bài nộp        ảnh mã hoá AES-256-GCM
       (cron dọn commit > 5 ngày)                            (KHÔNG dọn commit)                         (tự sinh repo mới khi đầy 200MB)
```

Không dùng MongoDB, Cloudinary hay Express. Backend chỉ phụ thuộc đúng một thư viện: **bcryptjs**.

## 1. Chuẩn bị GitHub (1 lần)
1. Tạo token: *Settings → Developer settings → Personal access tokens (classic)* với scope **`repo`** và **`admin:repo_hook`** (cần để gắn webhook).
2. Sinh các bí mật (chạy 3 lần, mỗi lần một giá trị khác nhau):
   `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` → dùng cho `JWT_SECRET`, `ENCRYPTION_KEY`, `GITHUB_WEBHOOK_SECRET` (và `CRON_SECRET`).
3. Trong `backend/`: copy `.env.example` → `.env`, điền, rồi chạy **`node scripts/setup-github.js`** → tự tạo repo private `…-account`, `…-data`, `…-image` và gắn webhook push → `/webhooks/github` cho từng repo.
   *(Bạn đã có sẵn repo `-account` private thì script chỉ bổ sung webhook.)*

> **Về 2 repo:** bạn ghi cả hai loại dữ liệu vào `tu-luyen-thi-cntt-utc-mnha-account`, nhưng một repo không thể vừa “dọn commit sau 5 ngày” vừa “không dọn” (dọn = viết lại lịch sử cả repo). Nên: **`-account`** = tài khoản/phiên/kho riêng tư (dọn 5 ngày), **`-data`** = bài + bài nộp (giữ lịch sử, có thể khôi phục bài lỡ xoá). Muốn gộp một repo: đặt `DATA_GITHUB_REPO` = `ACCOUNT_GITHUB_REPO`; khi đó cron **tự bỏ qua** việc dọn để không mất lịch sử bài.

## 2. Backend lên Vercel
1. Import repo này vào Vercel, **Root Directory = `backend`**.
2. *Settings → Environment Variables*: nhập toàn bộ biến trong `backend/.env.example` (bắt buộc: `GITHUB_TOKEN`, `GITHUB_OWNER`, `JWT_SECRET`, `ENCRYPTION_KEY`, `GITHUB_WEBHOOK_SECRET`, `CRON_SECRET`, `FRONTEND_ORIGINS`, `PUBLIC_API_URL`).
   `FRONTEND_ORIGINS` = origin GitHub Pages, **chỉ scheme + host**: `https://TEN_GITHUB.github.io` (không có `/tên-repo`, không có `/` cuối cũng được).
3. Deploy, mở `https://<project>.vercel.app/api/health?deep=1` → `ok: true`, `problems: []`, 2 repo `true`.
4. Cron `/api/cron/prune` chạy mỗi ngày 03:30 (VN). Vercel tự gửi `Authorization: Bearer $CRON_SECRET`.

## 3. Frontend lên GitHub Pages
Giao diện (`index.html`, `404.html`, `config.js`, `css/`, `js/`, `img/`) nằm ngay ở thư mục gốc, không cần build.
1. Sửa `config.js`: `API_BASE` = `https://<project>.vercel.app`, commit và push.
2. *Settings → Pages → Source: **Deploy from a branch** → `main` → `/ (root)`*.
3. Mở `https://TEN_GITHUB.github.io/TEN_REPO/` → Đăng ký (nhập email, nhận mã OTP 6 số để xác minh; cấu hình gửi mail ở mục *Phần OTP* trong `HUONG-DAN-CAI-DAT.md`).

## Vì sao Pages ↔ Vercel chạy ổn định
| Rủi ro | Cách xử lý |
|---|---|
| Trình duyệt chặn cookie bên thứ ba | **Không dùng cookie.** Access token (1 giờ) + refresh token (30 ngày) gửi qua header `Authorization`, lưu localStorage |
| Đổi trang / F5 trên Pages bị 404 | Router dùng **`#/đường-dẫn`** → luôn nạp `index.html` |
| CORS preflight (`OPTIONS`) | Trả 204 ngay đầu hàm, `Access-Control-Max-Age: 86400`, cho phép `Authorization`; **mọi lỗi (401/404/500/lỗi khởi tạo) đều kèm header CORS** nên thấy thông báo thật thay vì “CORS error” |
| Cold start Vercel | Frontend `ping /api/health` khi mở trang, hiện “máy chủ đang khởi động” |
| Rớt mạng / 502 / 429 | GET/PUT/DELETE tự retry có backoff; tạo bài & nộp bài dùng **id do client sinh** (`PUT /api/.../:id`) nên gửi lại **không bị trùng** |
| Access token hết hạn | Tự refresh (một lần tại một thời điểm), lỗi mạng khi refresh **không** làm đăng xuất |
| Mất bài đang viết | Bản nháp tự lưu localStorage |
| Ảnh cần token | Tải bằng fetch + Authorization rồi dựng blob URL |
| Giới hạn 4,5MB payload Vercel | Ảnh nén ở trình duyệt (≤1600px) và gửi nhị phân thô, tối đa 4MB |
| GitHub xung đột ghi / rate-limit | Khoá ghi tuần tự theo repo, retry khi 409/422, ETag (304 không tốn quota), retry 5xx/429 |

Trang **Cài đặt → Kiểm tra kết nối** chạy `/api/health?deep=1` ngay từ origin GitHub Pages.

## Bảo mật & dữ liệu
- Mật khẩu: **bcryptjs** (băm một chiều, mặc định 10 vòng, tối đa 72 byte). Repo private nên không mã hoá thêm hồ sơ/bài; riêng **API key AI** (Gemini, vilao.ai, ChatGPT, DeepSeek, OpenRouter) vẫn mã hoá AES-GCM.
- Ảnh: **AES-256-GCM**, khoá HKDF từ `ENCRYPTION_KEY`, AAD = id chủ tài khoản ⇒ người khác không giải mã được dù biết id. Không kiểm duyệt (không Cloudinary); chỉ kiểm tra đúng JPEG/PNG/GIF/WebP.
- Ảnh tự sinh `…-image`, `…-image-1`, `…-image-2`… (private + gắn webhook). Giới hạn 200MB/repo (`IMAGE_REPO_LIMIT_MB`), chừa dự phòng 8MB (`IMAGE_REPO_RESERVE_MB`) nên thực tế chuyển repo ở ~192MB. Dung lượng theo dõi bằng sổ `images/pool.json` + `repository.size` từ webhook.
- Webhook `POST /webhooks/github`: xác thực HMAC-SHA256 (`X-Hub-Signature-256`), nhận `ping`/`push`, làm mới cache các file vừa đổi, cập nhật dung lượng repo ảnh. Sai chữ ký → 401.
- Dọn commit: giữ `PRUNE_DAYS` (5) ngày; gộp phần cũ thành 1 commit gốc, nội dung HEAD **không đổi** (kiểm tra cây trước khi force-update; nhánh có commit mới giữa chừng thì bỏ lượt). Quá `PRUNE_MAX_REPLAY` commit trong 5 ngày thì chỉ giữ số commit mới nhất đó.
- Bố cục dữ liệu: `…-account`: `users/<tên>.json`, `sessions/<uid>.json`, `private/<uid>/vault.json` · `…-data`: `u/<uid>/{essays,quizzes,submissions}/<id>.json`, `u/<uid>/index.json`, `images/pool.json`.
- Giới hạn: tên đăng nhập `a-z0-9_.-` (3–32); bài ≤ ~900KB; trắc nghiệm ≤ 300 câu.
- Chống dò mật khẩu/spam chỉ ở mức RAM từng instance (serverless không có bộ nhớ chung) — đủ cho dùng cá nhân/nhóm nhỏ.

## Tính năng
Tạo/sửa/xoá bài tự luận (đề, đáp án mẫu, tiêu chí từ khoá, ảnh) và trắc nghiệm (nhập nhanh từ văn bản `Câu 1: … A. … Đáp án: B`, nhiều đáp án đúng, giải thích, đếm ngược, xáo câu, ảnh) · làm bài & chấm tự động trắc nghiệm · tự luận: gợi ý điểm theo từ khoá, tự chấm, chấm bằng AI (Gemini / vilao.ai / ChatGPT / DeepSeek / OpenRouter) bằng **key của chính bạn** · trắc nghiệm: **Phân tích AI** (chủ đề hay sai, vì sao sai từng câu, kế hoạch ôn; tối đa 5 lần/bài nộp, giãn cách 30 giây) · lịch sử bài nộp · xuất JSON · dựng lại chỉ mục.
Không có trong bản này (so với bản cũ): MongoDB, admin/duyệt user, slide/video/flashcard/tài liệu, Cloudinary.
Thanh trên cùng hiện **email đăng nhập** (tài khoản cũ chưa có email thì hiện tên đăng nhập).

## Kết nối AI (Cài đặt → Kết nối AI)
- Chọn nhà cung cấp + model (danh sách lấy từ bản cũ `luyen-thi-cntt-utc-mnha`: Gemini 3.x/2.5/Gemma, vilao.ai, ChatGPT, DeepSeek, OpenRouter), dán **API key của riêng bạn**, bấm **Kiểm tra kết nối AI**. Mỗi nhà cung cấp giữ một key riêng (mã hoá AES-256-GCM, repo `-account` private); nhà đang chọn là mặc định khi chấm.
- Ở trang bài nộp tự luận có thể chọn nhà cung cấp/model khác cho riêng lần chấm đó.
- Địa chỉ API của từng nhà cung cấp do **máy chủ cố định** trong `backend/src/aiModels.js` (người dùng không nhập URL → không bị lợi dụng gửi request tới địa chỉ lạ). Muốn thêm nhà cung cấp kiểu OpenAI khác: thêm một dòng `kind: 'openai'` vào file đó.
- Gemini quá tải (503/timeout) → tự thử tối đa 2 model dự phòng, trong ngân sách ~52 giây (Vercel giới hạn 60 giây/hàm).
- Lỗi key sai/hết hạn mức trả về mã 400/429 (không bao giờ 401 để khỏi bị đăng xuất nhầm). Giới hạn: 15 lần chấm/phân tích AI và 20 lần thử kết nối mỗi giờ. Kết quả phân tích lưu trong bài nộp (`aiAnalyses`).

## Kiểm thử
```
cd backend
npm test            # 45 kịch bản tích hợp với GitHub giả lập (không cần mạng)
npm run test:e2e    # trình duyệt thật (Playwright): Pages-origin ↔ API-origin khác nhau
npm run test:ui     # trình duyệt thật: nền trắng, tên mới, hiện/ẩn mật khẩu, Kết nối AI, chấm AI
```
Sandbox khi kiểm thử không có mạng nên `bcryptjs` được thay bằng bản giả trong `backend/test/stubs` (cùng API `hash/compare`); **khi chạy thật Vercel cài `bcryptjs` thật** từ `package.json`. Thư mục `test/` không ảnh hưởng khi deploy.
