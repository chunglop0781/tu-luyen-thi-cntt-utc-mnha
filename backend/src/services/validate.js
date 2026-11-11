'use strict';
const { HttpError } = require('../http');
const { clampStr, isId, randomId } = require('../util');

const bad = (msg) => new HttpError(400, msg, 'VALIDATION');
const IMG_TOKEN = /\[img:([0-9]+\.[a-f0-9]{16,32})\]/g;

/** Lấy mọi id ảnh được nhắc tới trong các chuỗi. */
function imageRefs(...texts) {
  const out = new Set();
  for (const t of texts) { if (!t) continue; for (const m of String(t).matchAll(IMG_TOKEN)) out.add(m[1]); }
  return [...out];
}

function common(input, type) {
  const title = clampStr(input.title, 200);
  if (!title) throw bad('Thiếu tiêu đề');
  return { type, title, subject: clampStr(input.subject, 60), tags: (Array.isArray(input.tags) ? input.tags : []).slice(0, 10).map((t) => clampStr(t, 30)).filter(Boolean) };
}


function sanitizeFlashcard(input) {
  const base = common(input, 'flashcard');
  const mode = input.mode === 'theory' ? 'theory' : 'language';
  const language = clampStr(input.language || 'en-US', 20);
  const description = clampStr(input.description, 1000);
  const raw = clampStr(input.content, 200000);
  if (!raw.trim()) throw bad('Thiếu nội dung flashcard');
  const { parse } = require('./flashcardParser');
  const p = parse(raw, mode);
  if (p.errors.length) throw new HttpError(400, `Flashcard chưa hợp lệ: ${p.errors[0].message}${p.errors.length > 1 ? ` (và ${p.errors.length - 1} lỗi nữa)` : ''}`, 'VALIDATION', p.errors);
  const cards = p.cards.map((c, i) => ({
    id: isId(c.id) ? c.id : `c${i + 1}`,
    front: clampStr(c.front, 600),
    back: clampStr(c.back, 2000),
    ipa: mode === 'language' ? clampStr(c.ipa, 120) : '',
    image: c.image || ''
  }));
  return { ...base, description, mode, language, raw, cards, maxScore: 10, images: imageRefs(raw, JSON.stringify(cards)) };
}

function sanitizeEssay(input) {
  const base = common(input, 'essay');
  const prompt = clampStr(input.prompt, 20000);
  if (!prompt) throw bad('Thiếu đề bài');
  const maxScore = Math.min(100, Math.max(1, Number(input.maxScore) || 10));
  const rubric = (Array.isArray(input.rubric) ? input.rubric : []).slice(0, 20).map((r) => ({
    name: clampStr(r && r.name, 100),
    points: Math.max(0, Math.min(maxScore, Number(r && r.points) || 0)),
    keywords: (Array.isArray(r && r.keywords) ? r.keywords : String((r && r.keywords) || '').split(',')).slice(0, 30).map((k) => clampStr(k, 60)).filter(Boolean),
  })).filter((r) => r.name);
  const modelAnswer = clampStr(input.modelAnswer, 30000);
  const untimed = input.timerMode === 'untimed' || input.duration === null || input.duration === undefined || input.duration === '' || input.duration === 'null';
  const d = Number(input.duration);
  if (!untimed && !(Number.isInteger(d) && d >= 1 && d <= 600)) throw bad('Thời gian làm bài phải là số phút nguyên từ 1 đến 600 (hoặc chọn “Không đếm giờ”).');
  return { ...base, prompt, modelAnswer, maxScore, rubric, duration: untimed ? null : d, images: imageRefs(prompt, modelAnswer), promptId: input.promptId || null };
}

const { parsePart, serializePart } = require('./quiz/parser');
const qcfg = require('./quiz/config');
const { sanitizeExplanationHtml } = require('./quiz/htmlsafe');
const { normalizeAudioUrl } = require('./quiz/audio');
const toNum = (v, def) => { const t = String(v == null ? '' : v).trim().replace(',', '.'); if (t === '') return def; const n = Number(t); return Number.isFinite(n) ? n : def; };
const round4 = (n) => Math.round(n * 10000) / 10000;
const MAX_TEXT = qcfg.LIMITS.MAX_RAW_TEXT_LEN;

/** Dựng đề 3 phần từ text (chuyển từ bản cũ quiz.controller.js: buildQuiz). Server PARSE LẠI — không tin JSON từ client. */
function buildQuiz(body) {
  const errors = [];
  const maxScore = toNum(body.maxScore, NaN);
  if (!(maxScore > 0)) errors.push({ msg: 'Thang điểm tối đa phải là số lớn hơn 0 (VD 10 hoặc 2.5).' });
  const parts = {}; let total = 0;
  for (const part of qcfg.PARTS) {
    const text = String(body[part] || '');
    if (text.length > MAX_TEXT) { errors.push({ part, msg: 'Text quá dài.' }); continue; }
    if (!text.trim()) continue;
    const ppq = toNum(body['pointsPerQuestion_' + part], NaN);
    if (!(ppq > 0)) { errors.push({ part, msg: '“Điểm / câu” phải là số lớn hơn 0 (VD 0.1, 0.2, 0.25, 1).' }); continue; }
    const opts = {};
    if (part === 'tf') {
      const sc = String(body.scoring_tf || body.tfScoring || qcfg.TF_DEFAULT_SCORING || 'equal');
      if (!qcfg.TF_SCORING.includes(sc)) { errors.push({ part, msg: 'Cách chia điểm phần Đúng/Sai không hợp lệ.' }); continue; }
      opts.scoring = sc;
    }
    if (part === 'fill') { opts.tolerance = Math.max(0, toNum(body.tolerance, 0)); opts.note = String(body.note || '').trim().slice(0, 300); }
    const r = parsePart(text, part, opts);
    if (r.errors.length) { r.errors.forEach((e) => errors.push({ part, line: e.line, msg: e.msg })); continue; }
    if (!r.questions.length) continue;
    const questions = r.questions.map((q, i) => {
      const id = `${part}-${i + 1}`;
      if (part === 'tf') return { ...q, id, statements: (q.statements || []).map((st) => ({ ...st, explanationHtml: st.explanationHtml ? (sanitizeExplanationHtml(st.explanationHtml) || null) : null })) };
      return { ...q, id, explanationHtml: q.explanationHtml ? (sanitizeExplanationHtml(q.explanationHtml) || null) : null };
    });
    parts[part] = { pointsPerQuestion: round4(ppq), questions };
    if (part === 'tf') parts.tf.scoring = opts.scoring;
    if (part === 'fill') { parts.fill.tolerance = opts.tolerance; parts.fill.note = opts.note || (r.note ? String(r.note).slice(0, 300) : ''); }
    if (part !== 'tf' && r.clusters && r.clusters.length) parts[part].clusters = r.clusters;
    total += questions.length;
  }
  if (!total && !errors.length) errors.push({ msg: 'Cần ít nhất 1 câu hỏi ở một phần nào đó.' });
  if (errors.length) return { errors };
  return { maxScore: round4(maxScore), parts };
}

const fail = (errors) => { throw new HttpError(400, `Đề chưa hợp lệ: ${errors[0].msg}${errors.length > 1 ? ` (và ${errors.length - 1} lỗi nữa)` : ''}`, 'VALIDATION', errors); };

function previewQuiz(input) { const b = buildQuiz(input || {}); if (b.errors) fail(b.errors); return { maxScore: b.maxScore, parts: b.parts }; }

function sanitizeQuiz(input) {
  const base = common(input, 'quiz');
  const built = buildQuiz(input);
  if (built.errors) fail(built.errors);
  const untimed = input.timerMode === 'untimed' || input.duration === null || input.duration === 'null';
  const d = toNum(input.duration, NaN);
  if (!untimed && !(Number.isInteger(d) && d >= 1 && d <= 600)) throw bad('Thời gian làm bài phải là số phút nguyên từ 1 đến 600 (hoặc chọn “Không đếm giờ”).');
  const audio = normalizeAudioUrl(input.audioUrl); if (audio.error) throw bad(audio.error);
  const contentHtml = sanitizeExplanationHtml(clampStr(input.contentHtml, 20000), { maxLength: 20000 });
  const out = { ...base, promptId: input.promptId || null, contentHtml, duration: untimed ? null : d, shuffle: !!input.shuffle, maxScore: built.maxScore, parts: built.parts, images: imageRefs(JSON.stringify(built.parts), contentHtml) };
  if (audio.url) out.audioUrl = audio.url;
  return out;
}

/** Văn bản 3 khối của một đề đã lưu (cho trình sửa đề). */
function rawTexts(item) {
  const raw = {};
  for (const k of qcfg.PARTS) { const p = item.parts && item.parts[k]; raw[k] = p ? serializePart(p.questions, k, p.note, p.clusters) : ''; }
  return raw;
}

/**
 * Đọc đề trắc nghiệm dạng văn bản:
 *   Câu 1: nội dung        (hoặc "1." / "1)")
 *   A. đáp án              (A–J, có thể "A)" hoặc "*A." để đánh dấu đúng)
 *   Đáp án: B              (hoặc "Đáp án: A, C" cho nhiều đáp án)
 *   Giải thích: ...
 */
function parseQuizText(text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  const qs = []; let cur = null; let mode = 'q';
  const finish = () => { if (cur && cur.text) qs.push(cur); cur = null; };
  const qRe = /^\s*(?:câu|cau|question|q)?\s*(\d+)\s*[.:)\-]\s*(.*)$/i;
  const oRe = /^\s*(\*)?\s*([A-Ja-j])\s*[.):]\s+(.*)$/;
  const aRe = /^\s*(?:đáp án|dap an|answer|đ\/a|dap_an)\s*[:：]\s*(.+)$/i;
  const eRe = /^\s*(?:giải thích|giai thich|explanation)\s*[:：]\s*(.*)$/i;
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;
    let m;
    if ((m = aRe.exec(line)) && cur) { cur.correct = [...new Set(m[1].toUpperCase().match(/[A-J]/g) || [])]; mode = 'a'; continue; }
    if ((m = eRe.exec(line)) && cur) { cur.explanation = m[1]; mode = 'e'; continue; }
    if ((m = oRe.exec(line)) && cur && !(mode === 'e')) {
      const id = m[2].toUpperCase(); cur.options.push({ id, text: m[3].trim() }); if (m[1]) cur.correct.push(id); mode = 'o'; continue;
    }
    if ((m = qRe.exec(line)) && (!cur || mode !== 'q' || cur.options.length)) { finish(); cur = { text: m[2].trim(), options: [], correct: [], explanation: '' }; mode = 'q'; continue; }
    if (!cur) { cur = { text: line.trim(), options: [], correct: [], explanation: '' }; mode = 'q'; continue; }
    if (mode === 'q') cur.text += '\n' + line.trim();
    else if (mode === 'o') cur.options[cur.options.length - 1].text += ' ' + line.trim();
    else if (mode === 'e') cur.explanation += '\n' + line.trim();
  }
  finish();
  return qs.map((q) => ({ ...q, correct: [...new Set(q.correct)], multiple: q.correct.length > 1 }));
}

module.exports = { sanitizeEssay, sanitizeFlashcard, sanitizeQuiz, previewQuiz, rawTexts, buildQuiz, parseQuizText, imageRefs, IMG_TOKEN, bad, isId };
