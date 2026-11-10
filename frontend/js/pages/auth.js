import { authCall } from '../api.js';
import { h, action, toast } from '../ui.js';

export function loginPage(ctx) {
  let mode = 'login';
  const box = h('div', { class: 'card auth' });
  const draw = () => {
    const u = h('input', { placeholder: 'Tên đăng nhập (a-z, 0-9, _ . -)', autocomplete: 'username', required: true, maxlength: 32 });
    const p = h('input', { type: 'password', placeholder: 'Mật khẩu (≥ 8 ký tự)', autocomplete: mode === 'login' ? 'current-password' : 'new-password', required: true });
    const n = h('input', { placeholder: 'Tên hiển thị (tuỳ chọn)', maxlength: 60 });
    const inv = h('input', { placeholder: 'Mã mời (nếu có)' });
    const btn = h('button', { class: 'btn primary', type: 'submit' }, mode === 'login' ? 'Đăng nhập' : 'Tạo tài khoản');
    const form = h('form', { class: 'stack' }, u, p, mode === 'register' ? n : null, mode === 'register' ? inv : null, btn);
    form.addEventListener('submit', action(btn, async () => {
      await authCall(mode, mode === 'login' ? { username: u.value, password: p.value } : { username: u.value, password: p.value, displayName: n.value, invite: inv.value || undefined });
      toast(mode === 'login' ? 'Đăng nhập thành công' : 'Đã tạo tài khoản', 'ok'); ctx.go('/');
    }));
    box.replaceChildren(
      h('h2', null, mode === 'login' ? 'Đăng nhập' : 'Tạo tài khoản'),
      h('p', { class: 'muted' }, 'Mỗi tài khoản có kho bài tự luận & trắc nghiệm riêng, chỉ mình bạn xem được.'),
      form,
      h('p', { class: 'muted' }, mode === 'login' ? 'Chưa có tài khoản? ' : 'Đã có tài khoản? ',
        h('a', { href: '#', onclick: (e) => { e.preventDefault(); mode = mode === 'login' ? 'register' : 'login'; draw(); } }, mode === 'login' ? 'Đăng ký' : 'Đăng nhập')),
    );
  };
  draw();
  return box;
}
