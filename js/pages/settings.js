import { get, put, post, patch, session, API, logout } from '../api.js';
import { h, action, toast, fmtDate, confirmBox, icon } from '../ui.js';

export async function settingsPage(ctx) {
  const [{ vault }, { sessions }] = await Promise.all([get('/api/me/vault'), get('/api/me/sessions')]);
  const s = session.get();

  const name = h('input', { value: s.user.displayName, maxlength: 60 });
  const nameBtn = h('button', { class: 'btn primary' }, 'Lưu');
  nameBtn.addEventListener('click', action(nameBtn, async () => { const r = await patch('/api/me', { displayName: name.value }); session.set({ ...session.get(), user: r.user, expiresIn: Math.max(60, (session.get().exp - Date.now()) / 1000) }); toast('Đã lưu', 'ok'); }));

  const oldPw = h('input', { type: 'password', autocomplete: 'current-password', placeholder: 'Mật khẩu hiện tại' });
  const newPw = h('input', { type: 'password', autocomplete: 'new-password', placeholder: 'Mật khẩu mới (≥ 8 ký tự)' });
  const pwBtn = h('button', { class: 'btn primary' }, 'Đổi mật khẩu');
  pwBtn.addEventListener('click', action(pwBtn, async () => { await post('/api/auth/change-password', { oldPassword: oldPw.value, newPassword: newPw.value }); oldPw.value = newPw.value = ''; toast('Đã đổi mật khẩu; các thiết bị khác bị đăng xuất', 'ok'); }));

  const key = h('input', { type: 'password', placeholder: vault.geminiKeySet ? '•••••• (đã lưu — nhập để thay)' : 'Gemini API key (AIza…)', autocomplete: 'off' });
  const model = h('input', { value: vault.geminiModel, placeholder: 'Model (để trống = mặc định của máy chủ)' });
  const notes = h('textarea', { rows: 3, placeholder: 'Ghi chú riêng tư' }); notes.value = vault.notes;
  const vBtn = h('button', { class: 'btn primary' }, 'Lưu');
  vBtn.addEventListener('click', action(vBtn, async () => { const b = { geminiModel: model.value, notes: notes.value }; if (key.value) b.geminiKey = key.value; await put('/api/me/vault', b); key.value = ''; toast('Đã lưu (khoá được mã hoá)', 'ok'); }));
  const rmKey = h('button', { class: 'btn danger' }, 'Xoá key');
  rmKey.addEventListener('click', action(rmKey, async () => { await put('/api/me/vault', { geminiKey: '' }); toast('Đã xoá key', 'ok'); }));

  const exp = h('button', { class: 'btn' }, icon('download'), 'Tải toàn bộ dữ liệu (JSON)');
  exp.addEventListener('click', action(exp, async () => {
    const d = await get('/api/export', { timeout: 60000 });
    const a = h('a', { href: URL.createObjectURL(new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' })), download: `utc-backup-${new Date().toISOString().slice(0, 10)}.json` }); a.click();
  }));
  const reidx = h('button', { class: 'btn' }, 'Dựng lại chỉ mục');
  reidx.addEventListener('click', action(reidx, async () => { await post('/api/reindex', {}, { timeout: 60000 }); toast('Đã dựng lại chỉ mục', 'ok'); }));
  const all = h('button', { class: 'btn danger' }, icon('log-out'), 'Đăng xuất mọi thiết bị');
  all.addEventListener('click', action(all, async () => { if (!(await confirmBox('Đăng xuất khỏi mọi thiết bị?'))) return; await post('/api/auth/logout-all', {}); await logout(); ctx.go('/login'); }));
  const diag = h('pre', { class: 'diag' }, 'Chưa kiểm tra');
  const diagBtn = h('button', { class: 'btn' }, 'Kiểm tra kết nối');
  diagBtn.addEventListener('click', action(diagBtn, async () => {
    const t0 = performance.now(); const j = await get('/api/health?deep=1', { auth: false });
    diag.textContent = JSON.stringify({ api: API, pages_origin: location.origin, ms: Math.round(performance.now() - t0), ...j }, null, 2);
  }));

  return h('div', { class: 'stack', style: 'max-width:48rem;margin:0 auto' }, h('div', null, h('h1', { class: 'title' }, 'Cài đặt'), h('p', { class: 'sub' }, 'Hồ sơ, mật khẩu, khoá Gemini và dữ liệu của bạn.')),
    h('div', { class: 'card stack' }, h('h3', null, 'Hồ sơ'), h('p', { class: 'muted' }, `Tên đăng nhập: ${s.user.username}`), h('div', { class: 'row' }, name, nameBtn)),
    h('div', { class: 'card stack' }, h('h3', null, 'Đổi mật khẩu'), oldPw, newPw, pwBtn),
    h('div', { class: 'card stack' }, h('h3', null, 'Kho riêng tư (chấm AI)'), h('p', { class: 'muted' }, 'Gemini API key của riêng bạn, lưu mã hoá trong repo account (private).'), key, model, notes, h('div', { class: 'row' }, vBtn, vault.geminiKeySet ? rmKey : null)),
    h('div', { class: 'card stack' }, h('h3', null, `Phiên đăng nhập (${sessions.length})`), ...sessions.map((x) => h('p', { class: 'muted' }, `${x.current ? 'Thiết bị này · ' : ''}${fmtDate(x.createdAt)} · ${x.ua.slice(0, 60)}`)), all),
    h('div', { class: 'card stack' }, h('h3', null, 'Dữ liệu'), h('div', { class: 'row' }, exp, reidx)),
    h('div', { class: 'card stack' }, h('h3', null, 'Kết nối'), h('p', { class: 'muted' }, `Backend: ${API}`), diagBtn, diag));
}
