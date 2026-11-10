'use strict';
/** Chấm tự luận bằng AI (Gemini / vilao.ai / ChatGPT / DeepSeek / OpenRouter) với khoá của CHÍNH người dùng. */
const { HttpError } = require('../http');
const { callAi, parseJsonLoose } = require('./ai');

async function gradeEssay({ provider, apiKey, model, essay, answer, fetchImpl = fetch, lookup }) {
  const prompt = [
    'Bạn là giảng viên chấm bài tự luận môn CNTT. Chấm công bằng, ngắn gọn, bằng tiếng Việt.',
    `Thang điểm: 0–${essay.maxScore}.`,
    `ĐỀ BÀI:\n${essay.prompt}`,
    essay.modelAnswer ? `ĐÁP ÁN THAM KHẢO:\n${essay.modelAnswer}` : '',
    essay.rubric && essay.rubric.length ? `TIÊU CHÍ:\n${essay.rubric.map((r) => `- ${r.name} (${r.points}đ): ${r.keywords.join(', ')}`).join('\n')}` : '',
    `BÀI LÀM CỦA SINH VIÊN:\n${answer}`,
    'Chỉ trả về JSON, không thêm chữ nào khác: {"score": number, "feedback": string, "strengths": string[], "weaknesses": string[]}',
  ].filter(Boolean).join('\n\n');
  const r = await callAi({ provider, model, apiKey, prompt, json: true, fetchImpl, lookup });
  const out = parseJsonLoose(r.text);
  if (!out) throw new HttpError(502, `${provider.label} trả về định dạng không đọc được`, 'AI_FORMAT');
  const score = Math.max(0, Math.min(essay.maxScore, Number(out.score)));
  if (Number.isNaN(score)) throw new HttpError(502, `${provider.label} không trả điểm hợp lệ`, 'AI_FORMAT');
  const arr = (v) => (Array.isArray(v) ? v.slice(0, 10).map((x) => String(x).slice(0, 500)) : []);
  return { score, feedback: String(out.feedback || '').slice(0, 3000), strengths: arr(out.strengths), weaknesses: arr(out.weaknesses), model: r.model, provider: r.provider, ...(r.fallbackFrom ? { fallbackFrom: r.fallbackFrom } : {}) };
}

module.exports = { gradeEssay };
