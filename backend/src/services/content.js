'use strict';
/** Bài tự luận / trắc nghiệm / bài nộp của TỪNG tài khoản — repo DATA (private, không dọn commit). */
const { HttpError } = require('../http');
const { nowIso, isId, mapLimit } = require('../util');
const { sanitizeEssay, sanitizeQuiz, imageRefs } = require('./validate');
const { gradeQuiz, suggestEssay } = require('./grading');
const { gradeEssay } = require('./gemini');
const { encryptText, decryptText, deriveKey } = require('../crypto');

const TYPES = { essay: 'essays', quiz: 'quizzes' };
const MAX_SUBS_IN_INDEX = 1000;

function createContent({ cfg, store, images, fetchImpl }) {
  const base = (uid) => `u/${uid}`;
  const itemPath = (uid, type, id) => `${base(uid)}/${TYPES[type]}/${id}.json`;
  const subPath = (uid, id) => `${base(uid)}/submissions/${id}.json`;
  const indexPath = (uid) => `${base(uid)}/index.json`;
  const vaultPath = (uid) => `private/${uid}/vault.json`;
  const emptyIndex = () => ({ items: {}, subs: [] });

  const mustId = (id) => { if (!isId(id)) throw new HttpError(400, 'id không hợp lệ', 'BAD_ID'); return id; };
  const mustType = (t) => { if (!TYPES[t]) throw new HttpError(400, 'Loại bài không hợp lệ', 'BAD_TYPE'); return t; };

  const summary = (it, prev = {}) => ({
    id: it.id, type: it.type, title: it.title, subject: it.subject, tags: it.tags,
    createdAt: it.createdAt, updatedAt: it.updatedAt,
    size: it.type === 'quiz' ? it.questions.length : it.maxScore,
    attempts: prev.attempts || 0, bestPct: prev.bestPct == null ? null : prev.bestPct, lastAt: prev.lastAt || null,
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
    return { items, subjects, recent: idx.subs.slice(0, 8), stats: { essays: items.filter((i) => i.type === 'essay').length, quizzes: items.filter((i) => i.type === 'quiz').length, submissions: idx.subs.length, avgQuizPct: avg } };
  }

  async function getItem(uid, type, id) {
    mustType(type); mustId(id);
    const r = await store.read('data', itemPath(uid, type, id));
    if (!r) throw new HttpError(404, 'Không tìm thấy bài', 'NOT_FOUND');
    return r.data;
  }

  async function putItem(uid, type, id, input) {
    mustType(type); mustId(id);
    const clean = type === 'essay' ? sanitizeEssay(input || {}) : sanitizeQuiz(input || {});
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
    if (type === 'quiz') {
      const g = gradeQuiz(item, input.answers);
      sub.answers = input.answers && typeof input.answers === 'object' ? input.answers : {};
      Object.assign(sub, { score: g.score, max: g.max, correctCount: g.correctCount, total: g.total, results: g.results });
      sub.snapshot = item.questions.map((q) => ({ id: q.id, text: q.text, options: q.options, correct: q.correct, explanation: q.explanation, points: q.points }));
      pct = g.max ? Math.round((g.score / g.max) * 100) : 0;
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

  const subSummary = (sub, pct) => ({ id: sub.id, type: sub.type, itemId: sub.itemId, title: sub.title, subject: sub.subject, at: sub.submittedAt, score: sub.score, max: sub.max, pct: pct == null ? null : pct });

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

  async function aiGrade(uid, id) {
    const sub = await getSubmission(uid, id);
    if (sub.type !== 'essay') throw new HttpError(400, 'Chỉ bài tự luận mới chấm AI', 'BAD_TYPE');
    const v = await readVault(uid, true);
    if (!v.geminiKey) throw new HttpError(400, 'Chưa lưu Gemini API key trong Cài đặt', 'NO_AI_KEY');
    const essay = { prompt: sub.snapshot.prompt, modelAnswer: sub.snapshot.modelAnswer, rubric: sub.snapshot.rubric, maxScore: sub.snapshot.maxScore };
    const ai = await gradeEssay({ apiKey: v.geminiKey, model: v.geminiModel || cfg.geminiModel, essay, answer: sub.text, fetchImpl });
    ai.at = nowIso();
    const next = await store.update('data', subPath(uid, id), (s) => { s.ai = ai; if (s.selfScore == null) s.score = ai.score; return s; }, { message: `ai-grade ${id}` });
    if (next.score != null) await patchIndexSub(uid, id, next.score, next.max);
    return next;
  }

  async function deleteSubmission(uid, id) {
    await getSubmission(uid, id);
    await store.remove('data', subPath(uid, id), `delete sub ${id}`);
    await store.update('data', indexPath(uid), (idx) => { idx.subs = idx.subs.filter((s) => s.id !== id); return idx; }, { message: `index ${uid}`, defaultValue: emptyIndex() });
  }

  // ───────── Kho riêng tư (repo ACCOUNT) ─────────
  const vkey = () => deriveKey(cfg.encKey, 'vault');
  async function readVault(uid, withSecret = false) {
    const r = await store.read('account', vaultPath(uid));
    const d = r ? r.data : {};
    let geminiKey = '';
    if (d.geminiKeyEnc) { try { geminiKey = decryptText(vkey(), d.geminiKeyEnc, uid); } catch { geminiKey = ''; } }
    const out = { geminiModel: d.geminiModel || '', geminiKeySet: !!geminiKey, notes: d.notes || '', updatedAt: d.updatedAt || null };
    if (withSecret) out.geminiKey = geminiKey;
    return out;
  }

  async function writeVault(uid, { geminiKey, geminiModel, notes }) {
    await store.update('account', vaultPath(uid), (d) => {
      d = d || {};
      if (geminiKey !== undefined) { if (geminiKey === '') delete d.geminiKeyEnc; else d.geminiKeyEnc = encryptText(vkey(), String(geminiKey).trim().slice(0, 200), uid); }
      if (geminiModel !== undefined) d.geminiModel = String(geminiModel).trim().slice(0, 80);
      if (notes !== undefined) d.notes = String(notes).slice(0, 5000);
      d.updatedAt = nowIso();
      return d;
    }, { message: `vault ${uid}`, defaultValue: {} });
    return readVault(uid);
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
    return { exportedAt: nowIso(), items: items.filter(Boolean), submissions: subs.filter(Boolean) };
  }

  return { overview, getItem, putItem, deleteItem, submit, getSubmission, listSubmissions, selfGrade, aiGrade, deleteSubmission, readVault, writeVault, reindex, exportAll, imageRefs };
}

module.exports = { createContent };
