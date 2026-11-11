'use strict';
/** Bài tự luận / trắc nghiệm / bài nộp của TỪNG tài khoản — repo DATA (private, không dọn commit). */
const { HttpError } = require('../http');
const { nowIso, isId, mapLimit, randomId } = require('../util');
const { sanitizeEssay, sanitizeFlashcard, sanitizeQuiz, rawTexts, imageRefs } = require('./validate');
const { suggestEssay } = require('./grading');
const { grade: gradeParts } = require('./quiz/grade');
const qcfg = require('./quiz/config');
const { gradeEssay } = require('./gemini');
const { callAi } = require('./ai');
const { analyzeQuiz } = require('./analysis');
const { createPrompts } = require('./prompts');
const { PRESETS, MAX_PROVIDERS, geminiProvider, normalizeProviderInput, sanitizeDocument, findProvider, safeModel, publicProvider, publicPresets } = require('../aiModels');
const { encryptText, decryptText, deriveKey } = require('../crypto');

const TYPES = { essay: 'essays', quiz: 'quizzes', flashcard: 'flashcards' };
const MAX_SUBS_IN_INDEX = 1000;
const MAX_SHARE_RESULTS = 4000;   // số kết quả tối đa lưu trong 1 bài chia sẻ
const MAX_ANALYSES = 5;            // số lần phân tích AI tối đa cho mỗi bài nộp trắc nghiệm
const ANALYSIS_COOLDOWN_MS = 30000; // giãn cách giữa 2 lần phân tích của cùng một bài nộp

function createContent({ cfg, store, images, fetchImpl, lookup }) {
  const base = (uid) => `u/${uid}`;
  const itemPath = (uid, type, id) => `${base(uid)}/${TYPES[type]}/${id}.json`;
  const subPath = (uid, id) => `${base(uid)}/submissions/${id}.json`;
  const indexPath = (uid) => `${base(uid)}/index.json`;
  const vaultPath = (uid) => `private/${uid}/vault.json`;
  const aiDocPath = (uid) => `AI-database/${uid}/index.json`;   // nhà cung cấp AI của TỪNG tài khoản (repo ACCOUNT, không chứa key)
  const emptyIndex = () => ({ items: {}, subs: [] });
  const prompts = createPrompts({ store });

  const mustId = (id) => { if (!isId(id)) throw new HttpError(400, 'id không hợp lệ', 'BAD_ID'); return id; };
  const mustType = (t) => { if (!TYPES[t]) throw new HttpError(400, 'Loại bài không hợp lệ', 'BAD_TYPE'); return t; };

  const summary = (it, prev = {}) => ({
    id: it.id, type: it.type, title: it.title, subject: it.subject, tags: it.tags,
    createdAt: it.createdAt, updatedAt: it.updatedAt,
    size: it.type === 'quiz' ? qcfg.PARTS.reduce((n, k) => n + ((it.parts && it.parts[k] && it.parts[k].questions.length) || 0), 0) : it.type === 'flashcard' ? ((it.cards && it.cards.length) || 0) : it.maxScore,
    attempts: prev.attempts || 0, bestPct: prev.bestPct == null ? null : prev.bestPct, lastAt: prev.lastAt || null,
    ...(prev.shareId ? { shareId: prev.shareId } : {}),
  });

  async function getIndex(uid) {
    const r = await store.read('data', indexPath(uid));
    return r ? r.data : emptyIndex();
  }

  async function overview(uid) {
    const idx = await getIndex(uid);
    const items = Object.values(idx.items).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    const subjects = [...new Set(items.map((i) => i.subject).filter(Boolean))].sort();
    const quizSubs = idx.subs.filter((s) => s.type === 'quiz');
    const avg = quizSubs.length ? Math.round(quizSubs.reduce((s, x) => s + x.pct, 0) / quizSubs.length) : null;
    const joined = new Map();   // bài người khác chia sẻ mà tôi đã làm (gom theo shareId)
    for (const x of idx.subs) {
      if (!x.shareId || idx.items[x.itemId]) continue;
      const j = joined.get(x.shareId) || { shareId: x.shareId, type: x.type, title: x.title, subject: x.subject, attempts: 0, bestPct: null, lastAt: x.at };
      j.attempts++; if (x.pct != null && (j.bestPct == null || x.pct > j.bestPct)) j.bestPct = x.pct;
      if (String(x.at) > String(j.lastAt)) j.lastAt = x.at;
      joined.set(x.shareId, j);
    }
    const flashcards = items.filter((i) => i.type === 'flashcard');
    const flashcardShared = [...joined.values()].filter((j) => j.type === 'flashcard');
    return { items, subjects, shared: [...joined.values()].sort((a, b) => String(b.lastAt).localeCompare(String(a.lastAt))),
      flashcards, flashcardShared, recent: idx.subs.slice(0, 8),
      stats: { essays: items.filter((i) => i.type === 'essay').length, quizzes: items.filter((i) => i.type === 'quiz').length, flashcards: flashcards.length, submissions: idx.subs.length, avgQuizPct: avg } };
  }

  /** shareId của một bài của mình (nếu đã chia sẻ) — để nút "Lịch sử làm bài" trỏ tới trang lịch sử của TẤT CẢ người làm. */
  async function shareIdOf(uid, id) {
    mustId(id);
    const idx = await getIndex(uid);
    const sid = idx.items && idx.items[id] && idx.items[id].shareId;
    return sid && isId(sid) ? sid : null;
  }

  async function getItem(uid, type, id) {
    mustType(type); mustId(id);
    const r = await store.read('data', itemPath(uid, type, id));
    if (!r) throw new HttpError(404, 'Không tìm thấy bài', 'NOT_FOUND');
    return type === 'quiz' && r.data.parts ? { ...r.data, raw: rawTexts(r.data) } : r.data;
  }

  async function putItem(uid, type, id, input) {
    mustType(type); mustId(id);
    const clean = type === 'essay' ? sanitizeEssay(input || {}) : type === 'flashcard' ? sanitizeFlashcard(input || {}) : sanitizeQuiz(input || {});
    clean.promptId = await prompts.assertUsable(uid, type, clean.promptId);   // chỉ gắn prompt có thật, đúng loại (null = dùng mặc định)
    const exist = await store.read('data', itemPath(uid, type, id), { fresh: true });
    const now = nowIso();
    const item = { id, ...clean, ownerId: uid, createdAt: exist ? exist.data.createdAt : now, updatedAt: now };
    if (Buffer.byteLength(JSON.stringify(item)) > 900 * 1024) throw new HttpError(413, 'Bài quá lớn (tối đa ~900KB)', 'TOO_LARGE');
    await store.write('data', itemPath(uid, type, id), item, `${type} ${id}`);
    await store.update('data', indexPath(uid), (idx) => { idx.items[id] = summary(item, idx.items[id]); return idx; }, { message: `index ${uid}`, defaultValue: emptyIndex() });
    // ảnh không còn được nhắc tới nữa → xoá
    if (exist) for (const old of exist.data.images || []) if (!item.images.includes(old)) images.remove(uid, old).catch(() => {});
    return item;
  }

  async function deleteItem(uid, type, id) {
    mustType(type); mustId(id);
    const exist = await store.read('data', itemPath(uid, type, id), { fresh: true });
    if (!exist) throw new HttpError(404, 'Không tìm thấy bài', 'NOT_FOUND');
    await store.remove('data', itemPath(uid, type, id), `delete ${type} ${id}`);
    await store.update('data', indexPath(uid), (idx) => { delete idx.items[id]; return idx; }, { message: `index ${uid}`, defaultValue: emptyIndex() });
    for (const img of exist.data.images || []) images.remove(uid, img).catch(() => {});
  }

  // ───────── Bài nộp ─────────
  async function submit(uid, id, input) {
    mustId(id);
    const type = mustType(input.itemType), itemId = mustId(input.itemId);
    const dup = await store.read('data', subPath(uid, id), { fresh: true });
    if (dup) return dup.data;                                        // client retry → idempotent
    const item = await getItem(uid, type, itemId);
    const sub = { id, ownerId: uid, type, itemId, title: item.title, subject: item.subject, submittedAt: nowIso(),
      startedAt: input.startedAt || null, durationSec: Math.max(0, Math.min(86400, Number(input.durationSec) || 0)) };
    let pct, scoreLabel;
    if (type === 'flashcard') {
      const total = Math.max(1, Math.min(500, Number(input.total) || item.cards.length));
      const ok = Math.max(0, Math.min(total, Number(input.ok) || 0));
      const score = Math.round((ok / total) * 100) / 10;
      Object.assign(sub, { score, max: 10, correctCount: ok, total, snapshot: { mode: item.mode, language: item.language, cards: item.cards } });
      pct = Math.round(score * 10);
    } else if (type === 'quiz') {
      const answers = sanitizeAnswers(item, input.answers);
      const result = gradeParts({ maxScore: item.maxScore, parts: item.parts }, answers);
      sub.answers = answers;
      Object.assign(sub, { score: result.score, max: result.maxScore, correctCount: result.correctCount, total: result.totalCount, result, snapshot: { maxScore: item.maxScore, parts: item.parts } });
      pct = result.maxScore ? Math.round((result.score / result.maxScore) * 100) : 0;
    } else {
      const text = String(input.text || '').slice(0, 30000);
      if (!text.trim()) throw new HttpError(400, 'Bài làm đang trống', 'VALIDATION');
      Object.assign(sub, { text, max: item.maxScore, suggestion: suggestEssay(item, text), selfScore: null, ai: null, note: '',
        snapshot: { prompt: item.prompt, modelAnswer: item.modelAnswer, rubric: item.rubric, maxScore: item.maxScore } });
      sub.score = null; pct = null;
    }
    if (Buffer.byteLength(JSON.stringify(sub)) > 950 * 1024) throw new HttpError(413, 'Bài nộp quá lớn', 'TOO_LARGE');
    try { await store.create('data', subPath(uid, id), sub, `submit ${id}`); }
    catch (e) { if (e.code === 'EXISTS') return (await store.read('data', subPath(uid, id), { fresh: true })).data; throw e; }
    await store.update('data', indexPath(uid), (idx) => {
      idx.subs.unshift(subSummary(sub, pct));
      idx.subs = idx.subs.slice(0, MAX_SUBS_IN_INDEX);
      const it = idx.items[itemId];
      if (it) { it.attempts = (it.attempts || 0) + 1; it.lastAt = sub.submittedAt; if (pct != null && (it.bestPct == null || pct > it.bestPct)) it.bestPct = pct; }
      return idx;
    }, { message: `index ${uid}`, defaultValue: emptyIndex() });
    return sub;
  }

  /** Chuẩn hoá đáp án gửi lên (chuyển từ bản cũ sanitizeAnswers): mcq = mảng khoá, tf = boolean theo từng ý, fill = chuỗi. */
  function sanitizeAnswers(quiz, raw) {
    const src = raw && typeof raw === 'object' ? raw : {}; const out = {};
    for (const k of qcfg.PARTS) {
      const p = quiz.parts && quiz.parts[k]; if (!p) continue;
      for (const q of p.questions) {
        if (k === 'tf') { for (const st of q.statements || []) if (typeof src[st.id] === 'boolean') out[st.id] = src[st.id]; continue; }
        const a = src[q.id]; if (a === undefined || a === null) continue;
        if (k === 'mcq') { const keys = new Set((q.options || []).map((o) => o.key)); const picked = (Array.isArray(a) ? a : [a]).map(String).filter((x) => keys.has(x)); if (picked.length) out[q.id] = [...new Set(picked)].sort(); }
        else if (typeof a === 'string' && a.trim()) out[q.id] = a.trim().slice(0, 300);
      }
    }
    return out;
  }

  const subSummary = (sub, pct) => ({ id: sub.id, type: sub.type, itemId: sub.itemId, title: sub.title, subject: sub.subject, at: sub.submittedAt, score: sub.score, max: sub.max, pct: pct == null ? null : pct, ...(sub.shareId ? { shareId: sub.shareId } : {}) });

  async function getSubmission(uid, id) {
    mustId(id);
    const r = await store.read('data', subPath(uid, id));
    if (!r) throw new HttpError(404, 'Không tìm thấy bài nộp', 'NOT_FOUND');
    return r.data;
  }

  async function listSubmissions(uid, { itemId, limit = 100 } = {}) {
    const idx = await getIndex(uid);
    let list = idx.subs; if (itemId) list = list.filter((s) => s.itemId === itemId);
    return list.slice(0, Math.min(500, limit));
  }

  async function patchIndexSub(uid, id, score, max) {
    const pct = max ? Math.round((score / max) * 100) : 0;
    await store.update('data', indexPath(uid), (idx) => {
      const s = idx.subs.find((x) => x.id === id); if (!s) return undefined;
      s.score = score; s.pct = pct;
      const it = idx.items[s.itemId]; if (it && (it.bestPct == null || pct > it.bestPct)) it.bestPct = pct;
      return idx;
    }, { message: `index ${uid}`, defaultValue: emptyIndex() });
  }

  /** Người dùng tự chấm tự luận (sau khi đối chiếu đáp án mẫu). */
  async function selfGrade(uid, id, { selfScore, note }) {
    const sub = await getSubmission(uid, id);
    if (sub.type !== 'essay') throw new HttpError(400, 'Chỉ bài tự luận mới tự chấm', 'BAD_TYPE');
    if (sub.shareId && selfScore !== null && selfScore !== undefined) throw new HttpError(403, 'Bài làm từ link chia sẻ không tự chấm điểm được — hãy dùng chấm AI', 'SHARED_LOCKED');
    const n = Number(selfScore);
    if (selfScore !== null && selfScore !== undefined && (Number.isNaN(n) || n < 0 || n > sub.max)) throw new HttpError(400, `Điểm phải trong 0–${sub.max}`, 'VALIDATION');
    const next = await store.update('data', subPath(uid, id), (s) => {
      if (selfScore !== null && selfScore !== undefined) { s.selfScore = n; s.score = n; }
      if (note !== undefined) s.note = String(note).slice(0, 3000);
      return s;
    }, { message: `grade ${id}` });
    if (next.score != null) await patchIndexSub(uid, id, next.score, next.max);
    return next;
  }

  /** Chọn nhà cung cấp + model + key để gọi AI (mặc định theo Cài đặt; có thể chọn riêng cho từng lần). */
  async function resolveAi(uid, wanted = {}) {
    const list = await userProviders(uid);
    const v = await readVault(uid, true, list);
    const p = findProvider(list, wanted.provider || v.provider);
    if (!p) throw new HttpError(400, 'Nhà cung cấp AI không hợp lệ — hãy thêm nhà cung cấp trong Cài đặt', 'AI_PROVIDER');
    if (p.enabled === false) throw new HttpError(400, `${p.label} đang tắt trong Cài đặt`, 'AI_PROVIDER');
    const apiKey = v.keys[p.id];
    if (!apiKey) throw new HttpError(400, `Chưa lưu API key ${p.label} trong Cài đặt`, 'NO_AI_KEY');
    const asked = typeof wanted.model === 'string' ? wanted.model.trim() : '';
    if (asked && safeModel(p, asked) !== asked) throw new HttpError(400, `Model "${asked}" không dùng được với ${p.label}`, 'AI_MODEL');
    return { provider: p, apiKey, model: safeModel(p, asked || v.items[p.id].model), keyName: v.items[p.id].name || '' };
  }

  /** Thử kết nối AI bằng một câu hỏi rất ngắn. */
  async function testAi(uid, wanted) {
    const { provider, apiKey, model, keyName } = await resolveAi(uid, wanted);
    const t0 = Date.now();
    const r = await callAi({ provider, model, apiKey, prompt: 'Reply only with the word OK.', fetchImpl, lookup, timeoutMs: 12000, budgetMs: 40000 });
    return { provider: provider.id, label: provider.label, ...(keyName ? { name: keyName } : {}), model: r.model, response: r.text.trim().slice(0, 60), ms: Date.now() - t0, ...(r.fallbackFrom ? { fallbackFrom: r.fallbackFrom } : {}) };
  }

  /** Prompt cho một bài nộp. Bài của chính mình: prompt gắn với bài → mặc định của mình. Bài từ link chia sẻ: prompt mà CHỦ BÀI đã gắn cho bài đó (không dùng prompt của người làm); không còn thì dùng mẫu dựng sẵn. */
  async function promptFor(uid, sub) {
    let owner = uid, itemId = sub.itemId;
    if (sub.shareId) {
      const r = isId(sub.shareId) ? await store.read('data', sharePath(sub.shareId)).catch(() => null) : null;
      if (!r) return null;
      owner = r.data.ownerId; itemId = r.data.itemId;
    }
    const it = isId(itemId) ? await store.read('data', itemPath(owner, sub.type, itemId)).catch(() => null) : null;
    return prompts.resolve(owner, sub.type, it && it.data.promptId).catch(() => null);
  }

  /** Chấm AI bài tự luận bằng nhà cung cấp + key của CHÍNH người nộp. Bài từ link chia sẻ chỉ được chấm một lần (không "chấm lại cho tới khi cao điểm") và điểm được đẩy lên biểu đồ chung. */
  async function aiGrade(uid, id, wanted = {}) {
    const sub = await getSubmission(uid, id);
    if (sub.type !== 'essay') throw new HttpError(400, 'Chỉ bài tự luận mới chấm AI', 'BAD_TYPE');
    const shared = sub.shareId && isId(sub.shareId) ? sub.shareId : null;
    const already = () => new HttpError(409, 'Bài làm từ link chia sẻ chỉ được chấm AI một lần', 'ALREADY_GRADED');
    if (shared && sub.ai) throw already();
    const { provider, apiKey, model, keyName } = await resolveAi(uid, wanted);
    const essay = { prompt: sub.snapshot.prompt, modelAnswer: sub.snapshot.modelAnswer, rubric: sub.snapshot.rubric, maxScore: sub.snapshot.maxScore };
    const pr = await promptFor(uid, sub);
    const ai = await gradeEssay({ provider, apiKey, model, essay, answer: sub.text, template: pr && pr.content, strictness: pr && pr.strictness, studentName: wanted.studentName, fetchImpl, lookup });
    ai.at = nowIso();
    if (keyName) ai.keyName = keyName;               // tên AI người dùng đặt — để sau này biết bài này do AI nào chấm
    if (pr && !shared) ai.promptName = pr.name;      // bài chia sẻ: không lộ tên/nội dung prompt của chủ bài
    const next = await store.update('data', subPath(uid, id), (s) => { if (shared && s.ai) throw already(); s.ai = ai; if (s.selfScore == null) s.score = ai.score; return s; }, { message: `ai-grade ${id}` });
    if (next.score != null) await patchIndexSub(uid, id, next.score, next.max);
    if (shared && next.score != null) await setResultScore(shared, { id, uid, n: String(wanted.studentName || '').slice(0, 60), at: next.submittedAt, score: next.score, max: next.max });
    return next;
  }

  /** Phân tích AI cho bài trắc nghiệm: lỗ hổng kiến thức, vì sao sai từng câu, kế hoạch ôn. Lưu vào sub.aiAnalyses. */
  async function aiAnalyze(uid, id, wanted = {}) {
    const sub = await getSubmission(uid, id);
    if (sub.type !== 'quiz') throw new HttpError(400, 'Chỉ bài trắc nghiệm mới phân tích AI', 'BAD_TYPE');
    const list = Array.isArray(sub.aiAnalyses) ? sub.aiAnalyses : [];
    if (list.length >= MAX_ANALYSES) throw new HttpError(429, `Đã phân tích tối đa ${MAX_ANALYSES} lần cho bài nộp này`, 'LIMIT');
    const last = list.length ? Date.parse(list[list.length - 1].at) : 0;
    if (last && Date.now() - last < ANALYSIS_COOLDOWN_MS) throw new HttpError(429, `Vui lòng chờ ${Math.ceil((ANALYSIS_COOLDOWN_MS - (Date.now() - last)) / 1000)} giây rồi thử lại`, 'COOLDOWN');
    const { provider, apiKey, model } = await resolveAi(uid, wanted);
    const pr = await promptFor(uid, sub);
    const out = await analyzeQuiz({ provider, apiKey, model, sub, studentName: wanted.studentName, template: pr && pr.content, fetchImpl, lookup });
    const entry = { id: `an_${Date.now()}`, at: nowIso(), ...out, ...(pr && !sub.shareId ? { promptName: pr.name } : {}) };
    const next = await store.update('data', subPath(uid, id), (s) => {
      const cur = Array.isArray(s.aiAnalyses) ? s.aiAnalyses : [];
      if (cur.length >= MAX_ANALYSES) throw new HttpError(429, `Đã phân tích tối đa ${MAX_ANALYSES} lần cho bài nộp này`, 'LIMIT');
      s.aiAnalyses = cur.concat([entry]); return s;
    }, { message: `ai-analyze ${id}` });
    return next;
  }

  async function deleteSubmission(uid, id) {
    const sub = await getSubmission(uid, id);
    // Bài nộp qua link chia sẻ đã nằm trong biểu đồ chung → không cho xoá (như luyen-thi), để điểm không biến mất.
    if (sub.shareId) throw new HttpError(403, 'Bài nộp từ link chia sẻ không xoá được — điểm đã nằm trong biểu đồ chung', 'SHARED_LOCKED');
    await store.remove('data', subPath(uid, id), `delete sub ${id}`);
    await store.update('data', indexPath(uid), (idx) => { idx.subs = idx.subs.filter((s) => s.id !== id); return idx; }, { message: `index ${uid}`, defaultValue: emptyIndex() });
  }


  // ───────── Chia sẻ bài (trắc nghiệm + tự luận) ─────────
  // shares/<shareId>.json (repo DATA): { id, ownerId, itemId, type, title, subject, enabled, createdAt, results: [{ id, uid, n, at, score, max }] }
  // Người làm: bài nộp lưu trong kho riêng của họ (u/<uid>/submissions) + 1 dòng kết quả trong file chia sẻ để dựng biểu đồ.
  const sharePath = (sid) => `shares/${sid}.json`;
  const shareRefPath = (uid, itemId) => `${base(uid)}/shares/${itemId}.json`;   // { shareId } — chủ bài tra ngược item → link
  const round2 = (n) => Math.round(n * 100) / 100;

  async function loadShare(sid, uid, { ownerOnly = false, needEnabled = true } = {}) {
    mustId(sid);
    const r = await store.read('data', sharePath(sid));
    if (!r) throw new HttpError(404, 'Link chia sẻ không tồn tại', 'NOT_FOUND');
    const doc = r.data, isOwner = doc.ownerId === uid;
    if (ownerOnly && !isOwner) throw new HttpError(404, 'Link chia sẻ không tồn tại', 'NOT_FOUND');
    if (needEnabled && !isOwner && doc.enabled === false) throw new HttpError(404, 'Chủ bài đã tắt chia sẻ', 'SHARE_OFF');
    return { doc, isOwner };
  }

  const shareType = (doc) => (doc.type === 'essay' ? 'essay' : doc.type === 'flashcard' ? 'flashcard' : 'quiz');
  async function sharedItem(doc) {
    const r = await store.read('data', itemPath(doc.ownerId, shareType(doc), doc.itemId));
    if (!r) throw new HttpError(404, 'Bài này đã bị chủ bài xoá', 'NOT_FOUND');
    return r.data;
  }

  /** Bỏ đáp án + giải thích trước khi gửi cho người làm (đáp án chỉ trả sau khi nộp). */
  function studentItem(item) {
    if (item.type === 'essay') {     // tự luận: chỉ đề bài — đáp án mẫu + tiêu chí chỉ trả về trong bài nộp của chính người làm
      return { id: item.id, type: 'essay', title: item.title, subject: item.subject, prompt: item.prompt, maxScore: item.maxScore, duration: item.duration === undefined ? null : item.duration, updatedAt: item.updatedAt };
    }
    if (item.type === 'flashcard') {
      return { id: item.id, type: 'flashcard', title: item.title, subject: item.subject, description: item.description || '', mode: item.mode, language: item.language, updatedAt: item.updatedAt,
        cards: (item.cards || []).map((c) => ({ id: c.id, front: c.front, back: c.back, ipa: c.ipa || '', image: c.image || '' })) };
    }
    const out = { id: item.id, type: 'quiz', title: item.title, subject: item.subject, contentHtml: item.contentHtml || '', duration: item.duration === undefined ? 20 : item.duration, shuffle: !!item.shuffle, maxScore: item.maxScore, updatedAt: item.updatedAt, parts: {} };
    if (item.audioUrl) out.audioUrl = item.audioUrl;
    for (const k of qcfg.PARTS) {
      const p = item.parts && item.parts[k]; if (!p) continue;
      out.parts[k] = { ...p, questions: (p.questions || []).map((q) => {
        const { correct, answers, explanationHtml, ...rest } = q;
        if (rest.statements) rest.statements = rest.statements.map((st) => { const { correct: c, explanationHtml: e, ...r } = st; return r; });
        return rest;
      }) };
    }
    return out;
  }

  async function createShare(uid, type, itemId) {
    if (type !== 'quiz' && type !== 'essay' && type !== 'flashcard') throw new HttpError(400, 'Loại bài không chia sẻ được', 'BAD_TYPE');
    mustId(itemId);
    const item = await getItem(uid, type, itemId);
    const ref = await store.read('data', shareRefPath(uid, itemId), { fresh: true });
    let sid = ref && ref.data.shareId;
    if (sid && isId(sid)) {
      const cur = await store.update('data', sharePath(sid), (d) => { if (!d) return undefined; d.enabled = true; d.title = item.title; d.subject = item.subject; return d; }, { message: `share ${sid}` });
      if (cur) return { shareId: sid, enabled: true };
    }
    sid = randomId(12);
    await store.create('data', sharePath(sid), { id: sid, ownerId: uid, itemId, type, title: item.title, subject: item.subject, enabled: true, createdAt: nowIso(), results: [] }, `share ${sid}`);
    await store.write('data', shareRefPath(uid, itemId), { shareId: sid }, `share-ref ${itemId}`);
    await store.update('data', indexPath(uid), (idx) => { if (idx.items[itemId]) idx.items[itemId].shareId = sid; return idx; }, { message: `index ${uid}`, defaultValue: emptyIndex() });
    return { shareId: sid, enabled: true };
  }

  /** Link kiểu /lessons/<itemId>/share?id=<ownerId>: tra ngược (chủ bài, bài) → shareId. Vẫn phải đăng nhập; tắt chia sẻ thì người khác không vào được. */
  async function resolveShare(uid, ownerId, itemId) {
    mustId(ownerId); mustId(itemId);
    const ref = await store.read('data', shareRefPath(ownerId, itemId));
    const sid = ref && ref.data && ref.data.shareId;
    if (!sid || !isId(sid)) throw new HttpError(404, 'Link chia sẻ không tồn tại', 'NOT_FOUND');
    await loadShare(sid, uid);     // 404 nếu chủ bài đã tắt chia sẻ (chủ bài thì luôn vào được)
    return { shareId: sid };
  }

  async function setShareEnabled(uid, sid, enabled) {
    await loadShare(sid, uid, { ownerOnly: true, needEnabled: false });
    await store.update('data', sharePath(sid), (d) => { d.enabled = !!enabled; return d; }, { message: `share ${sid}` });
    return { shareId: sid, enabled: !!enabled };
  }

  async function getShared(uid, sid) {
    const { doc, isOwner } = await loadShare(sid, uid);
    const item = await sharedItem(doc);
    return { share: { id: sid, itemId: doc.itemId, type: shareType(doc), title: item.title, subject: item.subject, isOwner, enabled: doc.enabled !== false, createdAt: doc.createdAt }, item: studentItem(item) };
  }

  /** Ảnh trong đề chia sẻ: chỉ trả ảnh thực sự nằm trong đề, giải mã bằng khoá của chủ bài. */
  async function sharedImage(uid, sid, imageId) {
    const { doc } = await loadShare(sid, uid);
    const item = await sharedItem(doc);
    if (!(item.images || []).includes(imageId)) throw new HttpError(404, 'Không có ảnh', 'NOT_FOUND');
    return images.download(doc.ownerId, imageId);
  }

  async function recordResult(sid, entry) {
    await store.update('data', sharePath(sid), (d) => {
      if (!d) return undefined;
      d.results = d.results || [];
      if (d.results.some((r) => r.id === entry.id && r.uid === entry.uid)) return undefined;
      d.results.push(entry);
      if (d.results.length > MAX_SHARE_RESULTS) d.results = d.results.slice(-MAX_SHARE_RESULTS);
      return d;
    }, { message: `share ${sid}` });
  }

  /** Cập nhật điểm của một lượt nộp trên biểu đồ chung (khi AI chấm xong bài tự luận); chưa có dòng thì thêm. */
  async function setResultScore(sid, entry) {
    await store.update('data', sharePath(sid), (d) => {
      if (!d) return undefined;
      d.results = d.results || [];
      const r = d.results.find((x) => x.id === entry.id && x.uid === entry.uid);
      if (r) { r.score = entry.score; r.max = entry.max; if (!r.n && entry.n) r.n = entry.n; }
      else d.results.push(entry);
      if (d.results.length > MAX_SHARE_RESULTS) d.results = d.results.slice(-MAX_SHARE_RESULTS);
      return d;
    }, { message: `share ${sid}` });
  }

  /** Nộp bài chia sẻ: chấm bằng đề của chủ bài, lưu bài nộp vào kho CỦA NGƯỜI LÀM, thêm 1 điểm vào biểu đồ chung. */
  async function submitShared(uid, name, sid, id, input = {}) {
    mustId(id);
    const { doc } = await loadShare(sid, uid);
    const dup = await store.read('data', subPath(uid, id), { fresh: true });
    if (dup) {
      if (dup.data.shareId !== sid) throw new HttpError(409, 'Mã bài nộp đã được dùng', 'EXISTS');
      await recordResult(sid, { id, uid, n: String(name || '').slice(0, 60), at: dup.data.submittedAt, score: dup.data.score, max: dup.data.max });
      return dup.data;                                              // client retry → idempotent
    }
    const item = await sharedItem(doc);
    const common = { id, ownerId: uid, itemId: doc.itemId, shareId: sid, title: item.title, subject: item.subject, submittedAt: nowIso(),
      startedAt: input.startedAt || null, durationSec: Math.max(0, Math.min(86400, Number(input.durationSec) || 0)) };
    let sub, pct;
    if (shareType(doc) === 'essay') {
      // Tự luận: KHÔNG chấm lúc nộp. Người làm tự bấm "Chấm bằng AI".
      const text = String(input.text || '').slice(0, 30000);
      if (!text.trim()) throw new HttpError(400, 'Bài làm đang trống', 'VALIDATION');
      sub = { ...common, type: 'essay', text, score: null, max: item.maxScore, selfScore: null, ai: null, note: '',
        snapshot: { prompt: item.prompt, modelAnswer: item.modelAnswer, rubric: item.rubric, maxScore: item.maxScore } };
      pct = null;
    } else if (shareType(doc) === 'flashcard') {
      const total = Math.max(1, Math.min(500, Number(input.total) || item.cards.length));
      const ok = Math.max(0, Math.min(total, Number(input.ok) || 0));
      const score = Math.round((ok / total) * 100) / 10;
      sub = { ...common, type: 'flashcard', ok, total, score, max: 10, correctCount: ok, snapshot: { mode: item.mode, language: item.language, cards: item.cards } };
      pct = Math.round(score * 10);
    } else {
      const answers = sanitizeAnswers(item, input.answers);
      const result = gradeParts({ maxScore: item.maxScore, parts: item.parts }, answers);
      sub = { ...common, type: 'quiz', answers, score: result.score, max: result.maxScore, correctCount: result.correctCount, total: result.totalCount, result, snapshot: { maxScore: item.maxScore, parts: item.parts } };
      pct = result.maxScore ? Math.round((result.score / result.maxScore) * 100) : 0;
    }
    if (Buffer.byteLength(JSON.stringify(sub)) > 950 * 1024) throw new HttpError(413, 'Bài nộp quá lớn', 'TOO_LARGE');
    try { await store.create('data', subPath(uid, id), sub, `submit ${id}`); }
    catch (e) { if (e.code === 'EXISTS') return (await store.read('data', subPath(uid, id), { fresh: true })).data; throw e; }
    await store.update('data', indexPath(uid), (idx) => {
      idx.subs.unshift(subSummary(sub, pct)); idx.subs = idx.subs.slice(0, MAX_SUBS_IN_INDEX);
      const it = idx.items[doc.itemId]; if (it) { it.attempts = (it.attempts || 0) + 1; it.lastAt = sub.submittedAt; if (pct != null && (it.bestPct == null || pct > it.bestPct)) it.bestPct = pct; }
      return idx;
    }, { message: `index ${uid}`, defaultValue: emptyIndex() });
    await recordResult(sid, { id, uid, n: String(name || '').slice(0, 60), at: sub.submittedAt, score: sub.score, max: sub.max });
    return sub;
  }

  /** Lịch sử + biểu đồ. Chủ bài: thấy tên từng người. Người làm: chỉ thấy bài + điểm của mình; điểm người khác ẩn danh. */
  async function sharedHistory(uid, sid) {
    const { doc, isOwner } = await loadShare(sid, uid);
    const allResults = (doc.results || []).filter(Boolean);
    const results = allResults.filter((r) => r.score != null);     // chỉ lượt đã có điểm mới lên biểu đồ
    const points = results.map((r) => {
      const t = Date.parse(r.at); const max = Number(r.max) || 10, raw = Number(r.score);
      const mine = r.uid === uid;
      const pt = { t, s: round2(Math.max(0, Math.min(10, (raw / max) * 10))), raw, max, q: shareType(doc) === 'quiz' ? 1 : 0, m: mine ? 1 : 0 };
      if (isOwner) pt.n = r.n || '';
      else if (mine) pt.id = r.id;
      return pt;
    }).filter((p) => !Number.isNaN(p.t)).sort((a, b) => a.t - b.t).slice(-5000);
    const rows = allResults.filter((r) => isOwner || r.uid === uid).map((r) => ({ id: isOwner ? undefined : r.id, n: isOwner ? r.n : undefined, at: r.at, score: r.score == null ? null : r.score, max: r.max })).sort((a, b) => String(b.at).localeCompare(String(a.at)));
    const scored = rows.filter((r) => r.score != null).map((r) => (r.max ? (r.score / r.max) * 10 : 0));
    return {
      share: { id: sid, itemId: doc.itemId, type: shareType(doc), title: doc.title, subject: doc.subject, isOwner, enabled: doc.enabled !== false },
      stats: { total: rows.length, pending: rows.filter((r) => r.score == null).length, students: isOwner ? new Set(allResults.map((r) => r.uid)).size : undefined, best: scored.length ? round2(Math.max(...scored)) : null },
      points, rows: rows.slice(0, 300),
    };
  }

  // ───────── Kho riêng tư (repo ACCOUNT) ─────────
  const vkey = () => deriveKey(cfg.encKey, 'vault');
  const KEY_RE = /^[\x21-\x7e]{8,300}$/;

  // ───────── Nhà cung cấp AI của từng tài khoản: AI-database/<uid>/index.json ─────────
  /** Đọc danh sách (đã chuẩn hoá, luôn có Gemini). Tài khoản cũ chưa có file → dựng từ các key đã lưu rồi ghi file. */
  async function userProviders(uid) {
    const r = await store.read('account', aiDocPath(uid));
    if (r) return sanitizeDocument(r.data, cfg).providers;
    const v = await store.read('account', vaultPath(uid)); const d = v ? v.data : {};
    const seeded = { version: 1, updatedAt: nowIso(), providers: [] };
    for (const pr of PRESETS) if ((d.keys && d.keys[pr.id]) || (d.models && d.models[pr.id])) {
      const n = normalizeProviderInput(pr); if (n.value) seeded.providers.push(n.value);
    }
    try { await store.create('account', aiDocPath(uid), seeded, `ai-database ${uid}`); } catch (e) { if (e.code !== 'EXISTS') throw e; }
    return sanitizeDocument(seeded, cfg).providers;
  }
  const saveAiDoc = (uid, providers) => store.write('account', aiDocPath(uid), { version: 1, updatedAt: nowIso(), providers: providers.filter((p) => !p.builtin) }, `ai-database ${uid}`);

  async function aiProviders(uid) {
    const list = await userProviders(uid);
    return { providers: list.map(publicProvider), presets: publicPresets(), max: MAX_PROVIDERS };
  }

  /** Thêm (id=null) hoặc sửa nhà cung cấp kiểu OpenAI. */
  async function saveProvider(uid, id, input = {}) {
    const list = await userProviders(uid);
    const prev = id ? findProvider(list, id) : null;
    if (id && !prev) throw new HttpError(404, 'Không tìm thấy nhà cung cấp', 'NOT_FOUND');
    if (prev && prev.builtin) throw new HttpError(400, 'Google Gemini là nhà cung cấp dựng sẵn, không sửa được', 'AI_PROVIDER');
    if (!prev && list.length >= MAX_PROVIDERS) throw new HttpError(400, `Tối đa ${MAX_PROVIDERS} nhà cung cấp`, 'LIMIT');
    const n = normalizeProviderInput(input, prev);
    if (!n.value) throw new HttpError(400, n.errors[0], 'VALIDATION');
    if (!prev && findProvider(list, n.value.id)) throw new HttpError(409, `Mã "${n.value.id}" đã tồn tại`, 'EXISTS');
    const next = prev ? list.map((p) => (p.id === prev.id ? n.value : p)) : list.concat([n.value]);
    await saveAiDoc(uid, next);
    return publicProvider(n.value);
  }

  async function deleteProvider(uid, id) {
    const list = await userProviders(uid); const prev = findProvider(list, id);
    if (!prev) throw new HttpError(404, 'Không tìm thấy nhà cung cấp', 'NOT_FOUND');
    if (prev.builtin) throw new HttpError(400, 'Không xoá được Google Gemini (dựng sẵn)', 'AI_PROVIDER');
    await saveAiDoc(uid, list.filter((p) => p.id !== prev.id));
    await store.update('account', vaultPath(uid), (d) => {      // xoá luôn key + model đã lưu cho nhà này
      if (!d) return undefined; if (d.keys) delete d.keys[prev.id]; if (d.models) delete d.models[prev.id]; if (d.names) delete d.names[prev.id]; if (d.provider === prev.id) d.provider = 'gemini'; return d;
    }, { message: `vault ${uid}` });
  }

  async function readVault(uid, withSecret = false, list = null) {
    list = list || await userProviders(uid);
    const r = await store.read('account', vaultPath(uid));
    const d = r ? r.data : {};
    const items = {}, keys = {};
    for (const p of list) {
      const enc = (d.keys && d.keys[p.id]) || (p.id === 'gemini' ? d.geminiKeyEnc : '');   // d.geminiKeyEnc: dữ liệu bản cũ
      let key = '';
      if (enc) { try { key = decryptText(vkey(), enc, uid); } catch { key = ''; } }
      items[p.id] = { keySet: !!key, model: (d.models && d.models[p.id]) || (p.id === 'gemini' ? d.geminiModel : '') || '', name: (d.names && d.names[p.id]) || '' };   // name = tên AI do người dùng đặt (để tìm lại)
      if (key) keys[p.id] = key;
    }
    const provider = findProvider(list, d.provider) ? d.provider : 'gemini';
    const out = { provider, items, geminiKeySet: items.gemini.keySet, geminiModel: items.gemini.model, notes: d.notes || '', updatedAt: d.updatedAt || null };
    if (withSecret) out.keys = keys;
    return out;
  }

  /** Nhận { provider, providers: { <id>: { key?, model? } }, notes } — hoặc dạng cũ { geminiKey, geminiModel }. Key rỗng '' = xoá key. */
  async function writeVault(uid, body = {}) {
    const list = await userProviders(uid);
    const upd = {};
    for (const [id, v] of Object.entries(body.providers && typeof body.providers === 'object' ? body.providers : {})) upd[id] = v && typeof v === 'object' ? { ...v } : {};
    if (body.geminiKey !== undefined) upd.gemini = { ...(upd.gemini || {}), key: body.geminiKey };
    if (body.geminiModel !== undefined) upd.gemini = { ...(upd.gemini || {}), model: body.geminiModel };
    for (const [id, v] of Object.entries(upd)) {
      const p = findProvider(list, id); if (!p) throw new HttpError(400, `Nhà cung cấp AI "${id}" chưa được thêm trong Cài đặt`, 'AI_PROVIDER');
      if (v.key) { const k = String(v.key).trim(); if (!KEY_RE.test(k)) throw new HttpError(400, `API key ${p.label} không hợp lệ (8–300 ký tự, không có khoảng trắng)`, 'VALIDATION'); v.key = k; }
      if (v.name !== undefined) {                                   // Tên AI: tự đặt / sửa, tối đa 60 ký tự, '' = xoá tên
        const nm = String(v.name == null ? '' : v.name).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
        if (nm.length > 60) throw new HttpError(400, 'Tên AI tối đa 60 ký tự', 'VALIDATION');
        v.name = nm;
      }
      if (v.model !== undefined) {
        const m = String(v.model || '').trim();
        if (m && safeModel(p, m) !== m) throw new HttpError(400, `Model "${m}" không dùng được với ${p.label}`, 'AI_MODEL');
        v.model = m;
      }
    }
    if (body.provider !== undefined && !findProvider(list, body.provider)) throw new HttpError(400, 'Nhà cung cấp AI không hợp lệ', 'AI_PROVIDER');
    await store.update('account', vaultPath(uid), (d) => {
      d = d || {}; d.keys = d.keys || {}; d.models = d.models || {}; d.names = d.names || {};
      if (d.geminiKeyEnc && !d.keys.gemini) d.keys.gemini = d.geminiKeyEnc;       // chuyển dữ liệu bản cũ
      if (d.geminiModel && d.models.gemini === undefined) d.models.gemini = d.geminiModel;
      delete d.geminiKeyEnc; delete d.geminiModel;
      for (const [id, v] of Object.entries(upd)) {
        if (v.key !== undefined) { if (v.key === '' || v.key === null) delete d.keys[id]; else d.keys[id] = encryptText(vkey(), v.key, uid); }
        if (v.model !== undefined) { if (v.model) d.models[id] = v.model; else delete d.models[id]; }
        if (v.name !== undefined) { if (v.name) d.names[id] = v.name; else delete d.names[id]; }
      }
      if (body.provider !== undefined) d.provider = String(body.provider).toLowerCase();
      if (body.notes !== undefined) d.notes = String(body.notes).slice(0, 5000);
      d.updatedAt = nowIso();
      return d;
    }, { message: `vault ${uid}`, defaultValue: {} });
    return readVault(uid, false, list);
  }

  /** Dựng lại index từ thư mục (khi index mất/hỏng). */
  async function reindex(uid) {
    const idx = emptyIndex();
    for (const type of Object.keys(TYPES)) {
      const files = await store.list('data', `${base(uid)}/${TYPES[type]}`);
      await mapLimit(files.filter((f) => f.name.endsWith('.json')), 5, async (f) => {
        const r = await store.read('data', f.path, { fresh: true }); if (r) idx.items[r.data.id] = summary(r.data);
      });
    }
    const subs = await store.list('data', `${base(uid)}/submissions`);
    const loaded = await mapLimit(subs.filter((f) => f.name.endsWith('.json')), 5, async (f) => (await store.read('data', f.path, { fresh: true }) || {}).data);
    for (const s of loaded.filter(Boolean)) {
      const pct = s.score != null && s.max ? Math.round((s.score / s.max) * 100) : null;
      idx.subs.push(subSummary(s, pct));
      const it = idx.items[s.itemId]; if (it) { it.attempts++; it.lastAt = it.lastAt && it.lastAt > s.submittedAt ? it.lastAt : s.submittedAt; if (pct != null && (it.bestPct == null || pct > it.bestPct)) it.bestPct = pct; }
    }
    idx.subs.sort((a, b) => String(b.at).localeCompare(String(a.at)));
    await store.write('data', indexPath(uid), idx, `reindex ${uid}`);
    return idx;
  }

  async function exportAll(uid) {
    const ov = await overview(uid);
    const items = await mapLimit(ov.items.slice(0, 400), 5, (i) => getItem(uid, i.type, i.id).catch(() => null));
    const subs = await mapLimit(ov.recent.length ? (await getIndex(uid)).subs.slice(0, 300) : [], 5, (s) => getSubmission(uid, s.id).catch(() => null));
    return { exportedAt: nowIso(), items: items.filter(Boolean), submissions: subs.filter(Boolean), prompts: await prompts.list(uid).catch(() => []) };
  }

  return { prompts, overview, shareIdOf, getItem, putItem, deleteItem, submit, getSubmission, listSubmissions, selfGrade, aiGrade, aiAnalyze, deleteSubmission, readVault, writeVault, resolveAi, testAi, aiProviders, saveProvider, deleteProvider, reindex, exportAll, imageRefs, createShare, resolveShare, setShareEnabled, getShared, sharedImage, submitShared, sharedHistory };
}

module.exports = { createContent };
