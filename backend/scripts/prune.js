'use strict';
// Dọn commit repo ACCOUNT bằng tay.  Xem trước: node scripts/prune.js   Chạy thật: node scripts/prune.js --yes
require('./env')();
const { config } = require('../src/config');
const { GitHub } = require('../src/github');
const { pruneRepo } = require('../src/services/prune');
(async () => {
  const cfg = config(); const apply = process.argv.includes('--yes');
  const gh = new GitHub({ token: cfg.token, owner: cfg.owner, branch: cfg.branch });
  console.log(apply ? 'CHẠY THẬT' : 'XEM TRƯỚC (thêm --yes để chạy thật)');
  console.log(await pruneRepo(gh, cfg.accountRepo, { branch: cfg.branch, days: cfg.pruneDays, maxReplay: cfg.pruneMaxReplay, apply, log: console.log }));
})().catch((e) => { console.error('❌', e.message); process.exit(1); });
