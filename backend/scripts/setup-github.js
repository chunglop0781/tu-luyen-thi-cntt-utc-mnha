'use strict';
/**
 * Chạy 1 lần: tạo repo private (account, data, image đầu tiên) và gắn webhook push → /webhooks/github.
 *   node scripts/setup-github.js
 * Cần .env có GITHUB_TOKEN, GITHUB_OWNER, GITHUB_WEBHOOK_SECRET, PUBLIC_API_URL.
 */
require('./env')();
const { config } = require('../src/config');
const { GitHub } = require('../src/github');
const { createWebhook } = require('../src/services/webhook');

(async () => {
  const cfg = config();
  if (!cfg.token || !cfg.owner) throw new Error('Thiếu GITHUB_TOKEN / GITHUB_OWNER');
  const gh = new GitHub({ token: cfg.token, owner: cfg.owner, branch: cfg.branch });
  const wh = createWebhook({ cfg, store: null, images: null });
  for (const name of [...new Set([cfg.accountRepo, cfg.dataRepo, cfg.imagePrefix])]) {
    if (await gh.getRepo(name)) console.log(`✓ ${cfg.owner}/${name} đã có`);
    else { await gh.createRepo(name, 'tu-luyen-thi-cntt-utc-mnha'); console.log(`+ đã tạo private ${cfg.owner}/${name}`); }
    const r = await wh.ensureHook(gh, name);
    console.log(r.skipped ? '  ! bỏ qua webhook (thiếu PUBLIC_API_URL hoặc GITHUB_WEBHOOK_SECRET)' : `  ✓ webhook ${r.created ? 'đã tạo' : 'đã cập nhật'} → ${cfg.publicApiUrl}/webhooks/github`);
  }
  console.log('Xong. Repo ảnh -1, -2… sẽ tự sinh (kèm webhook) khi đầy.');
})().catch((e) => { console.error('❌', e.message); process.exit(1); });
