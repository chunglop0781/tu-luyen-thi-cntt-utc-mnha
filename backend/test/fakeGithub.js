'use strict';
/** GitHub giả lập trong RAM (đủ endpoint backend dùng) để test mà không cần mạng. */
const crypto = require('crypto');
const sha1 = (b) => crypto.createHash('sha1').update(b).digest('hex');

class FakeGitHub {
  constructor(owner = 'me') {
    this.owner = owner; this.repos = new Map(); this.hooks = new Map();
    this.clock = () => Date.now(); this.calls = []; this.failures = [];
    this.blobs = new Map();
  }
  ensure(name) {
    if (this.repos.has(name)) return this.repos.get(name);
    const r = { name, private: true, files: new Map(), commits: new Map(), head: null, trees: new Map() };
    this.repos.set(name, r); this.hooks.set(name, []);
    this._commit(r, 'Initial commit'); return r;
  }
  _tree(r) { const s = [...r.files].map(([p, f]) => p + ':' + f.sha).sort().join('|'); const t = sha1('tree' + s); r.trees.set(t, new Map(r.files)); return t; }
  _commit(r, message, at) {
    const tree = this._tree(r); const d = new Date(at || this.clock()).toISOString();
    const sha = sha1(tree + message + d + (r.head || '') + Math.random());
    const who = { name: 'bot', email: 'b@x', date: d };
    r.commits.set(sha, { sha, tree: { sha: tree }, parents: r.head ? [{ sha: r.head }] : [], message, author: who, committer: who });
    r.head = sha; return sha;
  }
  seedCommit(repo, path, content, atMs) { const r = this.ensure(repo); const b = Buffer.from(content); r.files.set(path, { buf: b, sha: sha1(b) }); return this._commit(r, `seed ${path}`, atMs); }
  file(repo, path) { const f = this.repos.get(repo) && this.repos.get(repo).files.get(path); return f ? f.buf : null; }
  chainLength(repo) { const r = this.repos.get(repo); let n = 0, c = r.head; while (c) { n++; const p = r.commits.get(c).parents[0]; c = p && p.sha; } return n; }

  fetch = async (url, opts = {}) => {
    const u = new URL(url); const method = opts.method || 'GET'; this.calls.push(`${method} ${u.pathname}`);
    if (this.failures.length) { const f = this.failures.shift(); return new Response(JSON.stringify({ message: 'boom' }), { status: f }); }
    const j = (status, obj, headers = {}) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json', ...headers } });
    const body = opts.body ? JSON.parse(opts.body) : {};
    const p = decodeURIComponent(u.pathname); let m;
    const H = opts.headers || {};
    if (method === 'POST' && p === '/user/repos') { if (this.repos.has(body.name)) return j(422, { message: 'name already exists' }); const r = this.ensure(body.name); r.private = body.private; return j(201, { name: body.name }); }
    if ((m = /^\/repos\/([^/]+)\/([^/]+)(\/.*)?$/.exec(p))) {
      const [, , repo, rest = ''] = m; const r = this.repos.get(repo);
      if (!r) return j(404, { message: 'Not Found' });
      if (method === 'GET' && rest === '') return j(200, { name: repo, private: r.private, size: Math.ceil([...r.files.values()].reduce((s, f) => s + f.buf.length, 0) / 1024) });
      if ((m = /^\/contents\/(.+)$/.exec(rest))) {
        const path = m[1], f = r.files.get(path);
        if (method === 'GET') {
          if (f) { const et = `"${f.sha}"`; if (H['If-None-Match'] === et) return new Response(null, { status: 304 });
            const big = f.buf.length > 1024 * 1024; return j(200, { type: 'file', sha: f.sha, size: f.buf.length, content: big ? '' : f.buf.toString('base64'), encoding: big ? 'none' : 'base64' }, { etag: et }); }
          const pre = path.replace(/\/$/, '') + '/'; const kids = [...r.files].filter(([k]) => k.startsWith(pre) && !k.slice(pre.length).includes('/'));
          if (kids.length) return j(200, kids.map(([k, v]) => ({ type: 'file', name: k.slice(pre.length), path: k, sha: v.sha, size: v.buf.length })));
          return j(404, { message: 'Not Found' });
        }
        if (method === 'PUT') {
          if (f && !body.sha) return j(422, { message: 'Invalid request.\n\n"sha" wasn\'t supplied.' });
          if (f && body.sha !== f.sha) return j(409, { message: `${path} does not match ${body.sha}` });
          if (!f && body.sha) return j(404, { message: 'Not Found' });
          const buf = Buffer.from(body.content, 'base64'); const sha = sha1(buf); r.files.set(path, { buf, sha }); this.blobs.set(sha, buf);
          const c = this._commit(r, body.message); return j(f ? 200 : 201, { content: { sha }, commit: { sha: c } });
        }
        if (method === 'DELETE') { if (!f) return j(404, { message: 'Not Found' }); if (body.sha !== f.sha) return j(409, { message: 'sha mismatch' }); r.files.delete(path); return j(200, { commit: { sha: this._commit(r, body.message) } }); }
      }
      if ((m = /^\/git\/blobs\/(.+)$/.exec(rest))) { const b = this.blobs.get(m[1]) || [...r.files.values()].find((x) => x.sha === m[1])?.buf; return b ? new Response(b, { status: 200 }) : j(404, { message: 'nf' }); }
      if (rest.startsWith('/git/ref/heads/') && method === 'GET') return j(200, { object: { sha: r.head } });
      if (rest.startsWith('/git/refs/heads/') && method === 'PATCH') { if (!r.commits.has(body.sha)) return j(422, { message: 'bad sha' }); r.head = body.sha; r.files = new Map(r.trees.get(r.commits.get(body.sha).tree.sha)); return j(200, { object: { sha: r.head } }); }
      if ((m = /^\/git\/commits\/(.+)$/.exec(rest)) && method === 'GET') { const c = r.commits.get(m[1]); return c ? j(200, c) : j(404, { message: 'nf' }); }
      if (rest === '/git/commits' && method === 'POST') {
        const tree = body.tree; const sha = sha1(tree + body.message + JSON.stringify(body.parents) + JSON.stringify(body.committer));
        r.commits.set(sha, { sha, tree: { sha: tree }, parents: body.parents.map((x) => ({ sha: x })), message: body.message, author: body.author, committer: body.committer }); return j(201, r.commits.get(sha));
      }
      if (rest === '/commits' && method === 'GET') {
        let c = u.searchParams.get('sha'); if (c === 'main') c = r.head; const since = u.searchParams.get('since');
        const all = []; while (c) { const x = r.commits.get(c); if (since && x.committer.date < since) break; all.push({ sha: x.sha, commit: x, parents: x.parents }); const par = x.parents[0]; c = par && par.sha; }
        const per = Number(u.searchParams.get('per_page')), pg = Number(u.searchParams.get('page')); return j(200, all.slice((pg - 1) * per, pg * per));
      }
      if (rest.startsWith('/hooks')) {
        const list = this.hooks.get(repo);
        if (method === 'GET') return j(200, list);
        if (method === 'POST') { const h = { id: list.length + 1, config: body.config }; list.push(h); return j(201, h); }
        if (method === 'PATCH') { const h = list.find((x) => String(x.id) === rest.split('/')[2]); h.config = body.config; return j(200, h); }
      }
    }
    return j(404, { message: 'unhandled ' + method + ' ' + p });
  };
}
module.exports = { FakeGitHub, sha1 };
