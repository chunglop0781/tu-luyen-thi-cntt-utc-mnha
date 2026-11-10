# Hướng dẫn cài đặt từng bước (Backend trên Vercel + Frontend trên GitHub Pages)

Có **3 cách** cài. Chọn một:

| Cách | Dùng khi | Thời gian |
|---|---|---|
| **Cách 1 – Chạy thật, làm bằng giao diện web** (khuyến nghị) | Muốn đưa lên mạng để dùng thật | 20–30 phút |
| **Cách 2 – Chạy thật, làm bằng dòng lệnh Vercel CLI** | Quen terminal, muốn nhập biến môi trường bằng lệnh | 15–20 phút |
| **Cách 3 – Chạy thử trên máy** | Muốn xem thử/sửa code trước khi đưa lên mạng | 10 phút |

Cả 3 cách đều dùng chung **Phần 0 (chuẩn bị)** và **Phần .env** bên dưới, nên đọc hai phần này trước.

> Quy ước: `TEN_GITHUB` = username GitHub của bạn, `TEN_PROJECT` = tên project trên Vercel (địa chỉ sẽ là `https://TEN_PROJECT.vercel.app`).

---

## Phần 0. Chuẩn bị (làm 1 lần cho cả 3 cách)

**Cần có:** tài khoản GitHub, tài khoản Vercel (đăng nhập bằng GitHub, gói Hobby miễn phí là đủ), Node.js ≥ 18 và git trên máy.
Kiểm tra: `node -v` (phải ≥ v18) và `git --version`.

### 0.1. Đưa mã nguồn lên GitHub

1. Giải nén `tu-luyen-thi-cntt-utc-mnha.zip`.
2. Tạo repo mới trên GitHub tên **`tu-luyen-thi-cntt-utc-mnha`**, để **Public**
   (GitHub Pages miễn phí chỉ chạy với repo public; repo này **không chứa bí mật** vì `.env` đã bị `.gitignore` chặn; dữ liệu người dùng nằm ở các repo private khác).
   Đừng tick "Add a README" hay `.gitignore` (repo phải trống).
3. Mở terminal **ngay trong thư mục gốc vừa giải nén** (thư mục chứa `index.html`, `css`, `js`, `backend`), **không** đứng trong `backend`:
   ```bash
   git init -b main
   git add .
   git commit -m "first commit"
   git remote add origin https://github.com/TEN_GITHUB/tu-luyen-thi-cntt-utc-mnha.git
   git push -u origin main
   ```
4. Kiểm tra trước khi commit: `git ls-files | findstr /i env` (Windows) hoặc `git ls-files | grep -i env` phải chỉ ra `backend/.env.example` và `backend/scripts/env.js`, **không** có `backend/.env`. Nếu có `.env` thì bạn đang đứng sai thư mục, hãy dừng lại.

> Cấu trúc repo: giao diện (`index.html`, `404.html`, `config.js`, `css/`, `js/`, `img/`) nằm ngay ở **thư mục gốc** để GitHub Pages phục vụ được; backend nằm trong `backend/` và chỉ chạy trên Vercel.

### 0.2. Tạo token GitHub

*GitHub → Settings → Developer settings → Personal access tokens → **Tokens (classic)** → Generate new token (classic)*
- Note: `tu-luyen-thi`; Expiration: **No expiration** (hoặc dài, vì hết hạn thì backend ngừng ghi được dữ liệu).
- Tick scope **`repo`** và **`admin:repo_hook`**.
- Bấm Generate, **copy token ngay** (dạng `ghp_...`, chỉ hiện 1 lần).

> Dùng token fine-grained cũng được, nhưng phải cấp cho mọi repo của dự án quyền *Contents: Read and write*, *Administration: Read and write*, *Webhooks: Read and write*. Repo ảnh mới sinh về sau cũng cần nằm trong phạm vi token, nên token classic đơn giản hơn.

### 0.3. Sinh 4 chuỗi bí mật

Chạy lệnh dưới **4 lần**, mỗi lần ra một giá trị **khác nhau** (mỗi giá trị dài 96 ký tự):
```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```
Ghi lại thành 4 giá trị cho `JWT_SECRET`, `ENCRYPTION_KEY`, `GITHUB_WEBHOOK_SECRET`, `CRON_SECRET`.

⚠️ **Cất kỹ `ENCRYPTION_KEY`** (ví dụ trong trình quản lý mật khẩu). Mất hoặc đổi nó thì toàn bộ ảnh và API key AI đã lưu **không giải mã được nữa**. Đổi `JWT_SECRET` thì mọi người bị đăng xuất (không mất dữ liệu).

---

## Phần .env. Các biến môi trường

Cùng một danh sách biến được dùng ở 3 nơi, tuỳ cách bạn chọn:
- **Vercel** (Cách 1, 2): nhập trong *Settings → Environment Variables* hoặc bằng `vercel env add`.
- **File `backend/.env` trên máy bạn**: dùng để chạy `setup-github.js`, `prune.js` và chạy thử (Cách 3). File này **không bao giờ được commit**.

### Bảng giải thích từng biến

**Bắt buộc**

| Biến | Giá trị | Lấy ở đâu |
|---|---|---|
| `GITHUB_TOKEN` | `ghp_...` | Bước 0.2 |
| `GITHUB_OWNER` | `TEN_GITHUB` (username hoặc tên tổ chức sở hữu các repo) | Tên tài khoản GitHub |
| `JWT_SECRET` | chuỗi ≥ 32 ký tự | Bước 0.3 |
| `ENCRYPTION_KEY` | chuỗi ≥ 32 ký tự, khác `JWT_SECRET` | Bước 0.3 |
| `GITHUB_WEBHOOK_SECRET` | chuỗi ngẫu nhiên | Bước 0.3 |
| `CRON_SECRET` | chuỗi ngẫu nhiên | Bước 0.3 |
| `FRONTEND_ORIGINS` | `https://TEN_GITHUB.github.io` | Chỉ scheme + host, **không** có `/tu-luyen-thi-cntt-utc-mnha`. Nhiều địa chỉ thì cách nhau dấu phẩy |

**Gửi mã OTP xác minh email** (bắt buộc nếu để `REQUIRE_EMAIL_OTP=true`, là mặc định — cách lấy xem mục *Phần OTP* bên dưới)

| Biến | Giá trị | Ghi chú |
|---|---|---|
| `MAIL_USER` | `ten.ban@gmail.com` | Gmail dùng để gửi mã |
| `MAIL_PASS` | `abcdefghijklmnop` | **Mật khẩu ứng dụng** 16 ký tự của Gmail, KHÔNG phải mật khẩu đăng nhập Gmail. Có dấu cách cũng được, hệ thống tự bỏ |

**Nên đặt**

| Biến | Giá trị | Ghi chú |
|---|---|---|
| `PUBLIC_API_URL` | `https://TEN_PROJECT.vercel.app` | Để gắn webhook cho repo ảnh mới sinh. Trên Vercel nếu bỏ trống thì tự lấy tên miền production, nhưng **trong `.env` trên máy thì phải điền** để `setup-github.js` gắn được webhook. Không có `/` cuối |

**Tuỳ chọn** (đã có mặc định, không cần điền)

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `GITHUB_BRANCH` | `main` | Nhánh ghi dữ liệu |
| `ACCOUNT_GITHUB_REPO` | `tu-luyen-thi-cntt-utc-mnha-account` | Repo private chứa tài khoản + phiên đăng nhập (cron dọn commit cũ) |
| `DATA_GITHUB_REPO` | `tu-luyen-thi-cntt-utc-mnha-data` | Repo private chứa bài và bài nộp (giữ lịch sử). Đặt bằng `ACCOUNT_GITHUB_REPO` nếu muốn gộp một repo (khi đó cron bỏ qua việc dọn) |
| `IMAGE_REPO_PREFIX` | `tu-luyen-thi-cntt-utc-mnha-image` | Repo ảnh: `<prefix>`, `<prefix>-1`, `<prefix>-2`… |
| `IMAGE_REPO_LIMIT_MB` / `IMAGE_REPO_RESERVE_MB` | `200` / `8` | Chuyển sang repo ảnh mới khi đạt khoảng 192MB |
| `ACCESS_TOKEN_MINUTES` | `60` | Thời hạn access token |
| `REFRESH_TOKEN_DAYS` | `30` | Thời hạn refresh token |
| `BCRYPT_ROUNDS` | `10` | Độ nặng băm mật khẩu (8–14) |
| `REGISTRATION_OPEN` | `true` | Đặt `false` để đóng đăng ký (đăng ký xong hết người cần rồi đóng lại) |
| `INVITE_CODE` | (trống) | Đặt một mã nếu muốn ai đăng ký cũng phải nhập mã mời |
| `PRUNE_DAYS` / `PRUNE_MAX_REPLAY` | `5` / `150` | Dọn commit sau 5 ngày, giữ tối đa 150 commit mới nhất |
| `GEMINI_MODEL` | `gemini-2.5-flash` | Model Gemini mặc định khi chấm tự luận. Mỗi tài khoản tự chọn nhà cung cấp/model và nhập API key riêng trong Cài đặt → Nhà cung cấp AI |
| `REQUIRE_EMAIL_OTP` | `true` | `true`: đăng ký phải nhập mã OTP gửi về email. `false`: tắt OTP, đăng ký thẳng bằng tên + mật khẩu (không cần `MAIL_*`) |
| `MAIL_HOST` / `MAIL_PORT` / `MAIL_SECURE` | `smtp.gmail.com` / `465` / `true` | Chỉ đổi khi dùng nhà cung cấp mail khác (Brevo, SendGrid, Mailgun…) |
| `MAIL_FROM` | (trống) | Tên hiển thị ở người gửi, ví dụ `"Tự luyện thi" <ten.ban@gmail.com>`. Trống = tự lấy từ `MAIL_USER` |
| `OTP_TTL_MINUTES` | `10` | Mã sống bao lâu |
| `OTP_MAX_ATTEMPTS` | `5` | Nhập sai quá số lần này thì phải xin mã mới |
| `OTP_RESEND_SECONDS` | `60` | Giãn cách giữa 2 lần gửi mã |
| `ALLOW_LOCALHOST` | `false` | Chỉ đặt `true` khi chạy thử trên máy (Cách 3). **Đừng bật trên Vercel** |

### Phần OTP. Lấy "Mật khẩu ứng dụng" Gmail để gửi mã

Giống dự án *Luyện thi CNTT UTC*: backend gửi mail qua SMTP của Gmail, nên cần một **mật khẩu ứng dụng** (App Password).

1. Đăng nhập Gmail định dùng để gửi mã (nên tạo riêng một Gmail cho dự án, đừng dùng Gmail cá nhân chính).
2. Vào <https://myaccount.google.com/security> → bật **Xác minh 2 bước** (bắt buộc, chưa bật thì không tạo được mật khẩu ứng dụng).
3. Vào <https://myaccount.google.com/apppasswords> → đặt tên bất kỳ (ví dụ `tu-luyen-thi`) → **Tạo** → Google hiện 16 ký tự dạng `abcd efgh ijkl mnop`. **Chép ngay**, đóng cửa sổ là không xem lại được.
4. Điền vào `backend/.env` (máy bạn) **và** *Vercel → Settings → Environment Variables*:
   ```ini
   MAIL_USER=ten.ban@gmail.com
   MAIL_PASS=abcdefghijklmnop
   ```
   (Không đặt `MAIL_HOST`/`MAIL_PORT` thì mặc định đã là Gmail `smtp.gmail.com:465`.)
5. **Redeploy** Vercel (*Deployments → ⋯ → Redeploy*) vì Vercel chỉ đọc biến mới sau khi deploy lại. Lần đầu sau khi thêm `nodemailer` vào `package.json`, Vercel sẽ tự cài thư viện khi build.
6. Thử: mở trang → **Đăng ký** → điền email thật → bấm *Gửi mã xác minh* → mở hộp thư (xem cả mục **Spam**) lấy mã 6 số → nhập vào → tạo xong tài khoản.

Cách hoạt động: đăng ký gồm 2 bước. Bước 1 chưa tạo tài khoản, chỉ lưu bản chờ (mã được **băm**, hết hạn sau 10 phút, tối đa 5 lần thử sai) trong repo `-account`. Bước 2 nhập đúng mã mới tạo tài khoản. Mỗi email chỉ dùng cho 1 tài khoản. Có **Quên mật khẩu** (mã OTP gửi về email, đổi xong mọi thiết bị bị đăng xuất).

Gmail miễn phí gửi được khoảng 500 thư/ngày, đủ cho lớp học. Cần nhiều hơn thì dùng Brevo/SendGrid và đặt `MAIL_HOST`, `MAIL_PORT`, `MAIL_USER`, `MAIL_PASS` theo nhà cung cấp đó.

> **Tài khoản cũ** (tạo trước khi có OTP) vẫn đăng nhập bằng tên + mật khẩu bình thường nhưng chưa có email, nên chưa dùng được "Quên mật khẩu".
> **Muốn tắt OTP** (ví dụ chạy thử trên máy): đặt `REQUIRE_EMAIL_OTP=false`.

### Mẫu file `backend/.env` (điền thay các chỗ `...`)

> **Đã có sẵn file `backend/.env` trong zip**: 4 chuỗi bí mật đã được sinh sẵn, bạn chỉ thay 4 chỗ `THAY_...` (`GITHUB_TOKEN`, `GITHUB_OWNER`, `FRONTEND_ORIGINS`, `PUBLIC_API_URL`). File này đã bị `.gitignore` chặn nên `git add .` sẽ không đẩy nó lên GitHub. Muốn dùng bí mật khác thì sinh lại theo bước 0.3.

Tạo bằng: `cd backend` rồi `cp .env.example .env` (Windows: `copy .env.example .env`). Rồi sửa thành:

```ini
GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
GITHUB_OWNER=TEN_GITHUB
GITHUB_BRANCH=main

JWT_SECRET=dán-chuỗi-bí-mật-1-dài-96-ký-tự
ENCRYPTION_KEY=dán-chuỗi-bí-mật-2-dài-96-ký-tự
GITHUB_WEBHOOK_SECRET=dán-chuỗi-bí-mật-3-dài-96-ký-tự
CRON_SECRET=dán-chuỗi-bí-mật-4-dài-96-ký-tự

FRONTEND_ORIGINS=https://TEN_GITHUB.github.io
PUBLIC_API_URL=https://TEN_PROJECT.vercel.app

MAIL_USER=ten.ban@gmail.com
MAIL_PASS=mat-khau-ung-dung-16-ky-tu
```
Các dòng tuỳ chọn khác trong `.env.example` có thể để nguyên hoặc xoá.

### 5 lưu ý khi sửa `.env`

1. **Không ghi chú cùng dòng**: `JWT_SECRET=abc # bí mật` sẽ bị đọc thành giá trị `abc # bí mật`. Chú thích phải nằm ở dòng riêng, bắt đầu bằng `#`.
2. Không cần để giá trị trong dấu nháy; có nháy thì chương trình tự bỏ. Không để khoảng trắng thừa sau giá trị.
3. **Không bao giờ commit `.env`** (đã nằm trong `.gitignore`). Nếu lỡ lộ token, vào GitHub xoá token rồi tạo lại.
4. Giá trị trong `.env` trên máy phải **trùng** với trên Vercel ở các biến liên quan: tối thiểu `GITHUB_OWNER`, tên repo, `GITHUB_WEBHOOK_SECRET`. Nếu bạn chạy backend trên máy với dữ liệu thật thì cả `ENCRYPTION_KEY` cũng phải trùng.
5. Trên Vercel, **sửa biến xong phải Redeploy** mới có hiệu lực (*Deployments → ⋯ → Redeploy*).

### Cách nhập nhanh toàn bộ biến vào Vercel

Trong *Settings → Environment Variables → Add New*, bạn có thể **mở file `backend/.env` bằng trình soạn thảo, copy toàn bộ nội dung rồi dán vào ô Key**: Vercel tự tách thành từng biến. Sau đó xoá các dòng không cần (như `ALLOW_LOCALHOST`) và bấm Save. Nhớ chọn môi trường **Production**.

---

## Cách 1. Chạy thật, làm bằng giao diện web (khuyến nghị)

Làm đúng thứ tự A → F. Đã xong Phần 0 và có sẵn các giá trị cho `.env`.

### A. Triển khai Backend lên Vercel

1. Vào https://vercel.com/new → chọn repo `tu-luyen-thi-cntt-utc-mnha` → **Import**.
2. Ở màn hình cấu hình:
   - **Root Directory: bấm Edit → chọn `backend`** (bắt buộc, nếu bỏ sót sẽ lỗi 404).
   - Framework Preset: **Other**. Build/Output Command để mặc định.
3. Mở mục **Environment Variables**, dán các biến theo bảng ở Phần .env (tối thiểu 7 biến bắt buộc, thêm `PUBLIC_API_URL` sau khi biết địa chỉ).
4. Bấm **Deploy**. Xong sẽ có địa chỉ dạng `https://TEN_PROJECT.vercel.app` (xem trong Project → Domains).
5. Nếu lúc đầu chưa điền `PUBLIC_API_URL`: thêm biến `PUBLIC_API_URL` = `https://TEN_PROJECT.vercel.app` rồi **Redeploy**.
6. Mở `https://TEN_PROJECT.vercel.app/api/health` → thấy `"ok": true` và `"problems": []`.
   Nếu `problems` liệt kê biến thiếu thì bổ sung rồi Redeploy.

### B. Tạo repo dữ liệu private + gắn webhook (1 lần, chạy trên máy bạn)

```bash
cd backend
cp .env.example .env        # Windows: copy .env.example .env
```
Mở `.env`, điền **đúng các giá trị đã dùng trên Vercel** (xem mẫu ở Phần .env), rồi chạy:
```bash
node scripts/setup-github.js
```
Kết quả mong đợi:
```
+ đã tạo private TEN_GITHUB/tu-luyen-thi-cntt-utc-mnha-account
  ✓ webhook đã tạo → https://TEN_PROJECT.vercel.app/webhooks/github
+ đã tạo private TEN_GITHUB/tu-luyen-thi-cntt-utc-mnha-data
  ✓ webhook đã tạo → ...
+ đã tạo private TEN_GITHUB/tu-luyen-thi-cntt-utc-mnha-image
  ✓ webhook đã tạo → ...
```
(Repo đã có thì script giữ nguyên, chỉ bổ sung hoặc cập nhật webhook. Không cần `npm install` để chạy script này.)

Nếu thấy `! bỏ qua webhook`: `.env` đang thiếu `PUBLIC_API_URL` hoặc `GITHUB_WEBHOOK_SECRET`.

Kiểm tra: mở `https://TEN_PROJECT.vercel.app/api/health?deep=1` → `"github": {"account": true, "data": true}`.
Kiểm tra webhook: GitHub → repo `…-account` → *Settings → Webhooks* → *Recent Deliveries* có dấu ✔ xanh (bấm *Redeliver* nếu cần).

### C. Triển khai Frontend lên GitHub Pages

Giao diện là các file tĩnh nằm ở thư mục gốc, không cần build, không cần Actions.

1. Mở file `config.js` ở thư mục gốc, sửa dòng `API_BASE` thành địa chỉ Vercel của bạn (không có `/` cuối):
   ```js
   window.APP_CONFIG = {
     API_BASE: 'https://TEN_PROJECT.vercel.app',
   };
   ```
2. Commit và push:
   ```bash
   git add config.js
   git commit -m "set API_BASE"
   git push
   ```
3. Repo `tu-luyen-thi-cntt-utc-mnha` → *Settings → Pages* → mục **Build and deployment**:
   - Source: **Deploy from a branch**
   - Branch: **main**, thư mục **/ (root)** → Save.
4. Đợi 1–2 phút (tab *Actions* sẽ hiện một lượt "pages build and deployment" chạy xong), rồi mở `https://TEN_GITHUB.github.io/tu-luyen-thi-cntt-utc-mnha/`.

Trang dùng đường dẫn dạng `#/...` (ví dụ `.../tu-luyen-thi-cntt-utc-mnha/#/history`) nên đổi trang hay F5 đều không bị 404. Nếu ai gõ thẳng một đường dẫn kiểu `/tu-luyen-thi-cntt-utc-mnha/essay/abc`, file `404.html` sẽ tự chuyển sang dạng `#/essay/abc`.

### D. Dùng thử

1. Mở trang Pages → **Đăng ký** → tạo bài tự luận / trắc nghiệm → làm bài → xem lịch sử.
2. **Cài đặt → 🩺 Kiểm tra kết nối** → phải ra `"ok": true`.
3. (Tuỳ chọn) Trong **Cài đặt**, vào tab **Nhà cung cấp AI**, thêm nhà cung cấp (Gemini có sẵn; vilao.ai, ChatGPT, DeepSeek, OpenRouter bấm mẫu gợi ý hoặc tự nhập) + model, dán API key của bạn rồi bấm **Kiểm tra kết nối AI** để dùng chấm tự luận bằng AI.
4. Kiểm tra dữ liệu: repo `…-account` có `users/<tên>.json` (mật khẩu là chuỗi băm bcrypt), repo `…-data` có `u/<id>/…`.

### E. Dọn commit repo `-account` sau 5 ngày

Tự chạy mỗi ngày bằng Vercel Cron (khai báo trong `backend/vercel.json`, cần `CRON_SECRET`).
- Xem trước trên máy: `cd backend && node scripts/prune.js`
- Chạy thật: `node scripts/prune.js --yes`
- Gọi thử qua web: `curl -H "Authorization: Bearer CRON_SECRET" "https://TEN_PROJECT.vercel.app/api/cron/prune?dry=1"`

### F. Cập nhật sau này
`git push` lên `main`: Vercel tự triển khai lại backend; Pages tự cập nhật sau mỗi lần push.

---

## Cách 2. Chạy thật, dùng Vercel CLI

Thay bước A của Cách 1 bằng dòng lệnh. Các bước B, C, D, E giữ nguyên.

```bash
npm install -g vercel
cd backend
vercel login                  # làm theo hướng dẫn, chọn Continue with GitHub
vercel link                   # trả lời: scope = tài khoản của bạn; Link to existing project? N;
                              # tên project = TEN_PROJECT; thư mục code = ./  (vì đang đứng trong backend)
```

Thêm từng biến môi trường (mỗi lệnh sẽ hỏi giá trị, dán vào rồi Enter; chọn Production khi được hỏi):
```bash
vercel env add GITHUB_TOKEN production
vercel env add GITHUB_OWNER production
vercel env add JWT_SECRET production
vercel env add ENCRYPTION_KEY production
vercel env add GITHUB_WEBHOOK_SECRET production
vercel env add CRON_SECRET production
vercel env add FRONTEND_ORIGINS production
vercel env add PUBLIC_API_URL production
```
Nếu hỏi "mark as sensitive?" bạn nên chọn **Yes** cho token và các chuỗi bí mật.

Triển khai bản production:
```bash
vercel deploy --prod
```
Lệnh in ra địa chỉ `https://TEN_PROJECT.vercel.app`; mở `/api/health` kiểm tra như bước A6 của Cách 1.

> Dự án này được liên kết từ **thư mục `backend`**, nên Root Directory đã đúng. Nếu sau đó bạn muốn Vercel tự triển khai khi `git push`, vào *Project → Settings → Git* kết nối repo và đặt **Root Directory = `backend`**.

---

## Cách 3. Chạy thử trên máy (không cần Vercel/Pages)

Backend trên máy vẫn dùng **GitHub thật** (cần token và repo), nên vẫn phải làm Phần 0 và bước B của Cách 1 (tạo repo bằng `setup-github.js`). Khuyên dùng repo riêng cho thử nghiệm, ví dụ đặt `ACCOUNT_GITHUB_REPO=...-dev-account`, `DATA_GITHUB_REPO=...-dev-data`, `IMAGE_REPO_PREFIX=...-dev-image` trong `.env`.

1. Tạo `backend/.env` như mẫu ở Phần .env, **thêm các dòng** sau và để trống `PUBLIC_API_URL` (webhook không gọi được vào localhost):
   ```ini
   ALLOW_LOCALHOST=true
   FRONTEND_ORIGINS=http://localhost:8080
   PUBLIC_API_URL=
   ```
2. Cài thư viện và chạy backend:
   ```bash
   cd backend
   npm install
   node scripts/setup-github.js     # lần đầu: tạo repo (sẽ báo "bỏ qua webhook", bình thường)
   npm start                        # API tại http://localhost:3000/api/health
   ```
3. Terminal khác, chạy giao diện từ **thư mục gốc** của dự án:
   ```bash
   cd ..
   ```
   Sửa `config.js` thành `API_BASE: 'http://localhost:3000'`, rồi:
   ```bash
   python3 -m http.server 8080      # Windows: py -m http.server 8080
   ```
   Mở `http://localhost:8080`.
4. Chạy bộ test tự động (dùng GitHub giả, không cần mạng): `cd backend && npm test`.
5. Trước khi commit, **nhớ sửa `config.js` về địa chỉ Vercel thật** (không để `http://localhost:3000`).

---

## Khi đổi tên repo hoặc dùng tên miền riêng
- Đổi tên repo dữ liệu: đặt `ACCOUNT_GITHUB_REPO`, `DATA_GITHUB_REPO`, `IMAGE_REPO_PREFIX` trên Vercel **trước khi** có dữ liệu, rồi chạy lại `setup-github.js`.
- Tên miền riêng cho Pages (ví dụ `https://luyenthi.example.com`): thêm origin đó vào `FRONTEND_ORIGINS` (cách nhau dấu phẩy) và Redeploy.
- Tên miền riêng cho backend: cập nhật `PUBLIC_API_URL`, `API_BASE` trong `config.js`, rồi chạy lại `setup-github.js` để webhook trỏ về địa chỉ mới.

## Lỗi thường gặp

| Triệu chứng | Nguyên nhân / cách sửa |
|---|---|
| Vào `https://TEN_GITHUB.github.io/tu-luyen-thi-cntt-utc-mnha/` chỉ thấy nội dung README (trang Jekyll) | Pages đang lấy sai nguồn. Cách chuẩn: *Settings → Pages → Source = **GitHub Actions*** rồi vào tab *Actions* chạy lại workflow "Deploy frontend to GitHub Pages" (cần có thư mục `.github/workflows/pages.yml` trên repo: kéo-thả file lên web thường **bỏ sót thư mục/tệp bắt đầu bằng dấu chấm**, hãy dùng `git push`). Hoặc để *Deploy from a branch → main → /(root)*: `index.html` ở gốc sẽ tự chuyển sang `frontend/` |
| Sửa `config.js` ở gốc mà web không đổi | Giao diện đọc `frontend/config.js` (không phải `config.js` ở gốc). Sửa `API_BASE` trong `frontend/config.js`, commit + push |
| Trang báo "Chưa cấu hình backend" | `API_BASE` trong `config.js` vẫn là `TEN-PROJECT`. Sửa thành địa chỉ Vercel, commit và push (bước C) |
| Thanh đỏ "Không kết nối được máy chủ… CORS" | `FRONTEND_ORIGINS` sai. Phải là `https://TEN_GITHUB.github.io` (không có đường dẫn repo), sửa xong **Redeploy** |
| Vercel trả 404 ở mọi đường dẫn | Chưa đặt **Root Directory = `backend`** (*Settings → General*), đặt lại rồi Redeploy |
| `/api/health` có `problems` | Thiếu hoặc quá ngắn: `JWT_SECRET`, `ENCRYPTION_KEY` cần ≥ 32 ký tự; kiểm tra `GITHUB_TOKEN`, `GITHUB_OWNER`, `FRONTEND_ORIGINS` |
| Đã sửa biến mà không đổi gì | Chưa Redeploy |
| `?deep=1` báo `account: false` | Chưa chạy bước B, hoặc tên repo trên Vercel khác tên repo đã tạo |
| Đăng ký báo lỗi 502 "Kho dữ liệu GitHub tạm thời lỗi" | Token thiếu quyền `repo`, hết hạn, hoặc `GITHUB_OWNER` sai |
| `setup-github.js` báo "Thiếu GITHUB_TOKEN / GITHUB_OWNER" | Chưa có file `backend/.env`, hoặc đang chạy lệnh ở sai thư mục (phải ở trong `backend`) |
| `setup-github.js` bỏ qua webhook | `.env` thiếu `PUBLIC_API_URL` hoặc `GITHUB_WEBHOOK_SECRET` |
| Webhook báo 401 | `GITHUB_WEBHOOK_SECRET` trên Vercel khác secret đã gắn vào webhook: sửa cho trùng, Redeploy, chạy lại `setup-github.js` (nó cập nhật secret) |
| Webhook báo 503 | Chưa đặt `GITHUB_WEBHOOK_SECRET` trên Vercel hoặc chưa Redeploy |
| Pages 404 | Chưa chọn *Deploy from a branch → main → / (root)*, hoặc `index.html` không nằm ở gốc repo (kiểm tra trên GitHub: `index.html` phải thấy ngay ở trang chính của repo) |
| Push bị GitHub chặn ("Push cannot contain secrets") | Bạn đang đứng trong `backend` hoặc đã `git add` file `backend/.env`. Xoá thư mục `.git` đã tạo nhầm, vào thư mục gốc rồi `git init` lại (xem bước 0.1) |
| Không chọn được Pages cho repo | Repo đang Private trên gói miễn phí: chuyển Public (repo mã nguồn không chứa bí mật) |
| Tải ảnh báo quá lớn | Giới hạn 4MB/ảnh (payload Vercel); ảnh lớn được nén tự động ở trình duyệt |
| Bấm "Gửi mã xác minh" báo 502 "Máy chủ gửi mail bị từ chối đăng nhập" | `MAIL_PASS` sai: phải là **mật khẩu ứng dụng** 16 ký tự (không phải mật khẩu Gmail), và Gmail phải đã bật Xác minh 2 bước. Sửa xong Redeploy |
| Báo 502 "Không gửi được email" | Gmail tạm chặn/giới hạn, hoặc `MAIL_HOST`/`MAIL_PORT` sai. Xem *Vercel → Logs*, dòng bắt đầu bằng `[mail]` |
| Báo 503 "chưa cấu hình gửi email", hoặc `/api/health` có `warnings` nhắc MAIL | Chưa đặt `MAIL_USER`/`MAIL_PASS` trên Vercel (hoặc chưa Redeploy). Muốn tắt OTP: `REQUIRE_EMAIL_OTP=false` |
| Không thấy thư | Xem mục **Spam/Quảng cáo**; chờ 1 phút rồi bấm *Gửi lại mã* |
| Đăng ký cũ báo 403 `OTP_REQUIRED` | Đang gọi API đăng ký cũ. Dùng trang web bản mới (có ô Email), hoặc đặt `REQUIRE_EMAIL_OTP=false` |
| Ảnh hoặc API key AI cũ không đọc được | `ENCRYPTION_KEY` đã bị đổi so với lúc lưu. Đặt lại đúng giá trị cũ |
| Lần đầu mở chậm ~10 giây | Vercel khởi động hàm (cold start); trang sẽ hiện "máy chủ đang khởi động" rồi tự tải |
| Cron prune báo 401/503 | `CRON_SECRET` chưa đặt hoặc chưa Redeploy |
| Chạy thử trên máy bị CORS | Quên `ALLOW_LOCALHOST=true`, hoặc `FRONTEND_ORIGINS` không khớp cổng bạn đang mở (ví dụ `http://localhost:8080`) |
