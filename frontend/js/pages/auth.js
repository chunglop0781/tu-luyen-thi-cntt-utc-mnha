import { authCall } from '../api.js';
import { h, action, toast, icon } from '../ui.js';

const field = (label, el) => h('label', { class: 'field' }, h('span', null, label), el);

export function loginPage(ctx) {
  let mode = 'login';
  const box = h('div', { class: 'auth' });
  const draw = () => {
    const u = h('input', { placeholder: 'a-z, 0-9, _ . -', autocomplete: 'username', required: true, maxlength: 32 });
    const p = h('input', { type: 'password', placeholder: 'Ít nhất 8 ký tự', autocomplete: mode === 'login' ? 'current-password' : 'new-password', required: true });
    const n = h('input', { placeholder: 'Tên hiển thị (tuỳ chọn)', maxlength: 60 });
    const inv = h('input', { placeholder: 'Mã mời (nếu có)' });
    const btn = h('button', { class: 'btn primary full', type: 'submit' }, mode === 'login' ? 'Đăng nhập' : 'Tạo tài khoản');
    const form = h('form', { class: 'stack' }, field('Tên đăng nhập', u), field('Mật khẩu', p),
      mode === 'register' ? field('Tên hiển thị', n) : null, mode === 'register' ? field('Mã mời', inv) : null, btn);
    form.addEventListener('submit', action(btn, async () => {
      await authCall(mode, mode === 'login' ? { username: u.value, password: p.value } : { username: u.value, password: p.value, displayName: n.value, invite: inv.value || undefined });
      toast(mode === 'login' ? 'Đăng nhập thành công' : 'Đã tạo tài khoản', 'ok'); ctx.go('/');
    }));
    box.replaceChildren(
      h('div', { class: 'center' }, h('div', { class: 'auth-brand' },
        h('div', { class: 'auth-logo' }, icon('graduation-cap')),
        h('div', { style: 'text-align:left' }, h('h1', { style: 'font-size:1.25rem;font-weight:700' }, 'Luyện thi của MNHA'), h('p', { class: 'muted', style: 'font-size:.75rem' }, 'Hệ thống tự luyện thi CNTT UTC')))),
      h('div', { class: 'auth-card' },
        h('h2', null, mode === 'login' ? 'Đăng nhập' : 'Tạo tài khoản'),
        h('p', { class: 'muted', style: 'font-size:.875rem;margin-top:.5rem' }, mode === 'login' ? 'Đăng nhập để tiếp tục sử dụng hệ thống.' : 'Mỗi tài khoản có kho bài riêng, chỉ mình bạn xem được.'),
        form,
        h('p', { class: 'muted', style: 'font-size:.875rem;margin-top:1.5rem;text-align:center' }, mode === 'login' ? 'Chưa có tài khoản? ' : 'Đã có tài khoản? ',
          h('a', { href: '#', onclick: (e) => { e.preventDefault(); mode = mode === 'login' ? 'register' : 'login'; draw(); } }, mode === 'login' ? 'Đăng ký' : 'Đăng nhập'))));
    u.focus();
  };
  draw();
  return h('div', { class: 'authpage' }, box);
}
