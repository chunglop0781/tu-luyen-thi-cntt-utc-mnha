'use strict';
/**
 * Dọn lịch sử commit repo ACCOUNT: gộp mọi commit cũ hơn N ngày thành 1 commit gốc (giữ nguyên nội dung HEAD),
 * phát lại các commit trong N ngày lên trên rồi force-update nhánh. Chỉ dùng GitHub API (không clone).
 * An toàn: kiểm tra cây thư mục đầu nhánh mới == cũ, nhánh không bị đẩy thêm giữa chừng, nếu không thì huỷ.
 * Quá nhiều commit trong cửa sổ (> maxReplay) → chỉ giữ maxReplay commit mới nhất (phần cũ hơn gộp vào gốc) để luôn kịp thời gian.
 */
async function pruneRepo(gh, repo, { branch, days = 5, maxReplay = 150, apply = true, now = Date.now(), log = () => {} }) {
  const cutoff = new Date(now - days * 86400000).toISOString();
  const head = (await gh.getRef(repo, branch)).object.sha;

  const recent = []; let truncated = false;
  for (let page = 1; ; page++) {
    const { items } = await gh.listCommits(repo, { sha: branch, since: cutoff, page });
    recent.push(...items);
    if (recent.length > maxReplay) { recent.length = maxReplay; truncated = true; break; }
    if (items.length < 100) break;
  }
  if (!recent.length) { const c = await gh.getCommit(repo, head); recent.push({ sha: head, commit: c, parents: c.parents }); }

  const oldest = recent[recent.length - 1];
  const parent = (oldest.parents || [])[0];
  if (!parent) return { status: 'noop', reason: 'lịch sử đã nằm gọn trong cửa sổ' };
  const P = await gh.getCommit(repo, parent.sha);
  if (!P.parents.length) return { status: 'noop', reason: 'đã được dọn trước đó' };
  if (!apply) return { status: 'dry-run', kept: recent.length, truncated };

  let prev = (await gh.createCommit(repo, {
    tree: P.tree.sha, parents: [], author: P.author, committer: P.committer,
    message: `Snapshot: gộp lịch sử trước ${cutoff.slice(0, 10)} (giữ ${days} ngày gần nhất)`,
  })).sha;
  for (const c of [...recent].reverse()) {
    const m = c.commit;
    prev = (await gh.createCommit(repo, { tree: m.tree.sha, parents: [prev], message: m.message, author: m.author, committer: m.committer })).sha;
  }
  const [mine, old, cur] = await Promise.all([gh.getCommit(repo, prev), gh.getCommit(repo, head), gh.getRef(repo, branch)]);
  if (mine.tree.sha !== old.tree.sha) throw new Error('Cây thư mục sau khi dọn khác ban đầu — huỷ, chưa sửa gì');
  if (cur.object.sha !== head) { log('nhánh vừa có commit mới — bỏ lượt này'); return { status: 'raced' }; }
  await gh.updateRef(repo, branch, prev, true);
  return { status: 'pruned', kept: recent.length, truncated, head: prev };
}

module.exports = { pruneRepo };
