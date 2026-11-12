import { h } from './ui.js';

/* Biểu đồ điểm theo thời gian — chuyển từ public/js/historyChart.js của bản luyen-thi (SVG thuần, không thư viện).
   points: [{ t(ms), s(0–10), raw, max, m(1 = bài của chính mình), n(tên — chỉ chủ bài có), id(chỉ bài của mình) }]
   isOwner: chủ bài thấy tên từng người; người làm chỉ thấy điểm của CHÍNH MÌNH.
   onOpen(point): gọi khi bấm vào điểm có `id` (bài của mình). */

const COLORS = ['#b91c1c', '#dc2626', '#ea580c', '#f59e0b', '#eab308', '#84cc16', '#22c55e', '#0d9488', '#0ea5e9', '#4f46e5'];
const binOf = (s) => Math.max(0, Math.min(9, Math.floor(s)));
const NS = 'http://www.w3.org/2000/svg';
const H = 3600e3, D = 24 * H;
const W = 880, HT = 340, M = { l: 40, r: 22, t: 14, b: 34 }, PW = W - M.l - M.r, PH = HT - M.t - M.b;
const pad = (n) => (n < 10 ? '0' + n : '' + n);
const fmtNum = (n) => String(Math.round(n * 100) / 100);
const fmtDateTime = (t) => { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())} ${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`; };
const svgEl = (name, attrs, parent) => { const n = document.createElementNS(NS, name); for (const k in attrs) n.setAttribute(k, attrs[k]); if (parent) parent.appendChild(n); return n; };

function makeTicks(a, b) {
  const span = b - a, ticks = []; let d, step;
  if (span <= 2 * D + 1000) {
    step = span <= 6 * H ? 1 : (span <= 26 * H ? 3 : 6);
    d = new Date(a); d.setMinutes(0, 0, 0); if (d.getTime() < a) d.setHours(d.getHours() + 1);
    while (d.getHours() % step) d.setHours(d.getHours() + 1);
    while (d.getTime() <= b + 1000) { ticks.push({ t: d.getTime(), label: d.getHours() === 0 ? pad(d.getDate()) + '/' + pad(d.getMonth() + 1) : pad(d.getHours()) + ':00' }); d.setHours(d.getHours() + step); }
  } else if (span <= 70 * D) {
    step = span <= 10 * D ? 1 : (span <= 35 * D ? 5 : 7);
    d = new Date(a); d.setHours(0, 0, 0, 0); if (d.getTime() < a) d.setDate(d.getDate() + 1);
    while (d.getTime() <= b + 1000) { ticks.push({ t: d.getTime(), label: pad(d.getDate()) + '/' + pad(d.getMonth() + 1) }); d.setDate(d.getDate() + step); }
  } else if (span <= 4 * 366 * D) {
    step = Math.max(1, Math.ceil((span / (30.4 * D)) / 12));
    d = new Date(a); d.setDate(1); d.setHours(0, 0, 0, 0); if (d.getTime() < a) d.setMonth(d.getMonth() + 1);
    while (d.getTime() <= b + 1000) { ticks.push({ t: d.getTime(), label: pad(d.getMonth() + 1) + '/' + String(d.getFullYear()).slice(2) }); d.setMonth(d.getMonth() + step); }
  } else {
    step = Math.max(1, Math.ceil(span / (366 * D) / 10));
    d = new Date(a); d.setMonth(0, 1); d.setHours(0, 0, 0, 0); if (d.getTime() < a) d.setFullYear(d.getFullYear() + 1);
    while (d.getTime() <= b + 1000) { ticks.push({ t: d.getTime(), label: String(d.getFullYear()) }); d.setFullYear(d.getFullYear() + step); }
  }
  return ticks;
}

export function scoreChart({ isOwner, points = [], onOpen }) {
  let state = { type: 'preset', preset: 'all' };
  const today = new Date();

  const rangeLabel = h('span', { class: 'hc-range' });
  const summary = h('span', { class: 'hc-sum' });
  const presets = [['day', '1 ngày'], ['month', '1 tháng'], ['year', '1 năm'], ['all', 'Tất cả']].map(([k, label]) =>
    h('button', { type: 'button', class: 'hc-btn', onclick: () => { state = { type: 'preset', preset: k }; draw(); } }, label));
  const kindSel = h('select', { class: 'hc-in', onchange: () => { showKind(); custom(); } }, h('option', { value: 'year' }, 'Năm'), h('option', { value: 'month' }, 'Tháng'), h('option', { value: 'day' }, 'Ngày'));
  const inYear = h('input', { type: 'number', min: 2000, max: 2100, step: 1, class: 'hc-in hc-year', value: today.getFullYear(), onchange: () => custom() });
  const inMonth = h('input', { type: 'month', class: 'hc-in', value: `${today.getFullYear()}-${pad(today.getMonth() + 1)}`, onchange: () => custom() });
  const inDay = h('input', { type: 'date', class: 'hc-in', value: `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`, onchange: () => custom() });
  const lineChk = h('input', { type: 'checkbox', onchange: () => draw() }); lineChk.checked = !isOwner;
  const othersChk = isOwner ? null : h('input', { type: 'checkbox', onchange: () => draw() });
  if (othersChk) othersChk.checked = true;
  const svgHost = h('div');
  const emptyEl = h('div', { class: 'hc-empty', hidden: true }, 'Không có bài nộp trong khoảng này');
  const tip = h('div', { class: 'hc-tip', hidden: true });
  const legend = h('div', { class: 'hc-legend' });

  const showKind = () => { inYear.hidden = kindSel.value !== 'year'; inMonth.hidden = kindSel.value !== 'month'; inDay.hidden = kindSel.value !== 'day'; };
  const custom = () => { state = { type: 'custom', kind: kindSel.value }; draw(); };
  showKind();

  function getRange() {
    const now = new Date();
    if (state.type === 'preset') {
      let a, b, label;
      if (state.preset === 'day') { a = now.getTime() - D; b = now.getTime(); label = '1 ngày gần nhất (24 giờ)'; }
      else if (state.preset === 'month') { const m = new Date(now); m.setMonth(m.getMonth() - 1); a = m.getTime(); b = now.getTime(); label = '1 tháng gần nhất'; }
      else if (state.preset === 'year') { const y = new Date(now); y.setFullYear(y.getFullYear() - 1); a = y.getTime(); b = now.getTime(); label = '1 năm gần nhất'; }
      else {
        const ts = points.map((p) => p.t);
        if (ts.length) { a = Math.min(...ts); b = Math.max(...ts); if (b - a < H) { a -= 12 * H; b += 12 * H; } else { const p = (b - a) * 0.03; a -= p; b += p; } }
        else { a = now.getTime() - D; b = now.getTime(); }
        label = 'Tất cả thời gian';
      }
      return { a, b, label };
    }
    if (state.kind === 'year') { const Y = parseInt(inYear.value, 10); if (!Y) return null; return { a: new Date(Y, 0, 1).getTime(), b: new Date(Y + 1, 0, 1).getTime(), label: 'Năm ' + Y }; }
    if (state.kind === 'month') { const [yy, mm] = (inMonth.value || '').split('-').map((x) => parseInt(x, 10)); if (!yy || !mm) return null; return { a: new Date(yy, mm - 1, 1).getTime(), b: new Date(yy, mm, 1).getTime(), label: `Tháng ${mm} năm ${yy}` }; }
    const [dy, dm, dd] = (inDay.value || '').split('-').map((x) => parseInt(x, 10)); if (!dy || !dm || !dd) return null;
    return { a: new Date(dy, dm - 1, dd).getTime(), b: new Date(dy, dm - 1, dd + 1).getTime(), label: `Ngày ${dd} tháng ${dm} năm ${dy}` };
  }

  function showTip(ev, p) {
    const lines = [];
    if (isOwner) lines.push(h('b', null, p.n || '(không rõ tên)'));
    else lines.push(p.m ? h('b', null, 'Bài của bạn') : h('span', null, h('b', null, 'Bạn khác'), ' (ẩn danh)'));
    lines.push(h('span', null, 'Điểm: ', h('b', null, `${fmtNum(p.raw)}/${p.max}`), p.max !== 10 ? ` (quy đổi ${fmtNum(p.s)}/10)` : ''));
    lines.push(h('span', null, fmtDateTime(p.t)));
    if (p.id) lines.push(h('span', { class: 'hc-dim' }, 'Bấm để xem chi tiết'));
    tip.replaceChildren(...lines.flatMap((l, i) => (i ? [h('br'), l] : [l])));
    tip.hidden = false; moveTip(ev);
  }
  function moveTip(ev) {
    const box = tip.parentNode.getBoundingClientRect();
    let x = ev.clientX - box.left + 12, y = ev.clientY - box.top + 12;
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    if (x + tw > box.width) x = ev.clientX - box.left - tw - 12;
    if (y + th > box.height) y = ev.clientY - box.top - th - 12;
    tip.style.left = Math.max(0, x) + 'px'; tip.style.top = Math.max(0, y) + 'px';
  }

  function draw() {
    const r = getRange(); svgHost.replaceChildren(); if (!r) return;
    presets.forEach((b, i) => b.classList.toggle('on', state.type === 'preset' && state.preset === ['day', 'month', 'year', 'all'][i]));
    rangeLabel.textContent = r.label;
    const showOthers = isOwner || !othersChk || othersChk.checked;
    const inRange = points.filter((p) => p.t >= r.a && p.t <= r.b && (isOwner || p.m || showOthers));
    const X = (t) => M.l + ((t - r.a) / (r.b - r.a)) * PW, Y = (s) => M.t + (1 - s / 10) * PH;
    const svg = svgEl('svg', { viewBox: `0 0 ${W} ${HT}`, width: '100%', role: 'img', 'aria-label': 'Biểu đồ điểm theo thời gian' }, svgHost);
    svg.style.cssText = 'display:block;max-width:100%;height:auto';
    for (let i = 0; i < 10; i++) svgEl('rect', { x: M.l, y: Y(i + 1), width: PW, height: PH / 10, fill: COLORS[i], 'fill-opacity': 0.07 }, svg);
    for (let g = 0; g <= 10; g++) {
      svgEl('line', { x1: M.l, x2: M.l + PW, y1: Y(g), y2: Y(g), stroke: 'var(--line)', 'stroke-width': 1 }, svg);
      svgEl('text', { x: M.l - 8, y: Y(g) + 4, 'text-anchor': 'end', 'font-size': 11, fill: 'var(--muted)' }, svg).textContent = g;
    }
    makeTicks(r.a, r.b).forEach((tk) => {
      const x = X(tk.t); if (x < M.l - 0.5 || x > M.l + PW + 0.5) return;
      svgEl('line', { x1: x, x2: x, y1: M.t, y2: M.t + PH, stroke: 'var(--soft)', 'stroke-width': 1 }, svg);
      svgEl('line', { x1: x, x2: x, y1: M.t + PH, y2: M.t + PH + 4, stroke: 'var(--muted)', 'stroke-width': 1 }, svg);
      svgEl('text', { x, y: M.t + PH + 18, 'text-anchor': 'middle', 'font-size': 11, fill: 'var(--muted)' }, svg).textContent = tk.label;
    });
    svgEl('rect', { x: M.l, y: M.t, width: PW, height: PH, fill: 'none', stroke: 'var(--line)', 'stroke-width': 1 }, svg);

    const sorted = inRange.slice().sort((p, q) => p.t - q.t);
    const linePts = isOwner ? sorted : sorted.filter((p) => p.m);          // người làm: chỉ nối điểm của mình
    if (lineChk.checked && linePts.length > 1) svgEl('polyline', { points: linePts.map((p) => `${X(p.t).toFixed(1)},${Y(p.s).toFixed(1)}`).join(' '), fill: 'none', stroke: '#94a3b8', 'stroke-width': 1.5, 'stroke-linejoin': 'round' }, svg);
    const order = isOwner ? sorted : sorted.filter((p) => !p.m).concat(sorted.filter((p) => p.m));
    order.forEach((p) => {
      const other = !isOwner && !p.m;
      const c = svgEl('circle', { cx: X(p.t), cy: Y(p.s), r: other ? 4 : (isOwner ? 5 : 6.5), fill: COLORS[binOf(p.s)], 'fill-opacity': other ? 0.55 : 1, stroke: other || isOwner ? '#fff' : '#111827', 'stroke-width': other ? 1 : (isOwner ? 1.5 : 2) }, svg);
      c.addEventListener('mouseenter', (ev) => showTip(ev, p)); c.addEventListener('mousemove', moveTip); c.addEventListener('mouseleave', () => { tip.hidden = true; });
      if (p.id && onOpen) { c.style.cursor = 'pointer'; c.addEventListener('click', () => onOpen(p)); }
    });
    emptyEl.hidden = sorted.length > 0;
    if (sorted.length) {
      const sc = sorted.map((p) => p.s);
      summary.textContent = `${sorted.length} bài nộp${isOwner ? '' : ` (của bạn: ${sorted.filter((p) => p.m).length})`} • Cao nhất: ${fmtNum(Math.max(...sc))} • Thấp nhất: ${fmtNum(Math.min(...sc))} (thang 10)`;
    } else summary.textContent = 'Không có bài nộp trong khoảng này';
    const counts = Array(10).fill(0); sorted.forEach((p) => { counts[binOf(p.s)]++; });
    legend.replaceChildren(...counts.map((n, b) => h('span', { class: 'hc-chip', style: `opacity:${n ? 1 : 0.5}` }, h('i', { style: `background:${COLORS[b]}` }), `[${b},${b + 1}]  ${n}`)));
  }

  const node = h('div', { class: 'card hc' },
    h('div', { class: 'row between' }, h('h3', null, 'Biểu đồ điểm ', rangeLabel), summary),
    h('p', { class: 'muted hc-note' }, isOwner ? 'Điểm của tất cả người đã làm bài chia sẻ này (rê chuột để xem tên, bấm vào chấm để xem bài làm).' : 'Điểm các bài bạn đã nộp vào bài này (bấm vào chấm để xem chi tiết).'),
    h('div', { class: 'row hc-bar' }, ...presets, h('span', { class: 'muted' }, 'Xem theo:'), kindSel, inYear, inMonth, inDay,
      h('span', { class: 'hc-checks' }, othersChk ? h('label', null, othersChk, ' Hiện người khác') : null, h('label', null, lineChk, isOwner ? ' Nối các điểm' : ' Nối điểm của tôi'))),
    h('div', { class: 'hc-plot' }, svgHost, emptyEl, tip), legend,
    h('p', { class: 'muted hc-note' }, 'Mỗi khoảng điểm một màu. Điểm nằm đúng biên thuộc khoảng trên (1 → [1,2]); điểm 10 thuộc [9,10]. Quy về thang 10.'));
  draw();
  return node;
}
