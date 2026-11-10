'use strict';
const { config, problems } = require('./config');
const { GitHub, GitHubError } = require('./github');
const { Store } = require('./store');
const { HttpError, Router, corsHeaders, readBody, parseJson, send, sendJson } = require('./http');
const { createAuth } = require('./services/auth');
const { createImages } = require('./services/images');
const { createContent } = require('./services/content');
const { createWebhook } = require('./services/webhook');
const { pruneRepo } = require('./services/prune');
const { parseQuizText } = require('./services/validate');
const { safeEqual } = require('./crypto');

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

function createApp({ env = process.env, fetchImpl, aiFetch } = {}) {
  const cfg = config(env);
  const gh = new GitHub({ token: cfg.token, owner: cfg.owner, branch: cfg.branch, fetchImpl });
  const store = new Store(gh, { account: cfg.accountRepo, data: cfg.dataRepo });
  const wh = createWebhook({ cfg, store, images: { noteSize: (n, b) => images.noteSize(n, b) } });
  const images = createImages({ cfg, gh, store, ensureWebhook: (r) => wh.ensureHook(gh, r) });
  const auth = createAuth({ cfg, store });
  const content = createContent({ cfg, store, images, fetchImpl: aiFetch });
  const allow = limiter();
  const router = new Router();

  const ip = (req) => String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  const ua = (req) => String(req.headers['user-agent'] || '');
  const authed = (ctx) => auth.authenticate(ctx.req);

  // ── Hệ thống ──
  router.get('/api/health', async (ctx) => {
    const out = { ok: true, service: 'tu-luyen-thi-cntt-utc-mnha', version: cfg.version, time: new Date().toISOString(), problems: problems(cfg) };
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
  router.post('/api/auth/login', async (ctx) => {
    if (!allow('login:' + ip(ctx.req), 20, 600e3) || !allow('loginu:' + String(ctx.body.username).toLowerCase(), 10, 600e3)) throw new HttpError(429, 'Thử đăng nhập quá nhiều lần, đợi vài phút', 'RATE');
    return { ok: true, ...(await auth.login(ctx.body, ua(ctx.req))) };
  });
  router.post('/api/auth/refresh', async (ctx) => ({ ok: true, ...(await auth.refresh(ctx.body.refreshToken)) }));
  router.post('/api/auth/logout', async (ctx) => { await auth.logout(ctx.body.refreshToken); return { ok: true }; });
  router.post('/api/auth/logout-all', async (ctx) => { const a = authed(ctx); await auth.revoke(a.sub, null); return { ok: true }; });
  router.post('/api/auth/change-password', async (ctx) => { await auth.changePassword(authed(ctx), ctx.body); return { ok: true }; });
  router.get('/api/me', async (ctx) => ({ ok: true, user: await auth.me(authed(ctx)) }));
  router.patch('/api/me', async (ctx) => ({ ok: true, user: await auth.updateProfile(authed(ctx), ctx.body) }));
  router.get('/api/me/sessions', async (ctx) => ({ ok: true, sessions: await auth.sessions(authed(ctx)) }));
  router.get('/api/me/vault', async (ctx) => ({ ok: true, vault: await content.readVault(authed(ctx).sub) }));
  router.put('/api/me/vault', async (ctx) => ({ ok: true, vault: await content.writeVault(authed(ctx).sub, ctx.body) }));

  // ── Bài tập ──
  router.get('/api/overview', async (ctx) => ({ ok: true, ...(await content.overview(authed(ctx).sub)) }));
  router.post('/api/reindex', async (ctx) => { await content.reindex(authed(ctx).sub); return { ok: true, ...(await content.overview(authed(ctx).sub)) }; });
  router.get('/api/export', async (ctx) => ({ ok: true, ...(await content.exportAll(authed(ctx).sub)) }));
  router.post('/api/quizzes/parse', async (ctx) => {
    authed(ctx); const questions = parseQuizText(ctx.body.text);
    if (!questions.length) throw new HttpError(400, 'Không đọc được câu hỏi nào', 'VALIDATION');
    return { ok: true, questions };
  });
  for (const [type, seg] of [['essay', 'essays'], ['quiz', 'quizzes']]) {
    router.get(`/api/${seg}/:id`, async (ctx) => ({ ok: true, item: await content.getItem(authed(ctx).sub, type, ctx.params.id) }));
    router.put(`/api/${seg}/:id`, async (ctx) => ({ ok: true, item: await content.putItem(authed(ctx).sub, type, ctx.params.id, ctx.body) }));
    router.delete(`/api/${seg}/:id`, async (ctx) => { await content.deleteItem(authed(ctx).sub, type, ctx.params.id); return { ok: true }; });
  }

  // ── Bài nộp ──
  router.get('/api/submissions', async (ctx) => ({ ok: true, submissions: await content.listSubmissions(authed(ctx).sub, { itemId: ctx.query.get('itemId') || undefined, limit: Number(ctx.query.get('limit')) || 100 }) }));
  router.get('/api/submissions/:id', async (ctx) => ({ ok: true, submission: await content.getSubmission(authed(ctx).sub, ctx.params.id) }));
  router.put('/api/submissions/:id', async (ctx) => ({ ok: true, submission: await content.submit(authed(ctx).sub, ctx.params.id, ctx.body) }));
  router.patch('/api/submissions/:id', async (ctx) => ({ ok: true, submission: await content.selfGrade(authed(ctx).sub, ctx.params.id, ctx.body) }));
  router.post('/api/submissions/:id/ai-grade', async (ctx) => {
    const a = authed(ctx); if (!allow('ai:' + a.sub, 15, 3600e3)) throw new HttpError(429, 'Chấm AI quá nhiều lần trong 1 giờ', 'RATE');
    return { ok: true, submission: await content.aiGrade(a.sub, ctx.params.id) };
  });
  router.delete('/api/submissions/:id', async (ctx) => { await content.deleteSubmission(authed(ctx).sub, ctx.params.id); return { ok: true }; });

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
      return sendJson(res, status, { ok: false, error: msg, code }, extra);
    }
  }

  return { handler, cfg, gh, store, images, content, auth, webhook: wh };
}

module.exports = { createApp };
