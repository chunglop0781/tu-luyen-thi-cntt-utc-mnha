// services/quizGradingService.js
// Chấm tự động, KHÔNG dùng AI.
//
// Phần đúng/sai (tf): mỗi câu có nhiều ý. Chấm TỪNG Ý (answers[statementId] = true|false),
// đếm số ý đúng k trên tổng n ý, rồi tính điểm câu theo parts.tf.scoring:
//   equal  : P × k / n
//   thptqg : P × TF_THPTQG_RATIOS[k]   (chỉ định nghĩa cho n = 4)

const cfg = require('./config');
const { isNumberLike, parseNumber, normalizeFillValue } = require('./parser');

// Làm tròn 4 chữ số để điểm thập phân không bị lệch kiểu 0.30000000000000004
const r4 = (n) => Math.round(n * 10000) / 10000;

function norm(s) {
  return String(s || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function gradeMcq(question, studentAnswer) {
  const correct = question.correct || [];
  const chosen = Array.isArray(studentAnswer) ? studentAnswer : (studentAnswer ? [studentAnswer] : []);
  const chosenSet = new Set(chosen.map(String));
  const correctSet = new Set(correct.map(String));
  if (chosenSet.size !== correctSet.size) return false;
  for (const k of correctSet) if (!chosenSet.has(k)) return false;
  return true;
}

// Chấm MỘT ý của câu đúng/sai. Bỏ trống (null/undefined) = sai.
function gradeTfStatement(statement, studentAnswer) {
  if (!statement || typeof statement.correct !== 'boolean') return false;
  return studentAnswer === statement.correct;
}

function tfScoringOf(part) {
  const list = cfg.TF_SCORING || ['equal', 'thptqg'];
  return list.includes(part && part.scoring) ? part.scoring : (cfg.TF_DEFAULT_SCORING || 'equal');
}

/**
 * Điểm của một câu đúng/sai.
 * @param {number} P  điểm tối đa của cả câu
 * @param {number} k  số ý đúng
 * @param {number} n  tổng số ý
 * @param {'equal'|'thptqg'} scoring
 * Không làm tròn ở đây (chỉ làm tròn khi cộng dồn, xem r4).
 */
function tfQuestionPoints(P, k, n, scoring) {
  if (!(n > 0)) return 0;
  // thptqg chỉ có bảng hệ số cho câu 4 ý. Parser đã chặn câu khác 4 ý khi lưu đề;
  // nếu file đề bị sửa tay trên GitHub cho lệch thì rơi về chia đều thay vì chấm sai.
  if (scoring === 'thptqg' && n === cfg.TF_THPTQG_STATEMENTS) {
    return P * (cfg.TF_THPTQG_RATIOS[k] || 0);
  }
  return (P * k) / n;
}

function gradeFill(question, studentAnswer, tolerance) {
  const answers = question.answers || [];
  if (!answers.length || studentAnswer == null) return false;
  const stu = normalizeFillValue(studentAnswer);
  if (!stu) return false;

  for (const a of answers) {
    const an = normalizeFillValue(a);
    if (!an) continue;
    if (isNumberLike(an) && isNumberLike(stu)) {
      const tol = Number(tolerance) || 0;
      // + 1e-9: tránh sai số float (vd |1.1 − 1.0| = 0.10000000000000009 phải ≤ 0.1)
      if (Math.abs(parseNumber(an) - parseNumber(stu)) <= tol + 1e-9) return true;
    } else {
      if (norm(an) === norm(stu)) return true;
    }
  }
  return false;
}

/**
 * @param {object} quiz - đề (đã có đáp án + giải thích)
 * @param {object} answers - { [id]: string|string[]|boolean }
 *        id = id câu (mcq, fill) hoặc id Ý (tf, vd "tf-1-a")
 * @returns {object} result { score, maxScore, earnedPoints, totalPoints, correctCount, totalCount, parts, tfQuestions, items }
 *   correctCount / totalCount tính theo ĐƠN VỊ CHẤM: mcq, fill = câu; tf = ý.
 *   parts.tf: { correct: số ý đúng, total: số ý, earned, points }
 */
function grade(quiz, answers) {
  answers = answers || {};
  const maxScore = Number(quiz.maxScore) || cfg.DEFAULT_MAX_SCORE;
  const parts = quiz.parts || {};

  let earnedPoints = 0;
  let totalPoints = 0;
  let correctCount = 0;
  let totalCount = 0;
  const partStats = {};
  const tfQuestions = [];
  const items = [];

  for (const partKey of cfg.PARTS) {
    const p = parts[partKey];
    if (!p || !Array.isArray(p.questions) || p.questions.length === 0) continue;
    const ppq = Number(p.pointsPerQuestion) || cfg.DEFAULT_POINTS_PER_QUESTION;
    const tolerance = partKey === 'fill' ? Number(p.tolerance) || 0 : 0;
    const scoring = partKey === 'tf' ? tfScoringOf(p) : null;

    let pCorrect = 0;   // số đơn vị chấm đúng (mcq/fill: câu, tf: ý)
    let pUnits = 0;     // tổng đơn vị chấm
    let pTotal = 0;     // tổng điểm của phần
    let pEarned = 0;

    for (const q of p.questions) {
      if (partKey === 'tf') {
        const statements = Array.isArray(q.statements) ? q.statements : [];
        const n = statements.length;
        let k = 0;
        for (const s of statements) {
          const stu = answers[s.id];
          const ok = gradeTfStatement(s, stu);
          if (ok) k += 1;
          items.push({
            id: s.id,
            part: 'tf',
            questionId: q.id,
            correct: ok,
            studentAnswer: stu == null ? null : stu,
            correctAnswer: typeof s.correct === 'boolean' ? s.correct : null,
          });
        }
        const earned = r4(tfQuestionPoints(ppq, k, n, scoring));
        tfQuestions.push({ id: q.id, correctStatements: k, totalStatements: n, earned, points: ppq });

        pTotal = r4(pTotal + ppq);
        totalPoints = r4(totalPoints + ppq);
        pEarned = r4(pEarned + earned);
        earnedPoints = r4(earnedPoints + earned);
        pCorrect += k;
        pUnits += n;
        correctCount += k;
        totalCount += n;
        continue;
      }

      const stu = answers[q.id];
      let ok = false;
      if (partKey === 'mcq') ok = gradeMcq(q, stu);
      else if (partKey === 'fill') ok = gradeFill(q, stu, tolerance);

      pTotal = r4(pTotal + ppq);
      totalPoints = r4(totalPoints + ppq);
      pUnits += 1;
      totalCount += 1;
      if (ok) {
        pCorrect += 1;
        correctCount += 1;
        pEarned = r4(pEarned + ppq);
        earnedPoints = r4(earnedPoints + ppq);
      }

      items.push({
        id: q.id,
        part: partKey,
        correct: ok,
        earned: ok ? ppq : 0,
        points: ppq,
        studentAnswer: stu == null ? null : stu,
        correctAnswer: partKey === 'mcq' ? (q.correct || []) : (q.answers || []),
      });
    }
    partStats[partKey] = {
      correct: pCorrect,
      total: pUnits,
      earned: pEarned,
      points: pTotal,
    };
  }

  const score = totalPoints > 0
    ? Math.round((earnedPoints / totalPoints) * maxScore * 100) / 100
    : 0;

  return {
    score,
    maxScore,
    earnedPoints,
    totalPoints,
    correctCount,
    totalCount,
    parts: partStats,
    tfQuestions,
    items,
  };
}

module.exports = { grade, gradeMcq, gradeTfStatement, gradeTf: gradeTfStatement, gradeFill, tfQuestionPoints };
