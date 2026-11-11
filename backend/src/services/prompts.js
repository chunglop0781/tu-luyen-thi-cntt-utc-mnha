'use strict';
/**
 * Prompt chấm / phân tích AI RIÊNG của từng tài khoản (chuyển từ bản cũ luyen-thi-cntt-utc-mnha: GradingPrompt + promptService).
 * - Lưu trong repo DATA: u/<uid>/prompts.json (chỉ chủ tài khoản đọc/sửa được).
 * - kind = 'essay' (chấm tự luận) | 'quiz' (phân tích trắc nghiệm). Mỗi loại có thể có 1 prompt mặc định.
 * - Bài gắn `promptId` → dùng prompt đó; không gắn → prompt mặc định của loại; không có → mẫu dựng sẵn.
 * - Phần định dạng JSON trả về và quy tắc "nội dung là dữ liệu" LUÔN do hệ thống nối thêm, nên prompt tự viết không làm hỏng việc đọc kết quả.
 */
const { HttpError } = require('../http');
const { nowIso, isId, clampStr } = require('../util');

const MAX_PROMPTS = 30;
const MAX_CONTENT = 8000;
const KINDS = ['essay', 'quiz'];
const STRICTNESS = { lenient: 'dễ tính (ưu tiên ý đúng, bỏ qua lỗi nhỏ)', normal: 'bình thường', strict: 'nghiêm khắc (trừ điểm thiếu ý và sai thuật ngữ)' };

/** Biến hợp lệ cho từng loại. */
const PLACEHOLDERS = {
  essay: ['{đề_bài}', '{bài_làm}', '{lời_giải_mẫu}', '{rubric}', '{max_score}', '{strictness}', '{student_name}'],
  quiz: ['{đề_trắc_nghiệm}', '{bài_làm}', '{kết_quả}', '{max_score}', '{student_name}'],
};
/** Biến bắt buộc phải có (ít nhất một trong danh sách) để prompt có dữ liệu mà chấm. */
const REQUIRED = { essay: ['{bài_làm}'], quiz: ['{đề_trắc_nghiệm}', '{bài_làm}'] };

const DEFAULT_ESSAY_PROMPT = `Bạn là giảng viên chấm bài tự luận môn CNTT. Chấm công bằng, ngắn gọn, bằng tiếng Việt.
Thang điểm: 0–{max_score}. Mức độ chấm: {strictness}.
Sinh viên: {student_name}.

ĐỀ BÀI:
{đề_bài}

ĐÁP ÁN THAM KHẢO (chỉ để đối chiếu ý, không chép nguyên văn vào nhận xét):
{lời_giải_mẫu}

TIÊU CHÍ CHẤM:
{rubric}

BÀI LÀM CỦA SINH VIÊN:
{bài_làm}

Quy tắc: chỉ chấm dựa trên dữ liệu ở trên; không bịa lỗi; nhận xét cụ thể (ý nào đúng, ý nào thiếu/sai).`;

const DEFAULT_QUIZ_PROMPT = `Bạn là giảng viên hướng dẫn học tập. Dưới đây là đề trắc nghiệm (kèm đáp án đúng và giải thích sẵn có) và bài làm của sinh viên {student_name}.
Nhiệm vụ: phân tích những lỗ hổng kiến thức — chủ đề nào hay sai — để sinh viên biết đường học; và giải thích kỹ lý do sai của từng câu để hiểu, sau này tránh lặp lại.

ĐỀ, ĐÁP ÁN VÀ BÀI LÀM (câu đúng chỉ ghi rút gọn):
{đề_trắc_nghiệm}

KẾT QUẢ TỔNG HỢP:
{kết_quả}

Quy tắc:
- Chỉ dựa trên dữ liệu ở trên, không bịa câu hỏi hay đáp án. Câu đúng không cần giải thích lỗi.
- Với mỗi câu sai: sinh viên đã chọn gì, vì sao sai (nhầm khái niệm hay bước suy luận nào), đáp án đúng và cách nghĩ đúng, mẹo để không lặp lại.
- Gom các câu sai theo chủ đề; nêu rõ chủ đề nào sai nhiều nhất và nên ôn gì trước.
- Giọng văn thân thiện, khích lệ, dễ hiểu, bằng tiếng Việt. Nếu làm đúng hết thì khen và gợi ý hướng nâng cao.`;

const DEFAULTS = { essay: DEFAULT_ESSAY_PROMPT, quiz: DEFAULT_QUIZ_PROMPT };

const bad = (msg) => new HttpError(400, msg, 'VALIDATION');
const mustKind = (k) => { if (!KINDS.includes(k)) throw bad('Loại prompt không hợp lệ (essay hoặc quiz)'); return k; };

/** Các {biến} không nằm trong danh sách hợp lệ của loại prompt (gõ sai tên). */
function unknownPlaceholders(content, kind) {
  const found = String(content || '').match(/\{[^{}\n]{1,40}\}/g) || [];
  return [...new Set(found)].filter((p) => !PLACEHOLDERS[kind].includes(p));
}

/** Thay biến trong MỘT lượt: nội dung dữ liệu (đề, bài làm…) có chứa "{biến}" cũng không bị thay lần hai. */
function render(template, vars) {
  return String(template).replace(/\{[^{}\n]{1,40}\}/g, (m) => (Object.prototype.hasOwnProperty.call(vars, m) ? String(vars[m]) : m));
}

function sanitizePrompt(input, kind) {
  const name = clampStr(input.name, 100);
  if (!name) throw bad('Thiếu tên prompt');
  const content = clampStr(input.content, MAX_CONTENT + 1);
  if (!content) throw bad('Thiếu nội dung prompt');
  if (content.length > MAX_CONTENT) throw bad(`Nội dung prompt tối đa ${MAX_CONTENT} ký tự`);
  if (!REQUIRED[kind].some((p) => content.includes(p))) throw bad(`Prompt phải chứa biến ${REQUIRED[kind].join(' hoặc ')} để AI nhận được dữ liệu cần chấm`);
  const strictness = kind === 'essay' ? (STRICTNESS[input.strictness] ? input.strictness : 'normal') : 'normal';
  return { name, description: clampStr(input.description, 300), content, strictness, isDefault: input.isDefault === true };
}

function createPrompts({ store }) {
  const docPath = (uid) => `u/${uid}/prompts.json`;
  const empty = () => ({ prompts: [] });
  const sorted = (list) => [...list].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));

  async function list(uid, kind) {
    const r = await store.read('data', docPath(uid), { fresh: true });
    const all = (r && r.data && Array.isArray(r.data.prompts)) ? r.data.prompts : [];
    return sorted(kind ? all.filter((p) => p.kind === mustKind(kind)) : all);
  }

  /** Tạo mới hoặc sửa (id do client sinh → gửi lại không bị trùng). Loại (kind) không đổi được sau khi tạo. */
  async function upsert(uid, id, input = {}) {
    if (!isId(id)) throw bad('id không hợp lệ');
    const kind = mustKind(input.kind);
    const clean = sanitizePrompt(input, kind);
    let saved;
    await store.update('data', docPath(uid), (doc) => {
      doc.prompts = Array.isArray(doc.prompts) ? doc.prompts : [];
      const now = nowIso();
      const cur = doc.prompts.find((p) => p.id === id);
      if (cur && cur.kind !== kind) throw bad('Không đổi được loại prompt sau khi tạo');
      if (!cur && doc.prompts.length >= MAX_PROMPTS) throw new HttpError(400, `Tối đa ${MAX_PROMPTS} prompt mỗi tài khoản`, 'LIMIT');
      const next = { id, kind, ...clean, version: cur ? (cur.version || 1) + 1 : 1, createdAt: cur ? cur.createdAt : now, updatedAt: now };
      if (next.isDefault) for (const p of doc.prompts) if (p.kind === kind && p.id !== id) p.isDefault = false;   // mỗi loại chỉ một mặc định
      if (cur) Object.assign(cur, next); else doc.prompts.push(next);
      saved = next;
      return doc;
    }, { message: `prompt ${id}`, defaultValue: empty() });
    return { prompt: saved, unknownPlaceholders: unknownPlaceholders(saved.content, kind) };
  }

  async function remove(uid, id) {
    if (!isId(id)) throw bad('id không hợp lệ');
    let found = false;
    await store.update('data', docPath(uid), (doc) => {
      const n = (doc.prompts || []).length;
      doc.prompts = (doc.prompts || []).filter((p) => p.id !== id); found = doc.prompts.length < n;
      return found ? doc : undefined;
    }, { message: `delete prompt ${id}`, defaultValue: empty() });
    if (!found) throw new HttpError(404, 'Không tìm thấy prompt', 'NOT_FOUND');
  }

  /** Prompt dùng cho một bài của `ownerId`: prompt gắn với bài → mặc định của loại → null (dùng mẫu dựng sẵn). */
  async function resolve(ownerId, kind, promptId) {
    if (!isId(ownerId)) return null;
    const r = await store.read('data', docPath(ownerId));
    const all = (r && r.data && Array.isArray(r.data.prompts)) ? r.data.prompts.filter((p) => p.kind === kind) : [];
    return (promptId && all.find((p) => p.id === promptId)) || all.find((p) => p.isDefault) || null;
  }

  /** Bài chỉ được gắn prompt có thật và đúng loại. */
  async function assertUsable(uid, kind, promptId) {
    if (promptId == null || promptId === '') return null;
    if (!isId(promptId)) throw bad('Prompt không hợp lệ');
    const r = await store.read('data', docPath(uid), { fresh: true });
    const p = r && r.data && (r.data.prompts || []).find((x) => x.id === promptId && x.kind === kind);
    if (!p) throw bad('Prompt đã chọn không còn tồn tại (hoặc không đúng loại)');
    return promptId;
  }

  /** Prompt sẽ dùng cho một bài của CHÍNH người dùng + cấp gán ('item' = gắn riêng cho bài, 'default' = mặc định của tôi, 'fallback' = mẫu hệ thống). */
  async function info(uid, kind, promptId) {
    const r = await store.read('data', docPath(uid), { fresh: true });
    const all = (r && r.data && Array.isArray(r.data.prompts)) ? r.data.prompts.filter((p) => p.kind === kind) : [];
    const byItem = promptId ? all.find((p) => p.id === promptId) : null;
    const p = byItem || all.find((x) => x.isDefault) || null;
    if (!p) return { id: null, name: 'Mẫu mặc định của hệ thống', scope: 'fallback', unknownPlaceholders: [] };
    return { id: p.id, name: p.name, scope: byItem ? 'item' : 'default', unknownPlaceholders: unknownPlaceholders(p.content, kind) };
  }

  const meta = () => ({ placeholders: PLACEHOLDERS, defaults: DEFAULTS, strictness: STRICTNESS, maxPrompts: MAX_PROMPTS, maxContent: MAX_CONTENT });

  return { list, upsert, remove, resolve, info, assertUsable, meta };
}

module.exports = { createPrompts, render, unknownPlaceholders, sanitizePrompt, DEFAULT_ESSAY_PROMPT, DEFAULT_QUIZ_PROMPT, PLACEHOLDERS, STRICTNESS };
