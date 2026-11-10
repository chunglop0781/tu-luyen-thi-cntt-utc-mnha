'use strict';
/** Gọi AI bằng khoá của CHÍNH người dùng: Gemini (REST) hoặc API kiểu OpenAI (vilao.ai, ChatGPT, DeepSeek, OpenRouter). */
const { HttpError } = require('../http');
const { assertPublicHost } = require('./netguard');
const { DEFAULT_SYSTEM_PROMPT } = require('../aiModels');

const SYSTEM = DEFAULT_SYSTEM_PROMPT;

function apiError(status, body, p, raw) {
  const msg = (body && body.error && (body.error.message || (typeof body.error === 'string' && body.error))) || (body && body.message) || String(raw || '').slice(0, 200) || 'không rõ';
  const e = (s, m, c) => { const x = new HttpError(s, m, c); x.upstream = status; return x; };
  // KHÔNG trả 401 cho trình duyệt: 401 nghĩa là "hết phiên đăng nhập" và sẽ làm đăng xuất nhầm
  if (status === 401 || status === 403) {
    if (p.subscribeRegex && status === 403 && new RegExp(p.subscribeRegex, 'i').test(msg)) return e(400, `${p.label}: key chưa đăng ký model này (${msg})`, 'AI_MODEL');
    return e(400, `${p.label}: key không hợp lệ hoặc không có quyền (${status}) — ${msg}`, 'AI_KEY');
  }
  if (status === 404) return e(400, `${p.label}: không tìm thấy model hoặc địa chỉ API (${msg})`, 'AI_MODEL');
  if (status === 429) return e(429, `${p.label}: hết hạn mức hoặc gọi quá nhanh (${msg})`, 'AI_QUOTA');
  return e(502, `${p.label} lỗi (${status}): ${msg}`, 'AI_ERROR');
}

async function once({ p, model, apiKey, prompt, json, fetchImpl, timeoutMs, lookup }) {
  let res, url, init;
  if (p.kind === 'gemini') {
    url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    init = { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { ...(json ? { responseMimeType: 'application/json' } : {}), temperature: 0.2 } }) };
  } else {
    url = `${p.baseUrl}${p.chatPath}`;
    await assertPublicHost(new URL(url).hostname, lookup);   // địa chỉ do người dùng nhập → không cho trỏ vào mạng nội bộ
    const scheme = p.authScheme === undefined ? 'Bearer' : p.authScheme;
    init = { method: 'POST', headers: { 'Content-Type': 'application/json', [p.authHeader || 'Authorization']: scheme ? `${scheme} ${apiKey}` : apiKey }, redirect: 'error', // không theo chuyển hướng → không lộ key
      body: JSON.stringify({ model, messages: [{ role: 'system', content: p.systemPrompt || SYSTEM }, { role: 'user', content: prompt }], max_tokens: p.maxTokens || 4096, temperature: 0.2 }) };
  }
  try { res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) }); }
  catch (e) {
    const timeout = e && (e.name === 'TimeoutError' || e.name === 'AbortError');
    const err = new HttpError(504, timeout ? `${p.label} không phản hồi kịp (${Math.round(timeoutMs / 1000)}s)` : `${p.label}: không kết nối được (${e.message})`, 'AI_TIMEOUT'); err.upstream = 504; throw err;
  }
  const raw = await res.text(); let body = null; try { body = raw ? JSON.parse(raw) : null; } catch { body = null; }
  if (!res.ok) throw apiError(res.status, body, p, raw);
  let text = '';
  if (p.kind === 'gemini') text = ((body && body.candidates && body.candidates[0] && body.candidates[0].content && body.candidates[0].content.parts) || []).map((x) => x.text || '').join('');
  else { const c = body && body.choices && body.choices[0] && body.choices[0].message && body.choices[0].message.content; text = typeof c === 'string' ? c : Array.isArray(c) ? c.map((x) => (x && x.text) || '').join('') : ''; }
  if (!text) throw new HttpError(502, `${p.label} không trả về nội dung`, 'AI_FORMAT');
  return text;
}

/** → { text, model, provider, fallbackFrom? }. Gemini: model chính quá tải/timeout → thử tối đa 2 model dự phòng.
 *  `budgetMs`: tổng thời gian cho mọi lần thử (Vercel giới hạn 60s/hàm) — hết ngân sách thì không thử tiếp. */
async function callAi({ provider, model, apiKey, prompt, json = false, fetchImpl = fetch, timeoutMs = 45000, budgetMs = 52000, lookup }) {
  const chain = [model];
  if (provider.kind === 'gemini') for (const m of provider.fallbackModels || []) if (!chain.includes(m) && chain.length < 3) chain.push(m);
  const t0 = Date.now(); let last;
  for (let i = 0; i < chain.length; i++) {
    const left = budgetMs - (Date.now() - t0);
    if (i > 0 && left < 8000) break;
    try {
      const text = await once({ p: provider, model: chain[i], apiKey, prompt, json, fetchImpl, timeoutMs: Math.max(3000, Math.min(i === 0 ? timeoutMs : 20000, left)), lookup });
      return { text, model: chain[i], provider: provider.id, ...(i > 0 ? { fallbackFrom: model } : {}) };
    } catch (e) { last = e; if (!(provider.kind === 'gemini' && (e.upstream === 503 || e.upstream === 504))) throw e; }
  }
  throw last;
}

/** Bóc JSON từ câu trả lời (bỏ rào ``` và chữ thừa quanh dấu {}). */
function parseJsonLoose(text) {
  const s = String(text || '').replace(/```(?:json)?/gi, '').trim();
  try { return JSON.parse(s); } catch { /* thử cắt */ }
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a >= 0 && b > a) { try { return JSON.parse(s.slice(a, b + 1)); } catch { /* bỏ */ } }
  return null;
}

module.exports = { callAi, parseJsonLoose };
