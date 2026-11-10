import { authCall, authPost } from '../api.js';
import { h, toast, logo, withToggle } from '../ui.js';

/**
 * Đăng nhập / đăng ký (xác minh email bằng OTP) / quên mật khẩu.
 * mode: login → register → otp (nhập mã gửi về email) ; login → forgot → reset (mã + mật khẩu mới)
 */
export function loginPage(ctx) {
  let mode = 'login';
  let pending = null;            // dữ liệu đăng ký/đặt lại đang chờ OTP (chỉ giữ trong RAM)
  let timer = null;
  const box = h('div', { class: 'card auth' });
  const link = (text, fn) => h('a', { href: '#', onclick: (e) => { e.preventDefault(); fn(); } }, text);
  const go = (m, note) => { clearInterval(timer); mode = m; draw(note); };
  const label = (text, input, hint) => h('label', { class: 'field' }, h('span', { class: 'lbl' }, text, hint ? h('small', null, ' ', hint) : null), input);
  const alertBox = (kind, text) => h('div', { class: `alert ${kind}`, role: kind === 'err' ? 'alert' : 'status' }, text);

  /** Nút gửi form: khoá nút khi đang chạy, lỗi hiện ngay trong thẻ (không chỉ toast). */
  function submit(form, btn, fn) {
    const msg = h('div'); form.prepend(msg);
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault(); if (btn.disabled) return;
      const old = btn.textContent; btn.disabled = true; btn.textContent = '⏳ Đang xử lý…'; msg.replaceChildren();
      try { await fn(); } catch (e) { msg.replaceChildren(alertBox('err', e.message || 'Có lỗi xảy ra')); }
      finally { btn.disabled = false; btn.textContent = old; }
    });
  }

  /** Ô nhập mã 6 số + nút gửi lại có đếm ngược. */
  function otpField(resendFn, wait) {
    const code = h('input', { placeholder: '••••••', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: 6, pattern: '[0-9]{6}', required: true, class: 'otp' });
    const again = h('button', { class: 'btn small', type: 'button' }, 'Gửi lại mã');
    const info = h('span', { class: 'muted' });
    let left = wait;
    const tick = () => { again.disabled = left > 0; info.textContent = left > 0 ? `Có thể gửi lại sau ${left}s` : ''; };
    tick(); clearInterval(timer);
    timer = setInterval(() => { left = Math.max(0, left - 1); tick(); }, 1000);
    again.addEventListener('click', async () => {
      again.disabled = true;
      try { const r = await resendFn(); left = (r && r.resendIn) || 60; toast('Đã gửi lại mã, kiểm tra hộp thư (cả mục Spam)', 'ok'); }
      catch (e) { toast(e.message, 'err', 6000); left = 0; }
      tick();
    });
    return { code, row: h('div', { class: 'row between' }, again, info) };
  }

  const links = (...kids) => h('div', { class: 'links' }, ...kids);
  const head = (title, sub) => [h('h2', null, title), h('p', { class: 'muted' }, sub)];

  const draw = (note) => {
    if (mode === 'login' || mode === 'register') return drawMain(note);
    if (mode === 'otp') return drawRegisterOtp();
    if (mode === 'forgot') return drawForgot();
    return drawReset();
  };

  function drawMain(note) {
    const reg = mode === 'register';
    const u = h('input', { placeholder: 'vd: nguyenvana', autocomplete: 'username', required: true, maxlength: 32 });
    const em = h('input', { type: 'email', placeholder: 'ten@gmail.com', autocomplete: 'email', required: true, maxlength: 254 });
    const p = h('input', { type: 'password', placeholder: 'Tối thiểu 8 ký tự', autocomplete: reg ? 'new-password' : 'current-password', required: true });
    const n = h('input', { placeholder: 'vd: Nguyễn Văn A', maxlength: 60 });
    const inv = h('input', { placeholder: 'Chỉ nhập nếu được cấp' });
    const btn = h('button', { class: 'btn primary block', type: 'submit' }, reg ? 'Gửi mã xác minh' : 'Đăng nhập');
    const form = h('form', { class: 'stack' },
      label('Tên đăng nhập', u, reg ? '(a-z, 0-9, _ . -)' : null), reg ? label('Email', em, '(nhận mã xác minh)') : null,
      label('Mật khẩu', withToggle(p)), reg ? label('Tên hiển thị', n, '(tuỳ chọn)') : null, reg ? label('Mã mời', inv, '(nếu có)') : null, btn);
    submit(form, btn, async () => {
      if (!reg) { await authCall('login', { username: u.value, password: p.value }); toast('Đăng nhập thành công', 'ok'); return ctx.go('/'); }
      const body = { username: u.value, email: em.value, password: p.value, displayName: n.value, invite: inv.value || undefined };
      const r = await authPost('register/start', body);
      pending = { body, email: r.email, resendIn: r.resendIn || 60 };
      go('otp');
    });
    box.replaceChildren(
      ...head(reg ? 'Tạo tài khoản' : 'Chào mừng trở lại', reg ? 'Đăng ký bằng email, xác minh bằng mã OTP 6 số.' : 'Đăng nhập để vào kho bài của bạn.'),
      note ? alertBox('ok', note) : null, form,
      links(reg ? null : link('Quên mật khẩu?', () => go('forgot')),
        h('span', { class: 'muted' }, reg ? 'Đã có tài khoản? ' : 'Chưa có tài khoản? ', link(reg ? 'Đăng nhập' : 'Đăng ký ngay', () => go(reg ? 'login' : 'register')))),
    );
  }

  function drawRegisterOtp() {
    const f = otpField(() => authPost('register/start', pending.body), pending.resendIn);
    const btn = h('button', { class: 'btn primary block', type: 'submit' }, 'Xác minh & tạo tài khoản');
    const form = h('form', { class: 'stack' }, label('Mã xác minh', f.code), btn, f.row);
    submit(form, btn, async () => {
      await authCall('register/verify', { email: pending.body.email, code: f.code.value });
      clearInterval(timer); pending = null; toast('Đã tạo tài khoản', 'ok'); ctx.go('/');
    });
    box.replaceChildren(
      ...head('Nhập mã xác minh', `Mã 6 số đã gửi tới ${pending.email}. Có hiệu lực 10 phút (chưa thấy thì xem mục Spam).`),
      form, links(link('← Sửa thông tin đăng ký', () => go('register'))),
    );
    f.code.focus();
  }

  function drawForgot() {
    const em = h('input', { type: 'email', placeholder: 'ten@gmail.com', autocomplete: 'email', required: true });
    const btn = h('button', { class: 'btn primary block', type: 'submit' }, 'Gửi mã đặt lại');
    const form = h('form', { class: 'stack' }, label('Email đã đăng ký', em), btn);
    submit(form, btn, async () => {
      const r = await authPost('reset/start', { email: em.value });
      pending = { email: em.value, shown: r.email, resendIn: r.resendIn || 60 };
      go('reset');
    });
    box.replaceChildren(
      ...head('Quên mật khẩu', 'Nhập email đã dùng khi đăng ký, mã OTP sẽ được gửi về đó.'),
      alertBox('info', 'Tài khoản tạo trước khi có xác minh email chưa có email nên chưa dùng được cách này.'),
      form, links(link('← Quay lại đăng nhập', () => go('login'))),
    );
  }

  function drawReset() {
    const f = otpField(() => authPost('reset/start', { email: pending.email }), pending.resendIn);
    const p = h('input', { type: 'password', placeholder: 'Tối thiểu 8 ký tự', autocomplete: 'new-password', required: true });
    const btn = h('button', { class: 'btn primary block', type: 'submit' }, 'Đặt mật khẩu mới');
    const form = h('form', { class: 'stack' }, label('Mã xác minh', f.code), label('Mật khẩu mới', withToggle(p)), btn, f.row);
    submit(form, btn, async () => {
      await authPost('reset/confirm', { email: pending.email, code: f.code.value, newPassword: p.value });
      pending = null; go('login', 'Đã đổi mật khẩu. Hãy đăng nhập lại bằng mật khẩu mới.');
    });
    box.replaceChildren(
      ...head('Đặt lại mật khẩu', `Mã 6 số đã gửi tới ${pending.shown} (nếu email này có tài khoản). Có hiệu lực 10 phút.`),
      form, links(link('← Quay lại đăng nhập', () => go('login'))),
    );
    f.code.focus();
  }

  draw();
  return h('div', { class: 'auth-wrap' },
    h('div', { class: 'auth-brand' }, logo(), h('div', null, h('b', null, 'Tự luyện thi của mnha'), h('span', null, 'Tự tạo bài, tự ôn, tự chấm'))),
    box);
}
