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
  return { ...base, prompt, modelAnswer, maxScore, rubric, images: imageRefs(prompt, modelAnswer) };
}

function sanitizeQuiz(input) {
  const base = common(input, 'quiz');
  const qs = Array.isArray(input.questions) ? input.questions : [];
  if (!qs.length) throw bad('Bài trắc nghiệm cần ít nhất 1 câu');
  if (qs.length > 300) throw bad('Tối đa 300 câu mỗi bài');
  const seen = new Set();
  const questions = qs.map((q, i) => {
    const text = clampStr(q && q.text, 4000);
    if (!text) throw bad(`Câu ${i + 1}: thiếu nội dung`);
    const opts = (Array.isArray(q.options) ? q.options : []).slice(0, 10);
    if (opts.length < 2) throw bad(`Câu ${i + 1}: cần ít nhất 2 đáp án`);
    const options = opts.map((o, k) => {
      let id = clampStr(o && o.id, 20);
      if (!/^[A-Za-z0-9_-]{1,20}$/.test(id)) id = String.fromCharCode(65 + k);
      return { id, text: clampStr(o && o.text, 1500) };
    });
    if (new Set(options.map((o) => o.id)).size !== options.length) throw bad(`Câu ${i + 1}: id đáp án bị trùng`);
    if (options.some((o) => !o.text)) throw bad(`Câu ${i + 1}: có đáp án trống`);
    const correct = [...new Set((Array.isArray(q.correct) ? q.correct : [q.correct]).map(String))].filter((c) => options.some((o) => o.id === c));
    if (!correct.length) throw bad(`Câu ${i + 1}: chưa chọn đáp án đúng`);
    let id = clampStr(q.id, 32); if (!/^[A-Za-z0-9_-]{1,32}$/.test(id) || seen.has(id)) id = 'q' + randomId(4);
    seen.add(id);
    return { id, text, options, correct, multiple: correct.length > 1, explanation: clampStr(q.explanation, 3000), points: Math.min(100, Math.max(0.25, Number(q.points) || 1)) };
  });
  const timeLimitMin = Math.min(600, Math.max(0, Math.floor(Number(input.timeLimitMin) || 0)));
  const imgs = imageRefs(...questions.flatMap((q) => [q.text, q.explanation, ...q.options.map((o) => o.text)]));
  return { ...base, questions, timeLimitMin, shuffle: !!input.shuffle, images: imgs };
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

module.exports = { sanitizeEssay, sanitizeQuiz, parseQuizText, imageRefs, IMG_TOKEN, bad, isId };
