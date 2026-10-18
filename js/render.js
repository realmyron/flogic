'use strict';
/* Flogic: everything that turns the document into DOM. */

const vp = $('#viewport'), world = $('#world'), nodesWrap = $('#nodes'), edgeG = $('#edge-g');
const labelsWrap = $('#edge-labels'), groupsWrap = $('#groups'), guideG = $('#guide-g'), connPreview = $('#conn-preview');
const NODE_EL = new Map(), SIZE = new Map(), DISP = new Map(), EDGE_EL = new Map(), PANEL_EL = new Map(), GROUP_EL = new Map();
const V = { x: 0, y: 0, z: 1 };
let VR = { left: 0, top: 0, width: 800, height: 600 };
const DIR = { t: { x: 0, y: -1 }, b: { x: 0, y: 1 }, l: { x: -1, y: 0 }, r: { x: 1, y: 0 } };

/* one coloured arrowhead per connection type, shaped like the default one */
(() => {
  const defs = $('#edges defs'), base = $('#arrow');
  for (const [k, t] of Object.entries(EDGE_TYPES)) {
    const m = base.cloneNode(true);
    m.id = 'arrow-t-' + k;
    m.querySelector('path').setAttribute('class', '');
    m.querySelector('path').setAttribute('fill', t.color);
    defs.appendChild(m);
  }
})();

/* ---------- geometry ---------- */
function pos(id) { return DISP.get(id) || nodeById(id); }
function sizeOf(n) { return SIZE.get(n.id) || { w: n.w, h: n.type === 'sub' ? 96 : n.type === 'title' ? 140 : 160 }; }
function rectOf(n, model) { const p = model ? n : pos(n.id), s = sizeOf(n); return { x: p.x, y: p.y, w: s.w, h: s.h }; }
function portPos(n, side) {
  const r = rectOf(n);
  if (side === 't') return { x: r.x + r.w / 2, y: r.y };
  if (side === 'b') return { x: r.x + r.w / 2, y: r.y + r.h };
  if (side === 'l') return { x: r.x, y: r.y + r.h / 2 };
  return { x: r.x + r.w, y: r.y + r.h / 2 };
}
/* ---------- connection routing ----------
   Two looks: "fluid" (smooth S-curves) and "geometric" (straight lines in 4 directions, rounded corners).
   Lines start and end on the sides you dragged between. */
const f1 = v => v.toFixed(1);
function lineStyle(ed) { return (ed && ed.style) || DOC.lineStyle || 'fluid'; }
/* `via` is an optional point the line is bent through (set by dragging the line's middle handle) */
function bez(p1, s1, p2, s2, style, avoid, via) {
  if ((style || lineStyle()) === 'geometric') return via ? routeGeoVia(p1, s1, p2, s2, via) : routeGeo(p1, s1, p2, s2, avoid);
  return via ? routeFluidVia(p1, s1, p2, s2, via) : routeFluid(p1, s1, p2, s2);
}
/* A smooth curve through start -> B -> end that picks its own angles (centripetal Catmull-Rom).
   Hidden guide points sit just inside each node, so the line still leaves and arrives straight
   out of its side, then eases toward the bend point without steep kinks or loops. */
function routeFluidVia(p1, s1, p2, s2, B) {
  const a = DIR[s1], b = DIR[s2];
  const d1 = Math.hypot(B.x - p1.x, B.y - p1.y), d2 = Math.hypot(p2.x - B.x, p2.y - B.y);
  const L1 = clamp(d1 * 0.55, 24, 180), L2 = clamp(d2 * 0.55, 24, 180);
  const P = [{ x: p1.x - a.x * L1, y: p1.y - a.y * L1 }, p1, B, p2, { x: p2.x - b.x * L2, y: p2.y - b.y * L2 }];
  const seg = (q0, q1, q2, q3) => {
    const t01 = Math.pow(Math.hypot(q1.x - q0.x, q1.y - q0.y), 0.5) || 1e-4;
    const t12 = Math.pow(Math.hypot(q2.x - q1.x, q2.y - q1.y), 0.5) || 1e-4;
    const t23 = Math.pow(Math.hypot(q3.x - q2.x, q3.y - q2.y), 0.5) || 1e-4;
    /* tangents at q1 and q2 (Barry–Goldman form), then convert to cubic Bézier handles */
    const m1 = { x: t12 * ((q1.x - q0.x) / t01 - (q2.x - q0.x) / (t01 + t12) + (q2.x - q1.x) / t12), y: t12 * ((q1.y - q0.y) / t01 - (q2.y - q0.y) / (t01 + t12) + (q2.y - q1.y) / t12) };
    const m2 = { x: t12 * ((q2.x - q1.x) / t12 - (q3.x - q1.x) / (t12 + t23) + (q3.x - q2.x) / t23), y: t12 * ((q2.y - q1.y) / t12 - (q3.y - q1.y) / (t12 + t23) + (q3.y - q2.y) / t23) };
    return [{ x: q1.x + m1.x / 3, y: q1.y + m1.y / 3 }, { x: q2.x - m2.x / 3, y: q2.y - m2.y / 3 }];
  };
  const [c1, c2] = seg(P[0], P[1], P[2], P[3]), [c3, c4] = seg(P[1], P[2], P[3], P[4]);
  return {
    d: `M${f1(p1.x)} ${f1(p1.y)} C${f1(c1.x)} ${f1(c1.y)} ${f1(c2.x)} ${f1(c2.y)} ${f1(B.x)} ${f1(B.y)} C${f1(c3.x)} ${f1(c3.y)} ${f1(c4.x)} ${f1(c4.y)} ${f1(p2.x)} ${f1(p2.y)}`,
    mid: { x: B.x, y: B.y },
  };
}
/* geometric with a bend: the middle segment runs through B */
function routeGeoVia(p1, s1, p2, s2, B) {
  const a = DIR[s1], b = DIR[s2];
  let pts;
  if (a.y && b.y) pts = [p1, { x: p1.x, y: B.y }, { x: p2.x, y: B.y }, p2];
  else if (a.x && b.x) pts = [p1, { x: B.x, y: p1.y }, { x: B.x, y: p2.y }, p2];
  else if (a.y) pts = [p1, { x: p1.x, y: B.y }, { x: B.x, y: B.y }, { x: B.x, y: p2.y }, p2];
  else pts = [p1, { x: B.x, y: p1.y }, { x: B.x, y: B.y }, { x: p2.x, y: B.y }, p2];
  return roundedPath(pts, 14);
}
/* where a stored bend sits: it's kept relative to the middle of the two ends so it follows the nodes */
function bendPoint(ed, p1, p2) {
  return ed.bend ? { x: (p1.x + p2.x) / 2 + ed.bend.dx, y: (p1.y + p2.y) / 2 + ed.bend.dy } : null;
}
function routeFluid(p1, s1, p2, s2) {
  const a = DIR[s1], b = DIR[s2], dx = p2.x - p1.x, dy = p2.y - p1.y;
  const along = Math.abs(a.x ? dx : dy);                       // distance in the direction we leave
  const ahead = dx * a.x + dy * a.y > 0;                       // is the target in front of the start side?
  let k = ahead ? Math.max(along * 0.5, 24) : clamp(Math.hypot(dx, dy) * 0.38, 48, 180);
  k = Math.min(k, 220);
  const c1 = { x: p1.x + a.x * k, y: p1.y + a.y * k }, c2 = { x: p2.x + b.x * k, y: p2.y + b.y * k };
  return {
    d: `M${f1(p1.x)} ${f1(p1.y)} C${f1(c1.x)} ${f1(c1.y)} ${f1(c2.x)} ${f1(c2.y)} ${f1(p2.x)} ${f1(p2.y)}`,
    mid: { x: (p1.x + 3 * c1.x + 3 * c2.x + p2.x) / 8, y: (p1.y + 3 * c1.y + 3 * c2.y + p2.y) / 8 },
  };
}
function segHits(x1, y1, x2, y2, rects) {
  const ax = Math.min(x1, x2) - 6, bx = Math.max(x1, x2) + 6, ay = Math.min(y1, y2) - 6, by = Math.max(y1, y2) + 6;
  return rects.some(r => ax < r.x + r.w && bx > r.x && ay < r.y + r.h && by > r.y);
}
/* pick a channel between lo and hi (preferring the middle) whose crossing segment misses other nodes */
function freeChannel(lo, hi, test) {
  const mid = (lo + hi) / 2;
  if (hi - lo < 2) return mid;
  for (let o = 0; o <= (hi - lo) / 2; o += 12) {
    if (!test(mid - o)) return mid - o;
    if (o && !test(mid + o)) return mid + o;
  }
  return mid;
}
function routeGeo(p1, s1, p2, s2, avoid) {
  const a = DIR[s1], b = DIR[s2], stub = 20, obs = avoid || [];
  const q1 = { x: p1.x + a.x * stub, y: p1.y + a.y * stub }, q2 = { x: p2.x + b.x * stub, y: p2.y + b.y * stub };
  let pts;
  if (a.y && b.y) {
    let lo = Math.min(q1.y, q2.y), hi = Math.max(q1.y, q2.y);
    if (s1 === s2) lo = hi = s1 === 'b' ? Math.max(q1.y, q2.y) : Math.min(q1.y, q2.y);
    const my = freeChannel(lo, hi, y => segHits(p1.x, y, p2.x, y, obs));
    pts = [p1, { x: p1.x, y: my }, { x: p2.x, y: my }, p2];
  } else if (a.x && b.x) {
    let lo = Math.min(q1.x, q2.x), hi = Math.max(q1.x, q2.x);
    if (s1 === s2) lo = hi = s1 === 'r' ? Math.max(q1.x, q2.x) : Math.min(q1.x, q2.x);
    const mx = freeChannel(lo, hi, x => segHits(x, p1.y, x, p2.y, obs));
    pts = [p1, { x: mx, y: p1.y }, { x: mx, y: p2.y }, p2];
  } else if (a.y) {
    const c = { x: p1.x, y: p2.y };
    pts = (c.y - p1.y) * a.y > stub && (c.x - p2.x) * b.x > stub ? [p1, c, p2] : [p1, q1, { x: q1.x, y: q2.y }, q2, p2];
  } else {
    const c = { x: p2.x, y: p1.y };
    pts = (c.x - p1.x) * a.x > stub && (c.y - p2.y) * b.y > stub ? [p1, c, p2] : [p1, q1, { x: q2.x, y: q1.y }, q2, p2];
  }
  return roundedPath(pts, 14);
}
/* polyline -> path with rounded corners, plus its halfway point for the label */
function roundedPath(raw, r) {
  const pts = [];
  raw.forEach(p => {
    const l = pts[pts.length - 1];
    if (l && Math.abs(l.x - p.x) < 0.5 && Math.abs(l.y - p.y) < 0.5) return;
    if (pts.length >= 2) {
      const k = pts[pts.length - 2];
      if (Math.abs((l.x - k.x) * (p.y - l.y) - (l.y - k.y) * (p.x - l.x)) < 0.5) pts.pop();
    }
    pts.push(p);
  });
  let d = `M${f1(pts[0].x)} ${f1(pts[0].y)}`, total = 0;
  const lens = [];
  for (let i = 1; i < pts.length; i++) { const l = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y); lens.push(l); total += l; }
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i], pa = pts[i - 1], pb = pts[i + 1], l1 = lens[i - 1], l2 = lens[i];
    const rr = Math.min(r, l1 / 2, l2 / 2);
    const s = { x: p.x - (p.x - pa.x) / l1 * rr, y: p.y - (p.y - pa.y) / l1 * rr }, e = { x: p.x + (pb.x - p.x) / l2 * rr, y: p.y + (pb.y - p.y) / l2 * rr };
    d += ` L${f1(s.x)} ${f1(s.y)} Q${f1(p.x)} ${f1(p.y)} ${f1(e.x)} ${f1(e.y)}`;
  }
  const last = pts[pts.length - 1];
  d += ` L${f1(last.x)} ${f1(last.y)}`;
  let half = total / 2, mid = pts[0];
  for (let i = 1; i < pts.length; i++) {
    if (half <= lens[i - 1]) { const t = half / (lens[i - 1] || 1); mid = { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t }; break; }
    half -= lens[i - 1];
  }
  return { d, mid };
}
/* Two side-dots that are almost level (or almost in line) get the same height (or x), so the line is
   perfectly straight. This also keeps lines straight when a node is a little taller in edit mode
   (because of its "+ Item" style buttons) than it is for visitors. */
const STRAIGHTEN = 40;
function straighten(p1, s1, ra, p2, s2, rb) {
  const h1 = s1 === 'l' || s1 === 'r', h2 = s2 === 'l' || s2 === 'r';
  if (h1 !== h2) return;
  const k = h1 ? 'y' : 'x', pos = h1 ? 'y' : 'x', size = h1 ? 'h' : 'w';
  const lo = Math.max(ra[pos], rb[pos]) + 12, hi = Math.min(ra[pos] + ra[size], rb[pos] + rb[size]) - 12;
  if (lo > hi || Math.abs(p1[k] - p2[k]) > STRAIGHTEN) return;
  p1[k] = p2[k] = clamp((p1[k] + p2[k]) / 2, lo, hi);
}
function sidePoint(r, side, off) {
  if (side === 't') return { x: r.x + r.w / 2 + off, y: r.y };
  if (side === 'b') return { x: r.x + r.w / 2 + off, y: r.y + r.h };
  if (side === 'l') return { x: r.x, y: r.y + r.h / 2 + off };
  return { x: r.x + r.w, y: r.y + r.h / 2 + off };
}
/* which side of a target faces a point coming from `from` */
function facingSide(from, to) {
  const dx = to.x - from.x, dy = to.y - from.y;
  return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'l' : 'r') : (dy > 0 ? 't' : 'b');
}
function bboxOf(nodes, model) {
  if (!nodes.length) return null;
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  nodes.forEach(n => { const r = rectOf(n, model); x1 = Math.min(x1, r.x); y1 = Math.min(y1, r.y); x2 = Math.max(x2, r.x + r.w); y2 = Math.max(y2, r.y + r.h); });
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}
function toWorld(cx, cy) { return { x: (cx - VR.left - V.x) / V.z, y: (cy - VR.top - V.y) / V.z }; }

/* ---------- view ---------- */
function applyView() {
  const cx = (VR.width / 2 - V.x) / V.z, cy = (VR.height / 2 - V.y) / V.z;
  if (cx < -WORLD) V.x = VR.width / 2 + WORLD * V.z;
  if (cx > WORLD) V.x = VR.width / 2 - WORLD * V.z;
  if (cy < -WORLD) V.y = VR.height / 2 + WORLD * V.z;
  if (cy > WORLD) V.y = VR.height / 2 - WORLD * V.z;
  world.style.transform = `translate(${V.x}px,${V.y}px) scale(${V.z})`;
  world.style.setProperty('--z', V.z);
  let g = GRID * V.z;
  while (g < 14) g *= 4;
  vp.style.backgroundSize = `${g}px ${g}px`;
  vp.style.backgroundPosition = `${V.x - g / 2}px ${V.y - g / 2}px`;
  $('#zoom-label').textContent = Math.round(V.z * 100) + '%';
  queueMinimap();
  if (S.envId) {
    UI.views[S.envId] = { cx: (VR.width / 2 - V.x) / V.z, cy: (VR.height / 2 - V.y) / V.z, z: V.z };
    saveUI();
  }
}

/* ---------- text formatting ----------
   **bold**  *italic* or _italic_  ==highlight==  ~~strike~~  [text](https://link)  (text)[Node name]
   Lines: ___ or --- divider · "-# " small text · "- " bullet */
const MDP = String.fromCharCode(1);
function mdInline(s) {
  if (!s) return '';
  const keep = [], stash = h => MDP + (keep.push(h) - 1) + MDP;
  let h = esc(s);
  h = h.replace(/\(([^()\n]+?)\)\[([^\[\]\n]+?)\]/g, (m, t, n) => stash(`<a class="nlink" href="#" data-node="${n}" title="Go to ${n}">${t}</a>`));
  h = h.replace(/\[([^\[\]\n]+?)\]\((https?:\/\/[^\s)]+)\)/g, (m, t, u) => stash(`<a class="ext" href="${u}" target="_blank" rel="noopener noreferrer">${t}</a>`));
  h = h.replace(/\*\*(?=\S)([^*\n]*?\S)\*\*/g, '<b>$1</b>');
  h = h.replace(/==(?=\S)([^=\n]*?\S)==/g, '<mark>$1</mark>');
  h = h.replace(/~~(?=\S)([^~\n]*?\S)~~/g, '<s>$1</s>');
  h = h.replace(/(^|[^*\w])\*(?=\S)([^*\n]*?\S)\*(?![*\w])/g, '$1<i>$2</i>');
  h = h.replace(/(^|[^_\w])_(?=\S)([^_\n]*?\S)_(?![_\w])/g, '$1<i>$2</i>');
  return h.replace(new RegExp(MDP + '(\\d+)' + MDP, 'g'), (m, i) => keep[+i]);
}
const MD_HR = /^\s*(_{3,}|-{3,}|\*{3,})\s*$/;
function mdBlock(s) {
  if (!s) return '';
  return s.split('\n').map(line => {
    if (MD_HR.test(line)) return '<hr class="md-hr">';
    let m;
    if ((m = line.match(/^-#\s+(.*)$/))) return `<div class="md-small">${mdInline(m[1]) || '<br>'}</div>`;
    if ((m = line.match(/^\s*[-•]\s+(.*)$/))) return `<div class="md-li">${mdInline(m[1]) || '<br>'}</div>`;
    return `<div>${mdInline(line) || '<br>'}</div>`;
  }).join('');
}
function mdField(v, single) { return single ? mdInline(v) : mdBlock(v); }

/* ---------- node markup ---------- */
/* Edit-only controls ("+ Item", "+ Scenario"…) are also drawn for visitors, invisibly, so every node has
   exactly the same size for owner and visitors and connections attach at the same spots. */
function eoAttr() { return S.canEdit ? '' : ' aria-hidden="true" tabindex="-1"'; }
function fld(n, path, tag, cls, o = {}) {
  const v = getPath(n, path);
  return `<${tag} class="ed ${cls || ''}" data-f="${path}"${o.ph ? ` data-ph="${esc(o.ph)}"` : ''}${o.single ? ' data-single="1"' : ''}>${mdField(v == null ? '' : String(v), o.single)}</${tag}>`;
}
function nodeHTML(n) {
  const E = S.canEdit, T = n.type;
  let h = '';
  if (E) h += `<div class="ports">${SIDES.map(s => `<i class="port p-${s}" data-side="${s}"></i>`).join('')}</div><div class="rz" title="Drag to resize"></div><button class="n-add" data-act="add-block" title="Add a block" aria-label="Add a block">${ic('plus', 15)}</button>`;
  h += '<div class="n-head">';
  if (T !== 'sub') h += fld(n, 'tag', 'div', 'n-tag', { ph: 'Label', single: 1 });
  h += fld(n, 'title', 'div', 'n-title', { ph: T === 'title' ? 'Untitled' : T === 'note' ? 'Note title' : 'Sub-note', single: 1 });
  if (T === 'title') h += fld(n, 'subtitle', 'div', 'n-subtitle', { ph: 'Add a subtitle…' });
  h += `</div><div class="blocks">${n.blocks.map((b, i) => blockHTML(n, b, i)).join('')}</div>`;
  return h;
}
function blockHTML(n, b, i) {
  const P = `blocks.${i}`, E = S.canEdit;
  let inner = '';
  switch (b.kind) {
    case 'text':
      inner = fld(n, P + '.text', 'div', 'b-text', { ph: 'Write something…' }); break;
    case 'highlight':
      inner = `<div class="b-hl">${fld(n, P + '.label', 'div', 'lab', { ph: 'Label', single: 1 })}${fld(n, P + '.text', 'div', 'b-text', { ph: 'Highlighted text…' })}</div>`; break;
    case 'category': {
      const closed = catClosed(b), tog = ' data-act="toggle-fold"';
      inner = `<div class="b-cat${closed ? ' closed' : ''}" data-fold="${b.id}"><div class="cat-h"${E ? '' : tog}>${fld(n, P + '.label', 'div', 'lab', { ph: 'Category', single: 1 })}<button class="chev"${tog} aria-label="Open or close" title="${closed ? 'Open' : 'Close'}">${ic('chev', 14)}</button></div>` +
        `<div class="fold-b"><div class="fold-bi">${fld(n, P + '.text', 'div', 'b-text', { ph: 'Write something…' })}</div></div></div>`;
      break;
    }
    case 'conclusion':
      inner = `<div class="b-concl">${fld(n, P + '.label', 'div', 'lab', { ph: 'Conclusion', single: 1 })}${fld(n, P + '.text', 'div', 'b-text', { ph: 'The takeaway…' })}</div>`; break;
    case 'scenarios':
      inner = `<div class="b-scn">${fld(n, P + '.label', 'div', 'lab', { ph: 'Scenarios', single: 1 })}` +
        b.items.map((s, si) => scenarioHTML(n, b, i, s, si)).join('') +
        `<button class="ghost-btn wide eo" data-act="add-scn"${eoAttr()}>${ic('plus', 12)} Scenario</button>` + '</div>';
      break;
    case 'checklist':
      inner = `<div class="b-chk">${fld(n, P + '.label', 'div', 'lab', { ph: 'Checklist', single: 1 })}` +
        b.items.map((it, ii) => `<div class="chk${it.done ? ' done' : ''}"><button class="box" data-act="toggle-chk" data-ii="${ii}"${E ? '' : ' disabled'} aria-label="Toggle">${ic('check', 11)}</button>${fld(n, `${P}.items.${ii}.text`, 'div', 'b-text', { ph: 'To do…', single: 1 })}${E ? `<button class="mini-x" data-act="del-chk" data-ii="${ii}" aria-label="Remove item">${ic('x', 11)}</button>` : ''}</div>`).join('') +
        `<button class="ghost-btn eo" data-act="add-chk"${eoAttr()}>${ic('plus', 12)} Item</button>` + '</div>';
      break;
    case 'image':
      if (b.src) inner = `<figure class="b-img"><img src="${esc(imgSrc(b.src))}" data-src="${esc(b.src)}" alt="${esc(b.caption || '')}" draggable="false">${fld(n, P + '.caption', 'figcaption', 'cap', { ph: 'Caption…' })}</figure>`;
      else inner = `<div class="img-drop eo"${eoAttr()}><div class="idr" data-act="pick-img">${ic('image', 22)}<div><b>Add an image</b><small>Click to upload, drop a file, or paste</small></div></div><input class="img-url" placeholder="…or paste an image link and press Enter"></div>`;
      break;
    case 'sources':
      inner = `<div class="b-src">${fld(n, P + '.label', 'div', 'lab', { ph: 'Sources', single: 1 })}<div class="src-list">` +
        b.items.map((s, si) => sourceHTML(n, P, s, si)).join('') +
        `</div><button class="chip add eo" data-act="add-src"${eoAttr()}>${ic('plus', 11)} Source</button></div>`;
      break;
  }
  return `<div class="blk k-${b.kind}" data-i="${i}">${E ? `<span class="grip" title="Drag to move">${ic('grip', 14)}</span>` : ''}${inner}</div>`;   /* blocks are deleted from the right-click menu only, so they can't be removed by accident */
}
/* categories start open; the owner's open/closed choice is saved, visitors can fold them for themselves */
function catClosed(b) { const k = 'f:' + b.id; return k in S.open ? S.open[k] : !!b.closed; }
/* a source: title link, and (folded away by default) what it explains + the remove button */
function sourceHTML(n, P, s, si) {
  const E = S.canEdit, hasBody = E || (s.note && s.note.trim()), open = hasBody && !!S.open['s:' + s.id];
  return `<div class="src-it${open ? ' open' : ''}" data-sk="${esc(s.id || '')}">
    <div class="src-h">${hasBody ? `<button class="chev" data-act="toggle-src" aria-label="Show details" title="${open ? 'Hide' : 'Show'} details">${ic('chev', 13)}</button>` : `<span class="src-dot">${ic('link', 12)}</span>`}<a href="${esc(s.u)}" target="_blank" rel="noopener noreferrer" title="${esc(s.u)}"><span>${esc(s.t || hostOf(s.u))}</span>${ic('arrowr', 11)}</a></div>
    ${hasBody ? `<div class="fold-b"><div class="fold-bi"><div class="src-body">${fld(n, `${P}.items.${si}.note`, 'div', 'b-text', { ph: 'What this source explains or why it matters (optional)…' })}<div class="src-meta"><span>${esc(hostOf(s.u))}</span>${E ? `<button class="ghost-btn danger" data-act="del-src" data-si="${si}">${ic('trash', 12)} Remove source</button>` : ''}</div></div></div></div>` : ''}
  </div>`;
}
function scenarioHTML(n, b, i, s, si) {
  const E = S.canEdit, SP = `blocks.${i}.items.${si}`, open = !!S.open[s.id];
  const tog = ' data-act="toggle-scn"';
  return `<div class="scn${open ? ' open' : ''}" data-sid="${s.id}">
    <div class="scn-h"${E ? '' : tog}><span class="scn-n"${tog}>${si + 1}</span>${fld(n, SP + '.title', 'div', 'scn-t', { ph: 'What if…', single: 1 })}<span class="scn-c"${tog}>${s.steps.length} step${s.steps.length === 1 ? '' : 's'}</span><button class="chev"${tog} aria-label="Expand">${ic('chev', 14)}</button></div>
    <div class="scn-b"><div class="scn-bi"><div class="chain">` +
    s.steps.map((st, ti) => `<div class="step${st.alt ? ' alt' : ''}" style="--i:${ti}"><i class="dot"${E ? ` data-act="toggle-alt" data-si="${si}" data-ti="${ti}" title="Switch side"` : ''}></i><div class="step-c">${fld(n, `${SP}.steps.${ti}.label`, 'div', 'lab', { ph: 'Step', single: 1 })}${fld(n, `${SP}.steps.${ti}.text`, 'div', 'b-text', { ph: 'What happens…' })}</div>${E ? `<button class="mini-x" data-act="del-step" data-si="${si}" data-ti="${ti}" aria-label="Remove step">${ic('x', 11)}</button>` : ''}</div>`).join('') +
    `</div><div class="scn-actions eo"${eoAttr()}><button class="ghost-btn" data-act="add-step" data-si="${si}">${ic('plus', 12)} Step</button><button class="ghost-btn danger" data-act="del-scn" data-si="${si}">Remove scenario</button></div></div></div></div>`;
}

/* ---------- node elements ---------- */
const RO = new ResizeObserver(entries => {
  let ch = false;
  for (const en of entries) {
    const el = en.target, id = el.dataset.id;
    if (!id || NODE_EL.get(id) !== el) continue;
    const w = el.offsetWidth, h = el.offsetHeight, s = SIZE.get(id);
    if (!s || s.w !== w || s.h !== h) { SIZE.set(id, { w, h }); ch = true; }
  }
  if (ch) queueFrame();
});
function applyNode(el, n, i) {
  el.dataset.type = n.type;
  el.dataset.c = n.color || 'default';
  el.style.width = n.w + 'px';
  if (!el.classList.contains('lifted')) el.style.zIndex = i + 1;
  el.classList.toggle('sel', S.sel.has(n.id));
  el.classList.toggle('is-hidden', !!n.hidden);
  el.classList.toggle('is-folded', foldMap().has(n.id));
  if (!DISP.has(n.id)) el.style.transform = `translate3d(${n.x}px,${n.y}px,0)`;
}
function renderNode(n) {
  const el = NODE_EL.get(n.id);
  if (!el) return;
  if (S.editing && S.editing.id === n.id) endEdit();
  el.innerHTML = nodeHTML(n);
  applyNode(el, n, env().nodes.indexOf(n));
  markNode(n);
}
function syncNodes(force) {
  const e = env(), keep = new Set();
  e.nodes.forEach((n, i) => {
    keep.add(n.id);
    let el = NODE_EL.get(n.id);
    if (!el) {
      el = document.createElement('div');
      el.className = 'node';
      el.dataset.id = n.id;
      el.innerHTML = nodeHTML(n);
      NODE_EL.set(n.id, el);
      nodesWrap.appendChild(el);
      RO.observe(el);
      markNode(n);
    } else if (force) {
      if (S.editing && S.editing.id === n.id) endEdit();
      el.innerHTML = nodeHTML(n);
      markNode(n);
    }
    applyNode(el, n, i);
  });
  for (const [id, el] of NODE_EL) {
    if (keep.has(id)) continue;
    RO.unobserve(el); el.remove(); NODE_EL.delete(id); SIZE.delete(id); DISP.delete(id);
  }
}
function syncZ() { env().nodes.forEach((n, i) => { const el = NODE_EL.get(n.id); if (el) { el.classList.remove('lifted'); el.style.zIndex = i + 1; } }); }

/* ---------- edges ---------- */
function drawEdges() {
  const e = env(), seen = new Set(), rects = new Map(), nodeRects = new Map(), list = [], F = foldMap();
  for (const n of e.nodes) if (!n.hidden && !F.has(n.id)) { const r = rectOf(n); rects.set(n.id, r); nodeRects.set(n.id, r); }
  for (const p of e.panels) { const r = panelRect(p); if (r) rects.set(p.id, r); }       /* panels can be connected too */
  /* 1. each line uses the sides it was connected to; a line to a node inside a folded panel goes to the panel */
  for (const ed of e.edges) {
    const a = F.get(ed.from) || ed.from, b = F.get(ed.to) || ed.to;
    if (a === b) continue;
    const ra = rects.get(a), rb = rects.get(b);
    if (!ra || !rb) continue;
    list.push({ ed, a, b, ra, rb, s1: ed.fs, s2: ed.ts, o1: 0, o2: 0 });
  }
  /* 2. several lines on one face fan out instead of sharing a single point */
  const faces = new Map();
  const addFace = (id, side, it, end, other) => {
    const k = id + side;
    if (!faces.has(k)) faces.set(k, []);
    faces.get(k).push({ it, end, key: side === 't' || side === 'b' ? other.x + other.w / 2 : other.y + other.h / 2 });
  };
  list.forEach(it => { addFace(it.a, it.s1, it, 'o1', it.rb); addFace(it.b, it.s2, it, 'o2', it.ra); });
  for (const [k, arr] of faces) {
    if (arr.length < 2) continue;
    const side = k.slice(-1), r = rects.get(k.slice(0, -1));
    const span = (side === 't' || side === 'b' ? r.w : r.h) * 0.6, gap = Math.min(18, span / (arr.length - 1));
    arr.sort((p, q) => p.key - q.key).forEach((f, i) => { f.it[f.end] = (i - (arr.length - 1) / 2) * gap; });
  }
  /* 3. draw */
  for (const it of list) {
    const ed = it.ed, style = lineStyle(ed);
    const p1 = sidePoint(it.ra, it.s1, it.o1), p2 = sidePoint(it.rb, it.s2, it.o2);
    if (!ed.bend) straighten(p1, it.s1, it.ra, p2, it.s2, it.rb);
    let avoid = null;
    if (style === 'geometric') {
      /* steer around other nodes, but not around the nodes inside a connected panel */
      const inside = new Set([it.a, it.b].flatMap(id => (panelById(id) || { members: [] }).members));
      avoid = [];
      for (const [id, rc] of nodeRects) if (id !== it.a && id !== it.b && !inside.has(id)) avoid.push(rc);
    }
    const g = bez(p1, it.s1, p2, it.s2, style, avoid, bendPoint(ed, p1, p2));
    seen.add(ed.id);
    let r = EDGE_EL.get(ed.id);
    if (!r) {
      const gEl = document.createElementNS(SVGNS, 'g');
      gEl.dataset.e = ed.id;
      const hit = document.createElementNS(SVGNS, 'path'); hit.setAttribute('class', 'hit');
      const vis = document.createElementNS(SVGNS, 'path'); vis.setAttribute('class', 'vis');
      const knobHit = document.createElementNS(SVGNS, 'circle'); knobHit.setAttribute('class', 'bend-hit'); knobHit.setAttribute('r', '14');
      const knob = document.createElementNS(SVGNS, 'circle'); knob.setAttribute('class', 'bend'); knob.setAttribute('r', '5.5');
      gEl.append(hit, vis, knobHit, knob); edgeG.appendChild(gEl);
      /* the label pill: a type badge (icon) and the label text */
      const lab = document.createElement('div'); lab.className = 'elabel'; lab.dataset.e = ed.id;
      const labIc = document.createElement('span'); labIc.className = 'et-ic';
      const labTx = document.createElement('span'); labTx.className = 'et-tx';
      lab.append(labIc, labTx);
      labelsWrap.appendChild(lab);
      r = { g: gEl, hit, vis, knob, knobHit, lab, labIc, labTx, cls: '', type: '' };
      EDGE_EL.set(ed.id, r);
    }
    r.hit.setAttribute('d', g.d); r.vis.setAttribute('d', g.d);
    if (r.maskPath) r.maskPath.setAttribute('d', g.d);
    for (const c of [r.knob, r.knobHit]) { c.setAttribute('cx', f1(g.mid.x)); c.setAttribute('cy', f1(g.mid.y)); }
    Object.assign(r, { p1, p2, s1: it.s1, s2: it.s2, mid: g.mid });
    const T = EDGE_TYPES[ed.type], sel = S.edgeSel === ed.id, rel = !sel && !r.drawing && (S.sel.has(ed.from) || S.sel.has(ed.to));
    const cls = 'edge' + (sel ? ' sel' : '') + (rel ? ' rel' : '') + (ed.dashed ? ' dashed' : '') + (ed.label || T ? ' haslabel' : '') + (ed.bend ? ' bent' : '') + (T ? ' typed' : '') + (r.drawing ? ' draw' : '');
    if (r.cls !== cls) { r.g.setAttribute('class', cls); r.cls = cls; }
    if (r.type !== (ed.type || '')) {
      r.type = ed.type || '';
      for (const el of [r.g, r.lab]) { if (T) el.style.setProperty('--ec', T.color); else el.style.removeProperty('--ec'); }
      r.labIc.innerHTML = T ? ic(T.icon, 12) : '';
      r.lab.title = T ? T.label : '';
    }
    if (ed.arrow) r.vis.setAttribute('marker-end', T ? `url(#arrow-t-${ed.type})` : sel || rel ? 'url(#arrow-hi)' : 'url(#arrow)');
    else r.vis.removeAttribute('marker-end');
    const editingLabel = r.labTx.hasAttribute('contenteditable');
    const showText = !!ed.label || editingLabel || (sel && S.canEdit);
    if (showText || T) {
      r.lab.style.display = '';
      if (!editingLabel && r.labTx.textContent !== ed.label) r.labTx.textContent = ed.label;
      r.lab.classList.toggle('typed', !!T);
      r.lab.classList.toggle('empty', !ed.label && !editingLabel);
      r.lab.classList.toggle('notext', !showText);
      /* a type badge or label sits on the line's middle (and works as its bend handle);
         an empty "add a label" hint sits just below the middle dot instead of covering it */
      const centred = ed.label || editingLabel || T;
      r.lab.style.transform = `translate(${g.mid.x}px,${g.mid.y}px) translate(-50%,${centred ? '-50%' : '12px'})`;
    } else r.lab.style.display = 'none';
  }
  for (const [id, r] of EDGE_EL) if (!seen.has(id)) { r.g.remove(); r.lab.remove(); if (r.mask) r.mask.remove(); EDGE_EL.delete(id); }
}
/* Lines draw themselves in, one after another, after the nodes pop in (used when switching environments).
   A mask stroke grows along each line and reveals it, so dashed lines stay dashed while they draw. */
function animateEdgesIn(baseDelay = 160) {
  const defs = $('#edges defs');
  let i = 0;
  for (const [id, r] of EDGE_EL) {
    const delay = baseDelay + Math.min(i++, 24) * 45;
    if (!r.mask) {
      const m = document.createElementNS(SVGNS, 'mask');
      m.id = 'mk-' + id;
      m.setAttribute('maskUnits', 'userSpaceOnUse');
      ['x', 'y'].forEach(k => m.setAttribute(k, '-60000'));
      ['width', 'height'].forEach(k => m.setAttribute(k, '120000'));
      const mp = document.createElementNS(SVGNS, 'path');
      mp.setAttribute('class', 'mdraw'); mp.setAttribute('pathLength', '1'); mp.setAttribute('d', r.vis.getAttribute('d') || '');
      m.appendChild(mp); defs.appendChild(m);
      r.mask = m; r.maskPath = mp;
    }
    r.maskPath.style.animationDelay = delay + 'ms';
    r.vis.setAttribute('mask', `url(#mk-${id})`);
    r.drawing = true;
    r.lab.style.setProperty('--d', delay + 380 + 'ms');
    r.lab.classList.add('lab-in');
    clearTimeout(r.drawT);
    r.drawT = setTimeout(() => {
      r.drawing = false;
      r.vis.removeAttribute('mask');
      if (r.mask) { r.mask.remove(); r.mask = r.maskPath = null; }
      r.lab.classList.remove('lab-in');
      drawEdges();
    }, delay + 720);
  }
  drawEdges();
}

/* ---------- panels & groups ----------
   A panel is a framed area around its nodes. Looks: dotted (default), outline, tinted, hatched, grid,
   card (a raised card with a header). Panels have side dots, so they can be connected like a node, a
   thick grabbable edge all the way round, and a fold button that tucks the nodes away into a small box.
   Groups only bundle nodes; on the board they show as a light dashed outline while selected. */
const PANEL_LOOKS = [['dotted', 'Dotted'], ['outline', 'Outline'], ['tinted', 'Tinted'], ['hatched', 'Hatched'], ['grid', 'Grid'], ['card', 'Card']];
const PANEL_PAD = 30, PANEL_HEAD = 34, FOLD_H = 50, GROUP_PAD = 12;
const PANEL_FREE = new Set();   // nodes being dragged out of their panel: the frame ignores them until dropped
let PANEL_DROP = null;          // the panel nodes would be dropped into right now
function panelById(id) { return env().panels.find(p => p.id === id); }
function groupById(id) { return env().groups.find(g => g.id === id); }
/* node id -> id of the folded panel it is tucked into */
let FOLD = { k: null, m: new Map() };
function foldMap() {
  const e = env();
  let k = e.id;
  for (const p of e.panels) if (p.folded) k += '|' + p.id + ':' + p.members.join(',');
  if (k !== FOLD.k) { FOLD = { k, m: new Map() }; for (const p of e.panels) if (p.folded) p.members.forEach(id => FOLD.m.set(id, p.id)); }
  return FOLD.m;
}
const isShown = n => n && !n.hidden && !foldMap().has(n.id);
function panelRect(p) {
  let ns = p.members.map(nodeById).filter(n => n && !n.hidden);
  if (!ns.length) return null;
  const kept = ns.filter(n => !PANEL_FREE.has(n.id));
  if (kept.length) ns = kept;
  const bb = bboxOf(ns), head = p.look === 'card' ? PANEL_HEAD : 0;
  const x = bb.x - PANEL_PAD, y = bb.y - PANEL_PAD - head, w = bb.w + PANEL_PAD * 2;
  if (p.folded) return { x, y, w: Math.min(w, clamp(p.name.length * 7.4 + 120, 190, 440)), h: FOLD_H };
  return { x, y, w, h: bb.h + PANEL_PAD * 2 + head };
}
/* the panel that is the current selection (picked by its frame, its name or its Layers row) */
function selectedPanel() {
  const p = S.panelSel && !S.edgeSel && panelById(S.panelSel);
  if (!p) return null;
  const ms = p.members.filter(id => { const n = nodeById(id); return n && !n.hidden; });
  return ms.length && ms.length === S.sel.size && ms.every(id => S.sel.has(id)) ? p : null;
}
/* a connection end can be a node or a panel */
function endRect(id) {
  const n = nodeById(id);
  if (n) return isShown(n) ? rectOf(n) : null;
  const p = panelById(id);
  return p ? panelRect(p) : null;
}
function endPort(id, side) { const r = endRect(id); return r ? sidePoint(r, side, 0) : null; }
function drawFrames() { drawPanels(); drawGroupOutlines(); }
function drawPanels() {
  const e = env(), seen = new Set(), sp = selectedPanel();
  for (const p of e.panels) {
    const r = panelRect(p);
    if (!r) continue;
    let el = PANEL_EL.get(p.id);
    if (!el) {
      el = document.createElement('div');
      el.className = 'pframe';
      el.dataset.pid = p.id;
      el.innerHTML = ['t', 'r', 'b', 'l'].map(s => `<i class="pedge e-${s}" data-p="${p.id}"></i>`).join('') +
        `<div class="plabel" data-p="${p.id}"><button class="pfold" data-pfold="${p.id}" aria-label="Fold">${ic('chevr', 12)}</button>${ic('panel', 13)}<span class="pname"></span><span class="pcnt"></span></div>` +
        (S.canEdit ? SIDES.map(s => `<i class="port pport p-${s}" data-side="${s}" data-p="${p.id}"></i>`).join('') : '');
      groupsWrap.appendChild(el);
      PANEL_EL.set(p.id, el);
    }
    if (el.dataset.look !== p.look) el.dataset.look = p.look;
    el.style.setProperty('--gc', COLORS[p.color] || COLORS.slate);
    el.style.transform = `translate(${r.x}px,${r.y}px)`;
    el.style.width = r.w + 'px';
    el.style.height = r.h + 'px';
    const nm = el.querySelector('.pname'), cnt = el.querySelector('.pcnt'), fb = el.querySelector('.pfold');
    if (nm.textContent !== p.name) nm.textContent = p.name;
    const c = p.folded ? String(p.members.length) : '';
    if (cnt.textContent !== c) cnt.textContent = c;
    el.classList.toggle('folded', !!p.folded);
    fb.title = p.folded ? 'Unfold' : 'Fold';
    el.classList.toggle('sel', sp === p);
    el.classList.toggle('drop', PANEL_DROP === p.id);
    seen.add(p.id);
  }
  for (const [id, el] of PANEL_EL) if (!seen.has(id)) { el.remove(); PANEL_EL.delete(id); }
}
function drawGroupOutlines() {
  const e = env(), seen = new Set();
  for (const g of e.groups) {
    const ns = g.members.map(nodeById).filter(isShown);
    if (ns.length < 2 || !g.members.every(id => S.sel.has(id) || !isShown(nodeById(id)))) continue;
    const bb = bboxOf(ns);
    let el = GROUP_EL.get(g.id);
    if (!el) {
      el = document.createElement('div');
      el.className = 'gout';
      el.innerHTML = `<span>${ic('group', 11)}<b></b></span>`;
      groupsWrap.appendChild(el);
      GROUP_EL.set(g.id, el);
    }
    el.style.transform = `translate(${bb.x - GROUP_PAD}px,${bb.y - GROUP_PAD}px)`;
    el.style.width = bb.w + GROUP_PAD * 2 + 'px';
    el.style.height = bb.h + GROUP_PAD * 2 + 'px';
    const b = el.querySelector('b');
    if (b.textContent !== g.name) b.textContent = g.name;
    seen.add(g.id);
  }
  for (const [id, el] of GROUP_EL) if (!seen.has(id)) { el.remove(); GROUP_EL.delete(id); }
}

/* ---------- guides ---------- */
function drawGuides(gs) {
  guideG.innerHTML = gs.map(g => `<line class="${g.gap ? 'gap' : ''}" x1="${g.x1}" y1="${g.y1}" x2="${g.x2}" y2="${g.y2}"/>`).join('');
}

/* ---------- frame scheduling ---------- */
let FQ = 0;
function queueFrame() {
  if (FQ) return;
  FQ = requestAnimationFrame(() => { FQ = 0; drawEdges(); drawFrames(); drawMinimap(); });
}
let MQF = 0;
function queueMinimap() { if (!MQF) MQF = requestAnimationFrame(() => { MQF = 0; drawMinimap(); }); }

/* ---------- minimap ---------- */
let MM = null;
function drawMinimap() {
  const c = $('#minimap');
  if (!c || !c.offsetWidth) return;
  const ns = env().nodes.filter(n => !n.hidden);
  c.style.display = ns.length ? '' : 'none';
  if (!ns.length) return;
  const dpr = window.devicePixelRatio || 1, W = c.clientWidth, Hh = c.clientHeight;
  if (c.width !== W * dpr) { c.width = W * dpr; c.height = Hh * dpr; }
  const ctx = c.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, Hh);
  const vr = { x: -V.x / V.z, y: -V.y / V.z, w: VR.width / V.z, h: VR.height / V.z };
  const bb = bboxOf(ns);
  const x1 = Math.min(bb.x, vr.x), y1 = Math.min(bb.y, vr.y), x2 = Math.max(bb.x + bb.w, vr.x + vr.w), y2 = Math.max(bb.y + bb.h, vr.y + vr.h);
  const pad = 10, s = Math.min((W - pad * 2) / (x2 - x1), (Hh - pad * 2) / (y2 - y1));
  const ox = pad + ((W - pad * 2) - (x2 - x1) * s) / 2 - x1 * s, oy = pad + ((Hh - pad * 2) - (y2 - y1) * s) / 2 - y1 * s;
  MM = { s, ox, oy };
  const cs = getComputedStyle(document.documentElement);
  /* panels as soft outlines; a folded panel stands in for the nodes tucked inside it */
  ctx.lineWidth = 1;
  env().panels.forEach(p => {
    const r = panelRect(p);
    if (!r) return;
    ctx.strokeStyle = ctx.fillStyle = COLORS[p.color] || COLORS.slate;
    ctx.globalAlpha = p.folded ? 0.5 : 0.35;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(ox + r.x * s, oy + r.y * s, r.w * s, r.h * s, 3); else ctx.rect(ox + r.x * s, oy + r.y * s, r.w * s, r.h * s);
    if (p.folded) ctx.fill(); else ctx.stroke();
  });
  ns.filter(n => !foldMap().has(n.id)).forEach(n => {
    const r = rectOf(n);
    ctx.globalAlpha = S.sel.has(n.id) ? 1 : 0.55;
    ctx.fillStyle = COLORS[n.color] || COLORS.default;
    const w = Math.max(2, r.w * s), h = Math.max(2, r.h * s);
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(ox + r.x * s, oy + r.y * s, w, h, Math.min(3, w / 3)); else ctx.rect(ox + r.x * s, oy + r.y * s, w, h);
    ctx.fill();
  });
  ctx.globalAlpha = 1;
  ctx.strokeStyle = cs.getPropertyValue('--sel').trim() || '#7b93ff';
  ctx.lineWidth = 1.5;
  ctx.fillStyle = cs.getPropertyValue('--sel-soft').trim() || 'rgba(123,147,255,.15)';
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(ox + vr.x * s, oy + vr.y * s, vr.w * s, vr.h * s, 4); else ctx.rect(ox + vr.x * s, oy + vr.y * s, vr.w * s, vr.h * s);
  ctx.fill(); ctx.stroke();
}

/* ---------- side panels ---------- */
/* sidebar: environments without a category first, then each category with its environments */
function envRow(e, child) {
  return `<div class="env${e.id === S.envId ? ' active' : ''}${child ? ' child' : ''}" data-env="${e.id}"${S.canEdit ? ' draggable="true" title="Double-click to rename · drag to move"' : ''}>${ic('board', 15)}<span class="nm">${esc(e.name)}</span><span class="cnt">${e.nodes.length || ''}</span></div>`;
}
function renderEnvs() {
  const folders = DOC.folders || [], known = new Set(folders.map(f => f.id));
  let h = DOC.envs.filter(e => !known.has(e.folder)).map(e => envRow(e, false)).join('');
  for (const f of folders) {
    const items = DOC.envs.filter(e => e.folder === f.id);
    if (!S.canEdit && !items.length) continue;
    const open = !UI.collapsed['fold:' + f.id], active = items.some(e => e.id === S.envId);
    h += `<div class="efold${active ? ' has-active' : ''}" data-fold="${f.id}"${S.canEdit ? ' title="Click to open or close · double-click to rename"' : ''}><span class="lchev${open ? ' open' : ''}">${ic('chevr', 12)}</span>${ic(open ? 'folderopen' : 'folder', 15)}<span class="nm">${esc(f.name)}</span><span class="cnt">${items.length || ''}</span></div>`;
    if (open) h += `<div class="efold-items" data-fold-items="${f.id}">${items.length ? items.map(e => envRow(e, true)).join('') : (S.canEdit ? '<div class="efold-empty">Drag environments here</div>' : '')}</div>`;
  }
  $('#env-list').innerHTML = h;
}
/* depth: 0 top level, 1 inside a group or panel, 2 inside a group inside a panel */
function layerRow(n, depth, snip) {
  const icn = n.type === 'title' ? 'title' : n.type === 'note' ? 'note' : 'sub';
  return `<div class="layer${depth ? ' child d' + depth : ''}${S.sel.has(n.id) ? ' sel' : ''}${n.hidden ? ' is-hidden' : ''}" data-id="${n.id}"${S.canEdit ? ' draggable="true"' : ''}><span class="lic" style="color:${COLORS[n.color] || COLORS.default}">${ic(icn, 14)}</span><span class="nm">${esc(nodeName(n))}${snip ? `<small>${esc(snip)}</small>` : ''}</span>${eyeBtn(n.hidden)}</div>`;
}
function eyeBtn(hidden) {
  if (!S.canEdit) return '';
  return `<button class="leye" data-act="leye" title="${hidden ? 'Show' : 'Hide'} (${MOD}+Shift+H)" aria-label="${hidden ? 'Show' : 'Hide'}">${ic(hidden ? 'eyeoff' : 'eye', 14)}</button>`;
}
function renderLayers() {
  const e = env(), q = ($('#layer-filter').value || '').trim().toLowerCase();
  $('#layer-count').textContent = e.nodes.length || '';
  let h = '';
  if (q) {
    const hits = e.nodes.filter(n => nodeText(n).toLowerCase().includes(q)).reverse();
    h = hits.length ? hits.map(n => {
      const t = nodeText(n).replace(/\s+/g, ' '), i = t.toLowerCase().indexOf(q);
      return layerRow(n, false, i > -1 ? (i > 20 ? '…' : '') + t.slice(Math.max(0, i - 20), i + 40) : '');
    }).join('') : '<div class="list-empty">No matches</div>';
  } else if (!e.nodes.length) {
    h = `<div class="list-empty">No nodes yet.${S.canEdit ? '<br>Right-click the board to add one.' : ''}</div>`;
  } else {
    /* panels hold groups and nodes, groups hold nodes; each sits where its top-most node is */
    const inGroup = new Map(), inPanel = new Map(), sp = selectedPanel();
    e.groups.forEach(g => g.members.forEach(id => inGroup.set(id, g)));
    e.panels.forEach(p => p.members.forEach(id => inPanel.set(id, p)));
    const seenOk = n => S.canEdit || !n.hidden;   // visitors never see hidden nodes
    const top = e.nodes.slice().reverse().filter(seenOk);
    const done = new Set();
    const groupRows = (g, depth, list) => {
      const members = list.filter(m => g.members.includes(m.id));
      const open = !UI.collapsed[g.id], all = members.every(m => S.sel.has(m.id)), allHidden = members.every(m => m.hidden);
      let s = `<div class="layer grp${depth ? ' child d' + depth : ''}${all ? ' sel' : ''}${allHidden ? ' is-hidden' : ''}" data-g="${g.id}"${S.canEdit ? ' draggable="true"' : ''}><button class="lchev${open ? ' open' : ''}" data-act="lcollapse" aria-label="Collapse">${ic('chevr', 12)}</button><span class="lic">${ic('group', 14)}</span><span class="nm">${esc(g.name)}</span><span class="cnt">${members.length}</span>${eyeBtn(allHidden)}</div>`;
      if (open) members.forEach(m => { s += layerRow(m, depth + 1); });
      return s;
    };
    for (const n of top) {
      const p = inPanel.get(n.id), g = inGroup.get(n.id);
      if (p) {
        if (done.has(p.id)) continue;
        done.add(p.id);
        const members = top.filter(m => p.members.includes(m.id));
        const open = !UI.collapsed[p.id], allHidden = members.every(m => m.hidden);
        h += `<div class="layer pnl${sp === p ? ' sel' : ''}${allHidden ? ' is-hidden' : ''}${p.folded ? ' folded' : ''}" data-p="${p.id}"><button class="lchev${open ? ' open' : ''}" data-act="lcollapse" aria-label="Collapse">${ic('chevr', 12)}</button><span class="lic" style="color:${COLORS[p.color] || COLORS.slate}">${ic('panel', 14)}</span><span class="nm">${esc(p.name)}</span><span class="cnt">${members.length}</span>${eyeBtn(allHidden)}</div>`;
        if (!open) continue;
        const inner = new Set();
        for (const m of members) {
          const mg = inGroup.get(m.id);
          if (!mg) { h += layerRow(m, 1); continue; }
          if (inner.has(mg.id)) continue;
          inner.add(mg.id);
          h += groupRows(mg, 1, members);
        }
        continue;
      }
      if (g) {
        if (done.has(g.id)) continue;
        done.add(g.id);
        h += groupRows(g, 0, top);
        continue;
      }
      h += layerRow(n, 0);
    }
  }
  $('#layers').innerHTML = h;
}
/* grid of connection types (used in the line's right-click menu and in the inspector) */
function typeGridHTML(cur) {
  const groups = {};
  Object.entries(EDGE_TYPES).forEach(([k, t]) => { (groups[t.group] = groups[t.group] || []).push([k, t]); });
  const btn = (k, t) => `<button class="tt${(cur || '') === k ? ' on' : ''}" data-etype="${k}" style="--ec:${t ? t.color : 'var(--line)'}" title="${t ? t.label : 'Default'}"><span class="tt-ic">${t ? ic(t.icon, 12) : ''}</span><span class="tt-nm">${t ? t.label : 'Default'}</span></button>`;
  return `<div class="tgrid">${btn('', null)}${Object.entries(groups).map(([g, list]) => `<div class="tgroup">${esc(g)}</div>${list.map(([k, t]) => btn(k, t)).join('')}`).join('')}</div>`;
}
function swatches(cur) {
  return Object.entries(COLORS).map(([k, v]) => `<button class="sw${cur === k ? ' on' : ''}" data-sw="${k}" style="--sw:${v}" title="${k}" aria-label="${k}"></button>`).join('');
}
function renderInspector() {
  const box = $('#inspector');
  if (!S.canEdit) { box.innerHTML = ''; return; }
  const e = env();
  let h = '';
  if (S.edgeSel) {
    const ed = e.edges.find(x => x.id === S.edgeSel);
    const st = lineStyle(ed);
    if (ed) h = `<div class="sec-head"><span>Connection</span></div><div class="insp">
      <div class="seg3"><button class="seg${st === 'fluid' ? ' on' : ''}" data-ia="estyle" data-v="fluid">${ic('fluid', 14)} Fluid</button><button class="seg${st === 'geometric' ? ' on' : ''}" data-ia="estyle" data-v="geometric">${ic('geo', 14)} Geometric</button></div>
      <div class="row2"><button class="seg${ed.arrow ? ' on' : ''}" data-ia="arrow">${ic('arrowr', 14)} Arrow</button><button class="seg${ed.dashed ? ' on' : ''}" data-ia="dashed">${ic('dash', 14)} Dashed</button></div>
      <div class="ihead">Connection type</div>${typeGridHTML(ed.type)}
      <button class="ibtn" data-ia="elabel">${ic('edit', 14)} ${ed.label ? 'Edit label' : 'Add label'}</button>
      <button class="ibtn" data-ia="reverse">${ic('swap', 14)} Reverse direction</button>
      ${ed.bend ? `<button class="ibtn" data-ia="unbend">${ic('refresh', 14)} Reset curve</button>` : ''}
      <button class="ibtn danger" data-ia="del">${ic('trash', 14)} Delete <kbd>Del</kbd></button></div>`;
  } else if (selectedPanel()) {
    const p = selectedPanel();
    h = `<div class="sec-head"><span>${esc(p.name)}</span><span class="cnt">Panel</span></div><div class="insp">
      <div class="ihead">Look</div>
      <div class="glooks">${PANEL_LOOKS.map(([k, name]) => `<button class="glook${p.look === k ? ' on' : ''}" data-ia="plook" data-v="${k}" title="${name}"><span class="gl-prev gl-${k}"></span>${name}</button>`).join('')}</div>
      <div class="ihead">Frame colour</div><div class="swrow">${Object.entries(COLORS).map(([k, v]) => `<button class="sw${(p.color || 'slate') === k ? ' on' : ''}" data-pc="${k}" style="--sw:${v}" title="${k}" aria-label="${k}"></button>`).join('')}</div>
      <div class="row2"><button class="ibtn" style="flex:1" data-ia="pfold">${ic('chevr', 14)} ${p.folded ? 'Unfold' : 'Fold'}</button><button class="ibtn" style="flex:1" data-ia="prename">${ic('edit', 14)} Rename</button></div>
      ${p.folded ? '' : `<div class="row4"><button class="ib" data-ia="align" data-v="l" title="Align left">${ic('alignl', 15)}</button><button class="ib" data-ia="align" data-v="c" title="Align centres">${ic('alignc', 15)}</button><button class="ib" data-ia="align" data-v="t" title="Align top">${ic('alignt', 15)}</button><button class="ib" data-ia="tidy" title="Tidy up">${ic('tidy', 15)}</button></div>`}
      <button class="ibtn" data-ia="unpanel">${ic('panel', 14)} Remove panel (keep nodes)</button>
      <button class="ibtn danger" data-ia="del">${ic('trash', 14)} Delete panel and nodes</button></div>`;
  } else if (S.sel.size === 1) {
    const n = nodeById([...S.sel][0]), p = n && panelOf(n.id);
    if (n) h = `<div class="sec-head"><span>${NODE_LABEL[n.type]}</span></div><div class="insp">
      <div class="seg3">${['title', 'note', 'sub'].map(t => `<button class="seg${n.type === t ? ' on' : ''}" data-ia="type" data-v="${t}">${NODE_LABEL[t]}</button>`).join('')}</div>
      <div class="swrow">${swatches(n.color)}</div>
      <div class="row2"><button class="ibtn" style="flex:1" data-ia="dup">${ic('copy', 14)} Duplicate</button><button class="ibtn danger" data-ia="del" aria-label="Delete">${ic('trash', 14)}</button></div>
      ${p ? `<button class="ibtn" data-ia="outpanel">${ic('panel', 14)} Take out of “${esc(p.name)}”</button>` : `<button class="ibtn" data-ia="panel">${ic('panel', 14)} Put in a panel <kbd>P</kbd></button>`}
      <div class="meta">X ${Math.round(n.x)} · Y ${Math.round(n.y)} · W ${n.w}</div></div>`;
  } else if (S.sel.size > 1) {
    const g = selectedGroup(), inPanel = [...S.sel].some(id => panelOf(id));
    h = `<div class="sec-head"><span>${g ? esc(g.name) : S.sel.size + ' selected'}</span>${g ? '<span class="cnt">Group</span>' : ''}</div><div class="insp">
      <div class="row4"><button class="ib" data-ia="align" data-v="l" title="Align left">${ic('alignl', 15)}</button><button class="ib" data-ia="align" data-v="c" title="Align centres">${ic('alignc', 15)}</button><button class="ib" data-ia="align" data-v="t" title="Align top">${ic('alignt', 15)}</button><button class="ib" data-ia="tidy" title="Tidy up">${ic('tidy', 15)}</button></div>
      <div class="ihead">${g ? 'Node colour' : 'Colour'}</div><div class="swrow">${swatches(null)}</div>
      ${g ? `<div class="row2"><button class="ibtn" style="flex:1" data-ia="grename">${ic('edit', 14)} Rename</button><button class="ibtn" style="flex:1" data-ia="ungroup">${ic('group', 14)} Ungroup</button></div>` : `<button class="ibtn" data-ia="group">${ic('group', 14)} Group <kbd>${MOD} G</kbd></button>`}
      <button class="ibtn" data-ia="panel">${ic('panel', 14)} Put in a new panel <kbd>P</kbd></button>
      ${inPanel ? `<button class="ibtn" data-ia="outpanel">${ic('panel', 14)} Take out of panel</button>` : ''}
      <button class="ibtn danger" data-ia="del">${ic('trash', 14)} Delete <kbd>Del</kbd></button></div>`;
  }
  box.innerHTML = h;
}
let TOPKEY = '';
function renderTop(force) {
  const el = $('#topright');
  let key, h;
  if (!S.canEdit) {
    key = 'v' + S.preview;
    h = `<span class="pill">${ic('eye', 14)} View only</span><button class="tbtn" data-cmd="share" data-tip="Copy link">${ic('link', 15)}</button>` +
      (S.preview ? `<button class="btn primary" data-cmd="exit-preview">Exit preview</button>` : '');
  } else {
    const st = S.publishing ? ['busy', 'Publishing…'] : !S.connected ? ['local', S.local ? 'Saved on this device' : 'Saved locally'] : META.dirty ? ['dirty', 'Unpublished changes'] : ['ok', 'Published'];
    key = st.join() + S.connected;
    h = `<span class="pill st-${st[0]}"><i></i>${st[1]}</span>` +
      `<button class="tbtn" data-cmd="preview" data-tip="Preview as a visitor">${ic('eye', 15)}</button>` +
      `<button class="tbtn" data-cmd="share" data-tip="Copy link">${ic('link', 15)}</button>` +
      `<button class="btn ${S.connected && META.dirty ? 'primary' : 'quiet'}" data-cmd="publish"${S.publishing ? ' disabled' : ''}>${ic('upload', 14)}<span>Publish</span></button>`;
  }
  if (key === TOPKEY && !force) return;
  TOPKEY = key;
  el.innerHTML = h;
}
function renderEmptyHint() {
  const hint = $('#empty-hint'), empty = !env().nodes.length;
  hint.hidden = !empty;
  if (empty) hint.innerHTML = S.canEdit
    ? `<div class="eh-ic">${ic('plus', 24)}</div><b>An empty environment</b><span>Right-click anywhere to add a node, or press N</span>`
    : `<div class="eh-ic">${ic('board', 24)}</div><b>Nothing here yet</b><span>This environment is empty</span>`;
}
function renderAll(force) {
  syncNodes(force);
  renderEnvs(); renderLayers(); renderInspector(); renderTop(true); renderEmptyHint();
  drawEdges(); drawFrames(); drawMinimap(); drawBubbles(); renderSugPanel();
}
