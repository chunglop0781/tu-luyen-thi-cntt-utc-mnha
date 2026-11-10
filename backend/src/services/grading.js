'use strict';
const { fold } = require('../util');

/** Chấm trắc nghiệm: mỗi câu đúng khi tập đáp án chọn == tập đáp án đúng. */
function gradeQuiz(quiz, answers) {
  const a = answers && typeof answers === 'object' ? answers : {};
  let score = 0, max = 0, correctCount = 0;
  const results = quiz.questions.map((q) => {
    const chosen = [].concat(a[q.id] === undefined ? [] : a[q.id]).map(String).filter((c) => q.options.some((o) => o.id === c));
    const set = new Set(chosen);
    const ok = set.size === q.correct.length && q.correct.every((c) => set.has(c));
    max += q.points; if (ok) { score += q.points; correctCount++; }
    return { id: q.id, chosen: [...set], correct: q.correct, ok, points: ok ? q.points : 0 };
  });
  return { score: Math.round(score * 100) / 100, max: Math.round(max * 100) / 100, correctCount, total: quiz.questions.length, results };
}

const STOP = new Set('la va cua cho cac mot nhung the duoc trong khi voi de co khong nay do tu den hay hoac thi ma se da dang cung nhu'.split(' '));

/** Gợi ý điểm tự luận theo từ khoá của rubric (không dấu); không có rubric → độ phủ từ khoá của đáp án mẫu. */
function suggestEssay(essay, text) {
  const ans = ` ${fold(text)} `;
  const has = (kw) => { const k = fold(kw); return !!k && ans.includes(` ${k} `); };
  if (essay.rubric && essay.rubric.length) {
    const details = essay.rubric.map((r) => {
      const hit = r.keywords.filter(has);
      const ratio = r.keywords.length ? hit.length / r.keywords.length : 0;
      return { name: r.name, points: r.points, got: Math.round(r.points * ratio * 100) / 100, matched: hit, missing: r.keywords.filter((k) => !hit.includes(k)) };
    });
    const total = details.reduce((s, d) => s + d.points, 0) || 1;
    const got = details.reduce((s, d) => s + d.got, 0);
    return { method: 'rubric', score: Math.round((got / total) * essay.maxScore * 100) / 100, max: essay.maxScore, details };
  }
  const words = [...new Set(fold(essay.modelAnswer).split(' ').filter((w) => w.length > 2 && !STOP.has(w)))];
  if (!words.length) return { method: 'none', score: null, max: essay.maxScore, details: [] };
  const mine = new Set(fold(text).split(' '));
  const hit = words.filter((w) => mine.has(w));
  const coverage = hit.length / words.length;
  return { method: 'coverage', score: Math.round(Math.min(1, coverage * 1.15) * essay.maxScore * 10) / 10, max: essay.maxScore, coverage: Math.round(coverage * 100), details: [] };
}

module.exports = { gradeQuiz, suggestEssay };
