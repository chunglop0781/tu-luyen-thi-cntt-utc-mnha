'use strict';
/**
 * Danh sách nhà cung cấp AI + model (chuyển từ bản cũ luyen-thi-cntt-utc-mnha: config/aiProviderSeed.js).
 * Địa chỉ API do MÁY CHỦ cố định ở đây — người dùng chỉ chọn nhà cung cấp/model và dán key của mình
 * (không cho nhập URL tuỳ ý → không thể bị lợi dụng để gửi request tới địa chỉ lạ).
 *   kind 'gemini' → REST generateContent của Google
 *   kind 'openai' → API tương thích OpenAI (POST {baseUrl}{chatPath}, Authorization: Bearer <key>)
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

const MODEL_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._\-:/]{0,99}$/;

function providers(cfg = {}) {
  const gDefault = GEMINI_MODELS.includes(cfg.geminiModel) ? cfg.geminiModel : (cfg.geminiModel || 'gemini-flash-latest');
  return [
    { id: 'gemini', label: 'Google Gemini', kind: 'gemini', models: GEMINI_MODELS, defaultModel: gDefault, fallbackModels: GEMINI_FALLBACK, allowCustomModel: false, keyPlaceholder: 'AIza…', keyPrefixes: ['AIza', 'AQ.'] },
    { id: 'vilao', label: 'vilao.ai', kind: 'openai', baseUrl: 'https://api.vilao.ai', chatPath: '/v1/chat/completions', maxTokens: 4096, models: VILAO_MODELS, defaultModel: 'gpt-4o-mini', allowCustomModel: true, keyPlaceholder: 'sk-…', keyPrefixes: ['sk-'], subscribeRegex: 'subscribe\\s+to\\s+model' },
    { id: 'openai', label: 'ChatGPT (OpenAI)', kind: 'openai', baseUrl: 'https://api.openai.com', chatPath: '/v1/chat/completions', maxTokens: 4096, models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1', 'gpt-4.1-mini'], defaultModel: 'gpt-4o-mini', allowCustomModel: true, keyPlaceholder: 'sk-…', keyPrefixes: ['sk-'] },
    { id: 'deepseek', label: 'DeepSeek', kind: 'openai', baseUrl: 'https://api.deepseek.com', chatPath: '/chat/completions', maxTokens: 4096, models: ['deepseek-chat', 'deepseek-reasoner'], defaultModel: 'deepseek-chat', allowCustomModel: true, keyPlaceholder: 'sk-…', keyPrefixes: ['sk-'] },
    { id: 'openrouter', label: 'OpenRouter', kind: 'openai', baseUrl: 'https://openrouter.ai', chatPath: '/api/v1/chat/completions', maxTokens: 4096, models: ['openai/gpt-4o-mini', 'deepseek/deepseek-chat'], defaultModel: 'openai/gpt-4o-mini', allowCustomModel: true, keyPlaceholder: 'sk-or-…', keyPrefixes: ['sk-or-'] },
  ];
}

const getProvider = (cfg, id) => providers(cfg).find((p) => p.id === String(id || '').toLowerCase()) || null;
const isValidModelName = (m) => typeof m === 'string' && MODEL_NAME_RE.test(m.trim());

/** Làm sạch tên model theo nhà cung cấp: gemini chỉ nhận model trong danh sách; openai cho nhập tên hợp lệ bất kỳ. */
function safeModel(p, model) {
  const m = typeof model === 'string' ? model.trim() : '';
  if (!m) return p.defaultModel;
  if (p.kind === 'gemini') return p.models.includes(m) ? m : p.defaultModel;
  if (!isValidModelName(m)) return p.defaultModel;
  if (GEMINI_MODELS.includes(m) && !p.models.includes(m)) return p.defaultModel; // tên model Gemini gửi sang nhà khác sẽ lỗi
  return p.allowCustomModel || p.models.includes(m) ? m : p.defaultModel;
}

/** Phần gửi xuống trình duyệt (không có địa chỉ nội bộ). */
const publicList = (cfg) => providers(cfg).map(({ id, label, kind, models, defaultModel, allowCustomModel, keyPlaceholder }) => ({ id, label, kind, models, defaultModel, allowCustomModel, keyPlaceholder }));

module.exports = { providers, getProvider, safeModel, isValidModelName, publicList, GEMINI_MODELS };
