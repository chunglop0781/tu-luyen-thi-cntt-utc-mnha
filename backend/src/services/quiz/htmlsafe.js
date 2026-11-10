'use strict';
/** Làm sạch HTML ngắn (giải thích "++)", nội dung chùm, mô tả) — chuyển từ bản cũ services/sanitizeService.js (bộ làm sạch không cần package). */
const ALLOWED = ['b', 'i', 'u', 'strong', 'em', 'br', 'p', 'ul', 'ol', 'li', 'code', 'pre', 'sub', 'sup', 'span', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'a'];
const TAG_ALT = ALLOWED.join('|');
const RE_STACKED_ESC = /&(?:amp;)+(lt|gt|quot|#0*39|#x0*27|amp);/gi;
const RE_ESCAPED_BARE_TAG = new RegExp('&lt;(/?)(' + TAG_ALT + ')(\\s*/?)&gt;', 'gi');
const RE_STRAY_LT = new RegExp('<(?!/?(?:' + TAG_ALT + ')(?=[\\s/>])[^<>]*>)', 'gi');
const VOID_TAGS = new Set(['br']);

// Idempotent: lưu bao nhiêu lần cũng không đổi (không escape chồng; "i<n" giữ là chữ; thẻ allowlist giữ là thẻ)
const normalizeInput = (raw) => String(raw).replace(RE_STACKED_ESC, '&$1;').replace(RE_ESCAPED_BARE_TAG, '<$1$2$3>').replace(RE_STRAY_LT, '&lt;');

function fallbackSanitize(input) {
  const text = (t) => t.replace(/&(?!(?:#\d+|#x[0-9a-f]+|[a-z][a-z0-9]*);)/gi, '&amp;').replace(/>/g, '&gt;');
  const re = /<(\/?)([a-z][a-z0-9]*)([^<>]*)>/gi;
  const stack = []; let out = '', last = 0, m;
  while ((m = re.exec(input))) {
    out += text(input.slice(last, m.index)); last = re.lastIndex;
    const closing = m[1] === '/', name = m[2].toLowerCase(), attrs = m[3] || '';
    if (!ALLOWED.includes(name)) continue;                 // thẻ lạ: bỏ thẻ, giữ chữ
    if (closing) { const at = stack.lastIndexOf(name); if (at === -1) continue; while (stack.length > at) out += '</' + stack.pop() + '>'; continue; }
    if (VOID_TAGS.has(name)) { out += '<' + name + '>'; continue; }
    let extra = '';
    if (name === 'a') {
      const hr = /href\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attrs); const url = hr ? (hr[1] || hr[2] || '').trim() : '';
      extra = ' href="' + (/^https:\/\//i.test(url) ? url.replace(/"/g, '&quot;') : '') + '" rel="noopener noreferrer" target="_blank"';
    } else if (name === 'th' || name === 'td') {
      for (const k of ['colspan', 'rowspan']) { const v = new RegExp(k + '\\s*=\\s*["\']?(\\d{1,2})', 'i').exec(attrs); if (v) extra += ' ' + k + '="' + v[1] + '"'; }
    }
    out += '<' + name + extra + '>'; stack.push(name);
  }
  out += text(input.slice(last));
  while (stack.length) out += '</' + stack.pop() + '>';
  return out;
}

function sanitizeExplanationHtml(raw, opts = {}) {
  if (raw == null || raw === '') return '';
  return fallbackSanitize(normalizeInput(String(raw).slice(0, opts.maxLength || 3000))).trim();
}
const sanitizeClusterHtml = (raw, opts = {}) => sanitizeExplanationHtml(raw, { maxLength: opts.maxLength || 10000 });

/** HTML đã lưu → dạng dễ sửa trong ô nhập. */
const htmlToEditable = (html) => (html == null ? html : String(html).replace(RE_STACKED_ESC, '&$1;').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#0*39;|&#x0*27;/gi, "'").replace(/&amp;/gi, '&'));

module.exports = { sanitizeExplanationHtml, sanitizeClusterHtml, htmlToEditable };
