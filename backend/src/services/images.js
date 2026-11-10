'use strict';
/**
 * Ảnh mã hoá AES-256-GCM (không kiểm duyệt). Tự sinh repo <prefix>, <prefix>-1, <prefix>-2 … khi gần đầy 200MB.
 * id ảnh = "<chỉ số repo>.<hex>" → biết repo mà không cần tra sổ. Khoá AAD = uid ⇒ chỉ chủ ảnh giải mã được.
 */
const { HttpError } = require('../http');
const { deriveKey, encrypt, decrypt } = require('../crypto');
const { randomId } = require('../util');

const POOL_PATH = 'images/pool.json';
const OVERHEAD = 1024;

function detectMime(b) {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (b.length > 6 && /^GIF8[79]a$/.test(b.subarray(0, 6).toString('latin1'))) return 'image/gif';
  if (b.length > 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

function createImages({ cfg, gh, store, ensureWebhook = async () => {} }) {
  const key = () => deriveKey(cfg.encKey, 'image');
  const repoName = (i) => (i === 0 ? cfg.imagePrefix : `${cfg.imagePrefix}-${i}`);
  const ensured = new Set();
  const sizeHints = new Map();   // repoName → bytes (từ webhook push: repository.size, đơn vị KB)

  async function ensureRepo(name) {
    if (ensured.has(name)) return;
    if (!(await gh.getRepo(name))) {
      try { await gh.createRepo(name, 'Ảnh mã hoá của tu-luyen-thi-cntt-utc-mnha'); }
      catch (e) { if (!(await gh.getRepo(name))) throw e; }
    }
    ensured.add(name);
    ensureWebhook(name).catch(() => {});
  }

  function noteSize(name, bytes) { sizeHints.set(name, bytes); }

  /** Chọn repo còn chỗ; tạo repo mới nếu cần. Trả chỉ số repo. */
  async function pickRepo(need) {
    const cap = cfg.imageLimitBytes - cfg.imageReserveBytes;
    if (need + OVERHEAD > cap) throw new HttpError(413, 'Ảnh quá lớn', 'TOO_LARGE');
    let chosen;
    await store.update('data', POOL_PATH, (pool) => {
      const repos = pool.repos;
      let last = repos[repos.length - 1];
      const used = last ? Math.max(last.bytes, sizeHints.get(repoName(last.index)) || 0) : 0;
      if (!last || used + need + OVERHEAD > cap) {
        if (last) last.full = true;
        last = { index: last ? last.index + 1 : 0, bytes: 0, files: 0, createdAt: new Date().toISOString(), full: false };
        repos.push(last);
      }
      chosen = last.index;
      return pool;
    }, { message: 'image pool', defaultValue: { repos: [] } });
    await ensureRepo(repoName(chosen));
    return chosen;
  }

  async function upload(uid, buf, nameHint) {
    if (!buf.length) throw new HttpError(400, 'Ảnh rỗng', 'VALIDATION');
    if (buf.length > cfg.maxImageBytes) throw new HttpError(413, `Ảnh tối đa ${Math.round(cfg.maxImageBytes / 1048576)}MB (giới hạn payload của Vercel)`, 'TOO_LARGE');
    const mime = detectMime(buf);
    if (!mime) throw new HttpError(415, 'Chỉ nhận ảnh JPEG, PNG, GIF, WebP', 'BAD_TYPE');
    const mb = Buffer.from(mime);
    const plain = Buffer.concat([Buffer.from([mb.length]), mb, buf]);
    const blob = encrypt(key(), plain, uid);
    const index = await pickRepo(blob.length);
    const rid = randomId(12);
    const path = `i/${rid.slice(0, 2)}/${rid}.enc`;
    try { await gh.putFile(repoName(index), path, blob, { message: `img ${rid}` }); }
    catch (e) { ensured.delete(repoName(index)); await ensureRepo(repoName(index)); await gh.putFile(repoName(index), path, blob, { message: `img ${rid}` }); }
    await store.update('data', POOL_PATH, (pool) => {
      const r = pool.repos.find((x) => x.index === index); if (r) { r.bytes += blob.length + OVERHEAD; r.files += 1; }
      return pool;
    }, { message: 'image pool', defaultValue: { repos: [] } });
    return { id: `${index}.${rid}`, mime, bytes: buf.length };
  }

  function locate(id) {
    const m = /^(\d{1,3})\.([a-f0-9]{16,32})$/.exec(String(id));
    if (!m) throw new HttpError(404, 'Không có ảnh', 'NOT_FOUND');
    const rid = m[2];
    return { repo: repoName(Number(m[1])), path: `i/${rid.slice(0, 2)}/${rid}.enc` };
  }

  async function download(uid, id) {
    const { repo, path } = locate(id);
    const f = await gh.getFile(repo, path);
    if (!f) throw new HttpError(404, 'Không có ảnh', 'NOT_FOUND');
    let plain;
    try { plain = decrypt(key(), f.buffer, uid); } catch { throw new HttpError(404, 'Không có ảnh', 'NOT_FOUND'); }
    const n = plain[0];
    return { mime: plain.subarray(1, 1 + n).toString(), data: plain.subarray(1 + n) };
  }

  async function remove(uid, id) {
    const { repo, path } = locate(id);
    const f = await gh.getFile(repo, path);
    if (!f) return false;
    try { decrypt(key(), f.buffer, uid); } catch { return false; }   // không phải ảnh của người này
    await gh.deleteFile(repo, path, f.sha, `del img`);
    return true;
  }

  return { upload, download, remove, noteSize, repoName, detectMime };
}

module.exports = { createImages, detectMime };
