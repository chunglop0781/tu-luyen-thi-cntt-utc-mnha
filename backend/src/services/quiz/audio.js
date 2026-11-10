// services/quizAudioService.js
// Kiểm tra + chuẩn hoá link audio của bài trắc nghiệm (dùng ở quiz.controller khi LƯU đề).
// Client (quizEditor.js) có bản sao logic này chỉ để báo lỗi sớm — server mới là nơi quyết định.
//
//   const { normalizeAudioUrl } = require('../services/quizAudioService');
//   const a = normalizeAudioUrl(req.body.audioUrl);
//   if (a.error) return res.status(400).json({ success: false, errors: [{ msg: a.error }] });
//   if (a.url) quizJson.quiz.audioUrl = a.url; else delete quizJson.quiz.audioUrl;

// Nên đặt 2 hằng này vào config/quizConfig.js cùng chỗ với ALLOWED_IMAGE_HOSTS.
const ALLOWED_AUDIO_HOSTS = ['raw.githubusercontent.com', 'media.githubusercontent.com'];
const AUDIO_EXT = /\.(mp3|wav|ogg|oga|m4a|aac|opus)$/i;
const MAX_URL_LENGTH = 500;

function normalizeAudioUrl(input) {
  const s = String(input == null ? '' : input).trim();
  if (!s) return { url: '' };                       // không có audio
  if (s.length > MAX_URL_LENGTH) return { url: '', error: 'Link audio quá dài.' };

  let u;
  try { u = new URL(s); } catch (e) { return { url: '', error: 'Link audio không hợp lệ.' }; }
  if (u.protocol !== 'https:') return { url: '', error: 'Audio phải là link https.' };

  // github.com/{owner}/{repo}/blob|raw/{ref}/{path}  →  raw.githubusercontent.com/{owner}/{repo}/{ref}/{path}
  if (u.hostname === 'github.com' || u.hostname === 'www.github.com') {
    const m = u.pathname.match(/^\/([^/]+)\/([^/]+)\/(?:blob|raw)\/(.+)$/);
    if (!m) return { url: '', error: 'Link GitHub chưa đúng. Mở file audio trên GitHub rồi bấm “View raw” để lấy link.' };
    u = new URL('https://raw.githubusercontent.com/' + m[1] + '/' + m[2] + '/' + m[3]);
  }

  if (!ALLOWED_AUDIO_HOSTS.includes(u.hostname)) {
    return { url: '', error: 'Host audio không được phép (chỉ: ' + ALLOWED_AUDIO_HOSTS.join(', ') + ').' };
  }
  if (!AUDIO_EXT.test(u.pathname)) {
    return { url: '', error: 'File audio phải có đuôi .mp3, .wav, .ogg, .m4a, .aac hoặc .opus.' };
  }
  u.search = '';   // bỏ ?raw=true, ?token=… (repo private không hỗ trợ)
  u.hash = '';
  return { url: u.toString() };
}

module.exports = { normalizeAudioUrl, ALLOWED_AUDIO_HOSTS, AUDIO_EXT };
