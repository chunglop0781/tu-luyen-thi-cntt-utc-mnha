import { get, put, post, patch, session, API, logout } from '../api.js';
import { h, action, toast, fmtDate, confirmBox, withToggle } from '../ui.js';

export async function settingsPage(ctx) {
  const [{ vault }, { sessions }, { providers }] = await Promise.all([get('/api/me/vault'), get('/api/me/sessions'), get('/api/ai/providers')]);
  const s = session.get();

  const name = h('input', { value: s.user.displayName, maxlength: 60 });
  const nameBtn = h('button', { class: 'btn primary' }, 'Lưu');
  nameBtn.addEventListener('click', action(nameBtn, async () => { const r = await patch('/api/me', { displayName: name.value }); session.set({ ...session.get(), user: r.user, expiresIn: Math.max(60, (session.get().exp - Date.now()) / 1000) }); toast('Đã lưu', 'ok'); }));

  const oldPw = h('input', { type: 'password', autocomplete: 'current-password', placeholder: 'Mật khẩu hiện tại' });
  const newPw = h('input', { type: 'password', autocomplete: 'new-password', placeholder: 'Mật khẩu mới (≥ 8 ký tự)' });
  const pwBtn = h('button', { class: 'btn primary' }, 'Đổi mật khẩu');
  pwBtn.addEventListener('click', action(pwBtn, async () => { await post('/api/auth/change-password', { oldPassword: oldPw.value, newPassword: newPw.value }); oldPw.value = newPw.value = ''; toast('Đã đổi mật khẩu; các thiết bị khác bị đăng xuất', 'ok'); }));

  const aiBox = aiCard(vault, providers);

  const exp = h('button', { class: 'btn' }, '⬇️ Tải toàn bộ dữ liệu (JSON)');
  exp.addEventListener('click', action(exp, async () => {
    const d = await get('/api/export', { timeout: 60000 });
    const a = h('a', { href: URL.createObjectURL(new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' })), download: `mnha-backup-${new Date().toISOString().slice(0, 10)}.json` }); a.click();
  }));
  const reidx = h('button', { class: 'btn' }, '🔧 Dựng lại chỉ mục');
  reidx.addEventListener('click', action(reidx, async () => { await post('/api/reindex', {}, { timeout: 60000 }); toast('Đã dựng lại chỉ mục', 'ok'); }));
  const all = h('button', { class: 'btn ghost danger' }, 'Đăng xuất mọi thiết bị');
  all.addEventListener('click', action(all, async () => { if (!(await confirmBox('Đăng xuất khỏi mọi thiết bị?'))) return; await post('/api/auth/logout-all', {}); await logout(); ctx.go('/login'); }));
  const diag = h('pre', { class: 'diag' }, 'Chưa kiểm tra');
  const diagBtn = h('button', { class: 'btn' }, '🩺 Kiểm tra kết nối');
  diagBtn.addEventListener('click', action(diagBtn, async () => {
    const t0 = performance.now(); const j = await get('/api/health?deep=1', { auth: false });
    diag.textContent = JSON.stringify({ api: API, pages_origin: location.origin, ms: Math.round(performance.now() - t0), ...j }, null, 2);
  }));

  return h('div', { class: 'stack' }, h('h2', null, 'Cài đặt'),
    h('div', { class: 'card stack' }, h('h3', null, 'Hồ sơ'), h('p', { class: 'muted' }, `Tên đăng nhập: ${s.user.username}`), h('div', { class: 'row' }, name, nameBtn)),
    h('div', { class: 'card stack' }, h('h3', null, 'Đổi mật khẩu'), withToggle(oldPw), withToggle(newPw), pwBtn),
    aiBox,
    h('div', { class: 'card stack' }, h('h3', null, `Phiên đăng nhập (${sessions.length})`), ...sessions.map((x) => h('p', { class: 'muted' }, `${x.current ? '● Thiết bị này · ' : ''}${fmtDate(x.createdAt)} · ${x.ua.slice(0, 60)}`)), all),
    h('div', { class: 'card stack' }, h('h3', null, 'Dữ liệu'), h('div', { class: 'row' }, exp, reidx)),
    h('div', { class: 'card stack' }, h('h3', null, 'Kết nối'), h('p', { class: 'muted' }, `Backend: ${API}`), diagBtn, diag));
}

/** Kết nối AI: chọn nhà cung cấp + model, dán key của riêng bạn (lưu mã hoá AES-GCM trong repo account private), thử kết nối. */
function aiCard(vault, providers) {
  let cur = providers.some((p) => p.id === vault.provider) ? vault.provider : providers[0].id;
  let items = vault.items;
  const box = h('div', { class: 'card stack' });
  const result = h('div');
  const notes = h('textarea', { rows: 3, placeholder: 'Ghi chú riêng tư (chỉ bạn thấy)' }); notes.value = vault.notes || '';
  const msg = (kind, text) => h('div', { class: `alert ${kind}`, role: kind === 'err' ? 'alert' : 'status' }, text);
  let modelEl, key;

  async function save(extra = {}) {
    const m = (modelEl.value || '').trim();
    const body = { provider: cur, providers: { [cur]: { model: m } }, notes: notes.value, ...extra };
    if (key.value.trim()) body.providers[cur].key = key.value.trim();
    const r = await put('/api/me/vault', body);
    items = r.vault.items; key.value = '';
    return r.vault;
  }

  function draw() {
    const p = providers.find((x) => x.id === cur);
    const it = items[p.id] || { keySet: false, model: '' };
    const provSel = h('select', { 'aria-label': 'Nhà cung cấp AI' }, ...providers.map((x) => h('option', { value: x.id, selected: x.id === cur }, x.label + (items[x.id] && items[x.id].keySet ? '  ✓ đã có key' : ''))));
    provSel.addEventListener('change', () => { cur = provSel.value; result.replaceChildren(); draw(); });

    let extra = null;
    if (p.allowCustomModel) {
      modelEl = h('input', { list: 'ai-models', value: it.model, placeholder: `Mặc định: ${p.defaultModel}`, maxlength: 100, autocomplete: 'off', 'aria-label': 'Model' });
      extra = h('datalist', { id: 'ai-models' }, ...p.models.map((m) => h('option', { value: m })));
    } else {
      modelEl = h('select', { 'aria-label': 'Model' }, h('option', { value: '', selected: !it.model }, `Mặc định (${p.defaultModel})`), ...p.models.map((m) => h('option', { value: m, selected: m === it.model }, m)));
    }
    key = h('input', { type: 'password', autocomplete: 'off', spellcheck: 'false', placeholder: it.keySet ? '•••••• (đã lưu — nhập để thay)' : `API key ${p.label} (${p.keyPlaceholder})` });

    const saveBtn = h('button', { class: 'btn primary' }, 'Lưu');
    saveBtn.addEventListener('click', action(saveBtn, async () => { await save(); toast('Đã lưu (key được mã hoá)', 'ok'); draw(); }));
    const testBtn = h('button', { class: 'btn' }, '🔌 Kiểm tra kết nối AI');
    testBtn.addEventListener('click', action(testBtn, async () => {
      result.replaceChildren();
      await save();
      let out;
      try {
        const r = (await post('/api/ai/test', { provider: cur, model: (modelEl.value || '').trim() || undefined }, { timeout: 60000 })).result;
        out = msg('ok', `✅ Kết nối được ${r.label} · model ${r.model} · ${r.ms}ms · AI trả lời: "${r.response}"${r.fallbackFrom ? ` (model ${r.fallbackFrom} đang quá tải nên tự chuyển sang ${r.model})` : ''}`);
      } catch (e) { out = msg('err', `❌ ${e.message}`); }
      draw(); result.replaceChildren(out);
    }));
    const rmKey = h('button', { class: 'btn ghost danger' }, 'Xoá key');
    rmKey.addEventListener('click', action(rmKey, async () => {
      if (!(await confirmBox(`Xoá key ${p.label} đã lưu?`))) return;
      const r = await put('/api/me/vault', { providers: { [cur]: { key: '' } } }); items = r.vault.items; toast('Đã xoá key', 'ok'); result.replaceChildren(); draw();
    }));

    box.replaceChildren(
      h('h3', null, 'Kết nối AI (chấm tự luận)'),
      h('p', { class: 'muted' }, 'Chọn nhà cung cấp, model và dán API key của riêng bạn. Key lưu mã hoá trong repo account (private); mỗi nhà cung cấp giữ key riêng, nhà đang chọn là nhà mặc định khi chấm.'),
      h('div', { class: 'ai-grid' },
        h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Nhà cung cấp'), provSel),
        h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Model', h('small', null, p.allowCustomModel ? ' (chọn gợi ý hoặc tự gõ)' : '')), modelEl, extra)),
      h('label', { class: 'field' }, h('span', { class: 'lbl' }, `API key ${p.label}`), withToggle(key)),
      notes,
      h('div', { class: 'row' }, saveBtn, testBtn, it.keySet ? rmKey : null),
      result);
  }
  draw();
  return box;
}
