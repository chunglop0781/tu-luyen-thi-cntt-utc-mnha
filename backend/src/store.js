'use strict';
/**
 * Kho JSON trên GitHub: đọc có cache + ETag, ghi có khoá tuần tự theo repo + retry khi xung đột sha.
 * `repos` = { account: 'tên-repo', data: 'tên-repo' } — API dùng khoá logic, không dùng tên repo trực tiếp.
 */
const { sleep } = require('./util');
const { GitHubError } = require('./github');

class Store {
  constructor(gh, repos, { ttlMs = 15000 } = {}) {
    this.gh = gh; this.repos = repos; this.ttl = ttlMs;
    this.cache = new Map();      // `${repo}:${path}` → { at, sha, etag, data }
    this.locks = new Map();      // repo → Promise
  }

  repoOf(key) { const r = this.repos[key]; if (!r) throw new Error(`Repo logic không tồn tại: ${key}`); return r; }
  ck(repo, path) { return `${repo}:${path}`; }

  /** Xoá cache các đường dẫn (webhook gọi khi repo có push). */
  invalidate(repoName, paths) {
    if (!paths) { for (const k of this.cache.keys()) if (k.startsWith(repoName + ':')) this.cache.delete(k); return; }
    for (const p of paths) this.cache.delete(this.ck(repoName, p));
  }

  /** → { data, sha } | null */
  async read(key, path, { fresh = false } = {}) {
    const repo = this.repoOf(key), k = this.ck(repo, path), hit = this.cache.get(k);
    if (hit && !fresh && Date.now() - hit.at < this.ttl) return { data: structuredClone(hit.data), sha: hit.sha };
    const f = await this.gh.getFile(repo, path, { etag: hit && hit.etag });
    if (f === null) { this.cache.delete(k); return null; }
    if (f.notModified) { hit.at = Date.now(); return { data: structuredClone(hit.data), sha: hit.sha }; }
    const data = JSON.parse(f.buffer.toString('utf8'));
    this.cache.set(k, { at: Date.now(), sha: f.sha, etag: f.etag, data });
    return { data: structuredClone(data), sha: f.sha };
  }

  async withLock(repo, fn) {
    const prev = this.locks.get(repo) || Promise.resolve();
    let release; const mine = new Promise((r) => { release = r; });
    this.locks.set(repo, prev.then(() => mine));
    await prev;
    try { return await fn(); } finally { release(); }
  }

  async _put(repo, path, data, sha, message) {
    const r = await this.gh.putFile(repo, path, Buffer.from(JSON.stringify(data)), { message, sha });
    this.cache.set(this.ck(repo, path), { at: Date.now(), sha: r.sha, etag: undefined, data: structuredClone(data) });
    return r;
  }

  /** Tạo file mới; ném lỗi EXISTS nếu đã có. */
  async create(key, path, data, message) {
    const repo = this.repoOf(key);
    return this.withLock(repo, async () => {
      try { return await this._put(repo, path, data, undefined, message || `create ${path}`); }
      catch (e) {
        if (e instanceof GitHubError && (e.status === 422 || e.status === 409)) { const x = new Error('EXISTS'); x.code = 'EXISTS'; throw x; }
        throw e;
      }
    });
  }

  /** Đọc-sửa-ghi an toàn: fn(current|defaultValue) → giá trị mới (hoặc undefined = không ghi). */
  async update(key, path, fn, { message, defaultValue = null } = {}) {
    const repo = this.repoOf(key);
    return this.withLock(repo, async () => {
      for (let attempt = 0; attempt < 6; attempt++) {
        const cur = await this.read(key, path, { fresh: attempt > 0 });
        const next = await fn(cur ? cur.data : (defaultValue === null ? null : structuredClone(defaultValue)));
        if (next === undefined) return cur ? cur.data : null;
        try { await this._put(repo, path, next, cur ? cur.sha : undefined, message || `update ${path}`); return next; }
        catch (e) {
          if (e instanceof GitHubError && (e.status === 409 || e.status === 422) && attempt < 5) { this.cache.delete(this.ck(repo, path)); await sleep(150 * (attempt + 1) + Math.random() * 150); continue; }
          throw e;
        }
      }
    });
  }

  async write(key, path, data, message) { return this.update(key, path, () => data, { message }); }

  async remove(key, path, message) {
    const repo = this.repoOf(key);
    return this.withLock(repo, async () => {
      const cur = await this.read(key, path, { fresh: true });
      if (!cur) return false;
      await this.gh.deleteFile(repo, path, cur.sha, message || `delete ${path}`);
      this.cache.delete(this.ck(repo, path));
      return true;
    });
  }

  async list(key, dir) { return this.gh.listDir(this.repoOf(key), dir); }
}

module.exports = { Store };
