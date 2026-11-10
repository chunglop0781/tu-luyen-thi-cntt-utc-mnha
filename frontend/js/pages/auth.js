import { authCall, authPost } from '../api.js';
import { h, action, toast } from '../ui.js';

/**
 * Màn hình đăng nhập / đăng ký (xác minh email bằng OTP) / quên mật khẩu.
 * mode: login → register → otp (nhập mã gửi về email) ; login → forgot → reset (mã + mật khẩu mới)
 */
export function loginPage(ctx) {
  let mode = 'login';
  let pending = null;            // dữ liệu đăng ký/đặt lại đang chờ OTP (chỉ giữ trong RAM)
  let timer = null;
  const box = h('div', { class: 'card auth' });
  const link = (text, fn) => h('a', { href: '#', onclick: (e) => { e.preventDefault(); fn(); } }, text);
  const go = (m) => { clearInterval(timer); mode = m; draw(); };

  /** Ô nhập mã 6 số + nút gửi lại có đếm ngược. */
  function otpField(resendFn, wait) {
    const code = h('input', { placeholder: 'Mã OTP 6 số', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: 6, pattern: '[0-9]{6}', required: true, class: 'otp' });
    const again = h('button', { class: 'btn', type: 'button' }, 'Gửi lại mã');
    const label = h('span', { class: 'muted' });
    let left = wait;
    const tick = () => { again.disabled = left > 0; label.textContent = left > 0 ? `Gửi lại sau ${left}s` : ''; };
    tick(); clearInterval(timer);
    timer = setInterval(() => { left = Math.max(0, left - 1); tick(); }, 1000);
    again.addEventListener('click', action(again, async () => { const r = await resendFn(); left = (r && r.resendIn) || 60; tick(); toast('Đã gửi lại mã, kiểm tra hộp thư (cả mục Spam)', 'ok'); }));
    return { code, row: h('div', { class: 'row' }, again, label) };
  }

  const draw = () => {
    if (mode === 'login' || mode === 'register') return drawMain();
    if (mode === 'otp') return drawRegisterOtp();
    if (mode === 'forgot') return drawForgot();
    return drawReset();
  };

  function drawMain() {
    const reg = mode === 'register';
    const u = h('input', { placeholder: 'Tên đăng nhập (a-z, 0-9, _ . -)', autocomplete: 'username', required: true, maxlength: 32 });
    const em = h('input', { type: 'email', placeholder: 'Email nhận mã xác minh', autocomplete: 'email', required: true, maxlength: 254 });
    const p = h('input', { type: 'password', placeholder: 'Mật khẩu (≥ 8 ký tự)', autocomplete: reg ? 'new-password' : 'current-password', required: true });
    const n = h('input', { placeholder: 'Tên hiển thị (tuỳ chọn)', maxlength: 60 });
    const inv = h('input', { placeholder: 'Mã mời (nếu có)' });
    const btn = h('button', { class: 'btn primary', type: 'submit' }, reg ? 'Gửi mã xác minh' : 'Đăng nhập');
    const form = h('form', { class: 'stack' }, u, reg ? em : null, p, reg ? n : null, reg ? inv : null, btn);
    form.addEventListener('submit', action(btn, async () => {
      if (!reg) { await authCall('login', { username: u.value, password: p.value }); toast('Đăng nhập thành công', 'ok'); return ctx.go('/'); }
      const body = { username: u.value, email: em.value, password: p.value, displayName: n.value, invite: inv.value || undefined };
      const r = await authPost('register/start', body);
      pending = { body, email: r.email, resendIn: r.resendIn || 60 };
      toast('Đã gửi mã OTP về email', 'ok'); go('otp');
    }));
    box.replaceChildren(
      h('h2', null, reg ? 'Tạo tài khoản' : 'Đăng nhập'),
      h('p', { class: 'muted' }, 'Mỗi tài khoản có kho bài tự luận & trắc nghiệm riêng, chỉ mình bạn xem được.'),
      form,
      reg ? null : h('p', { class: 'muted' }, link('Quên mật khẩu?', () => go('forgot'))),
      h('p', { class: 'muted' }, reg ? 'Đã có tài khoản? ' : 'Chưa có tài khoản? ', link(reg ? 'Đăng nhập' : 'Đăng ký', () => go(reg ? 'login' : 'register'))),
    );
  }

  function drawRegisterOtp() {
    const f = otpField(() => authPost('register/start', pending.body), pending.resendIn);
    const btn = h('button', { class: 'btn primary', type: 'submit' }, 'Xác minh & tạo tài khoản');
    const form = h('form', { class: 'stack' }, f.code, btn, f.row);
    form.addEventListener('submit', action(btn, async () => {
      await authCall('register/verify', { email: pending.body.email, code: f.code.value });
      clearInterval(timer); pending = null; toast('Đã tạo tài khoản', 'ok'); ctx.go('/');
    }));
    box.replaceChildren(
      h('h2', null, 'Nhập mã xác minh'),
      h('p', { class: 'muted' }, `Mã 6 số đã gửi tới ${pending.email}. Mã có hiệu lực 10 phút (nếu chưa thấy, xem mục Spam).`),
      form,
      h('p', { class: 'muted' }, link('← Sửa thông tin đăng ký', () => go('register'))),
    );
    f.code.focus();
  }

  function drawForgot() {
    const em = h('input', { type: 'email', placeholder: 'Email đã đăng ký', autocomplete: 'email', required: true });
    const btn = h('button', { class: 'btn primary', type: 'submit' }, 'Gửi mã đặt lại');
    const form = h('form', { class: 'stack' }, em, btn);
    form.addEventListener('submit', action(btn, async () => {
      const r = await authPost('reset/start', { email: em.value });
      pending = { email: em.value, shown: r.email, resendIn: r.resendIn || 60 };
      toast('Nếu email đã đăng ký, mã OTP đã được gửi', 'ok'); go('reset');
    }));
    box.replaceChildren(
      h('h2', null, 'Quên mật khẩu'),
      h('p', { class: 'muted' }, 'Nhập email đã dùng khi đăng ký, mã OTP sẽ được gửi về đó. (Tài khoản tạo trước khi có xác minh email chưa có email nên không dùng được cách này.)'),
      form,
      h('p', { class: 'muted' }, link('← Quay lại đăng nhập', () => go('login'))),
    );
  }

  function drawReset() {
    const f = otpField(() => authPost('reset/start', { email: pending.email }), pending.resendIn);
    const p = h('input', { type: 'password', placeholder: 'Mật khẩu mới (≥ 8 ký tự)', autocomplete: 'new-password', required: true });
    const btn = h('button', { class: 'btn primary', type: 'submit' }, 'Đặt mật khẩu mới');
    const form = h('form', { class: 'stack' }, f.code, p, btn, f.row);
    form.addEventListener('submit', action(btn, async () => {
      await authPost('reset/confirm', { email: pending.email, code: f.code.value, newPassword: p.value });
      pending = null; toast('Đã đổi mật khẩu, hãy đăng nhập lại', 'ok'); go('login');
    }));
    box.replaceChildren(
      h('h2', null, 'Đặt lại mật khẩu'),
      h('p', { class: 'muted' }, `Mã 6 số đã gửi tới ${pending.shown} (nếu email này có tài khoản). Mã có hiệu lực 10 phút.`),
      form,
      h('p', { class: 'muted' }, link('← Quay lại đăng nhập', () => go('login'))),
    );
    f.code.focus();
  }

  draw();
  return box;
}
