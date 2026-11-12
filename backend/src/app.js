'use strict';
const { config, problems, warnings } = require('./config');
const { GitHub, GitHubError } = require('./github');
const { Store } = require('./store');
const { HttpError, Router, corsHeaders, readBody, parseJson, send, sendJson } = require('./http');
const { createAuth } = require('./services/auth');
const { createMailer } = require('./services/mailer');
const { createImages } = require('./services/images');
const { createContent } = require('./services/content');
const { createWebhook } = require('./services/webhook');
const { pruneRepo } = require('./services/prune');
const { previewQuiz } = require('./services/validate');
const fcfg = require('./services/flashcardConfig');
const { parse: parseFlashcards } = require('./services/flashcardParser');
const { safeEqual } = require('./crypto');
const qcfg = require('./services/quiz/config');
const { ALLOWED_AUDIO_HOSTS } = require('./services/quiz/audio');
const quizPublicConfig = () => ({ authoringPrompt: qcfg.QUIZ_AUTHORING_PROMPT, allowedImageHosts: qcfg.ALLOWED_IMAGE_HOSTS, allowedAudioHosts: ALLOWED_AUDIO_HOSTS, maxOptions: qcfg.LIMITS.MAX_OPTIONS_PER_QUESTION, tfMinStatements: qcfg.LIMITS.MIN_STATEMENTS_TF, tfMaxStatements: qcfg.LIMITS.MAX_STATEMENTS_TF, tfThptqgStatements: qcfg.TF_THPTQG_STATEMENTS, defaults: { ppq: qcfg.DEFAULT_POINTS_PER_QUESTION, maxScore: qcfg.DEFAULT_MAX_SCORE, duration: 20 }, durationLimits: { min: 1, max: 600 } });

/** Giới hạn tốc độ trong RAM (tốt nhất có thể trên serverless). */
function limiter() {
  const hits = new Map();
  return (key, max, windowMs) => {
    const now = Date.now(); const h = (hits.get(key) || []).filter((t) => now - t < windowMs);
    if (h.length >= max) { hits.set(key, h); return false; }
    h.push(now); hits.set(key, h);
    if (hits.size > 5000) for (const [k, v] of hits) if (!v.length || now - v[v.length - 1] > windowMs) hits.delete(k);
    return true;
  };
}

function createApp({ env = process.env, fetchImpl, aiFetch, mailer: mailerImpl, dnsLookup } = {}) {
  const cfg = config(env);
  const gh = new GitHub({ token: cfg.token, owner: cfg.owner, branch: cfg.branch, fetchImpl });
  const store = new Store(gh, { account: cfg.accountRepo, data: cfg.dataRepo });
  const wh = createWebhook({ cfg, store, images: { noteSize: (n, b) => images.noteSize(n, b) } });
  const images = createImages({ cfg, gh, store, ensureWebhook: (r) => wh.ensureHook(gh, r) });
  const mailer = mailerImpl || createMailer(cfg);
  const auth = createAuth({ cfg, store, mailer });
  const content = createContent({ cfg, store, images, fetchImpl: aiFetch, lookup: dnsLookup });
  const allow = limiter();
  const router = new Router();

  // IP thật của khách: Vercel tự ghi đè x-vercel-forwarded-for / x-real-ip (khách không giả được).
  // KHÔNG tin phần tử ĐẦU của x-forwarded-for (khách tự gửi → giả IP để né giới hạn đăng nhập); nếu phải dùng thì lấy phần tử CUỐI (do proxy gần nhất thêm).
  const ip = (req) => String(req.headers['x-vercel-forwarded-for'] || req.headers['x-real-ip'] || String(req.headers['x-forwarded-for'] || '').split(',').pop() || req.socket.remoteAddress || '').split(',')[0].trim().slice(0, 64);
  const ua = (req) => String(req.headers['user-agent'] || '');
  const authed = (ctx) => auth.authenticate(ctx.req);
  // Thao tác nhạy cảm (key, mật khẩu, phiên): token phải CÒN phiên — đăng xuất / đổi mật khẩu / "đăng xuất mọi nơi" có hiệu lực ngay, không đợi access token hết hạn.
  const authedLive = (ctx) => auth.authenticateLive(ctx.req);

  // ── Hệ thống ──
  router.get('/api/health', async (ctx) => {
    const out = { ok: true, service: 'tu-luyen-thi-cntt-utc-mnha', version: cfg.version, time: new Date().toISOString(), problems: problems(cfg), warnings: warnings(cfg), emailOtp: cfg.requireOtp };
    if (ctx.query.get('deep') === '1') {
      try { out.github = { account: !!(await gh.getRepo(cfg.accountRepo)), data: !!(await gh.getRepo(cfg.dataRepo)) }; }
      catch (e) { out.ok = false; out.github = { error: e.message }; }
      out.webhook = wh.stats;
    }
    return out;
  });

  // ── Tài khoản ──
  router.post('/api/auth/register', async (ctx) => {
    if (!allow('reg:' + ip(ctx.req), 10, 3600e3)) throw new HttpError(429, 'Đăng ký quá nhiều lần, thử lại sau', 'RATE');
    return { ok: true, ...(await auth.register(ctx.body, ua(ctx.req))) };
  }, { status: 201 });
  // Đăng ký có xác minh email: (1) gửi OTP  (2) nhập OTP → tạo tài khoản. Gọi lại (1) = gửi lại mã.
  const emailOf = (b) => String((b && b.email) || '').trim().toLowerCase();
  router.post('/api/auth/register/start', async (ctx) => {
    if (!allow('otp:' + ip(ctx.req), 40, 3600e3) || !allow('otpe:' + emailOf(ctx.body), 6, 3600e3)) throw new HttpError(429, 'Yêu cầu gửi mã quá nhiều, thử lại sau', 'RATE');
    return { ok: true, ...(await auth.registerStart(ctx.body)) };
  });
  router.post('/api/auth/register/verify', async (ctx) => {
    if (!allow('otpv:' + ip(ctx.req), 120, 3600e3)) throw new HttpError(429, 'Thử mã quá nhiều lần, thử lại sau', 'RATE');
    return { ok: true, ...(await auth.registerVerify(ctx.body, ua(ctx.req))) };
  }, { status: 201 });
  // Quên mật khẩu bằng OTP gửi về email đã xác minh
  router.post('/api/auth/reset/start', async (ctx) => {
    if (!allow('rst:' + ip(ctx.req), 40, 3600e3) || !allow('rste:' + emailOf(ctx.body), 6, 3600e3)) throw new HttpError(429, 'Yêu cầu gửi mã quá nhiều, thử lại sau', 'RATE');
    return { ok: true, ...(await auth.resetStart(ctx.body)) };
  });
  router.post('/api/auth/reset/confirm', async (ctx) => {
    if (!allow('rstv:' + ip(ctx.req), 120, 3600e3)) throw new HttpError(429, 'Thử mã quá nhiều lần, thử lại sau', 'RATE');
    await auth.resetConfirm(ctx.body); return { ok: true };
  });
  router.post('/api/auth/login', async (ctx) => {
    if (!allow('login:' + ip(ctx.req), 20, 600e3) || !allow('loginu:' + String(ctx.body.identifier !== undefined ? ctx.body.identifier : ctx.body.username || '').trim().toLowerCase().slice(0, 254), 10, 600e3)) throw new HttpError(429, 'Thử đăng nhập quá nhiều lần, đợi vài phút', 'RATE');
    return { ok: true, ...(await auth.login(ctx.body, ua(ctx.req))) };
  });
  router.post('/api/auth/refresh', async (ctx) => ({ ok: true, ...(await auth.refresh(ctx.body.refreshToken)) }));
  router.post('/api/auth/logout', async (ctx) => { await auth.logout(ctx.body.refreshToken); return { ok: true }; });
  router.post('/api/auth/logout-all', async (ctx) => { const a = await authedLive(ctx); await auth.revoke(a.sub, null); return { ok: true }; });
  router.post('/api/auth/change-password', async (ctx) => {
    const a = await authedLive(ctx);
    if (!allow('chpw:' + a.sub, 8, 600e3)) throw new HttpError(429, 'Đổi mật khẩu quá nhiều lần, đợi vài phút', 'RATE');   // chống dò mật khẩu cũ bằng token bị lộ
    await auth.changePassword(a, ctx.body); return { ok: true };
  });
  router.get('/api/me', async (ctx) => ({ ok: true, user: await auth.me(authed(ctx)) }));
  router.patch('/api/me', async (ctx) => ({ ok: true, user: await auth.updateProfile(authed(ctx), ctx.body) }));
  router.get('/api/me/sessions', async (ctx) => ({ ok: true, sessions: await auth.sessions(await authedLive(ctx)) }));
  router.get('/api/me/vault', async (ctx) => ({ ok: true, vault: await content.readVault(authed(ctx).sub) }));
  router.put('/api/me/vault', async (ctx) => ({ ok: true, vault: await content.writeVault((await authedLive(ctx)).sub, ctx.body) }));

  // ── AI: danh sách nhà cung cấp/model + thử kết nối bằng key của chính người dùng ──
  router.get('/api/ai/providers', async (ctx) => ({ ok: true, ...(await content.aiProviders(authed(ctx).sub)) }));
  router.post('/api/ai/providers', async (ctx) => ({ ok: true, provider: await content.saveProvider((await authedLive(ctx)).sub, null, ctx.body) }), { status: 201 });
  router.put('/api/ai/providers/:id', async (ctx) => ({ ok: true, provider: await content.saveProvider((await authedLive(ctx)).sub, ctx.params.id, ctx.body) }));
  router.delete('/api/ai/providers/:id', async (ctx) => { await content.deleteProvider((await authedLive(ctx)).sub, ctx.params.id); return { ok: true }; });
  // ── Chia sẻ AI key (link: /ai-key/<id-ai-key>?id=<id-user>). Key nhận về có createdBy nên không chia sẻ lại được ──
  router.post('/api/ai-key/:kid/share', async (ctx) => ({ ok: true, ...(await content.setKeyShare((await authedLive(ctx)).sub, ctx.params.kid, ctx.body.enabled !== false)) }));
  router.get('/api/ai-key/:kid', async (ctx) => {
    const a = await authedLive(ctx); if (!allow('aikeyv:' + a.sub, 60, 3600e3)) throw new HttpError(429, 'Xem link AI key quá nhiều lần, thử lại sau', 'RATE');   // chống dò id người dùng / id key
    return { ok: true, ...(await content.previewKeyShare(a.sub, ctx.query.get('id') || '', ctx.params.kid)) };
  });
  router.post('/api/ai-key/:kid/accept', async (ctx) => {
    const a = await authedLive(ctx); if (!allow('aikey:' + a.sub, 20, 3600e3)) throw new HttpError(429, 'Nhận AI key quá nhiều lần, thử lại sau', 'RATE');
    return { ok: true, ...(await content.acceptKeyShare(a.sub, String(ctx.body.ownerId || ctx.query.get('id') || ''), ctx.params.kid)) };
  }, { status: 201 });
  router.post('/api/ai/test', async (ctx) => {
    const a = await authedLive(ctx); if (!allow('aitest:' + a.sub, 20, 3600e3)) throw new HttpError(429, 'Thử kết nối AI quá nhiều lần trong 1 giờ', 'RATE');
    return { ok: true, result: await content.testAi(a.sub, { provider: ctx.body.provider, model: ctx.body.model }) };
  });

  // ── Prompt chấm / phân tích AI riêng của từng tài khoản (essay = chấm tự luận, quiz = phân tích trắc nghiệm) ──
  router.get('/api/prompts', async (ctx) => { const a = authed(ctx); return { ok: true, prompts: await content.prompts.list(a.sub, ctx.query.get('kind') || undefined), ...content.prompts.meta() }; });
  router.get('/api/prompts/resolve', async (ctx) => {      // prompt đang dùng cho một bài của mình (trang làm bài hiện "Prompt chấm đang dùng")
    const a = authed(ctx); const type = ctx.query.get('type') === 'quiz' ? 'quiz' : 'essay';
    const item = await content.getItem(a.sub, type, ctx.query.get('itemId'));
    return { ok: true, prompt: await content.prompts.info(a.sub, type, item.promptId) };
  });
  router.put('/api/prompts/:id', async (ctx) => ({ ok: true, ...(await content.prompts.upsert(authed(ctx).sub, ctx.params.id, ctx.body)) }));
  router.delete('/api/prompts/:id', async (ctx) => { await content.prompts.remove(authed(ctx).sub, ctx.params.id); return { ok: true }; });

  // ── Bài tập ──
  router.get('/api/overview', async (ctx) => ({ ok: true, ...(await content.overview(authed(ctx).sub)) }));
  router.post('/api/reindex', async (ctx) => { await content.reindex(authed(ctx).sub); return { ok: true, ...(await content.overview(authed(ctx).sub)) }; });
  router.get('/api/export', async (ctx) => ({ ok: true, ...(await content.exportAll(authed(ctx).sub)) }));
  router.get('/api/quizzes/config', async (ctx) => { authed(ctx); return { ok: true, config: quizPublicConfig() }; });
  router.get('/api/flashcards/config', async (ctx) => {
    authed(ctx);
    return { ok: true, config: {
      languages: fcfg.LANGUAGES, defaultLanguage: fcfg.DEFAULT_LANGUAGE,
      modes: [{ id: 'language', label: fcfg.MODE_LABEL.language, hint: fcfg.MODE_HINT.language }, { id: 'theory', label: fcfg.MODE_LABEL.theory, hint: fcfg.MODE_HINT.theory }],
      prompts: { language: fcfg.PROMPT_LANGUAGE, theory: fcfg.PROMPT_THEORY },
      limits: fcfg.LIMITS
    } };
  });
  router.post('/api/flashcards/parse', async (ctx) => {
    authed(ctx);
    const mode = ctx.body && ctx.body.mode === 'theory' ? 'theory' : 'language';
    const preview = parseFlashcards(String((ctx.body && ctx.body.content) || ''), mode);
    return { ok: true, preview: { total: preview.cards.length, cards: preview.cards, errors: preview.errors, imageHints: preview.imageHints } };
  });
  router.get('/api/flashcards/:id', async (ctx) => {
    const uid = authed(ctx).sub; const item = await content.getItem(uid, 'flashcard', ctx.params.id);
    const shareId = await content.shareIdOf(uid, ctx.params.id).catch(() => null);
    return { ok: true, item: shareId ? { ...item, shareId } : item };
  });
  router.put('/api/flashcards/:id', async (ctx) => ({ ok: true, item: await content.putItem(authed(ctx).sub, 'flashcard', ctx.params.id, ctx.body) }));
  router.delete('/api/flashcards/:id', async (ctx) => { await content.deleteItem(authed(ctx).sub, 'flashcard', ctx.params.id); return { ok: true }; });
   // prompt mẫu + giới hạn đề 3 phần
  router.post('/api/quizzes/parse', async (ctx) => { authed(ctx); return { ok: true, preview: previewQuiz(ctx.body) }; });   // xem trước / bắt lỗi đề 3 phần
  for (const [type, seg] of [['essay', 'essays'], ['quiz', 'quizzes']]) {
    router.get(`/api/${seg}/:id`, async (ctx) => { const uid = authed(ctx).sub; const item = await content.getItem(uid, type, ctx.params.id); const shareId = await content.shareIdOf(uid, ctx.params.id).catch(() => null); return { ok: true, item: shareId ? { ...item, shareId } : item }; });
    router.put(`/api/${seg}/:id`, async (ctx) => ({ ok: true, item: await content.putItem(authed(ctx).sub, type, ctx.params.id, ctx.body) }));
    router.delete(`/api/${seg}/:id`, async (ctx) => { await content.deleteItem(authed(ctx).sub, type, ctx.params.id); return { ok: true }; });
  }

  // ── Bài nộp ──
  router.get('/api/submissions', async (ctx) => ({ ok: true, submissions: await content.listSubmissions(authed(ctx).sub, { itemId: ctx.query.get('itemId') || undefined, limit: Number(ctx.query.get('limit')) || 100 }) }));
  router.get('/api/submissions/:id', async (ctx) => ({ ok: true, submission: await content.getSubmission(authed(ctx).sub, ctx.params.id) }));
  router.put('/api/submissions/:id', async (ctx) => ({ ok: true, submission: await content.submit(authed(ctx).sub, ctx.params.id, ctx.body) }));
  router.patch('/api/submissions/:id', async (ctx) => ({ ok: true, submission: await content.selfGrade(authed(ctx).sub, ctx.params.id, ctx.body) }));
  router.post('/api/submissions/:id/ai-grade', async (ctx) => {
    const a = await authedLive(ctx); if (!allow('ai:' + a.sub, 15, 3600e3)) throw new HttpError(429, 'Chấm AI quá nhiều lần trong 1 giờ', 'RATE');
    const u = await auth.me(a);
    return { ok: true, submission: await content.aiGrade(a.sub, ctx.params.id, { provider: ctx.body.provider, model: ctx.body.model, studentName: u.displayName || u.username }) };
  });
  router.post('/api/submissions/:id/ai-analyze', async (ctx) => {
    const a = await authedLive(ctx); if (!allow('ai:' + a.sub, 15, 3600e3)) throw new HttpError(429, 'Dùng AI quá nhiều lần trong 1 giờ', 'RATE');
    const u = await auth.me(a);
    return { ok: true, submission: await content.aiAnalyze(a.sub, ctx.params.id, { provider: ctx.body.provider, model: ctx.body.model, studentName: u.displayName }) };
  });
  router.delete('/api/submissions/:id', async (ctx) => { await content.deleteSubmission(authed(ctx).sub, ctx.params.id); return { ok: true }; });


  // ── Chia sẻ bài trắc nghiệm / tự luận (người làm phải đăng nhập; chủ bài thấy tên, người làm chỉ thấy bài + điểm của mình) ──
  router.post('/api/shares', async (ctx) => ({ ok: true, ...(await content.createShare(authed(ctx).sub, ctx.body.type || 'quiz', ctx.body.itemId)) }));
  router.get('/api/share-link/:owner/:item', async (ctx) => ({ ok: true, ...(await content.resolveShare(authed(ctx).sub, ctx.params.owner, ctx.params.item)) }));
  router.patch('/api/shares/:sid', async (ctx) => ({ ok: true, ...(await content.setShareEnabled(authed(ctx).sub, ctx.params.sid, ctx.body.enabled !== false)) }));
  router.get('/api/shares/:sid', async (ctx) => ({ ok: true, ...(await content.getShared(authed(ctx).sub, ctx.params.sid)) }));
  router.get('/api/shares/:sid/history', async (ctx) => ({ ok: true, ...(await content.sharedHistory(authed(ctx).sub, ctx.params.sid)) }));
  router.put('/api/shares/:sid/submissions/:id', async (ctx) => {
    const a = authed(ctx); const u = await auth.me(a);
    return { ok: true, submission: await content.submitShared(a.sub, u.displayName || u.username, ctx.params.sid, ctx.params.id, ctx.body) };
  });
  router.get('/api/shares/:sid/images/:id', async (ctx) => {
    const r = await content.sharedImage(authed(ctx).sub, ctx.params.sid, ctx.params.id);
    return { binary: r.data, mime: r.mime };
  });

  // ── Ảnh (body nhị phân, không JSON) ──
  router.post('/api/images', async (ctx) => {
    const a = authed(ctx); if (!allow('img:' + a.sub, 60, 3600e3)) throw new HttpError(429, 'Tải ảnh quá nhiều', 'RATE');
    const r = await images.upload(a.sub, ctx.raw, ctx.req.headers['x-image-name']);
    return { ok: true, image: r };
  }, { rawLimit: cfg.maxImageBytes, status: 201 });
  router.get('/api/images/:id', async (ctx) => {
    const r = await images.download(authed(ctx).sub, ctx.params.id);
    return { binary: r.data, mime: r.mime };
  });
  router.delete('/api/images/:id', async (ctx) => ({ ok: true, removed: await images.remove(authed(ctx).sub, ctx.params.id) }));

  // ── Webhook GitHub (thân thô để kiểm tra HMAC) ──
  router.post('/webhooks/github', async (ctx) => wh.handle(ctx.raw, ctx.req.headers), { rawLimit: 2 * 1024 * 1024 });

  // ── Cron: dọn commit repo ACCOUNT ──
  router.get('/api/cron/prune', async (ctx) => {
    if (cfg.cronSecret && !safeEqual(String(ctx.req.headers.authorization || ''), `Bearer ${cfg.cronSecret}`)) throw new HttpError(401, 'unauthorized', 'UNAUTHORIZED');
    if (!cfg.cronSecret) throw new HttpError(503, 'Chưa đặt CRON_SECRET', 'NO_SECRET');
    if (cfg.dataRepo === cfg.accountRepo) return { ok: true, skipped: 'ACCOUNT và DATA cùng một repo — không dọn để bảo toàn lịch sử bài' };
    const result = await pruneRepo(gh, cfg.accountRepo, { branch: cfg.branch, days: cfg.pruneDays, maxReplay: cfg.pruneMaxReplay, apply: ctx.query.get('dry') !== '1' });
    return { ok: true, repo: cfg.accountRepo, ...result };
  });

  async function handler(req, res) {
    const cors = corsHeaders(req, cfg);
    const url = new URL(req.url || '/', 'http://x');
    try {
      if (req.method === 'OPTIONS') return send(res, 204, cors, '');
      const m = router.match(req.method, url.pathname.replace(/\/+$/, '') || '/');
      if (!m.route) {
        if (url.pathname === '/' ) return sendJson(res, 200, { ok: true, service: 'tu-luyen-thi-cntt-utc-mnha', hint: 'Dùng /api/health' }, cors);
        throw new HttpError(m.pathMatched ? 405 : 404, m.pathMatched ? 'Sai phương thức' : 'Không tìm thấy', 'NOT_FOUND');
      }
      const ctx = { req, res, params: m.params, query: url.searchParams, body: {}, raw: null };
      if (!['GET', 'HEAD', 'DELETE'].includes(req.method)) {
        ctx.raw = await readBody(req, m.route.opts.rawLimit || 1024 * 1024);
        if (!m.route.opts.rawLimit) ctx.body = parseJson(ctx.raw);
      }
      if (!allow('g:' + ip(req), 600, 60e3)) throw new HttpError(429, 'Quá nhiều yêu cầu', 'RATE');
      const out = await m.route.handler(ctx);
      if (out && out.binary) return send(res, 200, { ...cors, 'Content-Type': out.mime, 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff', 'Content-Length': out.binary.length }, out.binary);
      return sendJson(res, m.route.opts.status || 200, out, cors);
    } catch (e) {
      let status = 500, msg = 'Lỗi máy chủ', code = 'SERVER';
      if (e instanceof HttpError) { status = e.status; msg = e.message; code = e.code || 'ERROR'; }
      else if (e instanceof GitHubError) { status = e.limited ? 503 : 502; msg = e.limited ? 'GitHub đang giới hạn tốc độ, thử lại sau ít giây' : 'Kho dữ liệu GitHub tạm thời lỗi, thử lại'; code = 'GITHUB'; console.error('[github]', e.status, e.message); }
      else console.error('[server]', e);
      const extra = { ...cors }; if (e && e.retryAfter) extra['Retry-After'] = String(e.retryAfter);
      return sendJson(res, status, { ok: false, error: msg, code, ...(e && e.errors ? { errors: e.errors } : {}) }, extra);
    }
  }

  return { handler, cfg, gh, store, images, content, auth, webhook: wh };
}

module.exports = { createApp };
