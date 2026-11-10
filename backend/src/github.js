'use strict';
/**
 * Client GitHub REST mỏng (fetch thuần, không Octokit) — tự retry lỗi tạm, hỗ trợ ETag (304 không tốn rate-limit).
 * `fetchImpl` có thể thay bằng bản giả khi test.
 */
const { sleep } = require('./util');

class GitHubError extends Error {
  constructor(status, message, extra = {}) { super(message); this.status = status; Object.assign(this, extra); }
}

const encPath = (p) => String(p).split('/').map(encodeURIComponent).join('/');

class GitHub {
  constructor({ token, owner, branch = 'main', fetchImpl, apiBase = 'https://api.github.com', timeoutMs = 20000 }) {
    this.token = token; this.owner = owner; this.branch = branch;
    this.fetch = fetchImpl || ((...a) => fetch(...a));
    this.apiBase = apiBase; this.timeoutMs = timeoutMs;
  }

  /** Gọi API. Trả { status, headers, body } — body là JSON, Buffer (raw=true) hoặc null (204/304). */
  async req(method, path, { body, headers = {}, raw = false, retries = 3, okStatus = [] } = {}) {
    let lastErr;
    for (let attempt = 0; attempt <= retries; attempt++) {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), this.timeoutMs);
      try {
        const res = await this.fetch(this.apiBase + path, {
          method,
          signal: ac.signal,
          headers: {
            Authorization: `Bearer ${this.token}`,
            Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
            'User-Agent': 'tu-luyen-thi-cntt-utc-mnha',
            ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
            ...headers,
          },
          body: body !== undefined ? JSON.stringify(body) : undefined,
        });
        clearTimeout(timer);
        const h = {}; res.headers.forEach((v, k) => { h[k.toLowerCase()] = v; });
        if (res.status === 204 || res.status === 304) return { status: res.status, headers: h, body: null };
        const buf = Buffer.from(await res.arrayBuffer());
        if (res.status >= 200 && res.status < 300) {
          return { status: res.status, headers: h, body: raw ? buf : (buf.length ? JSON.parse(buf.toString('utf8')) : null) };
        }
        let msg = ''; try { msg = JSON.parse(buf.toString('utf8')).message || ''; } catch { msg = buf.toString('utf8').slice(0, 200); }
        const retryAfter = Number(h['retry-after'] || 0);
        const limited = res.status === 429 || (res.status === 403 && (retryAfter || h['x-ratelimit-remaining'] === '0' || /rate limit|abuse/i.test(msg)));
        if ((res.status >= 500 || limited) && attempt < retries) {
          await sleep(limited && retryAfter ? Math.min(retryAfter, 5) * 1000 : 300 * 2 ** attempt + Math.random() * 200);
          continue;
        }
        if (okStatus.includes(res.status)) return { status: res.status, headers: h, body: null };
        throw new GitHubError(limited ? 503 : res.status, msg || `GitHub ${res.status}`, { limited, retryAfter, ghStatus: res.status });
      } catch (e) {
        clearTimeout(timer);
        if (e instanceof GitHubError) throw e;
        lastErr = e;
        if (attempt < retries) { await sleep(300 * 2 ** attempt + Math.random() * 200); continue; }
        throw new GitHubError(503, `Không gọi được GitHub: ${e.name === 'AbortError' ? 'quá thời gian' : e.message}`, { network: true });
      }
    }
    throw lastErr;
  }

  repoPath(repo) { return `/repos/${this.owner}/${repo}`; }

  /** Đọc file → { sha, buffer, etag } | null (404). Tự dùng blob API nếu file > 1MB. */
  async getFile(repo, path, { etag } = {}) {
    const r = await this.req('GET', `${this.repoPath(repo)}/contents/${encPath(path)}?ref=${encodeURIComponent(this.branch)}`, {
      headers: etag ? { 'If-None-Match': etag } : {}, okStatus: [404],
    });
    if (r.status === 404) return null;
    if (r.status === 304) return { notModified: true, etag };
    const m = r.body;
    if (Array.isArray(m) || m.type !== 'file') throw new GitHubError(400, `${path} không phải file`);
    let buffer;
    if (m.content) buffer = Buffer.from(m.content, 'base64');
    else if (!m.size) buffer = Buffer.alloc(0);
    else buffer = (await this.req('GET', `${this.repoPath(repo)}/git/blobs/${m.sha}`, { raw: true })).body;
    return { sha: m.sha, buffer, etag: r.headers.etag };
  }

  /** Liệt kê tên file trong thư mục (tối đa 1000). */
  async listDir(repo, dir) {
    const r = await this.req('GET', `${this.repoPath(repo)}/contents/${encPath(dir)}?ref=${encodeURIComponent(this.branch)}`, { okStatus: [404] });
    if (r.status === 404 || !Array.isArray(r.body)) return [];
    return r.body.filter((x) => x.type === 'file').map((x) => ({ name: x.name, path: x.path, sha: x.sha, size: x.size }));
  }

  /** Ghi file. Không có `sha` = tạo mới (422 nếu đã tồn tại). Có `sha` = cập nhật (409/422 nếu sha cũ). */
  async putFile(repo, path, buffer, { message, sha } = {}) {
    const r = await this.req('PUT', `${this.repoPath(repo)}/contents/${encPath(path)}`, {
      body: { message: message || `update ${path}`, content: buffer.toString('base64'), branch: this.branch, ...(sha ? { sha } : {}),
        committer: { name: 'UTC Practice Bot', email: 'bot@users.noreply.github.com' } },
    });
    return { sha: r.body.content.sha, commit: r.body.commit && r.body.commit.sha };
  }

  async deleteFile(repo, path, sha, message) {
    await this.req('DELETE', `${this.repoPath(repo)}/contents/${encPath(path)}`, {
      body: { message: message || `delete ${path}`, sha, branch: this.branch },
    });
  }

  async getRepo(repo) {
    const r = await this.req('GET', this.repoPath(repo), { okStatus: [404] });
    return r.status === 404 ? null : r.body;
  }
  async createRepo(name, description) {
    return (await this.req('POST', '/user/repos', { body: { name, private: true, auto_init: true, description } })).body;
  }
  async listHooks(repo) { return (await this.req('GET', `${this.repoPath(repo)}/hooks?per_page=100`)).body || []; }
  async createHook(repo, url, secret) {
    return (await this.req('POST', `${this.repoPath(repo)}/hooks`, {
      body: { name: 'web', active: true, events: ['push'], config: { url, content_type: 'json', secret, insecure_ssl: '0' } },
    })).body;
  }
  async updateHook(repo, id, url, secret) {
    return (await this.req('PATCH', `${this.repoPath(repo)}/hooks/${id}`, {
      body: { active: true, events: ['push'], config: { url, content_type: 'json', secret, insecure_ssl: '0' } },
    })).body;
  }

  // ── Git data (dùng cho prune) ──
  async getRef(repo, branch) { return (await this.req('GET', `${this.repoPath(repo)}/git/ref/heads/${encPath(branch)}`)).body; }
  async updateRef(repo, branch, sha, force) { return (await this.req('PATCH', `${this.repoPath(repo)}/git/refs/heads/${encPath(branch)}`, { body: { sha, force: !!force } })).body; }
  async getCommit(repo, sha) { return (await this.req('GET', `${this.repoPath(repo)}/git/commits/${sha}`)).body; }
  async createCommit(repo, c) { return (await this.req('POST', `${this.repoPath(repo)}/git/commits`, { body: c })).body; }
  async listCommits(repo, { sha, since, page = 1, perPage = 100 } = {}) {
    const q = new URLSearchParams({ per_page: String(perPage), page: String(page) });
    if (sha) q.set('sha', sha);
    if (since) q.set('since', since);
    const r = await this.req('GET', `${this.repoPath(repo)}/commits?${q}`);
    return { items: r.body || [], link: r.headers.link || '' };
  }
}

module.exports = { GitHub, GitHubError };
