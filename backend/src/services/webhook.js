'use strict';
/** Webhook GitHub (push) cho repo account / data / image*: xác thực HMAC-SHA256, làm mới cache, ghi nhận dung lượng repo ảnh. */
const { hmacHex, safeEqual } = require('../crypto');
const { HttpError } = require('../http');

function createWebhook({ cfg, store, images }) {
  const stats = { received: 0, lastAt: null, lastRepo: null, lastEvent: null };

  function repoKnown(name) {
    return name === cfg.accountRepo || name === cfg.dataRepo || name === cfg.imagePrefix || name.startsWith(cfg.imagePrefix + '-');
  }

  function handle(rawBody, headers) {
    if (!cfg.webhookSecret) throw new HttpError(503, 'Chưa cấu hình GITHUB_WEBHOOK_SECRET', 'NO_SECRET');
    const sig = String(headers['x-hub-signature-256'] || '');
    if (!safeEqual(sig, 'sha256=' + hmacHex(cfg.webhookSecret, rawBody))) throw new HttpError(401, 'Chữ ký webhook không hợp lệ', 'BAD_SIGNATURE');
    const event = String(headers['x-github-event'] || '');
    let p; try { p = JSON.parse(rawBody.toString('utf8')); } catch { throw new HttpError(400, 'Payload không phải JSON', 'BAD_JSON'); }
    if (event === 'ping') return { ok: true, pong: true, zen: p.zen };
    if (event !== 'push') return { ok: true, ignored: event };
    const repo = p.repository && p.repository.name;
    if (!repo || !repoKnown(repo)) return { ok: true, ignored: 'repo lạ' };
    const paths = new Set();
    for (const c of p.commits || []) for (const f of [...(c.added || []), ...(c.modified || []), ...(c.removed || [])]) paths.add(f);
    // Nhiều commit/bị cắt bớt trong payload → xoá cả cache repo cho chắc
    if (paths.size === 0 || (p.commits || []).length >= 20) store.invalidate(repo); else store.invalidate(repo, [...paths]);
    if (p.repository.size != null && repo.startsWith(cfg.imagePrefix)) images.noteSize(repo, Number(p.repository.size) * 1024);
    stats.received++; stats.lastAt = new Date().toISOString(); stats.lastRepo = repo; stats.lastEvent = event;
    return { ok: true, repo, invalidated: paths.size };
  }

  /** Tự gắn webhook push cho repo (nếu có PUBLIC_API_URL + secret). */
  async function ensureHook(gh, repo) {
    if (!cfg.publicApiUrl || !cfg.webhookSecret) return { skipped: true };
    const url = `${cfg.publicApiUrl}/webhooks/github`;
    const hooks = await gh.listHooks(repo);
    const mine = hooks.find((h) => h.config && h.config.url === url);
    if (mine) { await gh.updateHook(repo, mine.id, url, cfg.webhookSecret); return { updated: true }; }
    await gh.createHook(repo, url, cfg.webhookSecret);
    return { created: true };
  }

  return { handle, ensureHook, stats };
}

module.exports = { createWebhook };
