import { get, put, post, patch, del, session, API, logout } from '../api.js';
import { modelSelect, enhancePickers } from '../aiName.js';
import { h, action, toast, fmtDate, confirmBox, withToggle } from '../ui.js';

export async function settingsPage(ctx) {
  const { sessions } = await get('/api/me/sessions');
  const s = session.get();

  const name = h('input', { value: s.user.displayName, maxlength: 60 });
  const nameBtn = h('button', { class: 'btn primary' }, 'Lưu');
  nameBtn.addEventListener('click', action(nameBtn, async () => { const r = await patch('/api/me', { displayName: name.value }); session.set({ ...session.get(), user: r.user, expiresIn: Math.max(60, (session.get().exp - Date.now()) / 1000) }); toast('Đã lưu', 'ok'); }));

  const oldPw = h('input', { type: 'password', autocomplete: 'current-password', placeholder: 'Mật khẩu hiện tại' });
  const newPw = h('input', { type: 'password', autocomplete: 'new-password', placeholder: 'Mật khẩu mới (≥ 8 ký tự)' });
  const pwBtn = h('button', { class: 'btn primary' }, 'Đổi mật khẩu');
  pwBtn.addEventListener('click', action(pwBtn, async () => { await post('/api/auth/change-password', { oldPassword: oldPw.value, newPassword: newPw.value }); oldPw.value = newPw.value = ''; toast('Đã đổi mật khẩu; các thiết bị khác bị đăng xuất', 'ok'); }));

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

  return h('div', { class: 'stack' }, h('h2', null, 'Cài đặt'), tabs('account'),
    h('div', { class: 'card stack' }, h('h3', null, 'Hồ sơ'), h('p', { class: 'muted' }, `Tên đăng nhập: ${s.user.username}`), h('div', { class: 'row' }, name, nameBtn)),
    h('div', { class: 'card stack' }, h('h3', null, 'Đổi mật khẩu'), withToggle(oldPw), withToggle(newPw), pwBtn),
    h('div', { class: 'card stack' }, h('h3', null, `Phiên đăng nhập (${sessions.length})`), ...sessions.map((x) => h('p', { class: 'muted' }, `${x.current ? '● Thiết bị này · ' : ''}${fmtDate(x.createdAt)} · ${x.ua.slice(0, 60)}`)), all),
    h('div', { class: 'card stack' }, h('h3', null, 'Dữ liệu'), h('div', { class: 'row' }, exp, reidx)),
    h('div', { class: 'card stack' }, h('h3', null, 'Kết nối'), h('p', { class: 'muted' }, `Backend: ${API}`), diagBtn, diag));
}

function tabs(cur) {
  return h('div', { class: 'tabs', role: 'tablist' },
    h('a', { href: '#/settings', class: cur === 'account' ? 'on' : '', role: 'tab' }, '👤 Tài khoản & dữ liệu'),
    h('a', { href: '#/settings/ai', class: cur === 'ai' ? 'on' : '', role: 'tab' }, '🤖 Nhà cung cấp AI'));
}

const msg = (kind, text) => h('div', { class: `alert ${kind}`, role: kind === 'err' ? 'alert' : 'status' }, text);
const field = (label, input, hint) => h('label', { class: 'field' }, h('span', { class: 'lbl' }, label, hint ? h('small', null, ' ', hint) : null), input);

/**
 * Trang riêng "Nhà cung cấp AI" (tự chủ động như bản cũ luyen-thi-cntt-utc-mnha): người dùng TỰ THÊM nhà cung cấp
 * (tên, địa chỉ API, đường dẫn chat, model…), rồi dán API key riêng cho từng nhà. Danh sách lưu theo tài khoản ở
 * AI-database/<uid>/index.json (không chứa key); key mã hoá AES-GCM ở kho riêng tư.
 */
export async function aiSettingsPage() {
  const [{ providers: initial, presets, max }, { vault: v0 }] = await Promise.all([get('/api/ai/providers'), get('/api/me/vault')]);
  let providers = initial, vault = v0;
  const root = h('div', { class: 'stack' });

  const reload = async () => { const [a, b] = await Promise.all([get('/api/ai/providers'), get('/api/me/vault')]); providers = a.providers; vault = b.vault; draw(); };

  function providerCard(p) {
    const it = vault.items[p.id] || { keySet: false, model: '' };
    const isDefault = vault.provider === p.id;
    const result = h('div');
    const key = h('input', { type: 'password', autocomplete: 'off', spellcheck: 'false', placeholder: it.keySet ? '•••••• (đã lưu — nhập để thay)' : `API key ${p.label}${p.keyPlaceholder ? ` (${p.keyPlaceholder})` : ''}` });
    const modelEl = modelSelect(p, it.model || '');   // ô chọn model có tìm kiếm; gõ tên lạ → "Dùng …" (nếu nhà cho phép)
    // ★ Tên AI: tự đặt / sửa để sau này tìm lại (hiện trong ô chọn AI có tìm kiếm ở trang làm bài & chấm bài)
    const nameEl = h('input', { value: it.name || '', placeholder: 'Đặt tên để dễ tìm, vd: Key Gemini của tôi', maxlength: 60, autocomplete: 'off', 'aria-label': 'Tên AI' });
    const nameBtn = h('button', { class: 'btn small', type: 'button' }, it.name ? '✏️ Sửa tên' : '💾 Đặt tên');
    nameBtn.addEventListener('click', action(nameBtn, async () => { await put('/api/me/vault', { providers: { [p.id]: { name: nameEl.value } } }); toast(nameEl.value.trim() ? 'Đã lưu tên AI' : 'Đã xoá tên AI', 'ok'); await reload(); }));
    nameEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); nameBtn.click(); } });
    const save = async (setDefault) => {
      const body = { providers: { [p.id]: { model: (modelEl.value || '').trim(), name: nameEl.value } } };
      if (key.value.trim()) body.providers[p.id].key = key.value.trim();
      if (setDefault) body.provider = p.id;
      await put('/api/me/vault', body); key.value = '';
    };
    const saveBtn = h('button', { class: 'btn primary' }, 'Lưu key & model');
    saveBtn.addEventListener('click', action(saveBtn, async () => { await save(false); toast('Đã lưu (key được mã hoá)', 'ok'); await reload(); }));
    const defBtn = h('button', { class: 'btn' }, isDefault ? '★ Đang là mặc định' : '☆ Đặt làm mặc định');
    defBtn.addEventListener('click', action(defBtn, async () => { if (isDefault) return; await save(true); toast(`${p.label} là nhà mặc định khi chấm/phân tích`, 'ok'); await reload(); }));
    const testBtn = h('button', { class: 'btn' }, '🔌 Kiểm tra kết nối');
    testBtn.addEventListener('click', action(testBtn, async () => {
      result.replaceChildren(); await save(false);
      let out;
      try {
        const r = (await post('/api/ai/test', { provider: p.id, model: (modelEl.value || '').trim() || undefined }, { timeout: 60000 })).result;
        out = msg('ok', `✅ Kết nối được ${r.name ? r.name + ' — ' : ''}${r.label} · model ${r.model} · ${r.ms}ms · AI trả lời: "${r.response}"${r.fallbackFrom ? ` (model ${r.fallbackFrom} quá tải nên tự chuyển sang ${r.model})` : ''}`);
      } catch (e) { out = msg('err', `❌ ${e.message}`); }
      result.replaceChildren(out);
    }));
    const rmKey = h('button', { class: 'btn ghost danger' }, 'Xoá key');
    rmKey.addEventListener('click', action(rmKey, async () => { if (!(await confirmBox(`Xoá key ${p.label} đã lưu?`))) return; await put('/api/me/vault', { providers: { [p.id]: { key: '' } } }); toast('Đã xoá key', 'ok'); await reload(); }));
    const editBtn = p.builtin || p.kind === 'gemini' ? null : h('button', { class: 'btn ghost' }, '✏️ Sửa nhà cung cấp');   // key nhận: server tự khoá địa chỉ API
    if (editBtn) editBtn.addEventListener('click', () => { card.replaceWith(providerForm(p)); });
    const delBtn = p.builtin ? null : h('button', { class: 'btn ghost danger' }, '🗑 Xoá nhà cung cấp');
    if (delBtn) delBtn.addEventListener('click', action(delBtn, async () => { if (!(await confirmBox(`Xoá nhà cung cấp "${p.label}" cùng key đã lưu?`))) return; await del(`/api/ai/providers/${p.id}`); toast('Đã xoá', 'ok'); await reload(); }));

    // ★ Chia sẻ AI key: link #/ai-key/<id-ai-key>?id=<id-user>. Key nhận từ người khác (createdBy) KHÔNG chia sẻ lại được.
    const shareBox = shareControls(p, it, reload);
    const card = h('div', { class: 'card stack prov' },
      h('div', { class: 'row between' },
        h('h3', null, it.name ? it.name : p.label, ' ', it.name ? h('span', { class: 'badge' }, p.label) : null, h('span', { class: 'badge' }, p.builtin ? 'dựng sẵn' : p.id), isDefault ? h('span', { class: 'badge quiz' }, 'mặc định') : null, it.keySet ? h('span', { class: 'badge good-b' }, '✓ có key') : h('span', { class: 'badge' }, 'chưa có key'), it.createdBy ? h('span', { class: 'badge', title: 'createdBy: ' + it.createdBy }, '🎁 được chia sẻ') : null),
        h('div', { class: 'row' }, editBtn, delBtn)),
      p.baseUrl ? h('p', { class: 'muted' }, h('code', null, p.baseUrl + p.chatPath)) : h('p', { class: 'muted' }, 'API Google Gemini (generateContent)'),
      field('Tên AI', h('div', { class: 'row' }, nameEl, nameBtn), '(tự đặt để dễ tìm — để trống = dùng tên nhà cung cấp)'),
      h('div', { class: 'ai-grid' }, field('Model', modelEl, p.allowCustomModel ? '(chọn gợi ý hoặc tự gõ)' : ''), field(`API key ${p.label}`, withToggle(key))),
      h('div', { class: 'row' }, saveBtn, testBtn, defBtn, it.keySet ? rmKey : null), shareBox, result);
    return card;
  }

  /** Form thêm/sửa nhà cung cấp kiểu OpenAI (người dùng tự điền; có thể bấm mẫu gợi ý). */
  function providerForm(prev, preset) {
    const base = prev || preset || {};
    const f = {
      id: h('input', { value: prev ? prev.id : (base.id || ''), placeholder: 'vd: openai, deepseek', maxlength: 32, disabled: !!prev, autocomplete: 'off' }),
      label: h('input', { value: base.label || '', placeholder: 'Tên hiển thị, vd: ChatGPT (OpenAI)', maxlength: 60 }),
      baseUrl: h('input', { value: base.baseUrl || '', placeholder: 'https://api.openai.com', autocomplete: 'off' }),
      chatPath: h('input', { value: base.chatPath || '/v1/chat/completions', placeholder: '/v1/chat/completions' }),
      models: h('textarea', { rows: 3, placeholder: 'Mỗi dòng (hoặc cách nhau dấu phẩy) một model' }),
      defaultModel: h('input', { value: base.defaultModel || '', placeholder: 'Model mặc định (để trống = model đầu tiên)', maxlength: 100 }),
      authHeader: h('input', { value: prev ? prev.authHeader : 'Authorization', placeholder: 'Authorization' }),
      authScheme: h('input', { value: prev ? prev.authScheme : 'Bearer', placeholder: 'Bearer (để trống = gửi key trần)' }),
      maxTokens: h('input', { type: 'number', min: 1, max: 200000, value: prev ? prev.maxTokens : 4096 }),
      keyPlaceholder: h('input', { value: base.keyPlaceholder || '', placeholder: 'Gợi ý ô key, vd: sk-…', maxlength: 40 }),
      subscribeRegex: h('input', { value: base.subscribeRegex || '', placeholder: 'Tuỳ chọn: regex nhận lỗi "chưa đăng ký model"' }),
    };
    f.models.value = (base.models || []).join('\n');
    const custom = h('input', { type: 'checkbox', checked: prev ? prev.allowCustomModel : true });
    const err = h('div');
    const saveBtn = h('button', { class: 'btn primary' }, prev ? 'Lưu thay đổi' : 'Thêm nhà cung cấp');
    saveBtn.addEventListener('click', action(saveBtn, async () => {
      err.replaceChildren();
      const body = { id: f.id.value.trim().toLowerCase(), label: f.label.value, baseUrl: f.baseUrl.value, chatPath: f.chatPath.value, models: f.models.value, defaultModel: f.defaultModel.value, authHeader: f.authHeader.value, authScheme: f.authScheme.value, maxTokens: Number(f.maxTokens.value), keyPlaceholder: f.keyPlaceholder.value, subscribeRegex: f.subscribeRegex.value, allowCustomModel: custom.checked };
      try { if (prev) await put(`/api/ai/providers/${prev.id}`, body); else await post('/api/ai/providers', body); }
      catch (e) { err.replaceChildren(msg('err', e.message)); return; }
      toast(prev ? 'Đã lưu nhà cung cấp' : 'Đã thêm nhà cung cấp — hãy dán API key bên dưới', 'ok'); await reload();
    }));
    const cancel = h('button', { class: 'btn ghost', type: 'button' }, 'Huỷ'); cancel.addEventListener('click', () => draw());
    return h('div', { class: 'card stack prov-form' }, h('h3', null, prev ? `Sửa: ${prev.label}` : 'Thêm nhà cung cấp AI (API kiểu OpenAI)'),
      h('p', { class: 'muted' }, 'Địa chỉ phải là https:// tới tên miền công khai (không dùng IP / localhost). Yêu cầu gửi: POST {Địa chỉ API}{Đường dẫn chat}.'),
      h('div', { class: 'ai-grid' }, field('Mã (id)', f.id, '(a-z 0-9 - _)'), field('Tên hiển thị', f.label), field('Địa chỉ API', f.baseUrl), field('Đường dẫn chat', f.chatPath)),
      field('Danh sách model', f.models), h('div', { class: 'ai-grid' }, field('Model mặc định', f.defaultModel), field('Gợi ý ô key', f.keyPlaceholder)),
      h('details', null, h('summary', null, 'Nâng cao'), h('div', { class: 'stack' },
        h('div', { class: 'ai-grid' }, field('Tên header xác thực', f.authHeader), field('Kiểu xác thực', f.authScheme), field('max_tokens', f.maxTokens)),
        field('Regex lỗi chưa đăng ký model', f.subscribeRegex), h('label', { class: 'row opt' }, custom, h('span', null, 'Cho phép tự gõ tên model ngoài danh sách')))),
      err, h('div', { class: 'row' }, saveBtn, cancel));
  }

  function draw() {
    const have = new Set(providers.map((p) => p.id));
    const addBtn = h('button', { class: 'btn primary' }, '＋ Thêm nhà cung cấp');
    const slot = h('div');
    addBtn.disabled = providers.length >= max;
    addBtn.addEventListener('click', () => slot.replaceChildren(providerForm(null)));
    const presetBtns = presets.filter((x) => !have.has(x.id)).map((x) => { const b = h('button', { class: 'btn small', type: 'button' }, `＋ ${x.label}`); b.addEventListener('click', () => slot.replaceChildren(providerForm(null, x))); return b; });
    root.replaceChildren(h('h2', null, 'Cài đặt'), tabs('ai'),
      h('div', { class: 'card stack' }, h('h3', null, 'Nhà cung cấp AI của bạn'),
        h('p', { class: 'muted' }, 'Tự thêm nhà cung cấp mình dùng (Google Gemini có sẵn). Mỗi tài khoản có danh sách và key riêng — danh sách lưu ở ', h('code', null, 'AI-database/<id tài khoản>/index.json'), ', key được mã hoá. Nhà cung cấp mặc định dùng khi chấm tự luận / phân tích trắc nghiệm; ở từng bài vẫn chọn nhà khác được.'),
        h('div', { class: 'row' }, addBtn, presetBtns.length ? h('span', { class: 'muted' }, 'hoặc thêm nhanh theo mẫu:') : null, ...presetBtns), slot),
      ...providers.map(providerCard));
    enhancePickers(root);
  }
  draw();
  return root;
}


/** Khối "Chia sẻ AI key" trong thẻ nhà cung cấp. it = vault.items[p.id]. */
function shareControls(p, it, reload) {
  if (it.createdBy) {      // key nhận được → không chia sẻ lại
    return h('div', { class: 'alert info' }, '🎁 Key này do một tài khoản khác chia sẻ cho bạn (createdBy: ', h('code', null, it.createdBy), '). Bạn dùng được để chấm/phân tích nhưng không thể chia sẻ lại cho người khác. Nếu dán API key riêng của bạn vào ô trên, key sẽ trở thành của bạn.');
  }
  if (!it.keySet) return null;
  const uid = session.get().user.id;
  const link = `${location.origin}${location.pathname}#/ai-key/${p.id}?id=${uid}`;
  const toggle = h('button', { class: it.shared ? 'btn ghost danger' : 'btn' }, it.shared ? '⛔ Tắt chia sẻ' : '🔗 Chia sẻ key này');
  toggle.addEventListener('click', action(toggle, async () => {
    if (!it.shared && !(await confirmBox('Người mở link (đã đăng nhập) sẽ NHẬN ĐƯỢC một bản sao API key này và dùng được nó để gọi AI trên tài khoản của chủ key. Chỉ chia sẻ cho người bạn tin tưởng. Tiếp tục?'))) return;
    await post(`/api/ai-key/${p.id}/share`, { enabled: !it.shared });
    toast(it.shared ? 'Đã tắt chia sẻ — link không còn nhận được key mới (bản đã nhận vẫn còn)' : 'Đã bật chia sẻ — hãy sao chép link bên dưới', 'ok'); await reload();
  }));
  if (!it.shared) return h('div', { class: 'row' }, toggle, h('small', { class: 'muted' }, 'Chia sẻ key cho người khác qua link (người nhận không thể chia sẻ tiếp).'));
  const linkEl = h('input', { readonly: true, value: link, 'aria-label': 'Link chia sẻ AI key' });
  linkEl.addEventListener('focus', () => linkEl.select());
  const copy = h('button', { class: 'btn small', type: 'button' }, '📋 Sao chép link');
  copy.addEventListener('click', async () => { try { await navigator.clipboard.writeText(link); toast('Đã sao chép link chia sẻ AI key', 'ok'); } catch { linkEl.select(); toast('Hãy bấm Ctrl+C để sao chép', 'warn'); } });
  return h('div', { class: 'stack' }, h('div', { class: 'alert warn' }, '🔗 Đang chia sẻ: ai có link và đăng nhập đều nhận được key này. Tắt chia sẻ khi không cần.'), h('div', { class: 'row' }, linkEl, copy, toggle));
}

/** Trang mở từ link #/ai-key/<id-ai-key>?id=<id-user>: xem trước (không lộ key) rồi bấm "Nhận key". */
export async function aiKeyLinkPage(ctx, m) {
  const kid = m[1], owner = ctx.query.get('id') || '';
  if (!/^(?:[a-f0-9]{16,32}|\d{10,14}_[a-f0-9]{8,24})$/.test(owner)) throw new Error('Link chia sẻ thiếu id người chia sẻ (?id=…)');
  const pv = await get(`/api/ai-key/${kid}?id=${owner}`);
  const k = pv.key; const out = h('div');
  const btn = h('button', { class: 'btn primary', disabled: !!pv.blocked }, pv.already ? '🔄 Làm mới key đã nhận' : '📥 Nhận AI key này');
  btn.addEventListener('click', action(btn, async () => {
    const r = await post(`/api/ai-key/${kid}/accept`, { ownerId: owner });
    toast(r.refreshed ? 'Đã làm mới key' : 'Đã nhận AI key — dùng được ngay khi chấm bài', 'ok'); ctx.go('/settings/ai');
  }));
  return h('div', { class: 'card stack', style: 'max-width:560px;margin:24px auto' },
    h('h2', null, '🎁 Có người chia sẻ AI key cho bạn'),
    h('p', null, h('b', null, k.name || k.label), ' ', h('span', { class: 'badge' }, k.label)),
    h('p', { class: 'muted' }, 'Máy chủ AI: ', h('code', null, k.host), k.models && k.models.length ? ` · model: ${k.models.slice(0, 4).join(', ')}${k.models.length > 4 ? '…' : ''}` : ''),
    h('p', { class: 'muted' }, 'Người chia sẻ (createdBy): ', h('code', null, k.createdBy)),
    h('div', { class: 'alert info' }, 'Key được sao chép vào tài khoản của bạn, mã hoá và KHÔNG hiển thị lại. Bạn dùng nó để chấm bài / phân tích nhưng không thể chia sẻ tiếp cho người khác.'),
    pv.blocked ? h('div', { class: 'alert err' }, pv.blocked) : null, out,
    h('div', { class: 'row' }, btn, h('a', { class: 'btn ghost', href: '#/settings/ai' }, 'Về cài đặt AI')));
}
