'use strict';
/** Chấm tự luận bằng Gemini với khoá của CHÍNH người dùng (REST thuần). */
const { HttpError } = require('../http');

async function gradeEssay({ apiKey, model, essay, answer, fetchImpl = fetch }) {
  const prompt = [
    'Bạn là giảng viên chấm bài tự luận môn CNTT. Chấm công bằng, ngắn gọn, bằng tiếng Việt.',
    `Thang điểm: 0–${essay.maxScore}.`,
    `ĐỀ BÀI:\n${essay.prompt}`,
    essay.modelAnswer ? `ĐÁP ÁN THAM KHẢO:\n${essay.modelAnswer}` : '',
    essay.rubric && essay.rubric.length ? `TIÊU CHÍ:\n${essay.rubric.map((r) => `- ${r.name} (${r.points}đ): ${r.keywords.join(', ')}`).join('\n')}` : '',
    `BÀI LÀM CỦA SINH VIÊN:\n${answer}`,
    'Chỉ trả về JSON: {"score": number, "feedback": string, "strengths": string[], "weaknesses": string[]}',
  ].filter(Boolean).join('\n\n');
  let res;
  try {
    res = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json', temperature: 0.2 } }),
      signal: AbortSignal.timeout(45000),
    });
  } catch (e) { throw new HttpError(504, 'Gemini không phản hồi kịp: ' + e.message, 'AI_TIMEOUT'); }
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new HttpError(502, `Gemini lỗi ${res.status}: ${(j.error && j.error.message) || 'không rõ'}`, 'AI_ERROR');
  const txt = j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts && j.candidates[0].content.parts.map((p) => p.text || '').join('');
  let out; try { out = JSON.parse(String(txt).replace(/^```json|```$/g, '').trim()); } catch { throw new HttpError(502, 'Gemini trả về định dạng không đọc được', 'AI_FORMAT'); }
  const score = Math.max(0, Math.min(essay.maxScore, Number(out.score)));
  if (Number.isNaN(score)) throw new HttpError(502, 'Gemini không trả điểm hợp lệ', 'AI_FORMAT');
  const arr = (v) => (Array.isArray(v) ? v.slice(0, 10).map((x) => String(x).slice(0, 500)) : []);
  return { score, feedback: String(out.feedback || '').slice(0, 3000), strengths: arr(out.strengths), weaknesses: arr(out.weaknesses), model };
}

module.exports = { gradeEssay };
