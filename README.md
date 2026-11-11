> 🤖 Người/AI sửa code: đọc [AI-NOTES.md](AI-NOTES.md) trước (không thêm vẽ tay cho tự luận; frontend copy từ bản cũ, không làm "giống").

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
- Mật khẩu: **bcryptjs** (băm một chiều, mặc định 10 vòng, tối đa 72 byte). Repo private nên không mã hoá thêm hồ sơ/bài; riêng **API key AI** vẫn mã hoá AES-GCM. Đăng nhập được bằng **tên đăng nhập hoặc email**.
- Ảnh: **AES-256-GCM**, khoá HKDF từ `ENCRYPTION_KEY`, AAD = id chủ tài khoản ⇒ người khác không giải mã được dù biết id. Không kiểm duyệt (không Cloudinary); chỉ kiểm tra đúng JPEG/PNG/GIF/WebP.
- Ảnh tự sinh `…-image`, `…-image-1`, `…-image-2`… (private + gắn webhook). Giới hạn 200MB/repo (`IMAGE_REPO_LIMIT_MB`), chừa dự phòng 8MB (`IMAGE_REPO_RESERVE_MB`) nên thực tế chuyển repo ở ~192MB. Dung lượng theo dõi bằng sổ `images/pool.json` + `repository.size` từ webhook.
- Webhook `POST /webhooks/github`: xác thực HMAC-SHA256 (`X-Hub-Signature-256`), nhận `ping`/`push`, làm mới cache các file vừa đổi, cập nhật dung lượng repo ảnh. Sai chữ ký → 401.
- Dọn commit: giữ `PRUNE_DAYS` (5) ngày; gộp phần cũ thành 1 commit gốc, nội dung HEAD **không đổi** (kiểm tra cây trước khi force-update; nhánh có commit mới giữa chừng thì bỏ lượt). Quá `PRUNE_MAX_REPLAY` commit trong 5 ngày thì chỉ giữ số commit mới nhất đó.
- Bố cục dữ liệu: `…-account`: `users/<tên>.json`, `sessions/<uid>.json`, `private/<uid>/vault.json`, `AI-database/<uid>/index.json` (nhà cung cấp AI của tài khoản, không chứa key) · `…-data`: `u/<uid>/{essays,quizzes,submissions}/<id>.json`, `u/<uid>/index.json`, `images/pool.json`.
- Giới hạn: tên đăng nhập `a-z0-9_.-` (3–32); bài ≤ ~900KB; trắc nghiệm ≤ 300 câu; tối đa 12 nhà cung cấp AI/tài khoản.
- Chống dò mật khẩu/spam chỉ ở mức RAM từng instance (serverless không có bộ nhớ chung) — đủ cho dùng cá nhân/nhóm nhỏ.

## Tính năng
Tạo/sửa/xoá bài **tự luận** (đề, đáp án mẫu — dán HTML do AI sinh từ ảnh đề bằng prompt mẫu có sẵn, tiêu chí từ khoá, ảnh, đếm giờ) và **trắc nghiệm 3 phần** chuyển nguyên từ bản cũ `luyen-thi-cntt-utc-mnha`: Phần 1 nhiều đáp án, Phần 2 Đúng/Sai theo từng ý (chia đều hoặc THPTQG), Phần 3 điền số liệu (sai số, nhiều cách viết); dán 3 khối text theo quy luật `- câu / +) đáp án / => đáp án / ++) giải thích`, câu hỏi chùm `*)/1-3/`, `//image:`, prompt mẫu nhờ AI tạo đề, audio bài nghe, **xáo trộn thứ tự câu** (câu chùm đi liền nhau), đếm giờ + chuông, đánh dấu câu, nháp tự lưu · tự luận: chấm bằng AI bằng **key của chính bạn** · trắc nghiệm: **Phân tích AI** (chủ đề hay sai, vì sao sai từng câu, kế hoạch ôn; tối đa 5 lần/bài nộp, giãn cách 30 giây) · lịch sử bài nộp (trang `#/quiz|essay/<id>/history`: thống kê + biểu đồ điểm theo thời gian như luyen-thi) · xuất JSON · dựng lại chỉ mục.
Không có trong bản này (so với bản cũ): MongoDB, admin/duyệt user, slide/video/flashcard/tài liệu, Cloudinary.
Thanh trên cùng hiện **email đăng nhập** (tài khoản cũ chưa có email thì hiện tên đăng nhập).

## Nhà cung cấp AI (Cài đặt → tab "Nhà cung cấp AI")
- Trang riêng, **tự chủ động** như bản cũ: bạn **tự thêm** nhà cung cấp (tên, địa chỉ API, đường dẫn chat, danh sách model, header xác thực…) hoặc bấm mẫu gợi ý (vilao.ai, ChatGPT, DeepSeek, OpenRouter). Google Gemini luôn có sẵn (danh sách model lấy từ bản cũ).
- Danh sách của **từng tài khoản** lưu ở repo `-account`: `AI-database/<uid>/index.json` (không chứa key). Mỗi nhà giữ một API key riêng (mã hoá AES-256-GCM ở `private/<uid>/vault.json`); xoá nhà cung cấp thì xoá luôn key. Tài khoản cũ đã có key vilao.ai/ChatGPT/… được tự dựng danh sách lần đầu.
- Ở trang bài nộp có thể chọn nhà cung cấp/model khác cho riêng lần chấm/phân tích đó.
- Vì địa chỉ API do người dùng nhập: chỉ nhận `https://` tới tên miền công khai, cổng 443; máy chủ phân giải DNS và từ chối IP nội bộ/loopback trước khi gọi, không theo chuyển hướng (chống SSRF, không lộ key).
- Gemini quá tải (503/timeout) → tự thử tối đa 2 model dự phòng, trong ngân sách ~52 giây (Vercel giới hạn 60 giây/hàm).
- Lỗi key sai/hết hạn mức trả về mã 400/429 (không bao giờ 401 để khỏi bị đăng xuất nhầm). Giới hạn: 15 lần chấm/phân tích AI và 20 lần thử kết nối mỗi giờ. Kết quả phân tích lưu trong bài nộp (`aiAnalyses`).

## Chia sẻ bài (trắc nghiệm + tự luận) + lịch sử của nhóm
- Trang chủ → thẻ bài (trắc nghiệm hoặc tự luận) → **🔗 Chia sẻ** → sao chép link dạng `https://TEN_GITHUB.github.io/TEN_REPO/#/lessons/<id bài>/share?id=<id người tạo>` (giống `/lessons/<id>/share` của bản cũ; cũng chạy `/history` và `/play`). Link cũ dạng `#/s/<shareId>` vẫn mở được. Có nút **Tắt chia sẻ**; bật lại vẫn dùng đúng link cũ.
- Người nhận mở link: **chưa đăng nhập thì bị chuyển sang đăng nhập/đăng ký, xong quay lại đúng bài**. Bài làm lưu trong **kho riêng của người làm** (`u/<uid>/submissions`); đề được gửi xuống **không kèm đáp án/giải thích**, máy chủ chấm khi nộp; ảnh trong đề tải qua `/api/shares/:id/images/:imgId` (chỉ ảnh nằm trong đề).
- Trang `#/s/<id>/history` (chuyển từ `/lessons/:id/history` của luyen-thi): thống kê, **biểu đồ điểm theo thời gian** (1 ngày/1 tháng/1 năm/tất cả, theo năm-tháng-ngày, 10 khoảng điểm [0,1]…[9,10], nối điểm) và bảng.
  - **Chủ bài**: thấy tên từng người, điểm, giờ nộp; *không* đọc được bài làm.
  - **Người làm**: chỉ thấy bài làm + điểm của mình (bấm điểm để xem lại); điểm người khác hiện ẩn danh trên biểu đồ.
- Dữ liệu: `…-data/shares/<shareId>.json` (chủ bài, loại bài, trạng thái, danh sách `{id, uid, tên, giờ, điểm}`).
- **Bài nộp từ link chia sẻ không xoá được** (như luyen-thi) nên điểm không biến mất khỏi biểu đồ chung.
- **Tự luận**: nộp xong chưa có điểm (hiện “Chờ chấm AI”, chưa lên biểu đồ). Người làm tự bấm **🤖 Chấm bằng AI** — dùng nhà cung cấp + API key trong tài khoản của CHÍNH họ (Cài đặt → Nhà cung cấp AI); chỉ chấm được **một lần**, không tự nhập điểm. Chấm xong điểm (quy về thang 10) mới lên biểu đồ. Người làm không thấy đáp án mẫu trước khi nộp; chủ bài không đọc được bài làm của người khác.
- **Trang làm bài tự luận** (`#/essay/<id>`) khớp bản gốc: dòng “🧠 Prompt chấm đang dùng” (API `GET /api/prompts/resolve?type=essay&itemId=…`), âm báo hết giờ (khoá tới 00:00, phát lặp, tắt khi nộp), nút 📊 lịch sử, thanh AI (chọn nhà cung cấp/model, 🎲, 🔄 kiểm tra kết nối), bố cục 2 cột Đề bài | Bài viết, **khoá làm bài tới khi AI kết nối** (đồng hồ chạy từ lúc mở khoá) và **nộp xong tự chấm AI**.
- **Không làm phần vẽ tay** (bảng vẽ, ảnh → nét vẽ, tải ảnh/PDF làm bài) của bản gốc cho bài tự luận — không cần thêm; bài làm chỉ là văn bản.
- Test: `npm test` (backend, có mục “Chia sẻ bài trắc nghiệm” và “Chia sẻ bài tự luận”) và `NODE_PATH=test/stubs/node_modules:<playwright> node test/e2e-share.js` (trình duyệt thật).

## Kiểm thử
```
cd backend
npm test            # 48 kịch bản tích hợp với GitHub giả lập (không cần mạng)
npm run test:ui     # trình duyệt thật (Playwright): đăng nhập bằng email, Cài đặt → Nhà cung cấp AI, tạo/làm đề 3 phần, chấm & phân tích AI
```
Sandbox khi kiểm thử không có mạng nên `bcryptjs` được thay bằng bản giả trong `backend/test/stubs` (cùng API `hash/compare`); **khi chạy thật Vercel cài `bcryptjs` thật** từ `package.json`. Thư mục `test/` không ảnh hưởng khi deploy.

## Prompt AI riêng & id bài
- Trang **Prompt AI** (`#/prompts`): mỗi tài khoản tự tạo prompt **chấm tự luận** (`essay`) và **phân tích trắc nghiệm** (`quiz`), lưu ở `u/<uid>/prompts.json` (repo data). Mỗi loại có thể đặt 1 prompt mặc định. Biến: tự luận `{đề_bài} {bài_làm} {lời_giải_mẫu} {rubric} {max_score} {strictness} {student_name}`; trắc nghiệm `{đề_trắc_nghiệm} {bài_làm} {kết_quả} {max_score} {student_name}`. Phần JSON trả về và quy tắc "nội dung là dữ liệu" do hệ thống tự nối.
- Trong trình soạn, chọn prompt cho từng bài (`promptId`). Bài chia sẻ: người làm bấm chấm/phân tích bằng **key của chính họ** nhưng dùng **prompt của chủ bài** (bài không gắn thì dùng prompt mặc định của chủ bài); người làm không thấy tên hay nội dung prompt.
- Id bài/bài nộp/prompt mới có dạng `<timestamp ms>_<hex ngẫu nhiên>` (vd `1731289315790_9f3a1c07b2d4`), file `u/<uid>/essays/<id>.json` và `"id"` trùng nhau. Id cũ 16 hex vẫn dùng được.
