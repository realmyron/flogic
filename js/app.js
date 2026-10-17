'use strict';
/* Flogic: interaction layer (pointer, keyboard, menus, editing, publishing, boot). */

let PTR = { x: -1, y: -1 }, DRAG = null, PAN = null, MQ = null, CONN = null, BD = null, RZ = null, TB = null, PINCH = null, EG = null;
const TOUCH = new Map();
const pointerInVp = () => PTR.x >= VR.left && PTR.x <= VR.left + VR.width && PTR.y >= VR.top && PTR.y <= VR.top + VR.height;
const capture = e => { try { vp.setPointerCapture(e.pointerId); } catch (_) {} };

/* =====================================================================
   Motion: nodes glide to their (snapped) model position on a spring,
   tilt with horizontal speed while held, and get a directional blur.
   ===================================================================== */
let RAF = 0;
const MB = $('#mblur-g');
function captureDisp(ids) {
  for (const id of ids) {
    if (DISP.has(id)) continue;
    const n = nodeById(id);
    if (n) DISP.set(id, { x: n.x, y: n.y, ux: 0, uy: 0, s: 1, r: 0 });
  }
}
function kick() { if (!RAF) RAF = requestAnimationFrame(tick); }
function tick() {
  RAF = 0;
  const held = DRAG && DRAG.moved ? DRAG.set : null;
  let any = false, lead = null;
  for (const [id, d] of DISP) {
    const n = nodeById(id), el = NODE_EL.get(id);
    if (!n || !el) { DISP.delete(id); continue; }
    const h = held && held.has(id);
    const st = h ? 0.36 : 0.2, dm = h ? 0.48 : 0.6;
    d.ux = d.ux * dm + (n.x - d.x) * st;
    d.uy = d.uy * dm + (n.y - d.y) * st;
    d.x += d.ux; d.y += d.uy;
    d.s += ((h ? 1.025 : 1) - d.s) * 0.25;
    d.r += ((h ? clamp(d.ux * V.z * 0.22, -4, 4) : 0) - d.r) * 0.22;
    if (!h && Math.abs(n.x - d.x) < 0.25 && Math.abs(n.y - d.y) < 0.25 && Math.abs(d.ux) < 0.05 && Math.abs(d.uy) < 0.05 && Math.abs(d.s - 1) < 0.002 && Math.abs(d.r) < 0.03) {
      DISP.delete(id);
      el.style.transform = `translate3d(${n.x}px,${n.y}px,0)`;
      el.style.filter = '';
      continue;
    }
    any = true;
    el.style.transform = `translate3d(${d.x.toFixed(2)}px,${d.y.toFixed(2)}px,0) rotate(${d.r.toFixed(2)}deg) scale(${d.s.toFixed(4)})`;
    if (h && (!lead || id === DRAG.lead)) lead = d;
  }
  if (held) {
    let bx = 0, by = 0;
    if (lead) {
      bx = clamp((Math.abs(lead.ux) * V.z - 3) * 0.14, 0, 2.4) / V.z;
      by = clamp((Math.abs(lead.uy) * V.z - 3) * 0.14, 0, 2.4) / V.z;
    }
    const on = bx > 0.03 || by > 0.03;
    MB.setAttribute('stdDeviation', `${bx.toFixed(2)} ${by.toFixed(2)}`);
    for (const id of held) { const el = NODE_EL.get(id); if (el) el.style.filter = on ? 'url(#mblur)' : ''; }
  }
  drawEdges(); drawGroups();
  if (any) RAF = requestAnimationFrame(tick); else queueMinimap();
}
function popIn(ids, stagger) {
  ids.forEach((id, i) => {
    const el = NODE_EL.get(id);
    if (!el) return;
    el.classList.remove('pop'); void el.offsetWidth;
    if (stagger) el.style.animationDelay = Math.min(i, 30) * 16 + 'ms';
    el.classList.add('pop');
    setTimeout(() => { el.classList.remove('pop'); el.style.animationDelay = ''; }, 450 + (stagger ? Math.min(i, 30) * 16 : 0));
  });
}

/* ===================== selection ===================== */
function refreshSel(light) {
  for (const [id, el] of NODE_EL) el.classList.toggle('sel', S.sel.has(id));
  drawEdges(); drawGroups();
  if (light) return;
  renderLayers(); renderInspector(); queueMinimap();
}
function selectNodes(ids, add) { if (!add) S.sel.clear(); ids.forEach(id => S.sel.add(id)); S.edgeSel = null; refreshSel(); }
function clearSel() { if (!S.sel.size && !S.edgeSel) return; S.sel.clear(); S.edgeSel = null; refreshSel(); }
function selectEdge(id) { S.sel.clear(); S.edgeSel = id; refreshSel(); }
function groupOrNode(id) { const g = groupOf(id); return g ? g.members.slice() : [id]; }
function selNodes() { return [...S.sel].map(nodeById).filter(Boolean); }

/* ===================== change tracking ===================== */
function changed() {
  CHG++;
  META.dirty = true;
  saveLocal();
  renderTop();
  scheduleAuto();
}
function structureChanged() {
  syncNodes();
  drawEdges(); drawGroups();
  renderLayers(); renderInspector(); renderEnvs(); renderEmptyHint(); queueMinimap();
  changed();
}
function restore(json) {
  endEdit();
  const old = new Map(env().nodes.map(n => [n.id, { x: n.x, y: n.y }]));
  DOC = migrate(JSON.parse(json));
  if (!DOC.envs.some(e => e.id === S.envId)) switchEnv(DOC.envs[0].id);
  else {
    S.sel = new Set([...S.sel].filter(id => nodeById(id)));
    if (S.edgeSel && !env().edges.some(x => x.id === S.edgeSel)) S.edgeSel = null;
    for (const n of env().nodes) {
      const o = old.get(n.id);
      if (o && (o.x !== n.x || o.y !== n.y) && !DISP.has(n.id)) DISP.set(n.id, { x: o.x, y: o.y, ux: 0, uy: 0, s: 1, r: 0 });
    }
    renderAll(true);
    kick();
  }
  changed();
}

/* ===================== text editing ===================== */
const PLAIN = (() => { const d = document.createElement('div'); try { d.contentEditable = 'plaintext-only'; } catch (e) {} return d.contentEditable === 'plaintext-only' ? 'plaintext-only' : 'true'; })();
function startEdit(el, cx, cy) {
  if (!S.canEdit || !el) return;
  if (S.editing && S.editing.el === el) return;
  endEdit();
  const ne = el.closest('.node');
  if (!ne) return;
  checkpoint();
  S.editing = { el, id: ne.dataset.id, f: el.dataset.f, before: el.textContent };
  el.setAttribute('contenteditable', PLAIN);
  el.setAttribute('spellcheck', 'true');
  ne.classList.add('editing');
  el.focus({ preventScroll: true });
  const sel = getSelection();
  sel.removeAllRanges();
  let r = null;
  if (cx != null) {
    if (document.caretRangeFromPoint) r = document.caretRangeFromPoint(cx, cy);
    else if (document.caretPositionFromPoint) {
      const p = document.caretPositionFromPoint(cx, cy);
      if (p) { r = document.createRange(); r.setStart(p.offsetNode, p.offset); r.collapse(true); }
    }
  }
  if (!r || !el.contains(r.startContainer)) { r = document.createRange(); r.selectNodeContents(el); r.collapse(false); }
  sel.addRange(r);
}
function editField(nodeId, f, selectAll) {
  const ne = NODE_EL.get(nodeId), el = ne && ne.querySelector(`[data-f="${f}"]`);
  if (!el) return;
  startEdit(el);
  if (selectAll && el.textContent) { const r = document.createRange(); r.selectNodeContents(el); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
}
function endEdit() {
  const ed = S.editing;
  if (!ed) return;
  S.editing = null;
  const el = ed.el, n = nodeById(ed.id);
  if (n) {
    let v = el.innerText.replace(/\xa0/g, ' ').replace(/\n+$/, '');
    if (el.dataset.single) v = v.replace(/\s*\n\s*/g, ' ');
    setPath(n, ed.f, v);
    if (el.textContent !== v) el.textContent = v;
    if (v !== ed.before) changed();
  }
  el.removeAttribute('contenteditable');
  el.removeAttribute('spellcheck');
  const ne = el.closest('.node');
  if (ne) ne.classList.remove('editing');
  if (document.activeElement === el) el.blur();
  getSelection().removeAllRanges();
  renderLayers(); renderInspector();
}
nodesWrap.addEventListener('input', e => {
  const ed = S.editing;
  if (!ed || e.target !== ed.el) return;
  const n = nodeById(ed.id);
  if (!n) return;
  let v = ed.el.innerText;
  if (v === '\n' || v === '') { v = ''; if (ed.el.innerHTML) ed.el.innerHTML = ''; }
  setPath(n, ed.f, v);
  changed();
});
nodesWrap.addEventListener('focusout', e => { if (S.editing && e.target === S.editing.el) endEdit(); });
nodesWrap.addEventListener('keydown', e => {
  const ed = S.editing;
  if (!ed || e.target !== ed.el) return;
  e.stopPropagation();
  if (e.key === 'Escape') { e.preventDefault(); endEdit(); return; }
  if (e.key === 'Enter' && (ed.el.dataset.single || e.ctrlKey || e.metaKey)) { e.preventDefault(); endEdit(); return; }
  if (e.key === 'Tab') {
    e.preventDefault();
    const all = $$('[data-f]', NODE_EL.get(ed.id)).filter(x => x.offsetParent);
    const nx = all[(all.indexOf(ed.el) + (e.shiftKey ? -1 : 1) + all.length) % all.length];
    if (nx) startEdit(nx);
  }
});
nodesWrap.addEventListener('paste', e => {
  if (PLAIN === 'true' && S.editing && e.target.closest('[contenteditable]')) {
    e.preventDefault();
    document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
  }
});

/* ===================== node operations ===================== */
/* Each environment holds at most NODE_LIMIT nodes unless the limit is switched off in Settings. */
function roomFor(k = 1) {
  if (CFG.noLimit) return true;
  const have = env().nodes.length;
  if (have + k <= NODE_LIMIT) return true;
  toast(`This environment is at the ${NODE_LIMIT.toLocaleString()}-node limit. You can turn the limit off in Settings.`, { type: 'err', ms: 5000, actions: [{ label: 'Settings', fn: openSettings }] });
  return false;
}
function addNodeRaw(type, x, y) {
  const n = makeNode(type);
  n.x = clamp(x, -WORLD, WORLD); n.y = clamp(y, -WORLD, WORLD);
  env().nodes.push(n);
  return n;
}
function createNode(type, wx, wy, o = {}) {
  if (!roomFor(1)) return null;
  endEdit(); checkpoint();
  let x = wx - NODE_W[type] / 2, y = wy - 28;
  if (!o.free) { x = snapV(x); y = snapV(y); }
  const n = addNodeRaw(type, x, y);
  S.sel = new Set([n.id]); S.edgeSel = null;
  structureChanged(); refreshSel(); popIn([n.id]);
  if (o.edit !== false) editField(n.id, 'title');
  return n;
}
function createAt(type, where) {
  if (where === 'pointer' && pointerInVp()) { const p = toWorld(PTR.x, PTR.y); return createNode(type, p.x, p.y); }
  const c = toWorld(VR.left + VR.width / 2, VR.top + VR.height / 2), w = NODE_W[type];
  let x = snapV(c.x - w / 2), y = snapV(c.y - 60);
  const rs = env().nodes.map(n => rectOf(n, true));
  for (let i = 0; i < 80 && rs.some(r => x < r.x + r.w + GRID && x + w + GRID > r.x && y < r.y + r.h + GRID && y + 140 > r.y); i++) y += GRID * 2;
  return createNode(type, x + w / 2, y + 28);
}
function deleteSel() {
  endEdit();
  const e = env();
  if (S.edgeSel) {
    checkpoint();
    e.edges = e.edges.filter(x => x.id !== S.edgeSel);
    S.edgeSel = null;
    drawEdges(); renderInspector(); changed();
    return;
  }
  if (!S.sel.size) return;
  checkpoint();
  const ids = new Set(S.sel);
  e.nodes = e.nodes.filter(n => !ids.has(n.id));
  e.edges = e.edges.filter(x => !ids.has(x.from) && !ids.has(x.to));
  e.groups.forEach(g => { g.members = g.members.filter(id => !ids.has(id)); });
  e.groups = e.groups.filter(g => g.members.length > 1);
  for (const id of ids) {
    const el = NODE_EL.get(id);
    if (!el) continue;
    NODE_EL.delete(id); RO.unobserve(el); SIZE.delete(id); DISP.delete(id);
    el.classList.add('leaving'); el.style.pointerEvents = 'none';
    setTimeout(() => el.remove(), 200);
  }
  S.sel.clear();
  structureChanged();
  toast(`Deleted ${ids.size} node${ids.size > 1 ? 's' : ''}`, { actions: [{ label: 'Undo', fn: undo }] });
}

/* copy / paste / duplicate */
let CLIP = null;
function selData() {
  const e = env(), ids = new Set(S.sel);
  return { nodes: e.nodes.filter(n => ids.has(n.id)).map(clone), edges: e.edges.filter(x => ids.has(x.from) && ids.has(x.to)).map(clone) };
}
function copySel(silent) {
  if (!S.sel.size) return;
  CLIP = selData();
  CLIP.sys = false;
  const c = CLIP;
  try { navigator.clipboard.writeText('flogic:' + JSON.stringify({ nodes: c.nodes, edges: c.edges })).then(() => { c.sys = true; }, () => {}); } catch (_) {}
  if (!silent) toast(`Copied ${c.nodes.length} node${c.nodes.length > 1 ? 's' : ''}`);
}
function pasteData(data, at) {
  if (!data || !Array.isArray(data.nodes) || !data.nodes.length) return;
  const tmp = migrate({ envs: [{ id: 'x', name: 'x', nodes: clone(data.nodes), edges: clone(data.edges || []), groups: [] }] }).envs[0];
  if (!tmp.nodes.length || !roomFor(tmp.nodes.length)) return;
  endEdit(); checkpoint();
  const e = env(), map = {}, bb = bboxOf(tmp.nodes, true);
  const dx = at ? snapV(at.x - bb.x - bb.w / 2) : GAP, dy = at ? snapV(at.y - bb.y - bb.h / 2) : GAP;
  const added = [];
  tmp.nodes.forEach(n => {
    const old = n.id;
    reIdNode(n);
    map[old] = n.id;
    n.x = clamp(n.x + dx, -WORLD, WORLD); n.y = clamp(n.y + dy, -WORLD, WORLD);
    e.nodes.push(n); added.push(n.id);
  });
  tmp.edges.forEach(x => { if (map[x.from] && map[x.to]) e.edges.push(Object.assign(x, { id: uid('l'), from: map[x.from], to: map[x.to] })); });
  S.sel = new Set(added); S.edgeSel = null;
  structureChanged(); refreshSel(); popIn(added, true);
}
function duplicateSel() { if (S.sel.size) pasteData(selData(), null); }

/* type, colour, order */
function setType(type) {
  const ns = selNodes();
  if (!ns.length) return;
  endEdit(); checkpoint();
  ns.forEach(n => {
    if (n.type === type) return;
    if (n.w === NODE_W[n.type]) n.w = NODE_W[type];
    if (!n.tag || n.tag === NODE_LABEL[n.type]) n.tag = type === 'sub' ? '' : NODE_LABEL[type];
    n.type = type;
    renderNode(n);
  });
  renderLayers(); renderInspector(); queueMinimap(); changed();
}
function setColor(c) {
  const ns = selNodes();
  if (!ns.length) return;
  checkpoint();
  ns.forEach(n => { n.color = c; const el = NODE_EL.get(n.id); if (el) el.dataset.c = c; });
  renderLayers(); renderInspector(); queueMinimap(); changed();
}
function reorder(front) {
  const e = env(), sel = e.nodes.filter(n => S.sel.has(n.id));
  if (!sel.length) return;
  checkpoint();
  const rest = e.nodes.filter(n => !S.sel.has(n.id));
  e.nodes = front ? rest.concat(sel) : sel.concat(rest);
  syncZ(); renderLayers(); changed();
}

/* groups */
function groupSel() {
  if (S.sel.size < 2) return toast('Select two or more nodes to group them');
  checkpoint();
  const e = env(), ids = [...S.sel];
  e.groups.forEach(g => { g.members = g.members.filter(id => !S.sel.has(id)); });
  e.groups = e.groups.filter(g => g.members.length > 1);
  let k = e.groups.length + 1;
  while (e.groups.some(g => g.name === 'Group ' + k)) k++;
  e.groups.push({ id: uid('g'), name: 'Group ' + k, members: ids });
  structureChanged(); refreshSel();
}
function ungroupSel() {
  const e = env(), gs = e.groups.filter(g => g.members.some(id => S.sel.has(id)));
  if (!gs.length) return;
  checkpoint();
  e.groups = e.groups.filter(g => !gs.includes(g));
  structureChanged(); refreshSel();
}
/* Hide or show nodes. If any of them is visible they all get hidden, otherwise they all come back.
   Hidden nodes are saved that way, so visitors don't see them either. */
function toggleHidden(ids) {
  const ns = ids.map(nodeById).filter(Boolean);
  if (!ns.length) return;
  endEdit(); checkpoint();
  const hide = ns.some(n => !n.hidden);
  ns.forEach(n => {
    if (hide) { n.hidden = true; S.sel.delete(n.id); } else delete n.hidden;
    const el = NODE_EL.get(n.id);
    if (el) el.classList.toggle('is-hidden', hide);
  });
  if (!hide) S.sel = new Set(ns.map(n => n.id));
  refreshSel(); changed();
  toast(hide ? `Hidden ${ns.length > 1 ? ns.length + ' nodes' : '“' + nodeName(ns[0]) + '”'}` : 'Shown again', hide ? { actions: [{ label: 'Undo', fn: undo }] } : {});
}
function renameGroup(gid) {
  const g = env().groups.find(x => x.id === gid);
  if (!g || !S.canEdit) return;
  promptModal('Rename group', g.name, v => { checkpoint(); g.name = v; drawGroups(); renderLayers(); renderInspector(); changed(); });
}

/* layout helpers */
function alignSel(mode) {
  const ns = selNodes();
  if (ns.length < 2) return;
  checkpoint(); captureDisp(ns.map(n => n.id));
  const bb = bboxOf(ns, true);
  ns.forEach(n => {
    const s = sizeOf(n);
    if (mode === 'l') n.x = bb.x;
    if (mode === 't') n.y = bb.y;
    if (mode === 'c') n.x = Math.round(bb.x + bb.w / 2 - s.w / 2);
  });
  kick(); changed(); renderInspector();
}
/* Tidy up: group into rows by vertical overlap, space each row evenly, keep rows centred where they were. */
function tidySel() {
  let ns = selNodes();
  if (ns.length < 2) ns = env().nodes.slice();
  if (ns.length < 2) return;
  checkpoint(); captureDisp(ns.map(n => n.id));
  const items = ns.map(n => ({ n, r: rectOf(n, true) })).sort((a, b) => a.r.y - b.r.y);
  const rows = [];
  for (const it of items) {
    const row = rows.find(rw => it.r.y < rw.bottom - Math.min(40, it.r.h * 0.3));
    if (row) { row.items.push(it); row.bottom = Math.max(row.bottom, it.r.y + it.r.h); }
    else rows.push({ items: [it], top: it.r.y, bottom: it.r.y + it.r.h });
  }
  let y = snapV(rows[0].top);
  for (const row of rows) {
    row.items.sort((a, b) => a.r.x - b.r.x);
    const total = row.items.reduce((s, it) => s + it.r.w, 0) + GAP * (row.items.length - 1);
    const left = Math.min(...row.items.map(it => it.r.x)), right = Math.max(...row.items.map(it => it.r.x + it.r.w));
    let x = snapV((left + right) / 2 - total / 2), h = 0;
    for (const it of row.items) { it.n.x = x; it.n.y = y; x += it.r.w + GAP; h = Math.max(h, it.r.h); }
    y = Math.ceil((y + h + GAP) / GRID) * GRID;
  }
  kick(); changed(); renderInspector();
  toast('Tidied up', { actions: [{ label: 'Undo', fn: undo }] });
}
let lastNudge = 0;
function nudge(dx, dy) {
  const ns = selNodes();
  if (!ns.length) return;
  if (Date.now() - lastNudge > 700) checkpoint();
  lastNudge = Date.now();
  captureDisp(ns.map(n => n.id));
  ns.forEach(n => { n.x = clamp(n.x + dx, -WORLD, WORLD); n.y = clamp(n.y + dy, -WORLD, WORLD); });
  kick(); changed(); renderInspector();
}

/* ===================== edges ===================== */
function addEdge(from, fs, to, ts) {
  const e = env();
  if (from === to) return false;
  if (e.edges.some(x => (x.from === from && x.to === to) || (x.from === to && x.to === from))) { toast('Those nodes are already connected'); return false; }
  e.edges.push({ id: uid('l'), from, fs, to, ts, label: '', arrow: true, dashed: false });
  return true;
}
function edgeSet(id, patch) {
  const ed = env().edges.find(x => x.id === id);
  if (!ed) return;
  checkpoint(); Object.assign(ed, patch);
  drawEdges(); renderInspector(); changed();
}
function reverseEdge(id) {
  const ed = env().edges.find(x => x.id === id);
  if (ed) edgeSet(id, { from: ed.to, to: ed.from, fs: ed.ts, ts: ed.fs });
}
function editEdgeLabel(id) {
  const ed = env().edges.find(x => x.id === id);
  if (!ed || !S.canEdit) return;
  endEdit();
  S.sel.clear(); S.edgeSel = id; refreshSel();
  const r = EDGE_EL.get(id);
  if (!r) return;
  checkpoint();
  const lab = r.lab;
  lab.setAttribute('contenteditable', PLAIN);
  lab.style.display = '';
  lab.classList.remove('empty');
  lab.textContent = ed.label;
  lab.focus();
  const rg = document.createRange(); rg.selectNodeContents(lab);
  const s = getSelection(); s.removeAllRanges(); s.addRange(rg);
  const kd = ev => { ev.stopPropagation(); if (ev.key === 'Enter' || ev.key === 'Escape') { ev.preventDefault(); lab.blur(); } };
  const done = () => {
    lab.removeEventListener('blur', done); lab.removeEventListener('keydown', kd);
    lab.removeAttribute('contenteditable');
    const v = lab.innerText.replace(/\s+/g, ' ').trim();
    if (v !== ed.label) { ed.label = v; changed(); }
    lab.textContent = v;
    drawEdges(); renderInspector();
  };
  lab.addEventListener('blur', done); lab.addEventListener('keydown', kd);
}

/* ===================== blocks ===================== */
const FIRST_FIELD = { text: 'text', highlight: 'text', category: 'text', conclusion: 'text', scenarios: 'items.0.title', checklist: 'items.0.text' };
function landed(n, i) {
  const el = NODE_EL.get(n.id), b = el && el.querySelector(`.blk[data-i="${i}"]`);
  if (b) { b.classList.remove('landed'); void b.offsetWidth; b.classList.add('landed'); }
}
function addBlock(n, kind, idx) {
  endEdit(); checkpoint();
  const b = makeBlock(kind);
  if (idx == null) n.blocks.push(b); else n.blocks.splice(idx, 0, b);
  if (kind === 'scenarios') S.open[b.items[0].id] = true;
  renderNode(n); changed(); renderLayers();
  const i = n.blocks.indexOf(b);
  landed(n, i);
  if (FIRST_FIELD[kind]) editField(n.id, `blocks.${i}.${FIRST_FIELD[kind]}`);
  if (kind === 'sources') openSourceForm(n.id, i);
}
function moveBlock(n, from, to) {
  if (to < 0 || to >= n.blocks.length || from === to) return;
  endEdit(); checkpoint();
  const [b] = n.blocks.splice(from, 1);
  n.blocks.splice(to, 0, b);
  renderNode(n); landed(n, to); changed();
}
function duplicateBlock(n, i) {
  endEdit(); checkpoint();
  const tmp = { blocks: [clone(n.blocks[i])] };
  reIdNode(tmp);
  n.blocks.splice(i + 1, 0, tmp.blocks[0]);
  renderNode(n); landed(n, i + 1); changed();
}
function extractBlock(n, i) {
  if (!roomFor(1)) return;
  endEdit(); checkpoint();
  const [b] = n.blocks.splice(i, 1), r = rectOf(n, true);
  const s = addNodeRaw('sub', snapV(r.x + r.w + GAP), snapV(r.y));
  s.blocks = [b]; s.color = n.color;
  addEdge(n.id, 'r', s.id, 'l');
  renderNode(n);
  S.sel = new Set([s.id]);
  structureChanged(); refreshSel(); popIn([s.id]);
}
function openSourceForm(nodeId, bi) {
  const el = NODE_EL.get(nodeId), blk = el && el.querySelector(`.blk[data-i="${bi}"]`), add = blk && blk.querySelector('[data-act="add-src"]');
  if (!add) return;
  const n = nodeById(nodeId);
  const f = document.createElement('div');
  f.className = 'src-form';
  f.innerHTML = `<input class="sf-u" placeholder="https://…" autocomplete="off" spellcheck="false"><input class="sf-t" placeholder="Title (optional)" autocomplete="off"><div class="sf-row"><span class="err"></span><button class="btn sm" data-sf="cancel">Cancel</button><button class="btn sm primary" data-sf="ok">Add</button></div>`;
  add.replaceWith(f);
  const u = f.querySelector('.sf-u'), t = f.querySelector('.sf-t'), er = f.querySelector('.err');
  u.focus();
  const ok = () => {
    const url = safeUrl(u.value);
    if (!url) { er.textContent = 'Enter a valid http(s) link'; u.focus(); return; }
    checkpoint();
    n.blocks[bi].items.push({ t: t.value.trim(), u: url });
    renderNode(n); changed();
  };
  f.addEventListener('click', e => { e.stopPropagation(); const b = e.target.closest('[data-sf]'); if (b) b.dataset.sf === 'ok' ? ok() : renderNode(n); });
  f.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); ok(); } if (e.key === 'Escape') renderNode(n); });
}

nodesWrap.addEventListener('click', e => {
  const ne = e.target.closest('.node');
  if (!ne) return;
  const n = nodeById(ne.dataset.id);
  if (!n) return;
  const a = e.target.closest('[data-act]');
  if (!a) {
    const img = e.target.closest('.b-img img');
    if (img && !S.canEdit) openLightbox(img.src, img.alt);
    return;
  }
  const act = a.dataset.act, blk = a.closest('.blk'), bi = blk ? +blk.dataset.i : -1, b = n.blocks[bi];
  if (act === 'toggle-scn') {
    const sc = a.closest('.scn'), id = sc.dataset.sid;
    S.open[id] = !S.open[id];
    sc.classList.toggle('open', !!S.open[id]);
    return;
  }
  if (!S.canEdit) return;
  e.stopPropagation();
  const si = +a.dataset.si, ti = +a.dataset.ti, ii = +a.dataset.ii;
  const mut = fn => { endEdit(); checkpoint(); fn(); renderNode(n); changed(); renderLayers(); };
  switch (act) {
    case 'add-block': openBlockMenu(a, n); break;
    case 'del-block': mut(() => n.blocks.splice(bi, 1)); break;
    case 'add-scn': { const s = makeScenario(); S.open[s.id] = true; mut(() => b.items.push(s)); editField(n.id, `blocks.${bi}.items.${b.items.length - 1}.title`); break; }
    case 'del-scn': mut(() => b.items.splice(si, 1)); break;
    case 'add-step': { const sc = b.items[si]; mut(() => sc.steps.push(makeStep('Then'))); editField(n.id, `blocks.${bi}.items.${si}.steps.${sc.steps.length - 1}.text`); break; }
    case 'del-step': mut(() => b.items[si].steps.splice(ti, 1)); break;
    case 'toggle-alt': mut(() => { const st = b.items[si].steps[ti]; st.alt = !st.alt; }); break;
    case 'add-chk': mut(() => b.items.push({ id: uid('c'), text: '', done: false })); editField(n.id, `blocks.${bi}.items.${b.items.length - 1}.text`); break;
    case 'del-chk': mut(() => b.items.splice(ii, 1)); break;
    case 'toggle-chk': { checkpoint(); const it = b.items[ii]; it.done = !it.done; a.closest('.chk').classList.toggle('done', it.done); changed(); break; }
    case 'add-src': openSourceForm(n.id, bi); break;
    case 'del-src': mut(() => b.items.splice(si, 1)); break;
    case 'pick-img': pickImage(n.id, b.id); break;
  }
});
nodesWrap.addEventListener('dblclick', e => {
  const img = e.target.closest('.b-img img');
  if (img) { openLightbox(img.src, img.alt); return; }
  if (!S.canEdit) return;
  const f = e.target.closest('[data-f]');
  if (f) { startEdit(f, e.clientX, e.clientY); return; }
  const ne = e.target.closest('.node');
  if (ne && !e.target.closest('button, a, input, .grip, .port, .rz')) editField(ne.dataset.id, 'title');
});
nodesWrap.addEventListener('keydown', e => {
  const inp = e.target.closest && e.target.closest('.img-url');
  if (!inp) return;
  e.stopPropagation();
  if (e.key === 'Escape') { inp.blur(); return; }
  if (e.key !== 'Enter') return;
  const u = safeUrl(inp.value);
  if (!u) { inp.style.borderColor = 'var(--err)'; return; }
  const n = nodeById(inp.closest('.node').dataset.id), bi = +inp.closest('.blk').dataset.i;
  checkpoint(); n.blocks[bi].src = u; renderNode(n); changed();
});

/* ===================== images ===================== */
const fileImg = $('#file-img');
let PENDING_IMG = null;
function pickImage(nodeId, blockId) { PENDING_IMG = { nodeId, blockId }; fileImg.value = ''; fileImg.click(); }
fileImg.addEventListener('change', async () => {
  const f = fileImg.files[0], p = PENDING_IMG;
  PENDING_IMG = null;
  if (!f || !p) return;
  const url = await fileToDataUrl(f);
  const n = nodeById(p.nodeId), b = n && n.blocks.find(x => x.id === p.blockId);
  if (!b) return;
  checkpoint(); b.src = url; renderNode(n); changed();
});
async function fileToDataUrl(file) {
  const raw = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
  if (/gif|svg/.test(file.type)) return raw;
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = raw; });
    const s = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    let out = c.toDataURL('image/webp', 0.85);
    if (!out.startsWith('data:image/webp')) out = file.type === 'image/png' ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.86);
    return out.length < raw.length ? out : raw;
  } catch (e) { return raw; }
}
async function addImageFiles(files, at, target) {
  for (const f of files) {
    if (!target && !roomFor(1)) return;
    const url = await fileToDataUrl(f);
    checkpoint();
    if (target) {
      const b = makeBlock('image'); b.src = url;
      target.blocks.push(b);
      renderNode(target); landed(target, target.blocks.length - 1); changed();
    } else {
      const n = addNodeRaw('sub', snapV(at.x - NODE_W.sub / 2), snapV(at.y - 40));
      n.blocks = [Object.assign(makeBlock('image'), { src: url })];
      S.sel = new Set([n.id]);
      structureChanged(); refreshSel(); popIn([n.id]);
      at = { x: at.x + GAP, y: at.y + GAP };
    }
  }
}
window.addEventListener('dragover', e => e.preventDefault());
window.addEventListener('drop', e => e.preventDefault());
vp.addEventListener('dragover', e => {
  if (!S.canEdit || !e.dataTransfer || !Array.from(e.dataTransfer.types).includes('Files')) return;
  e.preventDefault(); e.dataTransfer.dropEffect = 'copy';
  $$('.img-drop.over').forEach(x => x.classList.remove('over'));
  const dz = e.target.closest('.img-drop'); if (dz) dz.classList.add('over');
});
vp.addEventListener('drop', e => {
  if (!S.canEdit) return;
  $$('.img-drop.over').forEach(x => x.classList.remove('over'));
  const files = Array.from(e.dataTransfer.files || []).filter(f => f.type.startsWith('image/'));
  if (!files.length) return;
  e.preventDefault();
  const dz = e.target.closest('.img-drop'), ne = e.target.closest('.node');
  if (dz && ne) {
    const n = nodeById(ne.dataset.id), b = n.blocks[+dz.closest('.blk').dataset.i];
    fileToDataUrl(files[0]).then(url => { checkpoint(); b.src = url; renderNode(n); changed(); });
    return;
  }
  addImageFiles(files, toWorld(e.clientX, e.clientY), ne ? nodeById(ne.dataset.id) : null);
});
document.addEventListener('paste', e => {
  if (!S.canEdit || isTyping() || modalOpen()) return;
  const dt = e.clipboardData;
  if (!dt) return;
  const at = pointerInVp() ? toWorld(PTR.x, PTR.y) : toWorld(VR.left + VR.width / 2, VR.top + VR.height / 2);
  const files = Array.from(dt.files || []).filter(f => f.type.startsWith('image/'));
  if (files.length) { e.preventDefault(); addImageFiles(files, at, S.sel.size === 1 ? selNodes()[0] : null); return; }
  const text = dt.getData('text/plain') || '';
  if (text.startsWith('flogic:')) { e.preventDefault(); try { pasteData(JSON.parse(text.slice(7)), at); } catch (_) {} return; }
  if (CLIP && (!CLIP.sys || !text)) { e.preventDefault(); pasteData(CLIP, at); return; }
  if (!text.trim()) return;
  e.preventDefault();
  if (!roomFor(1)) return;
  endEdit(); checkpoint();
  const url = /^\s*\S+\s*$/.test(text) ? safeUrl(text) : '';
  const isImg = url && /\.(png|jpe?g|gif|webp|svg|avif)(\?.*)?$/i.test(url);
  const n = addNodeRaw(url ? 'sub' : 'note', snapV(at.x - (url ? NODE_W.sub : NODE_W.note) / 2), snapV(at.y - 40));
  if (isImg) n.blocks = [Object.assign(makeBlock('image'), { src: url })];
  else if (url) { n.title = hostOf(url); n.blocks = [Object.assign(makeBlock('sources'), { items: [{ t: '', u: url }] })]; }
  else n.blocks = [Object.assign(makeBlock('text'), { text: text.trim() })];
  S.sel = new Set([n.id]);
  structureChanged(); refreshSel(); popIn([n.id]);
});

/* ===================== pointer gestures ===================== */
vp.addEventListener('mousedown', e => { if (e.button === 1) e.preventDefault(); });
vp.addEventListener('pointerdown', onDown);
window.addEventListener('pointermove', onMove);
window.addEventListener('pointerup', onUp);
window.addEventListener('pointercancel', onUp);

function onDown(e) {
  PTR = { x: e.clientX, y: e.clientY };
  stopViewAnim();
  if (e.pointerType === 'touch') {
    TOUCH.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (TOUCH.size === 2) { cancelGestures(); startPinch(); return; }
    if (TOUCH.size > 2) return;
  }
  const t = e.target;
  if (S.editing && !S.editing.el.contains(t)) endEdit();
  if (S.editing) return;
  if (e.button === 1 || (e.button === 0 && (S.space || S.tool === 'hand'))) { e.preventDefault(); startPan(e); return; }
  if (e.button !== 0) return;
  const ae = document.activeElement;
  if (ae && ae !== document.body && !t.closest('input, .src-form') && ae.blur) ae.blur();
  const ne = t.closest('.node');
  if (S.canEdit && ne) {
    const port = t.closest('.port');
    if (port) { e.preventDefault(); startConnect(e, ne.dataset.id, port.dataset.side); return; }
    const grip = t.closest('.grip');
    if (grip) { e.preventDefault(); startBlockDrag(e, grip.closest('.blk'), ne); return; }
    if (t.closest('.rz')) { e.preventDefault(); startResize(e, ne.dataset.id); return; }
  }
  const gl = t.closest('.glabel');
  if (gl) {
    const g = env().groups.find(x => x.id === gl.dataset.g);
    if (g) { selectNodes(g.members); if (S.canEdit) startDrag(e, g.members[0], false); else startPan(e); }
    return;
  }
  const eg = t.closest('[data-e]');
  if (eg) {
    selectEdge(eg.dataset.e);
    if (S.canEdit) EG = { id: eg.dataset.e, sx: e.clientX, sy: e.clientY };
    return;
  }
  if (ne) {
    const id = ne.dataset.id;
    if (t.closest('button, a, input, textarea, select, [data-act], .src-form')) { if (!S.sel.has(id)) selectNodes(groupOrNode(id)); return; }
    if (!S.canEdit) { selectNodes(groupOrNode(id)); startPan(e); return; }
    if (e.shiftKey) {
      if (S.sel.has(id)) { S.sel.delete(id); refreshSel(); return; }
      S.sel.add(id); S.edgeSel = null; refreshSel();
      startDrag(e, id, false);
      return;
    }
    if (!S.sel.has(id)) { selectNodes(groupOrNode(id)); startDrag(e, id, false); }
    else startDrag(e, id, true);
    return;
  }
  if (!S.canEdit || e.pointerType === 'touch') { if (!e.shiftKey) clearSel(); startPan(e); return; }
  startMarquee(e);
}
function onMove(e) {
  PTR = { x: e.clientX, y: e.clientY };
  if (e.pointerType === 'touch' && TOUCH.has(e.pointerId)) {
    TOUCH.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (PINCH) { movePinch(); return; }
  }
  if (PAN) {
    if (!PAN.moved) { PAN.moved = true; capture(e); document.body.classList.add('panning'); }
    V.x = PAN.vx + e.clientX - PAN.sx; V.y = PAN.vy + e.clientY - PAN.sy; applyView(); return;
  }
  if (DRAG) return moveDrag(e);
  if (MQ) return moveMarquee(e);
  if (CONN) return moveConnect(e);
  if (BD) return moveBlockDrag(e);
  if (RZ) return moveResize(e);
  if (TB) return moveTB(e);
  if (EG) return moveEdgeGrab(e);
}
function onUp(e) {
  if (e.pointerType === 'touch') {
    TOUCH.delete(e.pointerId);
    if (PINCH) { if (TOUCH.size < 2) PINCH = null; return; }
  }
  EG = null;
  if (PAN) { PAN = null; document.body.classList.remove('panning'); }
  if (DRAG) endDrag();
  if (MQ) endMarquee();
  if (CONN) endConnect(e);
  if (BD) endBlockDrag(e);
  if (RZ) endResize();
  if (TB) endTB(e);
}
function cancelGestures() {
  if (DRAG) endDrag();
  PAN = null;
  if (MQ) { $('#marquee').style.display = 'none'; MQ = null; }
  document.body.classList.remove('panning');
}

/* pan */
function startPan(e) { PAN = { sx: e.clientX, sy: e.clientY, vx: V.x, vy: V.y, moved: false }; }

/* pinch (touch) */
function startPinch() {
  const [a, b] = [...TOUCH.values()], c = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  PINCH = { d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, z0: V.z, w: toWorld(c.x, c.y) };
}
function movePinch() {
  const [a, b] = [...TOUCH.values()], c = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  V.z = clamp(PINCH.z0 * Math.hypot(a.x - b.x, a.y - b.y) / PINCH.d0, ZMIN, ZMAX);
  V.x = c.x - VR.left - PINCH.w.x * V.z; V.y = c.y - VR.top - PINCH.w.y * V.z;
  applyView();
}

/* drag nodes */
function startDrag(e, lead, narrow) {
  const ids = [...S.sel].filter(id => { const n = nodeById(id); return n && !n.hidden; });
  if (!ids.length) return;
  DRAG = {
    lead, ids, set: new Set(ids), sx: e.clientX, sy: e.clientY, moved: false, narrow,
    orig: new Map(ids.map(id => { const n = nodeById(id); return [id, { x: n.x, y: n.y }]; })),
    bb: bboxOf(ids.map(nodeById), true),
  };
}
function moveDrag(e) {
  const d = DRAG;
  if (!d.moved) {
    if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 4) return;
    d.moved = true;
    capture(e); checkpoint(); captureDisp(d.ids);
    document.body.classList.add('dragging-nodes');
    d.ids.forEach((id, i) => { const el = NODE_EL.get(id); if (el) { el.classList.add('lifted'); el.style.zIndex = 100000 + i; } });
  }
  let dx = (e.clientX - d.sx) / V.z, dy = (e.clientY - d.sy) / V.z, guides = [];
  if (!(e.ctrlKey || e.metaKey) && CFG.snap !== false) {
    const s = snapRect({ x: d.bb.x + dx, y: d.bb.y + dy, w: d.bb.w, h: d.bb.h }, d.set);
    dx += s.dx; dy += s.dy; guides = s.guides;
  }
  for (const id of d.ids) {
    const n = nodeById(id), o = d.orig.get(id);
    n.x = Math.round(clamp(o.x + dx, -WORLD, WORLD)); n.y = Math.round(clamp(o.y + dy, -WORLD, WORLD));
  }
  drawGuides(guides);
  kick();
}
function endDrag() {
  const d = DRAG;
  DRAG = null;
  if (!d.moved) { if (d.narrow && S.sel.size > 1) selectNodes([d.lead]); return; }
  document.body.classList.remove('dragging-nodes');
  drawGuides([]);
  d.ids.forEach(id => { const el = NODE_EL.get(id); if (el) el.style.filter = ''; });
  syncZ(); changed(); renderInspector(); kick();
}
/* Snap a moving rect to neighbours (edges, centres, preferred gap) or else to the grid. */
function snapRect(r, ex) {
  const thr = 8 / V.z, others = [];
  for (const n of env().nodes) {
    if (ex.has(n.id) || n.hidden) continue;
    const o = rectOf(n, true);
    if (Math.abs(o.x - r.x) < 2600 && Math.abs(o.y - r.y) < 2600) others.push(o);
  }
  const ax = { l: r.x, c: r.x + r.w / 2, r: r.x + r.w }, ay = { t: r.y, c: r.y + r.h / 2, b: r.y + r.h };
  let bx = null, by = null;
  for (const o of others) {
    const vOverlap = r.y < o.y + o.h + 200 && r.y + r.h > o.y - 200, hOverlap = r.x < o.x + o.w + 200 && r.x + r.w > o.x - 200;
    const tx = [['l', o.x], ['c', o.x + o.w / 2], ['r', o.x + o.w]];
    if (vOverlap) tx.push(['l', o.x + o.w + GAP, 1], ['r', o.x - GAP, 1]);
    for (const [k, v, gap] of tx) { const dd = v - ax[k]; if (Math.abs(dd) < thr && (!bx || Math.abs(dd) < Math.abs(bx.d) - 0.01)) bx = { d: dd, v, o, gap }; }
    const ty = [['t', o.y], ['c', o.y + o.h / 2], ['b', o.y + o.h]];
    if (hOverlap) ty.push(['t', o.y + o.h + GAP, 1], ['b', o.y - GAP, 1]);
    for (const [k, v, gap] of ty) { const dd = v - ay[k]; if (Math.abs(dd) < thr && (!by || Math.abs(dd) < Math.abs(by.d) - 0.01)) by = { d: dd, v, o, gap }; }
  }
  const dx = bx ? bx.d : snapV(r.x) - r.x, dy = by ? by.d : snapV(r.y) - r.y;
  const R = { x: r.x + dx, y: r.y + dy, w: r.w, h: r.h }, gs = [];
  if (bx) {
    const o = bx.o;
    if (bx.gap) {
      const y = (Math.max(R.y, o.y) + Math.min(R.y + R.h, o.y + o.h)) / 2;
      const yy = Math.min(R.y + R.h, o.y + o.h) > Math.max(R.y, o.y) ? y : R.y + Math.min(R.h, 60) / 2;
      gs.push(R.x > o.x ? { x1: o.x + o.w, x2: R.x, y1: yy, y2: yy, gap: 1 } : { x1: R.x + R.w, x2: o.x, y1: yy, y2: yy, gap: 1 });
    } else gs.push({ x1: bx.v, x2: bx.v, y1: Math.min(R.y, o.y) - 16, y2: Math.max(R.y + R.h, o.y + o.h) + 16 });
  }
  if (by) {
    const o = by.o;
    if (by.gap) {
      const x = (Math.max(R.x, o.x) + Math.min(R.x + R.w, o.x + o.w)) / 2;
      const xx = Math.min(R.x + R.w, o.x + o.w) > Math.max(R.x, o.x) ? x : R.x + R.w / 2;
      gs.push(R.y > o.y ? { y1: o.y + o.h, y2: R.y, x1: xx, x2: xx, gap: 1 } : { y1: R.y + R.h, y2: o.y, x1: xx, x2: xx, gap: 1 });
    } else gs.push({ y1: by.v, y2: by.v, x1: Math.min(R.x, o.x) - 16, x2: Math.max(R.x + R.w, o.x + o.w) + 16 });
  }
  return { dx, dy, guides: gs };
}

/* marquee */
function startMarquee(e) {
  MQ = { sx: e.clientX, sy: e.clientY, base: e.shiftKey ? new Set(S.sel) : new Set(), moved: false };
  if (!e.shiftKey) clearSel();
}
function moveMarquee(e) {
  if (!MQ.moved) { if (Math.hypot(e.clientX - MQ.sx, e.clientY - MQ.sy) < 4) return; MQ.moved = true; capture(e); }
  const x1 = Math.min(MQ.sx, e.clientX), y1 = Math.min(MQ.sy, e.clientY), x2 = Math.max(MQ.sx, e.clientX), y2 = Math.max(MQ.sy, e.clientY);
  const m = $('#marquee');
  Object.assign(m.style, { display: 'block', left: x1 - VR.left + 'px', top: y1 - VR.top + 'px', width: x2 - x1 + 'px', height: y2 - y1 + 'px' });
  const a = toWorld(x1, y1), b = toWorld(x2, y2);
  S.sel = new Set(MQ.base); S.edgeSel = null;
  for (const n of env().nodes) { if (n.hidden) continue; const r = rectOf(n, true); if (r.x < b.x && r.x + r.w > a.x && r.y < b.y && r.y + r.h > a.y) S.sel.add(n.id); }
  refreshSel(true);
}
function endMarquee() { $('#marquee').style.display = 'none'; const m = MQ; MQ = null; if (m.moved) refreshSel(); }

/* connect */
function startConnect(e, id, side) {
  CONN = { from: id, side, target: null, key: '' };
  capture(e);
  document.body.classList.add('connecting');
  if (!S.sel.has(id)) selectNodes([id]);
  moveConnect(e);
}
/* Grab an existing connection and pull: the end nearer the cursor comes loose and follows it.
   Drop it on a node to reconnect, or anywhere else to remove the connection. */
function moveEdgeGrab(e) {
  if (Math.hypot(e.clientX - EG.sx, e.clientY - EG.sy) < 6) return;
  const ed = env().edges.find(x => x.id === EG.id);
  EG = null;
  if (!ed) return;
  const a = nodeById(ed.from), b = nodeById(ed.to);
  if (!a || !b) return;
  const w = toWorld(e.clientX, e.clientY), pa = portPos(a, ed.fs), pb = portPos(b, ed.ts);
  const loseFrom = Math.hypot(pa.x - w.x, pa.y - w.y) < Math.hypot(pb.x - w.x, pb.y - w.y);
  checkpoint();
  env().edges = env().edges.filter(x => x !== ed);
  S.edgeSel = null;
  CONN = {
    from: loseFrom ? ed.to : ed.from, side: loseFrom ? ed.ts : ed.fs, target: null, key: '',
    detached: { reverse: loseFrom, label: ed.label, arrow: ed.arrow, dashed: ed.dashed },
  };
  capture(e);
  document.body.classList.add('connecting');
  drawEdges(); renderInspector();
  moveConnect(e);
}
function clearConnHL() { $$('.port.magnet').forEach(p => p.classList.remove('magnet')); $$('.node.conn-target').forEach(x => x.classList.remove('conn-target')); }
function moveConnect(e) {
  const w = toWorld(e.clientX, e.clientY), src = nodeById(CONN.from);
  if (!src) return;
  const p0 = portPos(src, CONN.side);
  let best = null, bd = 48 / V.z;
  for (const n of env().nodes) {
    if (n.id === CONN.from || n.hidden) continue;
    for (const s of SIDES) { const p = portPos(n, s), d = Math.hypot(p.x - w.x, p.y - w.y); if (d < bd) { bd = d; best = { id: n.id, side: s, p }; } }
  }
  if (!best) {
    const hit = document.elementFromPoint(e.clientX, e.clientY), ne = hit && hit.closest && hit.closest('.node');
    if (ne && ne.dataset.id !== CONN.from) {
      const n = nodeById(ne.dataset.id);
      let dd = Infinity;
      for (const s of SIDES) { const p = portPos(n, s), d = Math.hypot(p.x - w.x, p.y - w.y); if (d < dd) { dd = d; best = { id: n.id, side: s, p }; } }
    }
  }
  const key = best ? best.id + best.side : '';
  if (CONN.key !== key) {
    clearConnHL();
    if (best) { const el = NODE_EL.get(best.id); el.classList.add('conn-target'); const p = el.querySelector('.p-' + best.side); if (p) p.classList.add('magnet'); }
    CONN.key = key;
  }
  CONN.target = best;
  connPreview.setAttribute('d', bez(p0, CONN.side, best ? best.p : w, best ? best.side : facingSide(p0, w)).d);
}
function endConnect(e) {
  const c = CONN;
  CONN = null;
  document.body.classList.remove('connecting');
  clearConnHL();
  const d = c.detached;
  if (c.target) {
    connPreview.setAttribute('d', '');
    if (!d) checkpoint();
    const ok = d && d.reverse ? addEdge(c.target.id, c.target.side, c.from, c.side) : addEdge(c.from, c.side, c.target.id, c.target.side);
    if (ok && d) { const es = env().edges; Object.assign(es[es.length - 1], { label: d.label, arrow: d.arrow, dashed: d.dashed }); }
    if (ok || d) { drawEdges(); renderInspector(); changed(); }
    if (!ok && d) toast('Connection removed', { actions: [{ label: 'Undo', fn: undo }] });
    return;
  }
  if (d) {
    connPreview.setAttribute('d', '');
    drawEdges(); renderInspector(); changed();
    toast('Connection removed', { actions: [{ label: 'Undo', fn: undo }] });
    return;
  }
  const src = nodeById(c.from), hit = document.elementFromPoint(e.clientX, e.clientY);
  const w = toWorld(e.clientX, e.clientY), p0 = src && portPos(src, c.side);
  if (!src || !hit || !vp.contains(hit) || Math.hypot(w.x - p0.x, w.y - p0.y) * V.z < 30) { connPreview.setAttribute('d', ''); return; }
  openMenu(e.clientX, e.clientY, [
    { head: 'Connect to a new…' },
    { label: 'Note', icon: 'note', kbd: 'N', fn: () => createConnected('note', c, w) },
    { label: 'Sub-note', icon: 'sub', kbd: 'S', fn: () => createConnected('sub', c, w) },
    { label: 'Title node', icon: 'title', kbd: 'T', fn: () => createConnected('title', c, w) },
  ], { onClose: () => connPreview.setAttribute('d', ''), keys: { n: 1, s: 2, t: 3 } });
}
function createConnected(type, c, w) {
  if (!roomFor(1)) return;
  endEdit(); checkpoint();
  const src = nodeById(c.from), p0 = portPos(src, c.side), side = facingSide(p0, w);
  const W = NODE_W[type], Hh = type === 'sub' ? 84 : type === 'title' ? 130 : 120;
  let x, y;
  if (side === 'l') { x = w.x; y = w.y - Hh / 2; }
  else if (side === 'r') { x = w.x - W; y = w.y - Hh / 2; }
  else if (side === 't') { x = w.x - W / 2; y = w.y; }
  else { x = w.x - W / 2; y = w.y - Hh; }
  const n = addNodeRaw(type, snapV(x), snapV(y));
  if (src.color !== 'default') n.color = src.color;
  addEdge(c.from, c.side, n.id, side);
  S.sel = new Set([n.id]); S.edgeSel = null;
  structureChanged(); refreshSel(); popIn([n.id]);
  editField(n.id, 'title');
}

/* drag a block (within a node, into another node, or out onto the board) */
let DROPLINE = null;
function startBlockDrag(e, blkEl, ne) {
  const n = nodeById(ne.dataset.id), bi = +blkEl.dataset.i;
  BD = { n, bi, b: n.blocks[bi], el: blkEl, node: ne, sx: e.clientX, sy: e.clientY, lx: e.clientX, vx: 0, moved: false, target: null };
}
function clearDropHL() { $$('.node.drop-target').forEach(x => x.classList.remove('drop-target')); if (DROPLINE) { DROPLINE.remove(); DROPLINE = null; } }
function moveBlockDrag(e) {
  const d = BD;
  if (!d.moved) {
    if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 4) return;
    d.moved = true;
    capture(e); endEdit();
    const r = d.el.getBoundingClientRect();
    d.offx = d.sx - r.left; d.offy = d.sy - r.top;
    const g = d.el.cloneNode(true);
    g.className = 'blk blk-ghost k-' + d.b.kind;
    g.style.width = d.el.offsetWidth + 24 + 'px';
    g.style.setProperty('--c', getComputedStyle(d.node).getPropertyValue('--c'));
    document.body.appendChild(g);
    d.ghost = g;
    d.el.classList.add('drag-src');
    document.body.classList.add('dragging-block');
  }
  d.vx = d.vx * 0.7 + (e.clientX - d.lx) * 0.3; d.lx = e.clientX;
  d.ghost.style.transform = `translate(${e.clientX - d.offx - 12 * V.z}px,${e.clientY - d.offy - 10 * V.z}px) scale(${V.z}) rotate(${clamp(d.vx * 0.5, -6, 6).toFixed(2)}deg)`;
  const hit = document.elementFromPoint(e.clientX, e.clientY), tn = hit && hit.closest && hit.closest('.node');
  clearDropHL();
  if (tn) {
    const blocks = $$(':scope > .blocks > .blk', tn), cont = tn.querySelector('.blocks');
    let idx = blocks.length;
    for (let i = 0; i < blocks.length; i++) { const r = blocks[i].getBoundingClientRect(); if (e.clientY < r.top + r.height / 2) { idx = i; break; } }
    d.target = { n: nodeById(tn.dataset.id), idx };
    tn.classList.add('drop-target');
    const cr = cont.getBoundingClientRect(), gap = parseFloat(getComputedStyle(cont).rowGap) || 12;
    let y;
    if (!blocks.length) y = 0;
    else if (idx < blocks.length) y = (blocks[idx].getBoundingClientRect().top - cr.top) / V.z - gap / 2;
    else y = (blocks[blocks.length - 1].getBoundingClientRect().bottom - cr.top) / V.z + gap / 2;
    DROPLINE = document.createElement('div');
    DROPLINE.className = 'dropline';
    DROPLINE.style.top = y + 'px';
    cont.appendChild(DROPLINE);
    d.ghost.classList.remove('to-canvas');
  } else if (hit && vp.contains(hit)) {
    d.target = { canvas: true };
    d.ghost.classList.add('to-canvas');
  } else {
    d.target = null;
    d.ghost.classList.remove('to-canvas');
  }
}
function endBlockDrag(e) {
  const d = BD;
  BD = null;
  if (!d.moved) return;
  clearDropHL();
  d.ghost.remove();
  d.el.classList.remove('drag-src');
  document.body.classList.remove('dragging-block');
  if (!d.target) return;
  if (d.target.canvas) {
    if (!roomFor(1)) return;
    checkpoint();
    d.n.blocks.splice(d.bi, 1);
    const w = toWorld(e.clientX, e.clientY);
    const s = addNodeRaw('sub', snapV(w.x - d.offx / V.z), snapV(w.y - d.offy / V.z - 30));
    s.blocks = [d.b]; s.color = d.n.color;
    renderNode(d.n);
    S.sel = new Set([s.id]);
    structureChanged(); refreshSel(); popIn([s.id]);
    return;
  }
  const tn = d.target.n;
  let to = d.target.idx;
  if (tn === d.n) { if (to === d.bi || to === d.bi + 1) return; if (to > d.bi) to--; }
  checkpoint();
  d.n.blocks.splice(d.bi, 1);
  tn.blocks.splice(to, 0, d.b);
  renderNode(d.n);
  if (tn !== d.n) renderNode(tn);
  landed(tn, to);
  renderLayers(); changed();
}

/* resize width */
function startResize(e, id) { RZ = { id, sx: e.clientX, w0: nodeById(id).w, moved: false }; }
function moveResize(e) {
  const n = nodeById(RZ.id);
  if (!n) return;
  if (!RZ.moved) { RZ.moved = true; capture(e); checkpoint(); document.body.style.cursor = 'ew-resize'; }
  let w = RZ.w0 + (e.clientX - RZ.sx) / V.z;
  if (!(e.ctrlKey || e.metaKey)) w = snapV(w);
  n.w = clamp(Math.round(w), 168, 1200);
  NODE_EL.get(n.id).style.width = n.w + 'px';
}
function endResize() { const r = RZ; RZ = null; document.body.style.cursor = ''; if (r.moved) { changed(); renderInspector(); } }

/* toolbar: click to add at centre, or drag a node type onto the board */
$('#toolbar').addEventListener('pointerdown', e => {
  const b = e.target.closest('[data-new]');
  if (!b || !S.canEdit || e.button !== 0) return;
  TB = { type: b.dataset.new, sx: e.clientX, sy: e.clientY, moved: false, ghost: null };
});
function moveTB(e) {
  if (!TB.moved) {
    if (Math.hypot(e.clientX - TB.sx, e.clientY - TB.sy) < 6) return;
    TB.moved = true;
    const g = document.createElement('div');
    g.className = 'tb-ghost';
    g.textContent = NODE_LABEL[TB.type];
    g.style.width = NODE_W[TB.type] + 'px';
    g.style.height = (TB.type === 'sub' ? 84 : TB.type === 'title' ? 130 : 120) + 'px';
    document.body.appendChild(g);
    TB.ghost = g;
  }
  TB.ghost.style.transform = `translate(${e.clientX - NODE_W[TB.type] * V.z / 2}px,${e.clientY - 28 * V.z}px) scale(${V.z})`;
}
function endTB(e) {
  const t = TB;
  TB = null;
  if (!t.moved) { createAt(t.type, 'center'); return; }
  t.ghost.remove();
  const hit = document.elementFromPoint(e.clientX, e.clientY);
  if (hit && vp.contains(hit)) { const w = toWorld(e.clientX, e.clientY); createNode(t.type, w.x, w.y, { free: e.ctrlKey || e.metaKey }); }
}

/* ===================== zoom & view ===================== */
let ZA = null, VA = 0;
vp.addEventListener('wheel', e => {
  e.preventDefault();
  stopViewAnim();
  let dx = e.deltaX, dy = e.deltaY;
  if (e.deltaMode === 1) { dx *= 16; dy *= 16; } else if (e.deltaMode === 2) { dx *= VR.height; dy *= VR.height; }
  const sx = e.clientX - VR.left, sy = e.clientY - VR.top;
  if (e.ctrlKey || e.metaKey) { smoothZoom(sx, sy, Math.exp(-dy * (Math.abs(dy) >= 50 ? 0.0018 : 0.012))); return; }
  const trackpad = Math.abs(dx) > 0.5 || (Math.abs(dy) < 40 && !Number.isInteger(dy));
  if (CFG.wheel !== 'pan' && !trackpad && !e.shiftKey) { smoothZoom(sx, sy, Math.exp(-dy * 0.0018)); return; }
  if (e.shiftKey && !dx) { dx = dy; dy = 0; }
  V.x -= dx; V.y -= dy; applyView();
}, { passive: false });
function zoomAt(sx, sy, nz) {
  nz = clamp(nz, ZMIN, ZMAX);
  V.x = sx - (sx - V.x) * nz / V.z; V.y = sy - (sy - V.y) * nz / V.z; V.z = nz;
  applyView();
}
function smoothZoom(sx, sy, f) {
  const tz = clamp((ZA ? ZA.tz : V.z) * f, ZMIN, ZMAX);
  if (!ZA) ZA = { raf: 0 };
  Object.assign(ZA, { tz, sx, sy });
  if (!ZA.raf) ZA.raf = requestAnimationFrame(zaStep);
}
function zaStep() {
  if (!ZA) return;
  ZA.raf = 0;
  const nz = V.z + (ZA.tz - V.z) * 0.3, done = Math.abs(ZA.tz - nz) / ZA.tz < 0.002;
  zoomAt(ZA.sx, ZA.sy, done ? ZA.tz : nz);
  if (done) ZA = null; else ZA.raf = requestAnimationFrame(zaStep);
}
function stopViewAnim() {
  if (VA) { cancelAnimationFrame(VA); VA = 0; }
}
function animateView(tx, ty, tz, ms = 380) {
  stopViewAnim();
  if (ZA) { cancelAnimationFrame(ZA.raf); ZA = null; }
  const fx = V.x, fy = V.y, fz = V.z, t0 = performance.now();
  const step = now => {
    const t = Math.min(1, (now - t0) / ms), k = 1 - Math.pow(1 - t, 3);
    V.z = fz * Math.pow(tz / fz, k); V.x = fx + (tx - fx) * k; V.y = fy + (ty - fy) * k;
    applyView();
    VA = t < 1 ? requestAnimationFrame(step) : 0;
  };
  VA = requestAnimationFrame(step);
}
function fitRect(bb, o = {}) {
  const pad = o.pad || 90;
  const tz = clamp(Math.min((VR.width - pad * 2) / Math.max(bb.w, 1), (VR.height - pad * 2) / Math.max(bb.h, 1)), ZMIN, o.max || 1);
  const tx = VR.width / 2 - (bb.x + bb.w / 2) * tz, ty = VR.height / 2 - (bb.y + bb.h / 2) * tz;
  if (o.instant) { V.x = tx; V.y = ty; V.z = tz; applyView(); } else animateView(tx, ty, tz);
}
function fitAll(instant) {
  const ns = env().nodes.filter(n => !n.hidden);
  if (!ns.length) { if (instant) { V.x = VR.width / 2; V.y = VR.height / 2; V.z = 1; applyView(); } else animateView(VR.width / 2, VR.height / 2, 1); return; }
  fitRect(bboxOf(ns, true), { instant });
}
function zoomToNodes(ids) { const ns = ids.map(nodeById).filter(Boolean); if (ns.length) fitRect(bboxOf(ns, true), { max: 1.15, pad: 120 }); }
function zoomBy(f) {
  const cx = VR.width / 2, cy = VR.height / 2, tz = clamp(V.z * f, ZMIN, ZMAX);
  animateView(cx - (cx - V.x) * tz / V.z, cy - (cy - V.y) * tz / V.z, tz, 220);
}
function panToNodes(ids) {
  const ns = ids.map(nodeById).filter(Boolean);
  if (!ns.length) return;
  const bb = bboxOf(ns, true), a = toWorld(VR.left + 40, VR.top + 40), b = toWorld(VR.left + VR.width - 40, VR.top + VR.height - 40);
  if (bb.x >= a.x && bb.y >= a.y && bb.x + bb.w <= b.x && bb.y + bb.h <= b.y) return;
  if (bb.w * V.z > VR.width - 80 || bb.h * V.z > VR.height - 80) return zoomToNodes(ids);
  animateView(VR.width / 2 - (bb.x + bb.w / 2) * V.z, VR.height / 2 - (bb.y + bb.h / 2) * V.z, V.z);
}

/* minimap navigation */
(() => {
  const c = $('#minimap');
  let down = false;
  const go = (e, anim) => {
    if (!MM) return;
    const r = c.getBoundingClientRect(), wx = (e.clientX - r.left - MM.ox) / MM.s, wy = (e.clientY - r.top - MM.oy) / MM.s;
    const tx = VR.width / 2 - wx * V.z, ty = VR.height / 2 - wy * V.z;
    if (anim) animateView(tx, ty, V.z, 260); else { stopViewAnim(); V.x = tx; V.y = ty; applyView(); }
  };
  c.addEventListener('pointerdown', e => { down = true; c.setPointerCapture(e.pointerId); go(e, true); });
  c.addEventListener('pointermove', e => { if (down) go(e, false); });
  c.addEventListener('pointerup', () => { down = false; });
})();

/* ===================== context menus ===================== */
vp.addEventListener('contextmenu', e => {
  e.preventDefault();
  if (DRAG || CONN || BD || (PAN && PAN.moved)) return;
  const t = e.target, x = e.clientX, y = e.clientY, w = toWorld(x, y);
  if (!S.canEdit) {
    openMenu(x, y, [{ label: 'Fit to screen', icon: 'fit', kbd: '⇧1', fn: () => fitAll() }, { label: 'Copy link', icon: 'link', fn: share }]);
    return;
  }
  endEdit();
  const eg = t.closest('[data-e]');
  if (eg) { selectEdge(eg.dataset.e); openMenu(x, y, edgeMenu(eg.dataset.e)); return; }
  const gl = t.closest('.glabel');
  if (gl) {
    const g = env().groups.find(q => q.id === gl.dataset.g);
    if (!g) return;
    selectNodes(g.members);
    openMenu(x, y, [{ label: 'Rename group', icon: 'edit', fn: () => renameGroup(g.id) }, { label: 'Tidy up', icon: 'tidy', fn: tidySel }, { label: 'Ungroup', icon: 'group', kbd: MOD + '⇧G', fn: ungroupSel }, '-', { label: 'Delete group and nodes', icon: 'trash', danger: true, fn: deleteSel }]);
    return;
  }
  const ne = t.closest('.node');
  if (ne) {
    const id = ne.dataset.id, n = nodeById(id), blk = t.closest('.blk');
    if (!S.sel.has(id)) selectNodes(groupOrNode(id));
    if (blk && S.sel.size <= 1) { openMenu(x, y, blockMenu(n, +blk.dataset.i, x, y)); return; }
    openMenu(x, y, nodeMenu(x, y));
    return;
  }
  clearSel();
  openMenu(x, y, [
    { head: 'Add here' },
    { label: 'Title node', icon: 'title', kbd: 'T', fn: () => createNode('title', w.x, w.y) },
    { label: 'Note', icon: 'note', kbd: 'N', fn: () => createNode('note', w.x, w.y) },
    { label: 'Sub-note', icon: 'sub', kbd: 'S', fn: () => createNode('sub', w.x, w.y) },
    '-',
    { label: 'Paste', icon: 'copy', kbd: MOD + 'V', disabled: !CLIP, fn: () => pasteData(CLIP, w) },
    { label: 'Select all', icon: 'cursor', kbd: MOD + 'A', disabled: !env().nodes.length, fn: () => selectNodes(env().nodes.filter(n => !n.hidden).map(n => n.id)) },
    { label: 'Tidy up everything', icon: 'tidy', disabled: env().nodes.length < 2, fn: () => { S.sel.clear(); tidySel(); } },
    { label: 'Fit to screen', icon: 'fit', kbd: '⇧1', fn: () => fitAll() },
  ], { keys: { t: 2, n: 3, s: 4 } });
});
function nodeMenu(x, y) {
  const ns = selNodes(), multi = ns.length > 1, n = ns[0];
  const inGroup = ns.some(m => groupOf(m.id));
  const cur = ns.every(m => m.type === n.type) ? n.type : null;
  return [
    !multi && { label: 'Add block…', icon: 'plus', fn: () => openBlockMenu({ x, y }, n) },
    !multi && { label: 'Edit title', icon: 'edit', kbd: '↵', fn: () => editField(n.id, 'title', true) },
    { label: 'Duplicate', icon: 'copy', kbd: MOD + 'D', fn: duplicateSel },
    { label: 'Copy', icon: 'copy', kbd: MOD + 'C', fn: () => copySel() },
    '-',
    { head: 'Turn into' },
    ...['title', 'note', 'sub'].map(t => ({ label: NODE_LABEL[t], icon: t, check: cur === t, fn: () => setType(t) })),
    { head: 'Colour' },
    { swatches: true, value: multi ? null : n.color, fn: setColor },
    '-',
    multi && { label: 'Group', icon: 'group', kbd: MOD + 'G', fn: groupSel },
    inGroup && { label: 'Ungroup', icon: 'group', kbd: MOD + '⇧G', fn: ungroupSel },
    multi && { label: 'Tidy up', icon: 'tidy', fn: tidySel },
    { label: 'Hide', icon: 'eyeoff', kbd: MOD + '⇧H', fn: () => toggleHidden(ns.map(m => m.id)) },
    { label: 'Bring to front', icon: 'front', fn: () => reorder(true) },
    { label: 'Send to back', icon: 'back', fn: () => reorder(false) },
    '-',
    { label: multi ? `Delete ${ns.length} nodes` : 'Delete', icon: 'trash', kbd: 'Del', danger: true, fn: deleteSel },
  ];
}
function blockMenu(n, i, x, y) {
  return [
    { head: BLOCKS.find(b => b[0] === n.blocks[i].kind)[1] + ' block' },
    { label: 'Insert block above…', icon: 'plus', fn: () => openBlockMenu({ x, y }, n, i) },
    { label: 'Duplicate block', icon: 'copy', fn: () => duplicateBlock(n, i) },
    { label: 'Move up', icon: 'chev', disabled: i === 0, fn: () => moveBlock(n, i, i - 1) },
    { label: 'Move down', icon: 'chev', disabled: i === n.blocks.length - 1, fn: () => moveBlock(n, i, i + 1) },
    { label: 'Pull out into a sub-note', icon: 'sub', fn: () => extractBlock(n, i) },
    '-',
    { label: 'Node options…', icon: 'note', fn: () => openMenu(x, y, nodeMenu(x, y)) },
    { label: 'Delete block', icon: 'trash', danger: true, fn: () => { endEdit(); checkpoint(); n.blocks.splice(i, 1); renderNode(n); changed(); } },
  ];
}
function edgeMenu(id) {
  const ed = env().edges.find(x => x.id === id);
  return [
    { label: 'Arrow', icon: 'arrowr', check: ed.arrow, fn: () => edgeSet(id, { arrow: !ed.arrow }) },
    { label: 'Dashed', icon: 'dash', check: ed.dashed, fn: () => edgeSet(id, { dashed: !ed.dashed }) },
    { label: ed.label ? 'Edit label' : 'Add label', icon: 'edit', fn: () => editEdgeLabel(id) },
    { label: 'Reverse direction', icon: 'swap', fn: () => reverseEdge(id) },
    '-',
    { label: 'Delete connection', icon: 'trash', kbd: 'Del', danger: true, fn: () => { S.edgeSel = id; deleteSel(); } },
  ];
}
function openBlockMenu(anchor, n, idx) {
  const r = anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : { right: anchor.x, top: anchor.y };
  const html = `<div class="bm-grid">${BLOCKS.map(([k, name, desc]) => `<button class="bm" data-k="${k}"><span class="bm-ic">${ic(k, 17)}</span><span><b>${name}</b><small>${desc}</small></span></button>`).join('')}</div>`;
  openMenu(r.right + 8, r.top - 6, [{ html }], {
    cls: 'bmenu',
    onClick: e => { const b = e.target.closest('[data-k]'); if (b) { closeMenu(); addBlock(n, b.dataset.k, idx); } return false; },
  });
}
/* menus: optional onClose + single-letter shortcuts */
const _closeMenu = closeMenu;
closeMenu = function () { const m = MENU; _closeMenu(); if (m && m._opt && m._opt.onClose) m._opt.onClose(); };
const _openMenu = openMenu;
openMenu = function (x, y, items, opt = {}) { const m = _openMenu(x, y, items, opt); m._opt = opt; return m; };
document.addEventListener('contextmenu', e => { if (!e.target.closest('input, textarea, [contenteditable], a, .modal')) e.preventDefault(); });

/* ===================== keyboard ===================== */
window.addEventListener('keydown', e => {
  if (MENU) {
    const k = MENU._opt && MENU._opt.keys && MENU._opt.keys[e.key.toLowerCase()];
    if (k != null && !isTyping()) { e.preventDefault(); const b = MENU.querySelector(`[data-i="${k}"]`); if (b) b.click(); return; }
    if (menuKey(e)) return;
  }
  if (e.key === ' ' && !isTyping() && !modalOpen()) {
    e.preventDefault();
    if (!S.space) { S.space = true; document.body.classList.add('space'); }
    return;
  }
  if (isTyping() || modalOpen()) return;
  const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
  if (mod && k === 's') { e.preventDefault(); publish(); return; }
  if (mod && (k === '=' || k === '+')) { e.preventDefault(); zoomBy(1.25); return; }
  if (mod && k === '-') { e.preventDefault(); zoomBy(0.8); return; }
  if (mod && k === '0') { e.preventDefault(); zoomBy(1 / V.z); return; }
  if (e.shiftKey && e.code === 'Digit1') { e.preventDefault(); fitAll(); return; }
  if (e.shiftKey && e.code === 'Digit2') { e.preventDefault(); if (S.sel.size) zoomToNodes([...S.sel]); return; }
  if (e.key === 'Escape') { clearSel(); closePanels(); return; }
  if (e.key === '?') { openHelp(); return; }
  if (!S.canEdit) {
    if (e.key.startsWith('Arrow')) { e.preventDefault(); const st = e.shiftKey ? 240 : 60; V.x -= (k === 'arrowright' ? st : k === 'arrowleft' ? -st : 0); V.y -= (k === 'arrowdown' ? st : k === 'arrowup' ? -st : 0); applyView(); }
    if (k === 'h' || k === 'v') setTool(k === 'h' ? 'hand' : 'select');
    return;
  }
  if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (mod && k === 'y') { e.preventDefault(); redo(); return; }
  if (mod && k === 'a') { e.preventDefault(); selectNodes(env().nodes.filter(n => !n.hidden).map(n => n.id)); return; }
  if (mod && k === 'c') { copySel(); return; }
  if (mod && k === 'x') { copySel(true); deleteSel(); return; }
  if (mod && k === 'd') { e.preventDefault(); duplicateSel(); return; }
  if (mod && e.shiftKey && k === 'h') { e.preventDefault(); toggleHidden([...S.sel]); return; }
  if (mod && k === 'g') { e.preventDefault(); e.shiftKey ? ungroupSel() : groupSel(); return; }
  if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSel(); return; }
  if (e.key.startsWith('Arrow')) {
    e.preventDefault();
    const st = mod ? 1 : e.shiftKey ? GRID * 4 : GRID;
    nudge(k === 'arrowright' ? st : k === 'arrowleft' ? -st : 0, k === 'arrowdown' ? st : k === 'arrowup' ? -st : 0);
    return;
  }
  if (e.key === 'Enter' && S.sel.size === 1) { e.preventDefault(); editField([...S.sel][0], 'title', true); return; }
  if (mod || e.altKey) return;
  if (k === 'v') setTool('select');
  else if (k === 'h') setTool('hand');
  else if (k === 't') createAt('title', 'pointer');
  else if (k === 'n') createAt('note', 'pointer');
  else if (k === 's') createAt('sub', 'pointer');
});
window.addEventListener('keyup', e => { if (e.key === ' ') { S.space = false; document.body.classList.remove('space'); } });
window.addEventListener('blur', () => { S.space = false; document.body.classList.remove('space'); });

/* ===================== panels & chrome ===================== */
function setTool(t) {
  S.tool = t;
  $$('[data-tool]').forEach(b => b.classList.toggle('on', b.dataset.tool === t));
  document.body.classList.toggle('tool-hand', t === 'hand');
}
function closePanels() { document.body.classList.remove('show-left', 'show-right'); }
$('#toolbar').addEventListener('click', e => {
  const tool = e.target.closest('[data-tool]');
  if (tool) { setTool(tool.dataset.tool); return; }
  const nb = e.target.closest('[data-new]');
  if (nb && e.detail === 0) createAt(nb.dataset.new, 'center');
});
document.addEventListener('click', e => {
  const b = e.target.closest('[data-cmd]');
  if (!b) return;
  switch (b.dataset.cmd) {
    case 'undo': undo(); break;
    case 'redo': redo(); break;
    case 'zoomin': zoomBy(1.25); break;
    case 'zoomout': zoomBy(0.8); break;
    case 'zoom100': zoomBy(1 / V.z); break;
    case 'fit': fitAll(); break;
    case 'theme': cycleTheme(); break;
    case 'help': openHelp(); break;
    case 'settings': case 'signin': openSettings(); break;
    case 'publish': publish(); break;
    case 'share': share(); break;
    case 'preview': goPreview(true); break;
    case 'exit-preview': goPreview(false); break;
    case 'show-left': document.body.classList.add('show-left'); break;
    case 'show-right': document.body.classList.add('show-right'); break;
    case 'close-panels': closePanels(); break;
  }
});

/* environments */
function switchEnv(id) {
  endEdit();
  if (!DOC.envs.some(e => e.id === id)) id = DOC.envs[0].id;
  S.envId = id; UI.envId = id; saveUI();
  try { history.replaceState(null, '', location.pathname + location.search + '#e=' + id); } catch (_) {}
  for (const [, el] of NODE_EL) { RO.unobserve(el); el.remove(); }
  NODE_EL.clear(); SIZE.clear(); DISP.clear();
  for (const [, r] of EDGE_EL) { r.g.remove(); r.lab.remove(); }
  EDGE_EL.clear();
  for (const [, el] of GROUP_EL) el.remove();
  GROUP_EL.clear();
  S.sel.clear(); S.edgeSel = null;
  $('#layer-filter').value = '';
  renderAll();
  const v = UI.views[id];
  if (v && isFinite(v.cx) && isFinite(v.z)) { V.z = clamp(v.z, ZMIN, ZMAX); V.x = VR.width / 2 - v.cx * V.z; V.y = VR.height / 2 - v.cy * V.z; applyView(); }
  else { fitAll(true); requestAnimationFrame(() => requestAnimationFrame(() => fitAll(true))); }
  popIn(env().nodes.map(n => n.id), true);
}
function addEnv() {
  checkpoint();
  let k = DOC.envs.length + 1;
  while (DOC.envs.some(e => e.name === 'Environment ' + k)) k++;
  const e = makeEnv('Environment ' + k);
  DOC.envs.push(e);
  changed();
  switchEnv(e.id);
  renameEnvInline(e.id);
}
function renameEnvInline(id) {
  const e = DOC.envs.find(x => x.id === id), row = $(`.env[data-env="${id}"]`);
  if (!e || !row || !S.canEdit) return;
  const span = row.querySelector('.nm'), inp = document.createElement('input');
  inp.className = 'rename'; inp.value = e.name; inp.setAttribute('aria-label', 'Environment name');
  span.replaceWith(inp);
  inp.focus(); inp.select();
  let done = false;
  const finish = save => {
    if (done) return;
    done = true;
    const v = inp.value.trim();
    if (save && v && v !== e.name) { checkpoint(); e.name = v; changed(); }
    renderEnvs();
  };
  inp.addEventListener('keydown', ev => { ev.stopPropagation(); if (ev.key === 'Enter') finish(true); if (ev.key === 'Escape') finish(false); });
  inp.addEventListener('blur', () => finish(true));
  inp.addEventListener('pointerdown', ev => ev.stopPropagation());
}
function duplicateEnv(id) {
  const src = DOC.envs.find(x => x.id === id);
  if (!src) return;
  checkpoint();
  const c = clone(src), map = {};
  c.id = uid('e'); c.name = src.name + ' copy';
  c.nodes.forEach(n => { const o = n.id; reIdNode(n); map[o] = n.id; });
  c.edges.forEach(x => { x.id = uid('l'); x.from = map[x.from]; x.to = map[x.to]; });
  c.groups.forEach(g => { g.id = uid('g'); g.members = g.members.map(m => map[m]); });
  DOC.envs.splice(DOC.envs.indexOf(src) + 1, 0, c);
  changed(); switchEnv(c.id);
}
function deleteEnv(id) {
  if (DOC.envs.length < 2) return toast('You need at least one environment');
  const e = DOC.envs.find(x => x.id === id);
  if (!e) return;
  const k = e.nodes.length;
  const m = openModal(`<div class="mhead"><h3>Delete environment?</h3><button class="icon-btn" data-close aria-label="Close">${ic('x', 16)}</button></div>
    <div class="mbody"><p class="hint" style="margin:0">“<b>${esc(e.name)}</b>” ${k ? `and its <b>${k} node${k > 1 ? 's' : ''}</b> will be removed` : 'will be removed'}. Once you publish, it is gone for visitors too.</p>
    <div class="mrow"><span class="grow"></span><button class="btn" id="de-no">Cancel</button><button class="btn danger" id="de-yes">${ic('trash', 14)} Delete environment</button></div></div>`);
  const no = $('#de-no', m.el);
  no.focus();
  no.addEventListener('click', m.close);
  $('#de-yes', m.el).addEventListener('click', () => {
    m.close();
    checkpoint();
    DOC.envs = DOC.envs.filter(x => x.id !== id);
    changed();
    if (S.envId === id) switchEnv(DOC.envs[0].id); else renderEnvs();
    toast(`Deleted “${e.name}”`, { actions: [{ label: 'Undo', fn: undo }] });
  });
}
function moveEnv(id, d) {
  const i = DOC.envs.findIndex(x => x.id === id), j = i + d;
  if (i < 0 || j < 0 || j >= DOC.envs.length) return;
  checkpoint();
  [DOC.envs[i], DOC.envs[j]] = [DOC.envs[j], DOC.envs[i]];
  renderEnvs(); changed();
}
$('#env-add').addEventListener('click', addEnv);
$('#env-list').addEventListener('click', e => {
  const row = e.target.closest('.env');
  if (!row || row.querySelector('input')) return;
  if (row.dataset.env !== S.envId) switchEnv(row.dataset.env);
  closePanels();
});
$('#env-list').addEventListener('dblclick', e => { const row = e.target.closest('.env'); if (row) renameEnvInline(row.dataset.env); });
$('#env-list').addEventListener('contextmenu', e => {
  const row = e.target.closest('.env');
  if (!row || !S.canEdit) return;
  e.preventDefault();
  const id = row.dataset.env, i = DOC.envs.findIndex(x => x.id === id);
  openMenu(e.clientX, e.clientY, [
    { label: 'Rename', icon: 'edit', fn: () => renameEnvInline(id) },
    { label: 'Duplicate', icon: 'copy', fn: () => duplicateEnv(id) },
    { label: 'Move up', icon: 'chev', disabled: i === 0, fn: () => moveEnv(id, -1) },
    { label: 'Move down', icon: 'chev', disabled: i === DOC.envs.length - 1, fn: () => moveEnv(id, 1) },
    '-',
    { label: 'Delete', icon: 'trash', danger: true, disabled: DOC.envs.length < 2, fn: () => deleteEnv(id) },
  ]);
});
window.addEventListener('hashchange', () => {
  const id = (location.hash.match(/e=([\w-]+)/) || [])[1];
  if (id && id !== S.envId && DOC.envs.some(e => e.id === id)) switchEnv(id);
});

/* layers */
const layersEl = $('#layers');
layersEl.addEventListener('click', e => {
  const eye = e.target.closest('[data-act="leye"]');
  if (eye) {
    const row = eye.closest('.layer');
    if (row.dataset.g) { const g = env().groups.find(x => x.id === row.dataset.g); if (g) toggleHidden(g.members); }
    else toggleHidden([row.dataset.id]);
    return;
  }
  const ch = e.target.closest('[data-act="lcollapse"]');
  if (ch) { const g = ch.closest('[data-g]').dataset.g; UI.collapsed[g] = !UI.collapsed[g]; saveUI(); renderLayers(); return; }
  const row = e.target.closest('.layer');
  if (!row) return;
  endEdit();
  if (row.dataset.g) {
    const g = env().groups.find(x => x.id === row.dataset.g);
    if (g) { selectNodes(g.members, e.shiftKey); panToNodes(g.members); }
    return;
  }
  const id = row.dataset.id;
  if (e.shiftKey) { if (S.sel.has(id)) S.sel.delete(id); else S.sel.add(id); S.edgeSel = null; refreshSel(); }
  else selectNodes([id]);
  panToNodes([id]);
});
layersEl.addEventListener('dblclick', e => {
  const row = e.target.closest('.layer');
  if (!row) return;
  if (row.dataset.g) { if (S.canEdit) renameGroup(row.dataset.g); return; }
  zoomToNodes([row.dataset.id]);
});
layersEl.addEventListener('contextmenu', e => {
  const row = e.target.closest('.layer[data-id]');
  if (!row || !S.canEdit) return;
  e.preventDefault();
  if (!S.sel.has(row.dataset.id)) selectNodes([row.dataset.id]);
  openMenu(e.clientX, e.clientY, nodeMenu(e.clientX, e.clientY));
});
layersEl.addEventListener('mouseover', e => {
  const row = e.target.closest('.layer[data-id]');
  $$('.node.hl').forEach(x => x.classList.remove('hl'));
  if (row) { const el = NODE_EL.get(row.dataset.id); if (el) el.classList.add('hl'); }
});
layersEl.addEventListener('mouseleave', () => $$('.node.hl').forEach(x => x.classList.remove('hl')));
$('#layer-filter').addEventListener('input', renderLayers);
$('#layer-filter').addEventListener('keydown', e => {
  e.stopPropagation();
  if (e.key === 'Escape') { e.target.value = ''; renderLayers(); e.target.blur(); }
  if (e.key === 'Enter') { const r = layersEl.querySelector('.layer[data-id]'); if (r) { selectNodes([r.dataset.id]); zoomToNodes([r.dataset.id]); } }
});

/* inspector */
$('#inspector').addEventListener('click', e => {
  const sw = e.target.closest('[data-sw]');
  if (sw) { setColor(sw.dataset.sw); return; }
  const b = e.target.closest('[data-ia]');
  if (!b) return;
  const id = S.edgeSel, ed = id && env().edges.find(x => x.id === id);
  switch (b.dataset.ia) {
    case 'type': setType(b.dataset.v); break;
    case 'arrow': if (ed) edgeSet(id, { arrow: !ed.arrow }); break;
    case 'dashed': if (ed) edgeSet(id, { dashed: !ed.dashed }); break;
    case 'elabel': editEdgeLabel(id); break;
    case 'reverse': reverseEdge(id); break;
    case 'del': deleteSel(); break;
    case 'dup': duplicateSel(); break;
    case 'align': alignSel(b.dataset.v); break;
    case 'tidy': tidySel(); break;
    case 'group': groupSel(); break;
    case 'ungroup': ungroupSel(); break;
  }
});

/* labels & group frames on the board */
vp.addEventListener('dblclick', e => {
  const t = e.target;
  const eg = t.closest('[data-e]');
  if (eg) { editEdgeLabel(eg.dataset.e); return; }
  const gl = t.closest('.glabel');
  if (gl) { renameGroup(gl.dataset.g); return; }
  if (t.closest('.node') || !S.canEdit) return;
  const w = toWorld(e.clientX, e.clientY);
  createNode('note', w.x, w.y);
});

/* ===================== theme, help, share, preview ===================== */
function applyTheme() {
  const t = CFG.theme;
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
  const b = $('[data-cmd="theme"]');
  if (b) { b.innerHTML = ic(t === 'light' ? 'sun' : t === 'dark' ? 'moon' : 'monitor', 16); b.title = 'Theme: ' + (t === 'system' ? 'match system' : t); }
  queueMinimap();
}
function cycleTheme() {
  CFG.theme = { system: 'light', light: 'dark', dark: 'system' }[CFG.theme] || 'system';
  saveCfg(); applyTheme();
  toast('Theme: ' + (CFG.theme === 'system' ? 'match system' : CFG.theme));
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', queueMinimap);
function openHelp() {
  const K = [
    ['Pan', 'Middle-drag · Space-drag'], ['Zoom', 'Scroll · Ctrl+scroll · pinch'],
    ['Select', 'Click · drag on empty space'], ['Add to selection', 'Shift+click'],
    ['Add a node', 'Right-click · double-click · T N S'], ['Edit text', 'Double-click'],
    ['Place freely (no snapping)', 'Hold Ctrl while dragging'], ['Connect nodes', 'Drag from a side dot'],
    ['Move a block', 'Drag its ⋮⋮ handle'], ['Nudge', 'Arrows (Shift ×4, Ctrl 1px)'],
    ['Duplicate', 'Ctrl+D'], ['Copy · paste', 'Ctrl+C · Ctrl+V'],
    ['Group · ungroup', 'Ctrl+G · Ctrl+Shift+G'], ['Hide · show', 'Ctrl+Shift+H or the eye in Layers'],
    ['Disconnect', 'Drag a connection away'], ['Undo · redo', 'Ctrl+Z · Ctrl+Shift+Z'],
    ['Delete', 'Delete'], ['Fit all · selection', 'Shift+1 · Shift+2'],
    ['Zoom to 100%', 'Ctrl+0'], ['Publish', 'Ctrl+S'],
  ].map(([a, b]) => `<div><span>${a}</span><kbd>${esc(b.replace(/Ctrl/g, MOD))}</kbd></div>`).join('');
  openModal(`<div class="mhead"><h3>Keyboard & mouse</h3><button class="icon-btn" data-close aria-label="Close">${ic('x', 16)}</button></div>
    <div class="mbody"><section><div class="keys">${K}</div></section>
    <section><p class="hint" style="margin:0">Nodes snap to a 24px grid and line up with their neighbours, with pink guides showing the alignment. Pasting an image or a link onto the board makes a node from it.</p></section></div>`);
}
function share() {
  const url = location.origin + location.pathname + '#e=' + S.envId;
  const ok = () => toast('Link to this environment copied');
  try { navigator.clipboard.writeText(url).then(ok, () => prompt('Copy this link', url)); } catch (_) { prompt('Copy this link', url); }
}
function goPreview(on) {
  endEdit(); saveLocal.flush();
  location.href = location.pathname + (on ? '?view' : '') + '#e=' + S.envId;
}
function promptModal(title, value, cb) {
  const m = openModal(`<div class="mhead"><h3>${esc(title)}</h3><button class="icon-btn" data-close aria-label="Close">${ic('x', 16)}</button></div>
    <div class="mbody"><div class="grid2" style="grid-template-columns:1fr"><input id="pm-in" value="${esc(value)}"></div><div class="mrow"><span class="grow"></span><button class="btn" data-close>Cancel</button><button class="btn primary" id="pm-ok">Save</button></div></div>`);
  const inp = $('#pm-in', m.el);
  inp.focus(); inp.select();
  const ok = () => { const v = inp.value.trim(); if (v) cb(v); m.close(); };
  $('#pm-ok', m.el).addEventListener('click', ok);
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') ok(); });
}

/* ===================== settings & publishing ===================== */
function openSettings() {
  const det = detectRepo() || {};
  const conn = `<section><h4>${ic('upload', 15)} ${S.canEdit ? 'Publishing to GitHub' : 'Owner sign-in'}</h4>
    <p class="hint">${S.canEdit ? '' : 'Visitors can only view this board. '}Flogic keeps the board in <code>${DATA_PATH}</code> inside your GitHub Pages repository. To edit and publish, connect a <b>fine-grained token</b> that has <b>Contents: Read and write</b> on that one repository. The token is stored only in this browser.</p>
    <div class="grid2">
      <label>Owner<input id="s-owner" value="${esc(CFG.owner || det.owner || '')}" placeholder="your-username" spellcheck="false"></label>
      <label>Repository<input id="s-repo" value="${esc(CFG.repo || det.repo || '')}" placeholder="flogic" spellcheck="false"></label>
      <label>Branch<input id="s-branch" value="${esc(CFG.branch || 'main')}" spellcheck="false"></label>
      <label>Token<input id="s-token" type="password" value="${esc(CFG.token || '')}" placeholder="github_pat_…" autocomplete="off" spellcheck="false"></label>
    </div>
    <div class="mrow"><a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener noreferrer">Create a token ↗</a><span class="grow"></span><span class="sstat${S.connected ? ' ok' : ''}" id="s-stat">${S.connected ? 'Connected' : ''}</span>${CFG.token ? `<button class="btn" id="s-out">${ic('logout', 14)} Sign out</button>` : ''}<button class="btn primary" id="s-go">${S.connected ? 'Save' : 'Connect'}</button></div>
    ${S.canEdit ? `<label class="tog"><input type="checkbox" id="s-auto"${CFG.autoPublish ? ' checked' : ''}><span></span>Auto-publish 20 seconds after you stop editing</label>` : ''}
  </section>`;
  const prefs = S.canEdit ? `<section><h4>${ic('settings', 15)} Board</h4>
    <div class="field"><span>Mouse wheel</span><div class="segs" id="s-wheel"><button data-v="zoom" class="${CFG.wheel !== 'pan' ? 'on' : ''}">Zooms</button><button data-v="pan" class="${CFG.wheel === 'pan' ? 'on' : ''}">Scrolls</button></div></div>
    <label class="tog"><input type="checkbox" id="s-snap"${CFG.snap !== false ? ' checked' : ''}><span></span>Snap to the grid and to other nodes (hold Ctrl to bypass)</label>
    <label class="tog"><input type="checkbox" id="s-nolimit"${CFG.noLimit ? ' checked' : ''}><span></span>Remove the ${NODE_LIMIT.toLocaleString()}-node limit per environment (very large boards can get slow)</label></section>
    <section><h4>${ic('download', 15)} Backup</h4><p class="hint">Your work autosaves in this browser. Export a copy now and then, or import one to replace this board.</p>
    <div class="mrow" style="margin-top:0"><button class="btn" id="s-exp">${ic('download', 14)} Export JSON</button><button class="btn" id="s-imp">${ic('upload', 14)} Import JSON</button>${S.connected ? `<button class="btn" id="s-pull">${ic('refresh', 14)} Reload from GitHub</button>` : ''}</div></section>` : '';
  const m = openModal(`<div class="mhead"><h3>${S.canEdit ? 'Settings' : 'Sign in to edit'}</h3><button class="icon-btn" data-close aria-label="Close">${ic('x', 16)}</button></div><div class="mbody">${conn}${prefs}</div>`);
  const q = s => $(s, m.el);
  q('#s-go').addEventListener('click', async () => {
    const st = q('#s-stat'), prev = Object.assign({}, CFG);
    CFG.owner = q('#s-owner').value.trim(); CFG.repo = q('#s-repo').value.trim();
    CFG.branch = q('#s-branch').value.trim() || 'main'; CFG.token = q('#s-token').value.trim();
    st.className = 'sstat'; st.textContent = 'Checking…';
    try {
      await GH.verify();
      saveCfg();
      st.className = 'sstat ok'; st.textContent = 'Connected ✓';
      if (!S.connected || prev.owner !== CFG.owner || prev.repo !== CFG.repo || prev.branch !== CFG.branch) {
        if (S.canEdit) saveLocal.flush();
        setTimeout(() => location.reload(), 500);
      }
    } catch (err) {
      Object.assign(CFG, prev);
      st.className = 'sstat err'; st.textContent = err.message;
    }
  });
  const out = q('#s-out');
  if (out) out.addEventListener('click', () => {
    if (META.dirty && S.connected && !confirm('You have unpublished changes. They stay saved in this browser. Sign out anyway?')) return;
    CFG.token = ''; saveCfg(); saveLocal.flush(); location.reload();
  });
  const auto = q('#s-auto');
  if (auto) auto.addEventListener('change', () => { CFG.autoPublish = auto.checked; saveCfg(); scheduleAuto(); });
  const lim = q('#s-nolimit');
  if (lim) lim.addEventListener('change', () => { CFG.noLimit = lim.checked; saveCfg(); });
  const wheel = q('#s-wheel');
  if (wheel) wheel.addEventListener('click', e => { const b = e.target.closest('[data-v]'); if (!b) return; CFG.wheel = b.dataset.v; saveCfg(); $$('button', wheel).forEach(x => x.classList.toggle('on', x === b)); });
  const snapT = q('#s-snap');
  if (snapT) snapT.addEventListener('change', () => { CFG.snap = snapT.checked; saveCfg(); });
  const exp = q('#s-exp');
  if (exp) exp.addEventListener('click', exportJSON);
  const imp = q('#s-imp');
  if (imp) imp.addEventListener('click', () => { const f = $('#file-json'); f.value = ''; f.click(); m.close(); });
  const pull = q('#s-pull');
  if (pull) pull.addEventListener('click', async () => { m.close(); await pullRemote(); });
}
function exportJSON() {
  const blob = new Blob([JSON.stringify(DOC, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `flogic-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
$('#file-json').addEventListener('change', async e => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    const d = JSON.parse(await f.text());
    if (!d || !Array.isArray(d.envs)) throw new Error('Not a Flogic board');
    checkpoint();
    DOC = migrate(d);
    changed();
    switchEnv(DOC.envs[0].id);
    toast('Board imported', { actions: [{ label: 'Undo', fn: undo }] });
  } catch (err) { toast('Import failed: ' + err.message, { type: 'err' }); }
});
async function pullRemote() {
  if (META.dirty && !confirm('Replace your unpublished changes with the version on GitHub?')) return;
  try {
    const f = await GH.getFile(DATA_PATH);
    if (!f) return toast('Nothing published yet');
    checkpoint();
    DOC = migrate(JSON.parse(f.text));
    META.baseSha = f.sha; META.baseHash = hashStr(f.text); META.dirty = false;
    saveLocalNow(); switchEnv(S.envId); renderTop(true);
    toast('Loaded the published board');
  } catch (err) { toast('Could not load: ' + err.message, { type: 'err' }); }
}
async function publish() {
  if (!S.canEdit) return;
  if (!S.connected) { openSettings(); toast('Connect GitHub to publish'); return; }
  if (S.publishing) return;
  endEdit();
  S.publishing = true; renderTop();
  const startChg = CHG;
  try {
    await uploadAssets();
    const text = JSON.stringify(DOC, null, 1);
    const msg = `Flogic: update board (${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC)`;
    let sha;
    try { sha = await GH.putFile(DATA_PATH, utf8ToB64(text), META.baseSha, msg); }
    catch (err) {
      if (err.status !== 409 && err.status !== 422) throw err;
      const cur = await GH.getFile(DATA_PATH);
      if (cur && META.baseHash && hashStr(cur.text) !== META.baseHash && cur.text !== text &&
        !confirm('The board on GitHub changed somewhere else since you last synced. Overwrite it with this version?')) throw new Error('cancelled');
      sha = await GH.putFile(DATA_PATH, utf8ToB64(text), cur ? cur.sha : undefined, msg);
    }
    META.baseSha = sha; META.baseHash = hashStr(text); META.publishedAt = Date.now();
    META.dirty = CHG !== startChg;
    saveMeta();
    toast('Published. Visitors see it within a minute or two.');
  } catch (err) {
    if (err.message !== 'cancelled') toast('Publish failed: ' + err.message, { type: 'err', ms: 7000 });
  } finally {
    S.publishing = false;
    renderTop(true);
  }
}
const autoPub = debounce(() => {
  if (!CFG.autoPublish || !S.connected || !META.dirty) return;
  if (S.editing || DRAG || BD) return autoPub();
  publish();
}, 20000);
function scheduleAuto() { if (CFG.autoPublish && S.connected) autoPub(); }

/* ===================== boot ===================== */
function fillIcons() {
  const put = (sel, name, size = 17) => $$(sel).forEach(b => b.insertAdjacentHTML('afterbegin', ic(name, size)));
  put('[data-tool="select"]', 'cursor'); put('[data-tool="hand"]', 'hand');
  put('[data-new="title"]', 'title'); put('[data-new="note"]', 'note'); put('[data-new="sub"]', 'sub');
  put('[data-cmd="undo"]', 'undo'); put('[data-cmd="redo"]', 'redo');
  put('[data-cmd="zoomout"]', 'minus', 16); put('[data-cmd="zoomin"]', 'plus', 16); put('[data-cmd="fit"]', 'fit', 16);
  put('#env-add', 'plus', 15); put('[data-cmd="help"]', 'help', 16);
  put('[data-cmd="show-left"]', 'menu'); put('[data-cmd="show-right"]', 'layers'); put('[data-cmd="close-panels"]', 'x', 15);
  $('.search-ic').innerHTML = ic('search', 14);
  $('[data-cmd="signin"]').innerHTML = ic('lock', 15) + '<span>Owner sign-in</span>';
  $('[data-cmd="settings"]').innerHTML = ic('settings', 15) + '<span>Settings</span>';
  $('[data-cmd="help"]').title = 'Keyboard & mouse (?)';
}
async function loadDoc() {
  let pubText = null, pubSha = null;
  if (S.connected) { try { const f = await GH.getFile(DATA_PATH); if (f) { pubText = f.text; pubSha = f.sha; } } catch (e) { console.warn(e); } }
  if (pubText == null) { try { const r = await fetch(DATA_PATH + '?v=' + Date.now(), { cache: 'no-store' }); if (r.ok) pubText = await r.text(); } catch (e) { /* offline or file:// */ } }
  let pub = null;
  if (pubText) { try { pub = JSON.parse(pubText); } catch (e) { toast('The published board file is not valid JSON', { type: 'err' }); } }
  const draft = S.canEdit ? readLS(LS.doc) : null;
  if (draft && META.dirty) {
    DOC = draft;
    if (pub && pubSha && META.baseSha && pubSha !== META.baseSha) {
      toast('GitHub has a newer version than your unpublished draft.', { ms: 12000, actions: [{ label: 'Load GitHub version', fn: () => {
        checkpoint(); DOC = migrate(pub); META.baseSha = pubSha; META.baseHash = hashStr(pubText); META.dirty = false;
        saveLocalNow(); switchEnv(S.envId); renderTop(true);
      } }] });
    }
  } else if (pub) {
    DOC = pub;
    if (pubSha) { META.baseSha = pubSha; META.baseHash = hashStr(pubText); }
    META.dirty = false;
  } else if (draft) DOC = draft;
  else { DOC = demoDoc(); META.dirty = S.connected; }
  DOC = migrate(DOC);
  if (S.canEdit) saveLocalNow();
}
async function boot() {
  fillIcons(); applyTheme();
  VR = vp.getBoundingClientRect();
  new ResizeObserver(() => {
    const o = VR;
    VR = vp.getBoundingClientRect();
    if (S.envId && (o.width !== VR.width || o.height !== VR.height)) { V.x += (VR.width - o.width) / 2; V.y += (VR.height - o.height) / 2; applyView(); }
  }).observe(vp);
  S.local = location.protocol === 'file:' || /^(localhost|127\.0\.0\.1|\[::1\])$|\.localhost$|\.test$/.test(location.hostname);
  S.preview = new URLSearchParams(location.search).has('view');
  const det = detectRepo();
  if (det) { if (!CFG.owner) CFG.owner = det.owner; if (!CFG.repo) CFG.repo = det.repo; }
  if (CFG.token) {
    try { await GH.verify(); S.connected = true; }
    catch (err) {
      if (err.status) toast('GitHub: ' + err.message + '. Open Settings to fix it.', { type: 'err', ms: 8000 });
      else toast('Could not reach GitHub. Working offline; publish later.', { ms: 5000 });
    }
  }
  S.canEdit = !S.preview && (S.local || !!CFG.token);
  document.body.classList.add(S.canEdit ? 'editor' : 'viewer');
  await loadDoc();
  const hashEnv = (location.hash.match(/e=([\w-]+)/) || [])[1];
  const first = [hashEnv, UI.envId].find(id => id && DOC.envs.some(e => e.id === id)) || DOC.envs[0].id;
  switchEnv(first);
  setTool('select');
  const bootEl = $('#boot');
  bootEl.classList.add('done');
  setTimeout(() => bootEl.remove(), 400);
  if (S.preview) toast('Previewing as a visitor');
  else if (!S.canEdit) toast('View only · drag to pan, scroll to zoom', { ms: 3500 });
}
boot();
