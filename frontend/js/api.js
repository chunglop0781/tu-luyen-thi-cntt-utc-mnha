// Client gọi backend Vercel từ GitHub Pages — bền vững: Bearer token (không cookie), tự refresh, retry, timeout, báo trạng thái kết nối.
const CFG = window.APP_CONFIG || {};
export const API = String(CFG.API_BASE || '').replace(/\/+$/, '');
const KEY = 'utc.auth.v2';

export class ApiError extends Error {
  constructor(status, message, code, extra = {}) { super(message); this.status = status; this.code = code; Object.assign(this, extra); }
}

// ── lưu token (localStorage; rơi về RAM nếu bị chặn) ──
let mem = null;
function load() { try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch { return mem; } }
function save(v) { mem = v; try { v ? localStorage.setItem(KEY, JSON.stringify(v)) : localStorage.removeItem(KEY); } catch { /* bỏ qua */ } }
export const session = {
  get() { return load() || mem; },
  set(t) { save({ accessToken: t.accessToken, refreshToken: t.refreshToken, user: t.user, exp: Date.now() + (t.expiresIn || 3600) * 1000 }); emit('auth'); },
  clear() { save(null); emit('auth'); },
};

// ── sự kiện nhỏ (trạng thái kết nối / đăng nhập) ──
const subs = {};
export const on = (ev, fn) => { (subs[ev] = subs[ev] || []).push(fn); };
const emit = (ev, d) => (subs[ev] || []).forEach((f) => f(d));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let refreshing = null;

/** Làm mới access token — chỉ 1 lần tại 1 thời điểm (single-flight). Lỗi mạng KHÔNG đăng xuất. */
function refresh() {
  if (refreshing) return refreshing;
  const s = session.get();
  if (!s || !s.refreshToken) return Promise.reject(new ApiError(401, 'Chưa đăng nhập', 'UNAUTHORIZED'));
  refreshing = fetchJson('POST', '/api/auth/refresh', { refreshToken: s.refreshToken }, {}, 25000)
    .then((j) => { session.set({ ...j, refreshToken: j.refreshToken || s.refreshToken }); return j.accessToken; })
    .catch((e) => { if (e.status === 401) session.clear(); throw e; })
    .finally(() => { refreshing = null; });
  return refreshing;
}

async function fetchOnce(method, path, body, headers, timeout, raw) {
  const ac = new AbortController(); const timer = setTimeout(() => ac.abort(), timeout);
  try {
    const res = await fetch(API + path, {
      method, mode: 'cors', credentials: 'omit', signal: ac.signal, cache: 'no-store',
      headers: { ...(body !== undefined && !raw ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
    });
    return res;
  } finally { clearTimeout(timer); }
}

/** fetch + retry lỗi mạng/502/503/504/429 (chỉ khi `retry`). */
async function fetchJson(method, path, body, headers = {}, timeout = 30000, { retry = method !== 'POST', raw = false, binary = false } = {}) {
  let last;
  for (let i = 0; i < (retry ? 4 : 1); i++) {
    try {
      const res = await fetchOnce(method, path, body, headers, timeout, raw);
      if (binary && res.ok) { emit('online'); return res; }
      const text = await res.text(); let j = null; try { j = text ? JSON.parse(text) : null; } catch { /* không phải JSON */ }
      if (res.ok) { emit('online'); return j || {}; }
      const err = new ApiError(res.status, (j && j.error) || `Lỗi máy chủ (${res.status})`, j && j.code, { retryAfter: Number(res.headers.get('retry-after') || 0) });
      if ([429, 502, 503, 504].includes(res.status) && i < 3 && retry) { last = err; await sleep(err.retryAfter ? Math.min(err.retryAfter, 6) * 1000 : 600 * 2 ** i); continue; }
      throw err;
    } catch (e) {
      if (e instanceof ApiError) throw e;
      last = new ApiError(0, `Không kết nối được máy chủ${API ? '' : ' (chưa đặt API_BASE trong config.js)'}. Kiểm tra mạng, địa chỉ backend và FRONTEND_ORIGINS (CORS).`, 'NETWORK');
      emit('offline', last);
      if (i < 3 && retry) { await sleep(600 * 2 ** i); continue; }
      throw last;
    }
  }
  throw last;
}

/** Gọi API có xác thực. opts: { body, retry (mặc định: mọi method trừ POST), timeout, raw, headers, auth:false } */
export async function api(method, path, opts = {}) {
  const { body, auth = true, timeout, raw, headers = {}, binary } = opts;
  const retry = opts.retry !== undefined ? opts.retry : method !== 'POST';
  const go = async (token) => fetchJson(method, path, body, token ? { ...headers, Authorization: `Bearer ${token}` } : headers, timeout || 30000, { retry, raw, binary });
  if (!auth) return go(null);
  let s = session.get();
  if (!s) throw new ApiError(401, 'Cần đăng nhập', 'UNAUTHORIZED');
  let token = s.accessToken;
  if (s.exp && s.exp - Date.now() < 60000) { try { token = await refresh(); } catch (e) { if (e.status === 401) throw e; } }
  try { return await go(token); }
  catch (e) {
    if (e.status !== 401 || e.code === 'BAD_CREDENTIALS') throw e;
    token = await refresh();
    return go(token);
  }
}

export const get = (p, o) => api('GET', p, o);
export const put = (p, body, o) => api('PUT', p, { ...o, body });
export const post = (p, body, o) => api('POST', p, { ...o, body });
export const patch = (p, body, o) => api('PATCH', p, { ...o, body });
export const del = (p, o) => api('DELETE', p, o);

/** Đăng nhập/đăng ký (không cần token). POST không retry để tránh tạo trùng. */
export async function authCall(kind, body) {
  const j = await fetchJson('POST', `/api/auth/${kind}`, body, {}, 40000, { retry: false });
  session.set(j); return j;
}
/** Gọi API auth không trả token (gửi OTP, đặt lại mật khẩu). POST không retry để không gửi mail trùng. */
export async function authPost(kind, body) {
  return fetchJson('POST', `/api/auth/${kind}`, body, {}, 40000, { retry: false });
}
export async function logout() {
  const s = session.get();
  if (s && s.refreshToken) { try { await fetchJson('POST', '/api/auth/logout', { refreshToken: s.refreshToken }, {}, 8000, { retry: false }); } catch { /* vẫn đăng xuất cục bộ */ } }
  session.clear();
}

/** Đánh thức hàm serverless (cold start) và cho biết có online không. */
export async function ping(onSlow) {
  const t = setTimeout(() => onSlow && onSlow(), 3500);
  try { return await fetchJson('GET', '/api/health', undefined, {}, 40000); } finally { clearTimeout(t); }
}

// ── ảnh: <img> không gửi được header Authorization → tải bằng fetch rồi tạo blob URL ──
const blobCache = new Map();
export function imageUrl(id) {
  if (!blobCache.has(id)) {
    blobCache.set(id, (async () => {
      const token = (session.get() || {}).accessToken;
      let res = await fetchJson('GET', `/api/images/${id}`, undefined, { Authorization: `Bearer ${token}` }, 40000, { binary: true }).catch(async (e) => {
        if (e.status === 401) { const t = await refresh(); return fetchJson('GET', `/api/images/${id}`, undefined, { Authorization: `Bearer ${t}` }, 40000, { binary: true }); }
        throw e;
      });
      return URL.createObjectURL(await res.blob());
    })().catch((e) => { blobCache.delete(id); throw e; }));
  }
  return blobCache.get(id);
}

/** Nén ảnh phía trình duyệt (≤ ~1600px, JPEG) để vừa giới hạn 4,5MB của Vercel, rồi tải lên. */
export async function uploadImage(file) {
  let blob = file;
  const okType = /^image\/(jpeg|png|gif|webp)$/.test(file.type);
  if (!okType) throw new ApiError(415, 'Chỉ nhận ảnh JPEG, PNG, GIF, WebP', 'BAD_TYPE');
  if (file.type !== 'image/gif' && (file.size > 1.5 * 1024 * 1024)) {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(bmp, 0, 0, c.width, c.height);
    blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.82));
  }
  if (blob.size > 4 * 1024 * 1024) throw new ApiError(413, 'Ảnh vẫn quá lớn sau khi nén (tối đa 4MB)', 'TOO_LARGE');
  const buf = await blob.arrayBuffer();
  const j = await api('POST', '/api/images', { body: buf, raw: true, headers: { 'Content-Type': blob.type, 'X-Image-Name': encodeURIComponent(file.name || 'image').slice(0, 80) }, retry: true, timeout: 60000 });
  return j.image;
}

export const newId = () => { const a = new Uint8Array(8); crypto.getRandomValues(a); return [...a].map((b) => b.toString(16).padStart(2, '0')).join(''); };
