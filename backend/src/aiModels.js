'use strict';
/**
 * Nhà cung cấp AI — chuyển từ bản cũ luyen-thi-cntt-utc-mnha (services/aiProviderService.js + config/aiProviderSeed.js).
 * Khác bản cũ: mỗi TÀI KHOẢN tự quản lý danh sách của mình, lưu ở repo ACCOUNT: `AI-database/<uid>/index.json`
 * (file này KHÔNG chứa API key — key mã hoá AES-GCM nằm ở private/<uid>/vault.json).
 *   kind 'gemini' → REST generateContent của Google (nhà cung cấp dựng sẵn, luôn có, không xoá được)
 *   kind 'openai' → API tương thích OpenAI: POST {baseUrl}{chatPath} (vilao.ai, ChatGPT, DeepSeek, OpenRouter, … do người dùng tự thêm)
 */
const GEMINI_MODELS = [
  'gemini-flash-latest', 'gemini-flash-lite-latest', 'gemini-pro-latest',
  'gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-3-flash', 'gemini-3.1-pro',
  'gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-pro',
  'gemini-2-flash', 'gemini-2-flash-lite',
  'gemma-4-31b-it', 'gemma-4-26b-a4b-it',
];
// Model dự phòng khi model chính quá tải (503)
const GEMINI_FALLBACK = ['gemini-3.6-flash', 'gemini-flash-lite-latest', 'gemini-3.5-flash-lite', 'gemini-flash-latest', 'gemini-2-flash-lite'];

const VILAO_MODELS = [
  'gpt-4o-mini', 'gpt-4o', 'gpt-4.1', 'gpt-4.1-mini', 'gpt-4.1-nano', 'gpt-4-turbo', 'gpt-3.5-turbo',
  'occ/claude-opus-5', 'claude-3-5-sonnet', 'claude-3-5-haiku', 'claude-3-opus',
  'gemini-1.5-pro', 'gemini-1.5-flash', 'llama-3.1-70b', 'llama-3.1-8b', 'chib/deepseek-v4.1-flash',
];

const DEFAULT_SYSTEM_PROMPT = 'Bạn là trợ lý AI chấm bài. Làm đúng theo yêu cầu và định dạng đầu ra được nêu trong tin nhắn của người dùng.';
const ID_RE = /^[a-z][a-z0-9_-]{1,31}$/;
const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._\-:/]{0,99}$/;
const RESERVED_IDS = new Set(['google', 'default', 'auto', 'all', 'none', 'supplier', 'presets']);
const MAX_PROVIDERS = 12;

/** Mẫu gợi ý để bấm "Thêm" cho nhanh — người dùng vẫn có thể tự điền tay mọi trường. */
const PRESETS = [
  { id: 'vilao', label: 'vilao.ai', baseUrl: 'https://api.vilao.ai', chatPath: '/v1/chat/completions', models: VILAO_MODELS, defaultModel: 'gpt-4o-mini', keyPlaceholder: 'sk-…', subscribeRegex: 'subscribe\\s+to\\s+model' },
  { id: 'openai', label: 'ChatGPT (OpenAI)', baseUrl: 'https://api.openai.com', chatPath: '/v1/chat/completions', models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1', 'gpt-4.1-mini'], defaultModel: 'gpt-4o-mini', keyPlaceholder: 'sk-…' },
  { id: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com', chatPath: '/chat/completions', models: ['deepseek-chat', 'deepseek-reasoner'], defaultModel: 'deepseek-chat', keyPlaceholder: 'sk-…' },
  { id: 'openrouter', label: 'OpenRouter', baseUrl: 'https://openrouter.ai', chatPath: '/api/v1/chat/completions', models: ['openai/gpt-4o-mini', 'deepseek/deepseek-chat'], defaultModel: 'openai/gpt-4o-mini', keyPlaceholder: 'sk-or-…' },
];

const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isValidModelName = (m) => typeof m === 'string' && MODEL_RE.test(m.trim());
const uniq = (a) => [...new Set(a)];
const parseList = (v) => (Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[\r\n,;]+/) : []).map((x) => String(x == null ? '' : x).trim()).filter(Boolean);

/** Nhà cung cấp Gemini dựng sẵn (danh sách model lấy từ code → luôn mới). */
function geminiProvider(cfg = {}) {
  const def = GEMINI_MODELS.includes(cfg.geminiModel) ? cfg.geminiModel : 'gemini-flash-latest';
  return { id: 'gemini', label: 'Google Gemini', kind: 'gemini', builtin: true, enabled: true, models: GEMINI_MODELS, defaultModel: def, fallbackModels: GEMINI_FALLBACK, allowCustomModel: false, keyPlaceholder: 'AIza…', keyPrefixes: ['AIza', 'AQ.'] };
}

/** Chỉ cho gọi HTTPS tới tên miền công khai (người dùng nhập địa chỉ → không cho trỏ vào mạng nội bộ). */
function validateBaseUrl(raw) {
  let u; try { u = new URL(String(raw || '').trim()); } catch { return { error: 'Địa chỉ API (baseUrl) không hợp lệ. Ví dụ: https://api.openai.com' }; }
  if (u.protocol !== 'https:') return { error: 'Địa chỉ API phải dùng https://' };
  if (u.username || u.password) return { error: 'Địa chỉ API không được chứa user/mật khẩu.' };
  if (u.port && u.port !== '443') return { error: 'Địa chỉ API chỉ được dùng cổng 443 (mặc định của https).' };
  const host = u.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.localhost') || /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':') || host.startsWith('[') || !host.includes('.')) {
    return { error: 'Địa chỉ API phải là tên miền công khai (không dùng localhost / địa chỉ IP / mạng nội bộ).' };
  }
  return { value: u.origin + (u.pathname && u.pathname !== '/' ? u.pathname.replace(/\/+$/, '') : '') };
}

function validateRegex(src) {
  if (src == null || src === '') return { value: '' };
  const s = String(src); if (s.length > 200) return { error: 'Biểu thức regex quá dài (tối đa 200 ký tự).' };
  try { new RegExp(s, 'i'); } catch { return { error: `Biểu thức regex không hợp lệ: ${s}` }; }
  return { value: s };
}

/** Chuẩn hoá + kiểm tra một nhà cung cấp kiểu OpenAI do người dùng nhập. → { value } | { errors } */
function normalizeProviderInput(raw, prev = null) {
  const errors = []; const r = isPlain(raw) ? raw : {}; const out = {};
  const id = prev ? prev.id : String(r.id || '').trim().toLowerCase();
  if (!prev) {
    if (!ID_RE.test(id)) errors.push('Mã nhà cung cấp (id) gồm 2–32 ký tự a-z, 0-9, "-" hoặc "_", bắt đầu bằng chữ. Ví dụ: openai, deepseek.');
    else if (RESERVED_IDS.has(id) || id === 'gemini') errors.push(`Mã "${id}" đã được hệ thống giữ lại.`);
  }
  out.id = id;
  const label = String(r.label == null ? (prev && prev.label) || '' : r.label).trim();
  if (!label || label.length > 60) errors.push('Tên hiển thị bắt buộc (tối đa 60 ký tự).');
  out.label = label; out.kind = 'openai'; out.builtin = false;
  out.enabled = r.enabled === undefined ? (prev ? prev.enabled !== false : true) : (r.enabled === true || r.enabled === 'true' || r.enabled === 1 || r.enabled === '1' || r.enabled === 'on');

  const bu = validateBaseUrl(r.baseUrl == null ? prev && prev.baseUrl : r.baseUrl); if (bu.error) errors.push(bu.error); else out.baseUrl = bu.value;
  const chatPath = String(r.chatPath == null ? (prev && prev.chatPath) || '/v1/chat/completions' : r.chatPath).trim() || '/v1/chat/completions';
  if (!/^\/[A-Za-z0-9._~\-/]{0,198}$/.test(chatPath) || chatPath.includes('..')) errors.push('Đường dẫn chat (chatPath) phải bắt đầu bằng "/", ví dụ /v1/chat/completions.'); else out.chatPath = chatPath;
  const authHeader = String(r.authHeader == null ? (prev && prev.authHeader) || 'Authorization' : r.authHeader).trim() || 'Authorization';
  if (!/^[A-Za-z0-9-]{1,50}$/.test(authHeader)) errors.push('Tên header xác thực không hợp lệ.'); else out.authHeader = authHeader;
  let scheme = r.authScheme == null ? (prev && prev.authScheme !== undefined ? prev.authScheme : 'Bearer') : String(r.authScheme).trim();
  if (!/^[A-Za-z]{0,20}$/.test(scheme)) { errors.push('Kiểu xác thực chỉ gồm chữ cái, ví dụ Bearer (để trống = gửi key trần).'); scheme = 'Bearer'; }
  out.authScheme = scheme;
  const mt = Number(r.maxTokens == null ? (prev && prev.maxTokens) || 4096 : r.maxTokens);
  if (!Number.isInteger(mt) || mt < 1 || mt > 200000) errors.push('max_tokens phải là số nguyên từ 1 đến 200000.'); else out.maxTokens = mt;

  const sub = validateRegex(r.subscribeRegex !== undefined ? r.subscribeRegex : prev && prev.subscribeRegex); if (sub.error) errors.push(sub.error); else if (sub.value) out.subscribeRegex = sub.value;

  let models = uniq(parseList(r.models === undefined ? prev && prev.models : r.models));
  const badM = models.filter((m) => !isValidModelName(m)); if (badM.length) errors.push(`Tên model không hợp lệ: ${badM.slice(0, 5).join(', ')} (chỉ gồm chữ, số, . _ - : /).`);
  models = models.filter(isValidModelName); if (models.length > 200) errors.push('Tối đa 200 model.');
  let defaultModel = String(r.defaultModel == null ? (prev && prev.defaultModel) || '' : r.defaultModel).trim(); if (!defaultModel && models.length) defaultModel = models[0];
  if (!isValidModelName(defaultModel)) errors.push('Cần ít nhất một model (model mặc định hợp lệ).'); else if (!models.includes(defaultModel)) models.unshift(defaultModel);
  out.models = models; out.defaultModel = defaultModel;
  out.allowCustomModel = r.allowCustomModel === undefined ? (prev ? prev.allowCustomModel !== false : true) : (r.allowCustomModel === true || r.allowCustomModel === 'true' || r.allowCustomModel === 1);
  out.keyPlaceholder = String(r.keyPlaceholder == null ? (prev && prev.keyPlaceholder) || '' : r.keyPlaceholder).trim().slice(0, 40);
  out.systemPrompt = String(r.systemPrompt == null ? (prev && prev.systemPrompt) || DEFAULT_SYSTEM_PROMPT : r.systemPrompt).trim().slice(0, 1000) || DEFAULT_SYSTEM_PROMPT;
  const now = new Date().toISOString(); out.createdAt = (prev && prev.createdAt) || now; out.updatedAt = now;
  return errors.length ? { errors } : { value: out, errors: [] };
}

/** Chuẩn hoá cả tài liệu `AI-database/<uid>/index.json`; mục hỏng bị bỏ; luôn có 'gemini'. */
function sanitizeDocument(doc, cfg) {
  const out = { version: 1, updatedAt: (doc && doc.updatedAt) || new Date().toISOString(), providers: [geminiProvider(cfg)] };
  const seen = new Set(['gemini']);
  for (const raw of doc && Array.isArray(doc.providers) ? doc.providers : []) {
    if (!isPlain(raw)) continue; const id = String(raw.id || '').trim().toLowerCase();
    if (!id || seen.has(id) || id === 'gemini') continue;
    const r = normalizeProviderInput(raw, { id, createdAt: raw.createdAt, enabled: raw.enabled !== false });
    if (!r.value) continue; r.value.updatedAt = raw.updatedAt || r.value.updatedAt; seen.add(id); out.providers.push(r.value);
  }
  return out;
}

const findProvider = (list, id) => list.find((p) => p.id === String(id || '').toLowerCase()) || null;
const isValidModel = (m) => isValidModelName(m);

/** Làm sạch tên model theo nhà cung cấp: gemini chỉ nhận model trong danh sách; openai cho nhập tên hợp lệ bất kỳ (nếu allowCustomModel). */
function safeModel(p, model) {
  const m = typeof model === 'string' ? model.trim() : '';
  if (!m) return p.defaultModel;
  if (p.kind === 'gemini') return p.models.includes(m) ? m : p.defaultModel;
  if (!isValidModelName(m)) return p.defaultModel;
  if (GEMINI_MODELS.includes(m) && !p.models.includes(m)) return p.defaultModel; // tên model Gemini gửi sang nhà khác sẽ lỗi
  return p.allowCustomModel || p.models.includes(m) ? m : p.defaultModel;
}

/** Phần gửi xuống trình duyệt: của CHÍNH chủ tài khoản nên có địa chỉ API để sửa; không có key. */
const publicProvider = (p) => ({ id: p.id, label: p.label, kind: p.kind, builtin: !!p.builtin, enabled: p.enabled !== false, baseUrl: p.baseUrl || '', chatPath: p.chatPath || '', authHeader: p.authHeader || '', authScheme: p.authScheme === undefined ? '' : p.authScheme, maxTokens: p.maxTokens || 0, models: p.models, defaultModel: p.defaultModel, allowCustomModel: !!p.allowCustomModel, keyPlaceholder: p.keyPlaceholder || '', subscribeRegex: p.subscribeRegex || '', systemPrompt: p.systemPrompt || '' });
const publicPresets = () => PRESETS.map((x) => ({ id: x.id, label: x.label, baseUrl: x.baseUrl, chatPath: x.chatPath, models: x.models, defaultModel: x.defaultModel, keyPlaceholder: x.keyPlaceholder || '', subscribeRegex: x.subscribeRegex || '' }));

module.exports = { GEMINI_MODELS, PRESETS, MAX_PROVIDERS, DEFAULT_SYSTEM_PROMPT, geminiProvider, normalizeProviderInput, sanitizeDocument, findProvider, safeModel, isValidModel, isValidModelName, validateBaseUrl, publicProvider, publicPresets };
