'use strict';
/* Flogic: interaction layer (pointer, keyboard, menus, editing, publishing, boot). */

let PTR = { x: -1, y: -1 }, DRAG = null, PAN = null, MQ = null, CONN = null, BD = null, RZ = null, TB = null, PINCH = null, EG = null, BEND = null;
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
  drawEdges(); drawFrames();
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
  drawEdges(); drawFrames();
  if (light) return;
  renderLayers(); renderInspector(); queueMinimap();
}
function selectNodes(ids, add) { if (!add) S.sel.clear(); ids.forEach(id => S.sel.add(id)); S.edgeSel = null; S.panelSel = null; refreshSel(); }
function clearSel() { if (!S.sel.size && !S.edgeSel) return; S.sel.clear(); S.edgeSel = null; S.panelSel = null; refreshSel(); }
function selectEdge(id) { S.sel.clear(); S.edgeSel = id; S.panelSel = null; refreshSel(); }
/* picking a panel (by its frame, name or Layers row) selects all its nodes, so dragging moves the panel */
function selectPanel(pid) {
  const p = panelById(pid);
  if (!p) return;
  S.sel = new Set(p.members.filter(id => { const n = nodeById(id); return n && !n.hidden; }));
  S.edgeSel = null; S.panelSel = pid;
  refreshSel();
}
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
/* tidy groups and panels and drop connections whose node or panel no longer exists (e.g. after deleting) */
function pruneEdges() { normalizeEnv(env()); }
function structureChanged() {
  pruneEdges();
  syncNodes();
  drawEdges(); drawFrames();
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
function caretFromPoint(cx, cy) {
  if (document.caretRangeFromPoint) return document.caretRangeFromPoint(cx, cy);
  if (document.caretPositionFromPoint) {
    const p = document.caretPositionFromPoint(cx, cy);
    if (p) { const r = document.createRange(); r.setStart(p.offsetNode, p.offset); r.collapse(true); return r; }
  }
  return null;
}
/* Fields show formatted text; while editing they show the raw text with its ** == -# marks. */
function startEdit(el, cx, cy) {
  if (!S.canEdit || !el) return;
  if (S.editing && S.editing.el === el) return;
  endEdit();
  const ne = el.closest('.node');
  if (!ne) return;
  const n = nodeById(ne.dataset.id), raw = String(getPath(n, el.dataset.f) || '');
  /* where in the visible text was clicked, mapped onto the raw text */
  let at = raw.length;
  if (cx != null) {
    const r = caretFromPoint(cx, cy);
    if (r && el.contains(r.startContainer)) {
      const pre = document.createRange();
      pre.selectNodeContents(el); pre.setEnd(r.startContainer, r.startOffset);
      const shown = pre.toString(), all = el.textContent;
      if (all === raw) at = shown.length;
      else { let j = 0, i = 0; for (; i < raw.length && j < shown.length; i++) if (raw[i] === shown[j]) j++; at = i; }
    }
  }
  checkpoint();
  S.editing = { el, id: ne.dataset.id, f: el.dataset.f, before: raw };
  /* a formula's source is hidden until it is edited */
  const mx = el.closest('.b-mx');
  if (mx) mx.classList.add('src-on');
  el.textContent = raw;
  el.setAttribute('contenteditable', PLAIN);
  el.setAttribute('spellcheck', mx ? 'false' : 'true');
  ne.classList.add('editing');
  el.focus({ preventScroll: true });
  setEditSelection(at, at);
}
function editField(nodeId, f, selectAll) {
  const ne = NODE_EL.get(nodeId), el = ne && ne.querySelector(`[data-f="${f}"]`);
  if (!el) return;
  startEdit(el);
  if (selectAll && el.textContent) setEditSelection(0, el.textContent.length);
}
function endEdit() {
  const ed = S.editing;
  if (!ed) return;
  S.editing = null;
  const el = ed.el, n = nodeById(ed.id);
  let v = ed.before;
  if (n) {
    v = el.innerText.replace(/\xa0/g, ' ').replace(/\n+$/, '');
    if (el.dataset.single) v = v.replace(/\s*\n\s*/g, ' ');
    setPath(n, ed.f, v);
    if (v !== ed.before) { changed(); editPulse(n, el); }
  }
  el.removeAttribute('contenteditable');
  el.removeAttribute('spellcheck');
  el.innerHTML = mdField(v, !!el.dataset.single);
  const ne = el.closest('.node');
  if (ne) ne.classList.remove('editing');
  const mx = el.closest('.b-mx');
  if (mx) { mx.classList.remove('src-on'); mxPreview(mx, mx.closest('.blk').classList.contains('k-chem') ? 'chem' : 'math', v); }
  if (n) markNode(n);
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
  /* formulas redraw as you type */
  const mx = ed.el.closest('.b-mx');
  if (mx) mxPreview(mx, mx.closest('.blk').classList.contains('k-chem') ? 'chem' : 'math', v.replace(/\n+$/, ''));
  changed();
});
nodesWrap.addEventListener('focusout', e => { if (S.editing && e.target === S.editing.el) endEdit(); });
nodesWrap.addEventListener('keydown', e => {
  const ed = S.editing;
  if (!ed || e.target !== ed.el) return;
  e.stopPropagation();
  const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
  if (mod && !e.shiftKey && k === 'b') { e.preventDefault(); wrapSel('**'); return; }
  if (mod && !e.shiftKey && k === 'i') { e.preventDefault(); wrapSel('*'); return; }
  if (mod && !e.shiftKey && k === 'e') { e.preventDefault(); wrapSel('=='); return; }
  if (mod && e.shiftKey && k === 'x') { e.preventDefault(); wrapSel('~~'); return; }
  if (mod && k === 'k') { e.preventDefault(); const r = ed.el.getBoundingClientRect(); openNodeLinkPicker(r.left, r.bottom + 6); return; }
  if (e.key === 'Escape') { e.preventDefault(); endEdit(); return; }
  if (e.key === 'Enter' && (ed.el.dataset.single || mod)) { e.preventDefault(); endEdit(); return; }
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

/* ---------- formatting helpers (work on the raw text of the field being edited) ---------- */
function editSelection() {
  const el = S.editing.el, s = getSelection(), len = el.textContent.length;
  if (!s.rangeCount || !el.contains(s.anchorNode)) return { start: len, end: len };
  const r = s.getRangeAt(0), pre = document.createRange();
  pre.selectNodeContents(el); pre.setEnd(r.startContainer, r.startOffset);
  const start = pre.toString().length;
  return { start, end: Math.min(len, start + r.toString().length) };
}
/* character offset -> [text node, offset]; the field can hold several text nodes while typing */
function textPos(el, off) {
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let n, last = null;
  while ((n = w.nextNode())) { if (off <= n.length) return [n, Math.max(0, off)]; off -= n.length; last = n; }
  return last ? [last, last.length] : [el, 0];
}
function setEditSelection(a, b) {
  const el = S.editing && S.editing.el;
  if (!el) return;
  const [sn, so] = textPos(el, a), [en, eo] = textPos(el, b), r = document.createRange();
  r.setStart(sn, so); r.setEnd(en, eo);
  const s = getSelection(); s.removeAllRanges(); s.addRange(r);
}
/* Replace the field's text through the browser's own editing command, so Ctrl+Z / Ctrl+Y
   undo and redo formatting just like typing. Only the part that changed is replaced. */
function commitEditText(text, a, b) {
  const ed = S.editing, el = ed.el, old = el.textContent;
  if (text !== old) {
    let p = 0, s = 0;
    while (p < old.length && p < text.length && old[p] === text[p]) p++;
    while (s < old.length - p && s < text.length - p && old[old.length - 1 - s] === text[text.length - 1 - s]) s++;
    setEditSelection(p, old.length - s);
    const ins = text.slice(p, text.length - s);
    let ok = false;
    try { ok = ins ? document.execCommand('insertText', false, ins) : document.execCommand('delete', false); } catch (_) {}
    if (!ok || el.textContent !== text) el.textContent = text;
  }
  setEditSelection(a, b);
  setPath(nodeById(ed.id), ed.f, text);
  changed();
}
const WORD_L = /[\p{L}\p{N}_'’-]*$/u, WORD_R = /^[\p{L}\p{N}_'’-]*/u;
/* wrap the selection (or the word at the caret) in marks; wrapping again removes them */
function wrapSel(pre, post = pre, sel) {
  if (!S.editing) return;
  let { start, end } = sel || editSelection();
  const t = S.editing.el.textContent;
  if (start === end) { start -= t.slice(0, start).match(WORD_L)[0].length; end += t.slice(end).match(WORD_R)[0].length; }
  if (t.slice(start - pre.length, start) === pre && t.slice(end, end + post.length) === post)
    return commitEditText(t.slice(0, start - pre.length) + t.slice(start, end) + t.slice(end + post.length), start - pre.length, end - pre.length);
  if (t.slice(start, start + pre.length) === pre && t.slice(end - post.length, end) === post && end - start >= pre.length + post.length)
    return commitEditText(t.slice(0, start) + t.slice(start + pre.length, end - post.length) + t.slice(end), start, end - pre.length - post.length);
  commitEditText(t.slice(0, start) + pre + t.slice(start, end) + post + t.slice(end), start + pre.length, end + pre.length);
}
/* toggle a prefix (like "-# ") on the line holding the selection */
function toggleLinePrefix(prefix, sel) {
  if (!S.editing || S.editing.el.dataset.single) return;
  const { start, end } = sel || editSelection(), t = S.editing.el.textContent;
  const ls = t.lastIndexOf('\n', start - 1) + 1;
  if (t.startsWith(prefix, ls)) commitEditText(t.slice(0, ls) + t.slice(ls + prefix.length), Math.max(ls, start - prefix.length), Math.max(ls, end - prefix.length));
  else commitEditText(t.slice(0, ls) + prefix + t.slice(ls), start + prefix.length, end + prefix.length);
}
function insertDivider(sel) {
  if (!S.editing || S.editing.el.dataset.single) return;
  const { end } = sel || editSelection(), t = S.editing.el.textContent;
  const le = t.indexOf('\n', end), at = le < 0 ? t.length : le, add = '\n___\n';
  commitEditText(t.slice(0, at) + add + t.slice(at), at + add.length, at + add.length);
}
function linkSel(name, sel) {
  if (!S.editing) return;
  let { start, end } = sel || editSelection();
  const t = S.editing.el.textContent;
  if (start === end) { start -= t.slice(0, start).match(WORD_L)[0].length; end += t.slice(end).match(WORD_R)[0].length; }
  const label = t.slice(start, end) || name, ins = `(${label})[${name}]`;
  commitEditText(t.slice(0, start) + ins + t.slice(end), start + ins.length, start + ins.length);
}
function openNodeLinkPicker(x, y, sel) {
  if (!S.editing) return;
  sel = sel || editSelection();
  const here = S.editing.id;
  const ns = env().nodes.filter(n => n.id !== here && !n.hidden).sort((a, b) => nodeName(a).localeCompare(nodeName(b)));
  if (!ns.length) return toast('There are no other nodes to link to yet');
  openMenu(x, y, [{ head: 'Link to node' }, ...ns.slice(0, 80).map(n => ({
    label: nodeName(n), icon: n.type,
    fn: () => linkSel(nodeName(n), sel),
  }))], { cls: 'scroll' });
}
/* one-row formatting toolbar used inside right-click menus */
function fmtRow(single) {
  const b = (k, icon, tip, off) => `<button class="fb" data-fmt="${k}" title="${tip}"${off ? ' disabled' : ''}>${ic(icon, 15)}</button>`;
  return { html: `<div class="mfmt">${b('bold', 'bold', 'Bold · ' + MOD + '+B')}${b('italic', 'italic', 'Italic · ' + MOD + '+I')}${b('mark', 'mark', 'Highlight · ' + MOD + '+E')}${b('strike', 'strike', 'Strikethrough · ' + MOD + '+Shift+X')}<span class="fsep"></span>${b('small', 'small', 'Small text (-#)', single)}${b('hr', 'minus', 'Divider line below (___)', single)}${b('link', 'nodelink', 'Link to a node · ' + MOD + '+K')}</div>` };
}
function runFmt(k, sel) {
  if (k === 'bold') wrapSel('**', '**', sel);
  else if (k === 'italic') wrapSel('*', '*', sel);
  else if (k === 'mark') wrapSel('==', '==', sel);
  else if (k === 'strike') wrapSel('~~', '~~', sel);
  else if (k === 'small') toggleLinePrefix('-# ', sel);
  else if (k === 'hr') insertDivider(sel);
  else if (k === 'link') { const x = PTR.x, y = PTR.y; setTimeout(() => openNodeLinkPicker(x, y, sel), 0); }
}
/* `prep` makes sure the field is being edited and returns the selection to act on */
function fmtClick(prep) {
  return e => {
    const b = e.target.closest('[data-fmt]');
    if (!b || b.disabled) return false;
    closeMenu();
    const sel = prep();
    if (sel) runFmt(b.dataset.fmt, sel);
    return false;
  };
}
/* clicking a (text)[Node] link jumps to that node, even in another environment */
function goToNode(name) {
  const want = mdPlain(name).trim().toLowerCase();
  const match = n => nodeName(n).toLowerCase() === want;
  let e = env(), n = e.nodes.find(match);
  if (!n) { e = DOC.envs.find(x => x.nodes.some(match)); n = e && e.nodes.find(match); }
  if (!n) return toast(`No node called “${name}”`);
  if (n.hidden) return toast(`“${name}” is hidden`);
  endEdit();
  if (e.id !== S.envId) switchEnv(e.id);
  selectNodes([n.id]);
  zoomToNodes([n.id]);
  const el = NODE_EL.get(n.id);
  if (el) { el.classList.remove('ping'); void el.offsetWidth; el.classList.add('ping'); setTimeout(() => el.classList.remove('ping'), 1200); }
}

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
  bgPulse(x + n.w / 2, y + 48, colorOf(n.color).c1, 0.45, 0.5, true);
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
  const ids = new Set(S.sel), e0 = new Map(e.nodes.map(n => [n.id, n]));
  e.nodes = e.nodes.filter(n => !ids.has(n.id));
  e.edges = e.edges.filter(x => !ids.has(x.from) && !ids.has(x.to));
  e.groups.forEach(g => { g.members = g.members.filter(id => !ids.has(id)); });
  e.groups = e.groups.filter(g => g.members.length > 1);
  for (const id of ids) {
    const el = NODE_EL.get(id);
    if (!el) continue;
    NODE_EL.delete(id); RO.unobserve(el); SIZE.delete(id); DISP.delete(id);
    const n0 = e0.get(id);
    if (n0 && ids.size <= 24) dyingPulse(n0, el);
    el.classList.add('leaving'); el.style.pointerEvents = 'none';
    setTimeout(() => el.remove(), 360);
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
/* ---------- "Copy text": selected nodes as Markdown ----------
   Order follows the connections: start from nodes nothing points to (top-left first), then walk
   each node's outgoing links left to right, so a parent is followed by what it leads to. */
function mdSlug(s) { return mdPlain(s).toLowerCase().trim().replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s+/g, '-'); }
function mdOut(s, inline) {
  if (!s) return '';
  let t = String(s)
    .replace(/\(([^()\n]+?)\)\[([^\[\]\n]+?)\]/g, (m, a, n) => `[${a}](#${mdSlug(n)})`)
    .replace(/^-#\s+(.*)$/gm, '*$1*');
  if (!inline) t = t.replace(/^\s*(_{3,}|-{3,}|\*{3,})\s*$/gm, '\n---\n').replace(/\n{3,}/g, '\n\n');
  return t.trim();
}
/* clean Markdown of the nodes (the writer lives in textio.js, which also reads text back in) */
function nodesMarkdown(ns) { return boardText(ns, { sync: false }); }
function copyText() {
  const ns = selNodes().filter(n => !n.hidden);
  if (!ns.length) return toast('Select one or more nodes first');
  endEdit();
  const text = nodesMarkdown(ns);
  const done = () => toast(ns.length > 1 ? `Copied the text of ${ns.length} nodes as Markdown` : 'Copied the text as Markdown');
  const fallback = () => {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.cssText = 'position:fixed;left:-9999px;top:0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); done(); } catch (_) { toast('Could not copy', { type: 'err' }); }
    ta.remove();
  };
  try { navigator.clipboard.writeText(text).then(done, fallback); } catch (_) { fallback(); }
  return text;
}
/* ---------- "Copy as image": the selected nodes (with their connections, and the frames of panels
   that are fully selected) as a PNG with a see-through background. Visitors can do this too.
   The nodes are copied into an off-screen stage and drawn with html-to-image, loaded when first used. */
const H2I_URL = 'https://cdn.jsdelivr.net/npm/html-to-image@1.11.11/dist/html-to-image.js';
let H2I = null;
function loadH2I() {
  if (!H2I) H2I = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = H2I_URL; s.crossOrigin = 'anonymous';
    s.onload = () => window.htmlToImage ? res(window.htmlToImage) : rej(new Error('image tool missing'));
    s.onerror = () => { H2I = null; rej(new Error('Could not load the image tool (are you offline?)')); };
    document.head.appendChild(s);
  });
  return H2I;
}
async function nodesPng(ids) {
  endEdit();
  const e = env(), F = foldMap(), set = new Set(ids.filter(id => { const n = nodeById(id); return n && !n.hidden; }));
  if (!set.size) throw new Error('Select one or more nodes first');
  const panels = e.panels.filter(p => { const ms = p.members.filter(id => !nodeById(id).hidden); return ms.length && ms.every(id => set.has(id)); });
  const shown = [...set].filter(id => !F.has(id)).map(nodeById);
  const ends = new Set([...shown.map(n => n.id), ...panels.map(p => p.id)]);
  const edges = e.edges.filter(x => ends.has(F.get(x.from) || x.from) && ends.has(F.get(x.to) || x.to) && EDGE_EL.has(x.id));
  /* the area to capture */
  const rs = shown.map(n => rectOf(n, true));
  panels.forEach(p => { const r = panelRect(p); if (r) rs.push(r, { x: r.x, y: r.y - 32, w: 160, h: 32 }); });
  edges.forEach(x => { const r = EDGE_EL.get(x.id); try { const b = r.vis.getBBox(); rs.push({ x: b.x, y: b.y, w: b.width, h: b.height }); } catch (_) {} if (r.lab.style.display !== 'none') rs.push({ x: r.mid.x - 60, y: r.mid.y - 14, w: 120, h: 28 }); });
  const pad = 28, x1 = Math.min(...rs.map(r => r.x)) - pad, y1 = Math.min(...rs.map(r => r.y)) - pad;
  const W = Math.ceil(Math.max(...rs.map(r => r.x + r.w)) - x1 + pad), Hh = Math.ceil(Math.max(...rs.map(r => r.y + r.h)) - y1 + pad);
  const lib = await loadH2I();
  /* the stage: copies of the panel frames, lines, labels and nodes, shifted so the area starts at 0,0 */
  const stage = document.createElement('div');
  stage.className = 'snap';
  /* it has to be on screen to be drawn, so it sits behind the app for the moment it exists */
  stage.style.cssText = `position:fixed;left:0;top:0;z-index:-1;width:${W}px;height:${Hh}px;overflow:hidden;pointer-events:none`;
  const layer = () => { const d = document.createElement('div'); d.style.cssText = `position:absolute;left:0;top:0;transform:translate(${-x1}px,${-y1}px)`; stage.appendChild(d); return d; };
  const pl = layer();
  panels.forEach(p => { const el = PANEL_EL.get(p.id); if (el) { const c = el.cloneNode(true); c.classList.remove('sel', 'drop', 'conn-target', 'pf-anim'); pl.appendChild(c); } });
  const svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('width', W); svg.setAttribute('height', Hh);
  svg.style.cssText = 'position:absolute;left:0;top:0;overflow:visible';
  svg.appendChild($('#edges defs').cloneNode(true));
  const g = document.createElementNS(SVGNS, 'g');
  g.setAttribute('transform', `translate(${-x1},${-y1})`);
  edges.forEach(x => {
    const r = EDGE_EL.get(x.id), c = r.g.cloneNode(true);
    $$('.hit, .bend, .bend-hit', c).forEach(k => k.remove());
    c.classList.remove('sel', 'rel', 'draw');
    const vis = c.querySelector('.vis');
    vis.removeAttribute('mask');
    if (x.arrow) vis.setAttribute('marker-end', EDGE_TYPES[x.type] ? `url(#arrow-t-${x.type})` : 'url(#arrow)'); else vis.removeAttribute('marker-end');
    g.appendChild(c);
  });
  svg.appendChild(g);
  stage.appendChild(svg);
  const ll = layer();
  edges.forEach(x => { const r = EDGE_EL.get(x.id); if (r.lab.style.display !== 'none') { const c = r.lab.cloneNode(true); c.classList.remove('lab-in'); ll.appendChild(c); } });
  const nl = layer();
  shown.forEach((n, i) => {
    const c = NODE_EL.get(n.id).cloneNode(true);
    c.classList.remove('sel', 'hl', 'lifted', 'pop', 'editing', 'drop-target', 'conn-target', 'leaving');
    c.style.transform = `translate(${n.x}px,${n.y}px)`;
    c.style.filter = '';
    c.style.zIndex = e.nodes.indexOf(n) + 1;
    nl.appendChild(c);
  });
  document.body.appendChild(stage);
  try {
    await document.fonts.ready;
    const ratio = Math.min(2, 8000 / Math.max(W, Hh));
    return await lib.toBlob(stage, { pixelRatio: ratio, style: { zIndex: 'auto' }, imagePlaceholder: 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==' });
  } finally { stage.remove(); }
}
/* copy to the clipboard; where that isn't allowed, save the picture as a file instead */
function copyAsPng(ids) {
  const list = [...new Set(ids)];
  const k = list.length;
  toast(k > 1 ? `Making an image of ${k} nodes…` : 'Making an image…');
  const png = nodesPng(list);
  const save = () => png.then(blob => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${(env().name || 'flogic').replace(/[^\w\- ]+/g, '').trim() || 'flogic'}.png`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast('Your browser could not copy images, so it was saved as a file instead');
  }).catch(err => toast(err.message || 'Could not make the image', { type: 'err' }));
  try {
    if (!navigator.clipboard || !window.ClipboardItem) throw new Error('no clipboard');
    navigator.clipboard.write([new ClipboardItem({ 'image/png': png })])
      .then(() => toast(k > 1 ? `Copied ${k} nodes as an image` : 'Copied as an image'), () => png.then(save, err => toast(err.message || 'Could not make the image', { type: 'err' })));
  } catch (_) { save(); }
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
  const pb = bboxOf(added.map(nodeById), true);
  bgPulse(pb.x + pb.w / 2, pb.y + pb.h / 2, null, 0.7, 0.5, true);
}
function duplicateSel() { if (S.sel.size) pasteData(selData(), null); }

/* type, colour, order */
function setType(type) {
  const ns = selNodes();
  if (!ns.length) return;
  endEdit(); checkpoint();
  ns.forEach(n => {
    if (n.type === type) return;
    if (n.w === NODE_W[n.type] || (type === 'shape' && n.w > 360)) n.w = NODE_W[type];
    if (!n.tag || n.tag === NODE_LABEL[n.type]) n.tag = type === 'sub' || type === 'shape' ? '' : NODE_LABEL[type];
    /* a shape node shows only a label: use the first bit of text if there is no title (blocks are kept) */
    if (type === 'shape') {
      if (!SHAPE_RATIO[n.shape]) n.shape = 'rect';
      if (!n.title.trim()) { const b = n.blocks.find(x => x.text && x.text.trim()); if (b) n.title = mdPlain(b.text).trim().slice(0, 60); }
    } else if (n.type === 'shape' || n.shape !== 'rect') delete n.shape;
    if (n.accent === defaultAccent(type)) delete n.accent;
    n.type = type;
    renderNode(n);
  });
  drawEdges(); drawFrames(); renderLayers(); renderInspector(); queueMinimap(); changed();
}
function setColor(c) {
  const ns = selNodes();
  if (!ns.length || !(COLORS[c] || GRADIENTS[c] || isHex(c))) return;
  checkpoint();
  ns.forEach(n => { n.color = c; const el = NODE_EL.get(n.id); if (el) paintNode(el, n); });
  renderLayers(); renderInspector(); queueMinimap(); changed();
}
/* a shape node's shape, another node's corners ('round' default or sharp 'rect'), or the colour style */
function setNodeLook(key, v) {
  const ns = selNodes();
  if (!ns.length) return;
  endEdit(); checkpoint();
  ns.forEach(n => {
    if (key === 'shape') {
      if (isShapeNode(n)) {
        if (!SHAPE_RATIO[v]) return;
        /* a circle is as tall as it is wide, so it starts smaller */
        if (v === 'circle' && n.shape !== 'circle' && n.w === NODE_W.shape) n.w = 144;
        else if (n.shape === 'circle' && v !== 'circle' && n.w === 144) n.w = NODE_W.shape;
        n.shape = v;
        const el = NODE_EL.get(n.id);
        if (el) el.style.width = n.w + 'px';
      }
      else if (v === 'rect') n.shape = 'rect'; else if (v === 'round') delete n.shape;
    } else if (v === defaultAccent(n.type)) delete n.accent; else n.accent = v;
    const el = NODE_EL.get(n.id);
    if (el) paintNode(el, n);
  });
  drawEdges(); drawFrames(); renderInspector(); queueMinimap(); changed();
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
/* kind: 'g' for a group, 'p' for a panel */
function renameFrame(kind, id) {
  const g = kind === 'p' ? panelById(id) : groupById(id), what = kind === 'p' ? 'panel' : 'group';
  if (!g || !S.canEdit) return;
  /* rename right in the Layers list when the row is visible, otherwise in a small pop-up */
  const row = $(`#layers .layer[data-${kind}="${id}"]`);
  if (row) {
    row.scrollIntoView({ block: 'nearest' });
    const span = row.querySelector('.nm'), inp = document.createElement('input');
    inp.className = 'rename'; inp.value = g.name; inp.setAttribute('aria-label', what + ' name');
    span.replaceWith(inp); inp.focus(); inp.select();
    let done = false;
    const finish = ok => {
      if (done) return;
      done = true;
      const v = inp.value.trim();
      if (ok && v && v !== g.name) { checkpoint(); g.name = v; changed(); }
      drawFrames(); renderLayers(); renderInspector();
    };
    inp.addEventListener('keydown', ev => { ev.stopPropagation(); if (ev.key === 'Enter') finish(true); if (ev.key === 'Escape') finish(false); });
    inp.addEventListener('blur', () => finish(true));
    ['pointerdown', 'click', 'dblclick'].forEach(t => inp.addEventListener(t, ev => ev.stopPropagation()));
    return;
  }
  promptModal('Rename ' + what, g.name, v => { checkpoint(); g.name = v; drawFrames(); renderLayers(); renderInspector(); changed(); });
}
/* the group that is exactly the current selection, if any */
function selectedGroup() {
  const ids = [...S.sel], g = ids.length > 1 && groupOf(ids[0]);
  return g && g.members.length === ids.length && ids.every(id => g.members.includes(id)) ? g : null;
}
function groupMenu(g) {
  return [
    { head: g.name },
    { label: 'Rename', icon: 'edit', fn: () => renameFrame('g', g.id) },
    { label: 'Put in a new panel', icon: 'panel', kbd: 'P', fn: () => { selectNodes(g.members); panelFromSel(); } },
    { label: 'Tidy up', icon: 'tidy', fn: () => { selectNodes(g.members); tidySel(); } },
    { label: 'Copy group as image', icon: 'image', fn: () => copyAsPng(g.members) },
    { label: 'Ungroup', icon: 'group', kbd: MOD + '⇧G', fn: () => { selectNodes(g.members); ungroupSel(); } },
    '-',
    { label: 'Delete group and its nodes', icon: 'trash', danger: true, fn: () => { selectNodes(g.members); deleteSel(); } },
  ];
}

/* panels */
function newPanelName() {
  const e = env();
  let k = e.panels.length + 1;
  while (e.panels.some(p => p.name === 'Panel ' + k)) k++;
  return 'Panel ' + k;
}
/* Put nodes into a panel (pid), or take them out of their panel (pid null). Taking only part of a group
   takes those nodes out of the group. With relocate, the nodes also move on the board so they land
   inside the panel (or just outside the one they left) instead of stretching a frame across the board.
   Returns false when nothing changed. The caller makes the checkpoint and calls structureChanged. */
function setPanel(ids, pid, relocate) {
  const e = env(), to = pid ? panelById(pid) : null;
  if (pid && !to) return false;
  const movers = ids.filter(id => nodeById(id) && (panelOf(id) || null) !== to);
  if (!movers.length) return false;
  const ms = new Set(movers);
  e.groups.forEach(g => { if (g.members.some(id => ms.has(id)) && !g.members.every(id => ms.has(id))) g.members = g.members.filter(id => !ms.has(id)); });
  if (relocate) placeNodes(movers, to);
  e.panels.forEach(p => { p.members = p.members.filter(id => !ms.has(id)); });
  if (to) to.members.push(...movers);
  return true;
}
function placeNodes(ids, to) {
  const ns = ids.map(nodeById), mb = bboxOf(ns, true), ms = new Set(ids);
  let dx = 0, dy = 0;
  if (to) {
    const rest = to.members.filter(id => !ms.has(id)).map(nodeById).filter(Boolean);
    if (!rest.length) return;
    const bb = bboxOf(rest, true), cx = mb.x + mb.w / 2, cy = mb.y + mb.h / 2;
    if (cx > bb.x - PANEL_PAD && cx < bb.x + bb.w + PANEL_PAD && cy > bb.y - PANEL_PAD && cy < bb.y + bb.h + PANEL_PAD) return;
    dx = snapV(bb.x - mb.x); dy = snapV(bb.y + bb.h + GAP - mb.y);
  } else {
    const from = panelOf(ids[0]);
    const rest = from ? from.members.filter(id => !ms.has(id)).map(nodeById).filter(Boolean) : [];
    if (!rest.length) return;
    const bb = bboxOf(rest, true), r = { x: bb.x - PANEL_PAD, y: bb.y - PANEL_PAD, w: bb.w + PANEL_PAD * 2, h: bb.h + PANEL_PAD * 2 };
    if (mb.x > r.x + r.w || mb.x + mb.w < r.x || mb.y > r.y + r.h || mb.y + mb.h < r.y) return;
    dx = snapV(r.x + r.w + GAP - mb.x);
  }
  captureDisp(ids);
  ns.forEach(n => { n.x = clamp(n.x + dx, -WORLD, WORLD); n.y = clamp(n.y + dy, -WORLD, WORLD); });
  kick();
}
function moveToPanel(ids, pid) {
  const p = pid ? panelById(pid) : null;
  if (!ids.some(id => nodeById(id) && (panelOf(id) || null) !== p)) return;
  endEdit(); checkpoint();
  setPanel(ids, pid, true);
  structureChanged(); refreshSel();
  toast(p ? `Moved into “${p.name}”${p.folded ? ' (folded)' : ''}` : 'Taken out of the panel');
}
function panelFromSel() {
  const ids = [...S.sel].filter(id => nodeById(id));
  if (!ids.length) return toast('Select one or more nodes to put them in a panel');
  const cur = panelOf(ids[0]);
  if (cur && cur.members.length === ids.length && ids.every(id => cur.members.includes(id))) { selectPanel(cur.id); return toast(`That is already the panel “${cur.name}”`); }
  endEdit(); checkpoint();
  const p = { id: uid('p'), name: newPanelName(), members: [], look: 'dotted' };
  env().panels.push(p);
  PANEL_BORN.add(p.id);
  setPanel(ids, p.id, false);
  structureChanged(); selectPanel(p.id);
}
function unpanel(pid) {
  const e = env(), p = panelById(pid);
  if (!p) return;
  checkpoint();
  e.panels = e.panels.filter(x => x !== p);
  structureChanged(); selectNodes(p.members.filter(id => isShown(nodeById(id))));
  toast(`Removed the panel “${p.name}”`, { actions: [{ label: 'Undo', fn: undo }] });
}
function setPanelLook(pid, look) {
  const p = panelById(pid);
  if (!p || p.look === look || !PANEL_LOOK_IDS.includes(look)) return;
  checkpoint(); p.look = look;
  drawFrames(); drawEdges(); renderInspector(); changed();
}
function setPanelColor(pid, color) {
  const p = panelById(pid);
  if (!p || !COLORS[color]) return;
  checkpoint(); p.color = color;
  drawFrames(); renderLayers(); renderInspector(); queueMinimap(); changed();
}
/* fold a panel into a small box (its nodes are tucked away, lines go to the box) or open it again.
   Visitors can fold and unfold too; for them it is not saved. */
function toggleFold(pid) {
  const p = panelById(pid);
  if (!p) return;
  endEdit();
  if (S.canEdit) checkpoint();
  if (p.folded) delete p.folded; else p.folded = true;
  const el = PANEL_EL.get(pid);
  if (el) { el.classList.add('pf-anim'); clearTimeout(el._ft); el._ft = setTimeout(() => el.classList.remove('pf-anim'), 380); }
  if (p.folded && !selectedPanel()) p.members.forEach(id => S.sel.delete(id));
  if (!p.folded) popIn(p.members.filter(id => isShown(nodeById(id))), true);
  syncNodes(); drawEdges(); drawFrames(); renderLayers(); renderInspector(); queueMinimap();
  if (S.canEdit) changed();
}
function panelMenu(p) {
  return [
    { head: p.name },
    { label: p.folded ? 'Unfold' : 'Fold', icon: 'chevr', fn: () => toggleFold(p.id) },
    { label: 'Rename', icon: 'edit', fn: () => renameFrame('p', p.id) },
    { head: 'Look' },
    ...PANEL_LOOKS.map(([k, name]) => ({ label: name, icon: 'panel', check: p.look === k, fn: () => setPanelLook(p.id, k) })),
    { head: 'Frame colour' },
    { swatches: true, value: p.color || 'slate', fn: c => setPanelColor(p.id, c) },
    '-',
    !p.folded && { label: 'Tidy up', icon: 'tidy', fn: () => { selectPanel(p.id); tidySel(); } },
    { label: 'Copy panel as image', icon: 'image', fn: () => copyAsPng(p.members) },
    { label: 'Remove panel (keep nodes)', icon: 'panel', fn: () => unpanel(p.id) },
    '-',
    { label: 'Delete panel and its nodes', icon: 'trash', danger: true, fn: () => { selectPanel(p.id); deleteSel(); } },
  ];
}
/* "Panel" part of a node's menu: new panel, move into another panel, take out */
function panelMenuItems(ids) {
  const e = env(), cur = ids.map(id => panelOf(id) || null), same = cur.every(p => p === cur[0]) ? cur[0] : undefined;
  const others = e.panels.filter(p => p !== same);
  return [
    { head: 'Panel' },
    { label: 'Put in a new panel', icon: 'panel', kbd: 'P', fn: panelFromSel },
    ...others.slice(0, 10).map(p => ({ label: `Move into “${p.name}”`, icon: 'panel', fn: () => moveToPanel(ids, p.id) })),
    cur.some(Boolean) && { label: 'Take out of panel', icon: 'panel', fn: () => moveToPanel(ids, null) },
  ];
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
  /* two nodes can be linked several times through different sides; only an identical line is refused */
  const same = x => (x.from === from && x.fs === fs && x.to === to && x.ts === ts) || (x.from === to && x.fs === ts && x.to === from && x.ts === fs);
  if (e.edges.some(same)) { toast('Those sides are already connected'); return false; }
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
  const lab = r.labTx;            /* only the text part; the type badge beside it stays as it is */
  lab.setAttribute('contenteditable', PLAIN);
  r.lab.style.display = '';
  r.lab.classList.remove('empty', 'notext');
  lab.textContent = ed.label;
  drawEdges();
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
const FIRST_FIELD = { text: 'text', highlight: 'text', category: 'text', conclusion: 'text', scenarios: 'items.0.title', checklist: 'items.0.text', quote: 'text', math: 'tex', chem: 'tex' };
function landed(n, i) {
  const el = NODE_EL.get(n.id), b = el && el.querySelector(`.blk[data-i="${i}"]`);
  if (b) { b.classList.remove('landed'); void b.offsetWidth; b.classList.add('landed'); }
}
function addBlock(n, kind, idx) {
  endEdit(); checkpoint();
  const b = makeBlock(kind);
  /* in a shape node an icon goes above the label, everything else below it */
  if (isShapeNode(n) && (kind === 'icon' || (idx != null && n.blocks[idx] && n.blocks[idx].above))) b.above = true;
  if (idx == null) n.blocks.push(b); else n.blocks.splice(idx, 0, b);
  if (kind === 'scenarios') S.open[b.items[0].id] = true;
  renderNode(n); changed(); renderLayers();
  const i = n.blocks.indexOf(b);
  landed(n, i);
  const ne = NODE_EL.get(n.id);
  editPulse(n, ne && ne.querySelector(`.blk[data-i="${i}"]`));
  if (FIRST_FIELD[kind]) editField(n.id, `blocks.${i}.${FIRST_FIELD[kind]}`);
  if (kind === 'sources') openSourceForm(n.id, i);
  if (kind === 'icon') openIconPicker(n.id, b.id);
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
  f.innerHTML = `<input class="sf-u" placeholder="https://…" autocomplete="off" spellcheck="false"><input class="sf-t" placeholder="Title (optional)" autocomplete="off"><textarea class="sf-n" rows="2" placeholder="What it explains or why it matters (optional)"></textarea><div class="sf-row"><span class="err"></span><button class="btn sm" data-sf="cancel">Cancel</button><button class="btn sm primary" data-sf="ok">Add</button></div>`;
  add.replaceWith(f);
  const u = f.querySelector('.sf-u'), t = f.querySelector('.sf-t'), nt = f.querySelector('.sf-n'), er = f.querySelector('.err');
  u.focus();
  const ok = () => {
    const url = safeUrl(u.value);
    if (!url) { er.textContent = 'Enter a valid http(s) link'; u.focus(); return; }
    checkpoint();
    n.blocks[bi].items.push({ id: uid('r'), t: t.value.trim(), u: url, note: nt.value.trim() });
    renderNode(n); changed();
  };
  f.addEventListener('click', e => { e.stopPropagation(); const b = e.target.closest('[data-sf]'); if (b) b.dataset.sf === 'ok' ? ok() : renderNode(n); });
  f.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Enter' && (e.target !== nt || e.ctrlKey || e.metaKey)) { e.preventDefault(); ok(); }
    if (e.key === 'Escape') renderNode(n);
  });
}

nodesWrap.addEventListener('click', e => {
  const nl = e.target.closest('a.nlink');
  if (nl) { e.preventDefault(); e.stopPropagation(); goToNode(nl.dataset.node); return; }
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
  if (act === 'toggle-src') {
    const it = a.closest('.src-it'), k = 's:' + it.dataset.sk;
    S.open[k] = !S.open[k];
    it.classList.toggle('open', S.open[k]);
    a.title = S.open[k] ? 'Hide details' : 'Show details';
    return;
  }
  if (act === 'toggle-fold') {
    /* the owner's choice is saved with the board; visitors only fold it for themselves */
    const box = a.closest('.b-cat'), closed = !box.classList.contains('closed');
    if (S.canEdit) { endEdit(); b.closed = closed; if (!closed) delete b.closed; delete S.open['f:' + b.id]; changed(); }
    else S.open['f:' + b.id] = closed;
    box.classList.toggle('closed', closed);
    const btn = box.querySelector('.cat-h .chev');
    if (btn) btn.title = closed ? 'Open' : 'Close';
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
    case 'pick-icon': openIconPicker(n.id, b.id); break;
    case 'edit-tex': if (S.canEdit) editField(n.id, `blocks.${bi}.tex`); break;
    case 'icon-size': if (b.size !== a.dataset.v) mut(() => { b.size = a.dataset.v; }); break;
  }
});
nodesWrap.addEventListener('dblclick', e => {
  e.stopPropagation();
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
/* ===================== icons =====================
   The owner's icons are uploaded once and saved with the board (DOC.icons), so every node in every
   environment can use them. Like images, they become files in data/assets/ when published. */
async function iconDataUrl(file) {
  let raw = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
  /* some systems give .svg files no type */
  if (/\.svg$/i.test(file.name) && !raw.startsWith('data:image/svg+xml')) raw = 'data:image/svg+xml;base64,' + raw.split(',')[1];
  if (/svg|gif/.test(file.type) || /\.svg$/i.test(file.name)) return raw;
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = raw; });
    const s = Math.min(1, 256 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    const out = c.toDataURL('image/png');
    return out.length < raw.length ? out : raw;
  } catch (e) { return raw; }
}
function openIconPicker(nodeId, blockId) {
  if (!S.canEdit) return;
  const block = () => { const n = nodeById(nodeId); return n && n.blocks.find(x => x.id === blockId); };
  const cur = (block() || {}).icon;
  const m = openModal(`<div class="mhead"><h3>Choose an icon</h3><button class="icon-btn" data-close aria-label="Close">${ic('x', 16)}</button></div>
    <div class="mbody ipick">
      <div class="ip-head"><b>Your icons</b><button class="btn sm" id="ip-up">${ic('upload', 13)} Upload icons…</button></div>
      <div class="ipgrid" id="ip-mine"></div>
      <div class="ip-head"><b>Built-in</b><small>drawn in the node's colour</small></div>
      <div class="ipgrid">${BUILTIN_ICONS.filter(k => ICONS[k]).map(k => `<button class="ipi${cur === 'b:' + k ? ' on' : ''}" data-icon="b:${k}" title="${k}">${ic(k, 22)}</button>`).join('')}</div>
    </div>`);
  const mine = $('#ip-mine', m.el);
  const draw = () => {
    const list = DOC.icons || [];
    mine.innerHTML = list.length
      ? list.map(x => `<button class="ipi${cur === 'u:' + x.id ? ' on' : ''}" data-icon="u:${x.id}" title="${esc(x.name)} · right-click to remove"><img src="${esc(imgSrc(x.src))}" alt="${esc(x.name)}"></button>`).join('')
      : '<div class="ip-empty">Upload PNG or SVG icons you made. They are saved with your board, so you can use them in any node and any environment.</div>';
  };
  draw();
  m.el.addEventListener('click', e => {
    const b = e.target.closest('[data-icon]');
    if (!b) return;
    const bl = block();
    m.close();
    if (!bl || bl.icon === b.dataset.icon) return;
    checkpoint(); bl.icon = b.dataset.icon; renderNode(nodeById(nodeId)); changed();
  });
  /* right-click one of your icons to remove it from the set */
  mine.addEventListener('contextmenu', e => {
    const b = e.target.closest('[data-icon]');
    if (!b) return;
    e.preventDefault();
    const id = b.dataset.icon.slice(2), x = DOC.icons.find(q => q.id === id);
    const used = DOC.envs.reduce((k, en) => k + en.nodes.reduce((j, n) => j + n.blocks.filter(bb => bb.icon === 'u:' + id).length, 0), 0);
    openMenu(e.clientX, e.clientY, [
      { head: x.name },
      { label: used ? `Remove (used ${used} time${used > 1 ? 's' : ''})` : 'Remove from your icons', icon: 'trash', danger: true, fn: () => {
        checkpoint(); DOC.icons = DOC.icons.filter(q => q.id !== id); changed(); draw();
        DOC.envs.forEach(en => en.nodes.forEach(n => { if (en === env() && n.blocks.some(bb => bb.icon === 'u:' + id)) renderNode(n); }));
      } },
    ]);
  });
  $('#ip-up', m.el).addEventListener('click', () => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/*,.svg'; inp.multiple = true;
    inp.addEventListener('change', async () => {
      const files = Array.from(inp.files || []).filter(f => f.type.startsWith('image/') || /\.svg$/i.test(f.name));
      if (!files.length) return;
      checkpoint();
      for (const f of files) {
        const src = await iconDataUrl(f);
        (DOC.icons = DOC.icons || []).push({ id: uid('ic'), name: f.name.replace(/\.[^.]+$/, '').slice(0, 40) || 'Icon', src });
      }
      changed(); draw();
      toast(`Added ${files.length} icon${files.length > 1 ? 's' : ''} to your set`);
    });
    inp.click();
  });
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
  /* Flogic text (from Copy text for AI, or an AI's reply): open the import window */
  if (/<!--\s*node\b/i.test(text) || /FLOGIC FORMAT INSTRUCTIONS/.test(text)) { e.preventDefault(); openImport(text, { at, scope: [...S.sel] }); return; }
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
window.addEventListener('pointercancel', e => { if (e.pointerType === 'touch') onUp(e); else abortGestures(); });

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
  if (t.closest('.sug-flag, .sug-bubble')) return;   /* suggestion markers handle their own clicks */
  const ae = document.activeElement;
  if (ae && ae !== document.body && !t.closest('input, .src-form') && ae.blur) ae.blur();
  const ne = t.closest('.node');
  const pport = S.canEdit && t.closest('.pport');
  if (pport) { e.preventDefault(); startConnect(e, pport.dataset.p, pport.dataset.side); return; }
  const pfold = t.closest('[data-pfold]');
  if (pfold) { e.preventDefault(); toggleFold(pfold.dataset.pfold); return; }
  if (S.canEdit && ne) {
    const port = t.closest('.port');
    if (port) { e.preventDefault(); startConnect(e, ne.dataset.id, port.dataset.side); return; }
    const grip = t.closest('.grip');
    if (grip) { e.preventDefault(); startBlockDrag(e, grip.closest('.blk'), ne); return; }
    if (t.closest('.rz')) { e.preventDefault(); startResize(e, ne.dataset.id); return; }
  }
  /* a panel's name tag or its thick edge: select the panel and drag it */
  const pe = t.closest('.plabel, .pedge');
  if (pe) {
    const p = panelById(pe.dataset.p);
    if (!p) return;
    if (e.shiftKey) { p.members.forEach(id => S.sel.add(id)); S.edgeSel = null; refreshSel(); return; }
    selectPanel(p.id);
    if (S.canEdit && S.sel.size) { startDrag(e, [...S.sel][0], false); if (DRAG) DRAG.panel = p.id; } else startPan(e);
    return;
  }
  const eg = t.closest('[data-e]');
  if (eg) {
    selectEdge(eg.dataset.e);
    if (!S.canEdit) return;
    /* the middle dot (or a line's label) bends the line; anywhere else on the line pulls it off to disconnect */
    if (t.closest('.bend, .bend-hit') || (eg.classList.contains('elabel') && !eg.querySelector('[contenteditable]'))) BEND = { id: eg.dataset.e, sx: e.clientX, sy: e.clientY, moved: false };
    else EG = { id: eg.dataset.e, sx: e.clientX, sy: e.clientY };
    return;
  }
  if (ne) {
    const id = ne.dataset.id;
    if (t.closest('button, a, input, textarea, select, [data-act], .src-form')) { if (!S.sel.has(id)) selectNodes(groupOrNode(id)); return; }
    if (!S.canEdit) {
      /* visitors can select several nodes with Shift (to copy them as text or an image) */
      if (e.shiftKey) { if (S.sel.has(id)) S.sel.delete(id); else groupOrNode(id).forEach(x => S.sel.add(x)); S.edgeSel = null; refreshSel(); }
      else if (!S.sel.has(id)) selectNodes(groupOrNode(id));
      if (t.closest('.ed')) return;   /* visitors can select and copy text; drag the node's edge or the board to pan */
      startPan(e); return;
    }
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
  /* empty board: drag to box-select (visitors too); on touch screens, drag to pan */
  if (e.pointerType === 'touch') { if (!e.shiftKey) clearSel(); startPan(e); return; }
  startMarquee(e);
}
function onMove(e) {
  PTR = { x: e.clientX, y: e.clientY };
  if (e.pointerType === 'mouse' && e.buttons === 0 && (CONN || DRAG || BD || MQ || RZ || TB || EG || BEND || (PAN && PAN.moved))) { abortGestures(); return; }
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
  if (BEND) return moveBend(e);
}
function onUp(e) {
  if (e.pointerType === 'touch') {
    TOUCH.delete(e.pointerId);
    if (PINCH) { if (TOUCH.size < 2) PINCH = null; return; }
  }
  EG = null;
  if (BEND) endBend();
  if (PAN) { PAN = null; document.body.classList.remove('panning'); }
  if (DRAG) endDrag();
  if (MQ) endMarquee();
  if (CONN) endConnect(e);
  if (BD) endBlockDrag(e);
  if (RZ) endResize();
  if (TB) endTB(e);
}
/* Alt-tab, a lost pointer or a button released outside the window would otherwise leave a gesture
   hanging (e.g. a half-drawn connection that follows the mouse). End everything cleanly instead. */
function abortGestures() {
  EG = null;
  if (BEND) endBend();
  if (CONN) cancelConnect();
  if (DRAG) endDrag(true);
  if (BD) { BD.target = null; endBlockDrag({}); }
  if (MQ) endMarquee();
  if (RZ) endResize();
  if (TB) { if (TB.ghost) TB.ghost.remove(); TB = null; }
  if (PAN) { PAN = null; document.body.classList.remove('panning'); }
  PINCH = null; TOUCH.clear();
}
window.addEventListener('blur', abortGestures);
document.addEventListener('visibilitychange', () => { if (document.hidden) abortGestures(); });
vp.addEventListener('lostpointercapture', e => { if (e.pointerType === 'mouse' && e.buttons === 0 && (CONN || BD || DRAG || MQ || RZ)) abortGestures(); });
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
    field: e.target && e.target.closest ? e.target.closest('[data-f]') : null,
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
    /* Dragging some (not all) of a panel's nodes can pull them out of it: the frame stays put while they
       move and they leave if dropped outside. Dropping nodes onto another panel puts them in it.
       A whole panel being moved never changes what is in it. */
    d.whole = new Set();
    if (!d.panel) {
      for (const p of env().panels) {
        const ms = p.members.filter(id => isShown(nodeById(id)));
        if (!ms.some(id => d.set.has(id))) continue;
        if (ms.every(id => d.set.has(id))) d.whole.add(p.id);
        else ms.forEach(id => { if (d.set.has(id)) PANEL_FREE.add(id); });
      }
    }
  }
  if (!d.panel) {
    const w = toWorld(e.clientX, e.clientY);
    let best = null, ba = Infinity;
    for (const p of env().panels) {
      if (p.folded || d.whole.has(p.id)) continue;
      const r = panelRect(p);
      if (r && w.x > r.x && w.x < r.x + r.w && w.y > r.y && w.y < r.y + r.h && r.w * r.h < ba) { ba = r.w * r.h; best = p.id; }
    }
    PANEL_DROP = best;
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
function endDrag(aborted) {
  const d = DRAG;
  DRAG = null;
  if (!d.moved) {
    if (aborted) return;
    if (d.narrow && S.sel.size > 1) selectNodes([d.lead]);
    /* clicking the text of a node that was already selected starts editing right there */
    else if (d.narrow && d.field && d.field.isConnected) startEdit(d.field, d.sx, d.sy);
    return;
  }
  document.body.classList.remove('dragging-nodes');
  drawGuides([]);
  d.ids.forEach(id => { const el = NODE_EL.get(id); if (el) el.style.filter = ''; });
  /* into the panel under the pointer, or out of the panel they were pulled from */
  const target = PANEL_DROP, free = [...PANEL_FREE];
  PANEL_DROP = null; PANEL_FREE.clear();
  let moved = false;
  if (!aborted && !d.panel) {
    if (target) moved = setPanel(d.ids.filter(id => !d.whole.has((panelOf(id) || {}).id)), target, false);
    else if (free.length) moved = setPanel(free, null, false);
  }
  syncZ();
  if (!aborted) { const db = bboxOf(d.ids.map(nodeById).filter(Boolean), true), ln = nodeById(d.lead); if (db) bgPulse(db.x + db.w / 2, db.y + db.h / 2, ln && colorOf(ln.color).c1, 0.22, 0.45); }
  if (moved) {
    structureChanged(); refreshSel();
    const p = target && panelById(target);
    toast(p ? `Moved into “${p.name}”` : 'Taken out of the panel', { actions: [{ label: 'Undo', fn: undo }] });
  } else { changed(); renderInspector(); drawFrames(); }
  kick();
}
/* Snap a moving rect to neighbours (edges, centres, preferred gap) or else to the grid. */
function snapRect(r, ex) {
  const thr = 8 / V.z, others = [];
  for (const n of env().nodes) {
    if (ex.has(n.id) || !isShown(n)) continue;
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
  for (const n of env().nodes) { if (!isShown(n)) continue; const r = rectOf(n, true); if (r.x < b.x && r.x + r.w > a.x && r.y < b.y && r.y + r.h > a.y) S.sel.add(n.id); }
  refreshSel(true);
}
function endMarquee() { $('#marquee').style.display = 'none'; const m = MQ; MQ = null; if (m.moved) refreshSel(); }

/* connect */
function startConnect(e, id, side) {
  CONN = { from: id, side, target: null, key: '' };
  capture(e);
  document.body.classList.add('connecting');
  if (panelById(id)) { if (!selectedPanel() || S.panelSel !== id) selectPanel(id); } else if (!S.sel.has(id)) selectNodes([id]);
  moveConnect(e);
}
/* Grab an existing connection and pull: the end nearer the cursor comes loose and follows it.
   Drop it on a node to reconnect, or anywhere else to remove the connection. */
function moveEdgeGrab(e) {
  if (Math.hypot(e.clientX - EG.sx, e.clientY - EG.sy) < 6) return;
  const ed = env().edges.find(x => x.id === EG.id);
  EG = null;
  if (!ed) return;
  if (!endRect(ed.from) || !endRect(ed.to)) return;
  const drawn = EDGE_EL.get(ed.id) || {};
  const s1 = drawn.s1 || ed.fs, s2 = drawn.s2 || ed.ts;
  const w = toWorld(e.clientX, e.clientY), pa = drawn.p1 || endPort(ed.from, s1), pb = drawn.p2 || endPort(ed.to, s2);
  const loseFrom = Math.hypot(pa.x - w.x, pa.y - w.y) < Math.hypot(pb.x - w.x, pb.y - w.y);
  checkpoint();
  env().edges = env().edges.filter(x => x !== ed);
  S.edgeSel = null;
  CONN = {
    from: loseFrom ? ed.to : ed.from, side: loseFrom ? s2 : s1, target: null, key: '',
    detached: { reverse: loseFrom, label: ed.label, arrow: ed.arrow, dashed: ed.dashed, style: ed.style, bend: ed.bend, edge: ed },
  };
  capture(e);
  document.body.classList.add('connecting');
  drawEdges(); renderInspector();
  moveConnect(e);
}
/* bend a line by dragging its middle dot; the dot snaps to the grid unless Ctrl is held */
function moveBend(e) {
  const b = BEND, ed = env().edges.find(x => x.id === b.id), r = EDGE_EL.get(b.id);
  if (!ed || !r || !r.p1) { BEND = null; return; }
  if (!b.moved) {
    if (Math.hypot(e.clientX - b.sx, e.clientY - b.sy) < 3) return;
    b.moved = true; capture(e); checkpoint();
    document.body.classList.add('bending');
  }
  const w = toWorld(e.clientX, e.clientY);
  if (!(e.ctrlKey || e.metaKey)) { w.x = snapV(w.x); w.y = snapV(w.y); }
  ed.bend = { dx: Math.round(w.x - (r.p1.x + r.p2.x) / 2), dy: Math.round(w.y - (r.p1.y + r.p2.y) / 2) };
  drawEdges();
}
function endBend() {
  const b = BEND;
  BEND = null;
  document.body.classList.remove('bending');
  if (b && b.moved) { changed(); renderInspector(); }
}
function resetBend(id) {
  const ed = env().edges.find(x => x.id === id);
  if (!ed || !ed.bend) return;
  checkpoint(); delete ed.bend;
  drawEdges(); renderInspector(); changed();
}
function clearConnHL() { $$('.port.magnet').forEach(p => p.classList.remove('magnet')); $$('.conn-target').forEach(x => x.classList.remove('conn-target')); }
/* the board element that represents a connection end (a node, or a group's frame) */
function endEl(id) { return NODE_EL.get(id) || PANEL_EL.get(id); }
function moveConnect(e) {
  const w = toWorld(e.clientX, e.clientY), p0 = endPort(CONN.from, CONN.side);
  if (!p0) return;
  /* everything that can be connected to: visible nodes and panels */
  const ends = env().nodes.filter(isShown).map(n => n.id).concat(env().panels.map(p => p.id)).filter(id => id !== CONN.from);
  let best = null, bd = 48 / V.z;
  for (const id of ends) {
    for (const s of SIDES) { const p = endPort(id, s); if (!p) continue; const d = Math.hypot(p.x - w.x, p.y - w.y); if (d < bd) { bd = d; best = { id, side: s, p }; } }
  }
  if (!best) {
    const hit = document.elementFromPoint(e.clientX, e.clientY), ne = hit && hit.closest && (hit.closest('.node') || hit.closest('.pframe'));
    const id = ne && (ne.dataset.id || ne.dataset.pid);
    if (id && id !== CONN.from) {
      let dd = Infinity;
      for (const s of SIDES) { const p = endPort(id, s); if (!p) continue; const d = Math.hypot(p.x - w.x, p.y - w.y); if (d < dd) { dd = d; best = { id, side: s, p }; } }
    }
  }
  const from = p0, fromSide = CONN.side, to = best ? best.p : w, toSide = best ? best.side : facingSide(p0, w);
  const key = best ? best.id + best.side : '';
  if (CONN.key !== key) {
    clearConnHL();
    const el = best && endEl(best.id);
    if (el) { el.classList.add('conn-target'); const p = el.querySelector(':scope > .ports > .p-' + best.side + ', :scope > .p-' + best.side); if (p) p.classList.add('magnet'); }
    CONN.key = key;
  }
  CONN.target = best;
  connPreview.setAttribute('d', bez(from, fromSide, to, toSide, CONN.detached && CONN.detached.style).d);
}
/* Abandon a half-made connection (window lost focus, pointer vanished…). A line pulled off an
   existing connection goes back where it was. */
function cancelConnect() {
  const c = CONN;
  if (!c) return;
  CONN = null;
  document.body.classList.remove('connecting');
  clearConnHL();
  connPreview.setAttribute('d', '');
  if (c.detached) { env().edges.push(c.detached.edge); H.undo.pop(); drawEdges(); }
}
function endConnect(e) {
  const c = CONN;
  CONN = null;
  document.body.classList.remove('connecting');
  clearConnHL();
  const d = c.detached, pd = connPreview.getAttribute('d');
  if (c.target) {
    connPreview.setAttribute('d', '');
    if (!d) checkpoint();
    const ok = d && d.reverse ? addEdge(c.target.id, c.target.side, c.from, c.side) : addEdge(c.from, c.side, c.target.id, c.target.side);
    if (ok && d) { const es = env().edges, ne = es[es.length - 1]; Object.assign(ne, { label: d.label, arrow: d.arrow, dashed: d.dashed }); if (d.style) ne.style = d.style; if (d.bend) ne.bend = d.bend; }
    if (ok || d) { drawEdges(); renderInspector(); changed(); }
    if (ok) { const es = env().edges; chargeEdge(es[es.length - 1].id); }
    if (!ok && d) { fxEdgeBreak(pd, null); toast('Connection removed', { actions: [{ label: 'Undo', fn: undo }] }); }
    return;
  }
  if (d) {
    connPreview.setAttribute('d', '');
    fxEdgeBreak(pd, null);   // a line pulled off and dropped on nothing breaks apart where it was let go
    drawEdges(); renderInspector(); changed();
    toast('Connection removed', { actions: [{ label: 'Undo', fn: undo }] });
    return;
  }
  /* let go over nothing: no connection */
  connPreview.setAttribute('d', '');
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
  const tnode = tn && nodeById(tn.dataset.id);
  /* shape nodes only take icons, images and text */
  if (tnode && isShapeNode(tnode) && !SHAPE_KINDS.includes(d.b.kind)) {
    d.target = null;
    d.ghost.classList.remove('to-canvas');
  } else if (tn) {
    const blocks = $$(':scope > .blocks > .blk', tn), cont = tn.querySelector(':scope > .blocks');
    let k = blocks.length;
    for (let i = 0; i < blocks.length; i++) { const r = blocks[i].getBoundingClientRect(); if (e.clientY < r.top + r.height / 2) { k = i; break; } }
    /* shown blocks map to positions in the node's list (a shape node may keep some blocks hidden) */
    const idx = k < blocks.length ? +blocks[k].dataset.i : blocks.length ? +blocks[blocks.length - 1].dataset.i + 1 : tnode.blocks.length;
    /* in a shape node, dropping above the label puts the block above it */
    let above = false;
    if (isShapeNode(tnode)) {
      const lab = tn.querySelector('.sn-title'), lr = lab && lab.getBoundingClientRect();
      above = lr && lr.height ? e.clientY < lr.top + lr.height / 2 : k < blocks.length && !!tnode.blocks[idx].above;
    }
    d.target = { n: tnode, idx, above };
    tn.classList.add('drop-target');
    const cr = cont.getBoundingClientRect(), gap = parseFloat(getComputedStyle(cont).rowGap) || 12;
    let y;
    if (!blocks.length) y = 0;
    else if (k < blocks.length) y = (blocks[k].getBoundingClientRect().top - cr.top) / V.z - gap / 2;
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
  const tn = d.target.n, above = !!d.target.above;
  let to = d.target.idx;
  if (tn === d.n) { if ((to === d.bi || to === d.bi + 1) && above === !!d.b.above) return; if (to > d.bi) to--; }
  checkpoint();
  if (above) d.b.above = true; else delete d.b.above;
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
  n.w = clamp(Math.round(w), n.type === 'shape' ? 96 : 168, 1200);
  const el = NODE_EL.get(n.id);
  el.style.width = n.w + 'px';
  if (n.type === 'shape') paintNode(el, n);
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
    g.style.height = (TB.type === 'sub' ? 84 : TB.type === 'title' ? 130 : TB.type === 'shape' ? 90 : 120) + 'px';
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
    const vn = t.closest('.node'), field = t.closest('.ed'), vsel = viewerSelection();
    if (vn && !S.sel.has(vn.dataset.id)) selectNodes(groupOrNode(vn.dataset.id));
    /* a suggestion points at the selected text if there is some, else at the node, else at this spot */
    const target = vsel && vsel.node ? { node: vsel.node, f: vsel.f, q: vsel.q }
      : vn ? { node: vn.dataset.id, f: field ? field.dataset.f : '', q: '' }
      : { x: w.x, y: w.y };
    openMenu(x, y, [
      vsel && { label: 'Copy', icon: 'copy', kbd: MOD + 'C', fn: () => copyPlain(vsel.text) },
      vn && { label: S.sel.size > 1 ? `Copy text of ${S.sel.size} nodes` : 'Copy node as Markdown', icon: 'text2', fn: copyText },
      (vn || S.sel.size > 0) && { label: S.sel.size > 1 ? `Copy ${S.sel.size} nodes as image` : 'Copy as image', icon: 'image', fn: () => copyAsPng([...S.sel]) },
      '-',
      target.node
        ? { label: vsel && vsel.node ? 'Suggest a change to this text…' : 'Suggest a change…', icon: 'warn', fn: () => openSuggestForm(target) }
        : { label: 'Suggest an idea here…', icon: 'bubble', fn: () => openSuggestForm(target) },
      '-',
      { label: 'Fit to screen', icon: 'fit', kbd: '⇧1', fn: () => fitAll() },
      { label: 'Copy link', icon: 'link', fn: share },
    ]);
    return;
  }
  /* right-click while typing: format the selected text */
  if (S.editing && S.editing.el.contains(t)) {
    const sel = editSelection();
    openMenu(x, y, [{ head: 'Format' }, fmtRow(!!S.editing.el.dataset.single)], { onClick: fmtClick(() => (S.editing ? sel : null)) });
    return;
  }
  endEdit();
  const eg = t.closest('[data-e]');
  if (eg) { selectEdge(eg.dataset.e); openMenu(x, y, edgeMenu(eg.dataset.e), edgeMenuOpts(eg.dataset.e)); return; }
  const pe = t.closest('.plabel, .pedge');
  if (pe) {
    const p = panelById(pe.dataset.p);
    if (!p) return;
    selectPanel(p.id);
    openMenu(x, y, panelMenu(p));
    return;
  }
  const ne = t.closest('.node');
  if (ne) {
    const id = ne.dataset.id, n = nodeById(id), blk = t.closest('.blk'), field = t.closest('[data-f]');
    if (!S.sel.has(id)) selectNodes(groupOrNode(id));
    const items = blk && S.sel.size <= 1 ? blockMenu(n, +blk.dataset.i, x, y) : nodeMenu(x, y);
    if (field && S.sel.size <= 1) {
      /* right-clicked a word: offer formatting for it on top of the usual menu */
      const prep = () => { if (!S.editing || S.editing.el !== field) startEdit(field, x, y); return S.editing ? editSelection() : null; };
      openMenu(x, y, [{ head: 'Format this word' }, fmtRow(!!field.dataset.single), '-', ...items], { onClick: fmtClick(prep) });
      return;
    }
    openMenu(x, y, items);
    return;
  }
  clearSel();
  openMenu(x, y, [
    { head: 'Add here' },
    { label: 'Title node', icon: 'title', kbd: 'T', fn: () => createNode('title', w.x, w.y) },
    { label: 'Note', icon: 'note', kbd: 'N', fn: () => createNode('note', w.x, w.y) },
    { label: 'Sub-note', icon: 'sub', kbd: 'S', fn: () => createNode('sub', w.x, w.y) },
    { label: 'Shape', icon: 'shape', kbd: 'D', fn: () => createNode('shape', w.x, w.y) },
    '-',
    { label: 'Paste', icon: 'copy', kbd: MOD + 'V', disabled: !CLIP, fn: () => pasteData(CLIP, w) },
    { label: 'Import text from clipboard', icon: 'upload', kbd: MOD + '⇧V', fn: () => importFromClipboard({ at: w }) },
    { label: 'Import text from a file…', icon: 'folderopen', fn: () => importFromFile({ at: w }) },
    { label: 'Copy all as text for AI', icon: 'bulb', disabled: !env().nodes.length, fn: () => copyTextForAI(env().nodes.filter(n => !n.hidden).map(n => n.id)) },
    '-',
    { label: 'Select all', icon: 'cursor', kbd: MOD + 'A', disabled: !env().nodes.length, fn: () => selectNodes(env().nodes.filter(isShown).map(n => n.id)) },
    { label: 'Tidy up everything', icon: 'tidy', disabled: env().nodes.length < 2, fn: () => { S.sel.clear(); tidySel(); } },
    { label: 'Fit to screen', icon: 'fit', kbd: '⇧1', fn: () => fitAll() },
  ], { keys: { t: 1, n: 2, s: 3, d: 4 } });
});
/* kept short (everything else is in the right-hand panel): edit, copy, import, arrange, delete */
function nodeMenu(x, y) {
  const ns = selNodes(), multi = ns.length > 1, n = ns[0];
  const inGroup = ns.some(m => groupOf(m.id)), inPanel = ns.some(m => panelOf(m.id));
  return [
    !multi && { label: isShapeNode(n) ? 'Add icon, image or text…' : 'Add block…', icon: 'plus', fn: () => openBlockMenu({ x, y }, n) },
    !multi && { label: isShapeNode(n) ? 'Edit label' : 'Edit title', icon: 'edit', kbd: '↵', fn: () => editField(n.id, 'title', true) },
    { label: 'Duplicate', icon: 'copy', kbd: MOD + 'D', fn: duplicateSel },
    { label: 'Copy', icon: 'copy', kbd: MOD + 'C', fn: () => copySel() },
    { label: multi ? `Copy text of ${ns.length} nodes` : 'Copy text', icon: 'text2', kbd: MOD + '⌥C', fn: copyText },
    { label: 'Copy text for AI', icon: 'bulb', fn: () => copyTextForAI(ns.map(m => m.id)) },
    { label: multi ? `Copy ${ns.length} nodes as image` : 'Copy as image', icon: 'image', fn: () => copyAsPng(ns.map(m => m.id)) },
    '-',
    { label: 'Import text from clipboard', icon: 'upload', kbd: MOD + '⇧V', fn: () => importFromClipboard({ scope: ns.map(m => m.id) }) },
    { label: 'Import text from a file…', icon: 'folderopen', fn: () => importFromFile({ scope: ns.map(m => m.id) }) },
    '-',
    multi && { label: 'Group', icon: 'group', kbd: MOD + 'G', fn: groupSel },
    { label: 'Put in a panel', icon: 'panel', kbd: 'P', fn: panelFromSel },
    inGroup && { label: 'Ungroup', icon: 'group', kbd: MOD + '⇧G', fn: ungroupSel },
    multi && { label: 'Tidy up', icon: 'tidy', fn: tidySel },
    inPanel && { label: 'Take out of panel', icon: 'panel', fn: () => moveToPanel(ns.map(m => m.id), null) },
    { label: 'Hide', icon: 'eyeoff', kbd: MOD + '⇧H', fn: () => toggleHidden(ns.map(m => m.id)) },
    { label: 'Bring forward', icon: 'front', kbd: MOD + ']', fn: () => stepZ(1) },
    { label: 'Send backward', icon: 'back', kbd: MOD + '[', fn: () => stepZ(-1) },
    '-',
    { label: multi ? `Delete ${ns.length} nodes` : 'Delete', icon: 'trash', kbd: 'Del', danger: true, fn: deleteSel },
  ];
}function blockMenu(n, i, x, y) {
  const b = n.blocks[i], shape = isShapeNode(n);
  const set = fn => () => { endEdit(); checkpoint(); fn(); renderNode(n); changed(); };
  return [
    { head: BLOCKS.find(k => k[0] === b.kind)[1] + ' block' },
    b.kind === 'icon' && { label: 'Change icon…', icon: 'shape', fn: () => openIconPicker(n.id, b.id) },
    ...(b.kind === 'icon' ? [['s', 'Small'], ['m', 'Medium'], ['l', 'Large']].map(([k, name]) => ({ label: name + ' icon', icon: 'image', check: (b.size || 'm') === k, fn: set(() => { b.size = k; }) })) : []),
    shape && { label: b.above ? 'Put below the label' : 'Put above the label', icon: 'swap', fn: set(() => { if (b.above) delete b.above; else b.above = true; }) },
    b.kind === 'icon' || shape ? '-' : null,
    { label: shape ? 'Insert above…' : 'Insert block above…', icon: 'plus', fn: () => openBlockMenu({ x, y }, n, i) },
    { label: 'Duplicate block', icon: 'copy', fn: () => duplicateBlock(n, i) },
    { label: 'Move up', icon: 'chev', disabled: i === 0, fn: () => moveBlock(n, i, i - 1) },
    { label: 'Move down', icon: 'chev', disabled: i === n.blocks.length - 1, fn: () => moveBlock(n, i, i + 1) },
    { label: 'Pull out into a sub-note', icon: 'sub', fn: () => extractBlock(n, i) },
    '-',
    { label: 'Node options…', icon: 'note', fn: () => openMenu(x, y, nodeMenu(x, y)) },
    { label: 'Delete block', icon: 'trash', danger: true, fn: () => { endEdit(); checkpoint(); n.blocks.splice(i, 1); renderNode(n); changed(); } },
  ];
}
function setEdgeType(id, type) {
  const ed = env().edges.find(x => x.id === id);
  if (!ed || (ed.type || '') === (type || '')) return;
  checkpoint();
  if (EDGE_TYPES[type]) ed.type = type; else delete ed.type;
  drawEdges(); renderInspector(); changed();
}
/* clicks on the type grid inside the line's menu */
const edgeMenuOpts = id => ({
  cls: 'emenu',
  onClick: e => { const b = e.target.closest('[data-etype]'); if (b) { closeMenu(); setEdgeType(id, b.dataset.etype); } return false; },
});
function edgeMenu(id) {
  const ed = env().edges.find(x => x.id === id);
  const st = lineStyle(ed);
  return [
    { head: 'Line style' },
    ...LINE_STYLES.map(([k, name]) => ({ label: name, icon: LINE_ICON[k], check: st === k, fn: () => edgeSet(id, { style: k }) })),
    '-',
    { label: 'Arrow', icon: 'arrowr', check: ed.arrow, fn: () => edgeSet(id, { arrow: !ed.arrow }) },
    { label: 'Dashed', icon: 'dash', check: ed.dashed, fn: () => edgeSet(id, { dashed: !ed.dashed }) },
    { head: 'Connection type' },
    { html: typeGridHTML(ed.type) },
    '-',
    { label: ed.label ? 'Edit label' : 'Add label', icon: 'edit', fn: () => editEdgeLabel(id) },
    { label: 'Reverse direction', icon: 'swap', fn: () => reverseEdge(id) },
    ed.bend && { label: 'Reset curve', icon: 'refresh', fn: () => resetBend(id) },
    '-',
    { label: 'Delete connection', icon: 'trash', kbd: 'Del', danger: true, fn: () => { S.edgeSel = id; deleteSel(); } },
  ];
}
function openBlockMenu(anchor, n, idx) {
  const r = anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : { right: anchor.x, top: anchor.y };
  const list = isShapeNode(n) ? BLOCKS.filter(b => SHAPE_KINDS.includes(b[0])) : BLOCKS;
  const html = `<div class="bm-grid${isShapeNode(n) ? ' bm-few' : ''}">${list.map(([k, name, desc]) => `<button class="bm" data-k="${k}"><span class="bm-ic">${ic(k, 17)}</span><span><b>${name}</b><small>${desc}</small></span></button>`).join('')}</div>`;
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
  if (mod && e.altKey && e.code === 'KeyC') { e.preventDefault(); copyText(); return; }
  if (e.key === 'Escape') { clearSel(); closePanels(); return; }
  if (e.key === '?') { openHelp(); return; }
  if (k === 'f' && !mod && !e.altKey) { e.preventDefault(); toggleFocus(); return; }
  if (!S.canEdit) {
    if (e.key.startsWith('Arrow')) { e.preventDefault(); const st = e.shiftKey ? 240 : 60; V.x -= (k === 'arrowright' ? st : k === 'arrowleft' ? -st : 0); V.y -= (k === 'arrowdown' ? st : k === 'arrowup' ? -st : 0); applyView(); }
    if (k === 'h' || k === 'v') setTool(k === 'h' ? 'hand' : 'select');
    return;
  }
  if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (mod && k === 'y') { e.preventDefault(); redo(); return; }
  if (mod && k === 'a') { e.preventDefault(); selectNodes(env().nodes.filter(isShown).map(n => n.id)); return; }
  if (mod && e.shiftKey && k === 'v') { e.preventDefault(); importFromClipboard({ at: pointerInVp() ? toWorld(PTR.x, PTR.y) : null, scope: [...S.sel] }); return; }
  if (mod && k === 'c') { copySel(); return; }
  if (mod && k === 'x') { copySel(true); deleteSel(); return; }
  if (mod && k === 'd') { e.preventDefault(); duplicateSel(); return; }
  if (mod && e.shiftKey && k === 'h') { e.preventDefault(); toggleHidden([...S.sel]); return; }
  if (mod && k === 'g') { e.preventDefault(); e.shiftKey ? ungroupSel() : groupSel(); return; }
  if (mod && (e.code === 'BracketRight' || e.code === 'BracketLeft')) { e.preventDefault(); const up = e.code === 'BracketRight'; if (e.shiftKey) reorder(up); else stepZ(up ? 1 : -1); return; }
  if (k === 'p' && !mod && !e.altKey) { e.preventDefault(); panelFromSel(); return; }
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
  else if (k === 'd') createAt('shape', 'pointer');
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
    case 'focus': openFocusMenu(b); break;
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

/* ===================== comfort =====================
   Three quiet helpers, each set per browser (so visitors can use them too) and meant to be felt more
   than seen: a focus vignette, light trails on the board's background, and a reading glow. */

/* ---- focus vignette: the edges of the board blur, dim and lose a little colour, so the eye settles on
   the middle. The strength (0 to 100%) sets how far in it reaches and how strong it is. */
const veil = $('#focus-veil');
const FOC = { touch: false };
/* the comfort defaults changed (focus became a vignette at 3%): move older saved settings over once */
if ((CFG.comfortV || 0) < 2) { CFG.focus = 3; CFG.focusLast = 3; if (CFG.readGlow == null) CFG.readGlow = true; }

function focusLevel() { return clamp(+CFG.focus || 0, 0, 100) / 100; }
function applyFocusLevel() {
  const f = focusLevel(), btn = $('[data-cmd="focus"]');
  if (btn) btn.classList.toggle('on', f > 0 || fxMode() !== 'off' || !!CFG.readGlow);
  if (!f) { veil.style.display = 'none'; return; }
  /* at 3% only the corners soften (about 0.25px); at 100% everything but the middle is strongly blurred */
  const blur = 8 * Math.pow(f, 0.95), sat = 1 - 0.4 * Math.pow(f, 1.2), dim = 34 * Math.pow(f, 1.25);
  const inner = 68 - 50 * Math.pow(f, 0.6);   // % of the way to the corners that stays sharp
  const at = k => (inner + (100 - inner) * k).toFixed(1) + '%';
  veil.style.display = 'block';
  veil.style.backdropFilter = veil.style.webkitBackdropFilter = `blur(${blur.toFixed(2)}px) saturate(${sat.toFixed(2)})`;
  veil.style.background = `color-mix(in srgb,var(--bg) ${dim.toFixed(1)}%,transparent)`;
  veil.style.maskImage = veil.style.webkitMaskImage =
    `radial-gradient(ellipse at 50% 50%,transparent ${inner.toFixed(1)}%,rgba(0,0,0,.12) ${at(0.22)},rgba(0,0,0,.43) ${at(0.45)},rgba(0,0,0,.78) ${at(0.7)},#000 100%)`;
}
function setFocusLevel(v) {
  CFG.focus = clamp(Math.round(v), 0, 100);
  if (CFG.focus > 0) CFG.focusLast = CFG.focus;
  saveCfg(); applyFocusLevel();
}
function toggleFocus() {
  setFocusLevel(CFG.focus > 0 ? 0 : (CFG.focusLast || 3));
  toast(CFG.focus > 0 ? `Focus vignette on (${CFG.focus}%)` : 'Focus vignette off');
}

/* ---- reactive grid: the board's dot grid answers what you do. Only the dots themselves light up (no
   glows or shapes on top), so it stays clean:
     - moving the pointer lights the dots around it; the faster you move, the more it shows, and it fades
       out shortly after you stop
     - adding, connecting, dropping or pasting nodes sends a soft wave of light through the dots
     - a node being dragged lights the dots underneath it in its own colour
   Grid: all of it. Pulses: just the waves. Off: a still grid. */
const FX_MODES = [['off', 'Off'], ['grid', 'All'], ['pulse', 'Pulses only']];
if ((CFG.comfortV || 0) < 4) { CFG.bgFx = 'grid'; CFG.comfortV = 4; saveCfg(); }
if (!FX_MODES.some(m => m[0] === CFG.bgFx)) CFG.bgFx = 'grid';
const amb = document.createElement('div');
amb.id = 'amb';
amb.setAttribute('aria-hidden', 'true');
amb.innerHTML = '<i class="ab1"></i><i class="ab2"></i>';
$('#stage').prepend(amb);
const gridCv = document.createElement('canvas');
gridCv.id = 'grid-fx';
gridCv.setAttribute('aria-hidden', 'true');
vp.insertBefore(gridCv, vp.firstChild);
const gx = gridCv.getContext('2d');
const GF = { waves: [], trail: [], raf: 0, last: 0, px: -1e4, py: -1e4, sp: 0, spot: 0, moved: 0, pal: null, dpr: 1 };
const TRAIL = 0.9;   // seconds a lit spot along the pointer's path stays before it has faded
function fxMode() { const m = CFG.bgFx || 'grid'; return m === 'off' || RM.matches || FOC.touch ? 'off' : m; }
/* '#rrggbb' or 'rgba(r,g,b,a)' -> [r, g, b] */
function toRgb(v) {
  const s = String(v).trim();
  if (/^#[0-9a-f]{6}$/i.test(s)) return [1, 3, 5].map(i => parseInt(s.slice(i, i + 2), 16));
  return (s.match(/[\d.]+/g) || [123, 147, 255]).slice(0, 3).map(Number);
}
function gridPal() {
  if (GF.pal) return GF.pal;
  const cs = getComputedStyle(document.documentElement), bg = toRgb(cs.getPropertyValue('--bg'));
  GF.pal = { dark: bg[0] * 0.3 + bg[1] * 0.59 + bg[2] * 0.11 < 100, sel: toRgb(cs.getPropertyValue('--sel')) };
  return GF.pal;
}
new MutationObserver(() => { GF.pal = null; }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { GF.pal = null; });
function gridSize() {
  const dpr = Math.min(2, window.devicePixelRatio || 1), w = vp.clientWidth, h = vp.clientHeight;
  if (gridCv.width !== Math.round(w * dpr) || gridCv.height !== Math.round(h * dpr)) { gridCv.width = Math.round(w * dpr); gridCv.height = Math.round(h * dpr); }
  GF.dpr = dpr;
}
window.addEventListener('resize', gridSize);
function gridKick() { if (!GF.raf && fxMode() !== 'off') { GF.last = performance.now(); GF.raf = requestAnimationFrame(gridFrame); } }
/* a wave of light through the dots, from a point on the board (world coordinates) */
/* size: how far it spreads (1 = about 350px); strength: how bright (1 = full) */
function bgPulse(wx, wy, color, size = 1, strength = 1, implode = false) {
  if (fxMode() === 'off') return;
  GF.waves.push({ wx, wy, c: toRgb(color || '#' + gridPal().sel.map(v => v.toString(16).padStart(2, '0')).join('')), t: 0, life: 0.85 + 0.35 * size, R: 80 + 200 * size, k: (0.55 + 0.45 * Math.min(1, size)) * strength, implode });
  if (GF.waves.length > 12) GF.waves.shift();
  gridKick();
}
const sstep = (a, b, x) => { const k = clamp((x - a) / (b - a), 0, 1); return k * k * (3 - 2 * k); };
/* light the dots in a box (screen px) with intensity f(x, y) in 0..1 */
function gridDots(x1, y1, x2, y2, c, f) {
  let g = GRID * V.z;
  while (g < 14) g *= 4;
  const P = gridPal(), base = P.dark ? 0.9 : 0.8;
  const i1 = Math.ceil((x1 - V.x) / g), i2 = Math.floor((x2 - V.x) / g), j1 = Math.ceil((y1 - V.y) / g), j2 = Math.floor((y2 - V.y) / g);
  if ((i2 - i1) * (j2 - j1) > 9000) return;
  gx.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`;
  for (let i = i1; i <= i2; i++) for (let j = j1; j <= j2; j++) {
    const x = V.x + i * g, y = V.y + j * g, a = f(x, y);
    if (a < 0.02) continue;
    gx.globalAlpha = Math.min(1, a) * base;
    const r = 1.15 + 1.05 * Math.min(1, a);
    gx.beginPath(); gx.arc(x, y, r, 0, Math.PI * 2); gx.fill();
  }
  gx.globalAlpha = 1;
}
function gridFrame(now) {
  GF.raf = 0;
  const dt = Math.min(0.05, (now - GF.last) / 1000), m = fxMode();
  GF.last = now;
  gridSize();
  gx.setTransform(GF.dpr, 0, 0, GF.dpr, 0, 0);
  gx.clearRect(0, 0, gridCv.width, gridCv.height);
  if (m === 'off') { GF.waves = []; GF.spot = 0; return; }
  const P = gridPal(), W = vp.clientWidth, H = vp.clientHeight;
  let busy = false;
  /* the pointer leaves a trail: each spot along its path is brighter the faster it moved, then fades
     (and narrows) over TRAIL seconds, so a short tail of lit dots follows it */
  if (m === 'grid') {
    const pts = GF.trail.map(q => {
      const life = 1 - (now - q.at) / (TRAIL * 1000);
      return life <= 0 ? null : { x: V.x + q.wx * V.z, y: V.y + q.wy * V.z, r: (80 + 40 * q.s) * (0.7 + 0.3 * life), a: q.s * Math.pow(life, 1.4) };
    }).filter(Boolean);
    GF.trail = GF.trail.filter(q => now - q.at < TRAIL * 1000);
    if (pts.length) {
      const x1 = Math.min(...pts.map(q => q.x - q.r)), y1 = Math.min(...pts.map(q => q.y - q.r)), x2 = Math.max(...pts.map(q => q.x + q.r)), y2 = Math.max(...pts.map(q => q.y + q.r));
      /* each dot takes the brightest spot near it, so overlapping spots don't add up */
      gridDots(x1, y1, x2, y2, P.sel, (x, y) => {
        let best = 0;
        for (const q of pts) { const d = Math.hypot(x - q.x, y - q.y) / q.r; if (d < 1) best = Math.max(best, q.a * Math.pow(1 - d, 1.8)); }
        return best;
      });
      busy = true;
    }
    /* nodes being dragged light the ground under them in their own colour */
    if (DRAG && DRAG.moved) {
      DRAG.ids.slice(0, 40).forEach(id => {
        const n = nodeById(id); if (!n) return;
        const r = rectOf(n), x1 = V.x + r.x * V.z, y1 = V.y + r.y * V.z, x2 = x1 + r.w * V.z, y2 = y1 + r.h * V.z, pad = 34;
        gridDots(x1 - pad, y1 - pad, x2 + pad, y2 + pad, toRgb(colorOf(n.color).c1), (x, y) => {
          const dx = Math.max(x1 - x, 0, x - x2), dy = Math.max(y1 - y, 0, y - y2), d = Math.hypot(dx, dy) / pad;
          return d >= 1 ? 0 : 0.55 * Math.pow(1 - d, 1.4);
        });
      });
      busy = true;
    }
  }
  /* waves: a soft ring that eases outward and fades */
  for (const w of GF.waves) {
    w.t += dt / w.life;
    const t = Math.min(1, w.t), e = 1 - Math.pow(1 - t, 3), cx = V.x + w.wx * V.z, cy = V.y + w.wy * V.z;
    /* an implosion (a dying pulse) draws in toward its centre instead of spreading out */
    const rad = w.implode ? 6 + w.R * (1 - e) : 10 + w.R * e, band = w.implode ? 30 + 20 * (1 - e) : 34 + 26 * e;
    const fade = w.implode ? w.k * Math.pow(Math.sin(Math.PI * t), 1.3) : w.k * sstep(0, 0.18, t) * Math.pow(1 - t, 2);
    const box = rad + band;
    if (cx + box < 0 || cy + box < 0 || cx - box > W || cy - box > H) continue;
    gridDots(cx - box, cy - box, cx + box, cy + box, w.c, (x, y) => { const d = (Math.hypot(x - cx, y - cy) - rad) / band; return fade * Math.exp(-d * d * 2.2); });
  }
  GF.waves = GF.waves.filter(w => w.t < 1);
  if (GF.waves.length) busy = true;
  if (busy) GF.raf = requestAnimationFrame(gridFrame);
  else gx.clearRect(0, 0, gridCv.width, gridCv.height);
}
window.addEventListener('pointermove', e => {
  if (e.pointerType === 'touch' || fxMode() !== 'grid') return;
  const x = e.clientX - VR.left, y = e.clientY - VR.top;
  if (!pointerInVp()) { GF.sp = 0; return; }
  const d = GF.px > -1e3 ? Math.hypot(x - GF.px, y - GF.py) : 0;
  GF.sp = GF.sp * 0.7 + Math.min(d, 80) * 0.3;
  GF.px = x; GF.py = y; GF.moved = performance.now();
  /* a new spot every 10px along the path; in between, the newest one keeps up with the pointer */
  const w = toWorld(e.clientX, e.clientY), s = clamp(GF.sp / 22, 0.18, 1) * 0.55, last = GF.trail[GF.trail.length - 1];
  if (last && Math.hypot((w.x - last.wx) * V.z, (w.y - last.wy) * V.z) < 10) Object.assign(last, { wx: w.x, wy: w.y, at: GF.moved, s: Math.max(last.s, s) });
  else { GF.trail.push({ wx: w.x, wy: w.y, at: GF.moved, s }); if (GF.trail.length > 90) GF.trail.shift(); }
  gridKick();
}, { passive: true });
function setBgFx(m) { CFG.bgFx = m; saveCfg(); GF.waves = []; GF.trail = []; gridKick(); applyFocusLevel(); }
function fxApply() { gridSize(); }

/* ---- action effects, in the same soft "energy" style as the grid (and off whenever the grid is):
     connecting: a charge runs along the new line, and a pulse runs round each node's outline from
       where the line meets it
     deleting: the node flickers out while the dots around it draw in, like a dying pulse
     a new panel: dots fly in from around it and settle into its outline
     a panel going away: holes open up in it and it breaks apart into dots */
const OVL = $('#overlay');
const fxOn = () => fxMode() !== 'off';
function svgNew(tag, attrs) { const el = document.createElementNS(SVGNS, tag); for (const k in attrs) el.setAttribute(k, attrs[k]); return el; }
const selHex = () => '#' + gridPal().sel.map(v => v.toString(16).padStart(2, '0')).join('');
/* a soft glowing segment that travels along a path (world coordinates) and is removed after */
function runPulse(d, color, { dur = 450, len = 0.22, width = 3, delay = 0, fade = 0.85, peak = 1, thin = false } = {}) {
  const p = svgNew('path', { d, class: 'fx-pulse' + (thin ? ' thin' : ''), pathLength: '1' });
  p.style.stroke = color; p.style.color = color; p.style.strokeWidth = width; p.style.strokeDasharray = `${len} ${2 + len}`;
  OVL.appendChild(p);
  const a = p.animate([{ strokeDashoffset: len, opacity: peak }, { strokeDashoffset: -1, opacity: fade * peak }], { duration: dur, delay, easing: 'cubic-bezier(.45,.05,.3,1)', fill: 'both' });
  const done = () => p.remove();
  a.onfinish = done; setTimeout(done, dur + delay + 400);
}
/* a node's (or panel's) outline, split at a point into two halves that run away from it in opposite directions */
function outlineHalves(id, at) {
  const n = nodeById(id), p = !n && panelById(id);
  let d;
  if (n) {
    const r = rectOf(n), el = NODE_EL.get(id), fill = el && el.querySelector(':scope > .nsh .sh-fill');
    if (fill) d = fill.getAttribute('d');
    else {
      const rad = Math.min(parseFloat(el ? getComputedStyle(el).borderTopLeftRadius : 16) || 16, r.w / 2, r.h / 2);
      d = roundedRectD(0.5, 0.5, r.w - 1, r.h - 1, rad);
    }
    return halves(d, r.x, r.y, at);
  }
  if (p) { const r = panelRect(p); if (!r) return null; return halves(roundedRectD(0, 0, r.w, r.h, p.folded ? 16 : 28), r.x, r.y, at); }
  return null;
}
function roundedRectD(x, y, w, h, r) {
  return `M${x + r},${y}H${x + w - r}A${r},${r} 0 0 1 ${x + w},${y + r}V${y + h - r}A${r},${r} 0 0 1 ${x + w - r},${y + h}H${x + r}A${r},${r} 0 0 1 ${x},${y + h - r}V${y + r}A${r},${r} 0 0 1 ${x + r},${y}Z`;
}
/* sample the outline, start at the point nearest `at`, and go half way round each way */
function halves(d, ox, oy, at) {
  const tmp = svgNew('path', { d });
  OVL.appendChild(tmp);
  let L = 0;
  try { L = tmp.getTotalLength(); } catch (_) {}
  if (!L) { tmp.remove(); return null; }
  const N = 140, pts = [];
  for (let i = 0; i < N; i++) { const q = tmp.getPointAtLength(L * i / N); pts.push([q.x + ox, q.y + oy]); }
  tmp.remove();
  let k = 0, best = Infinity;
  pts.forEach((q, i) => { const dd = (q[0] - at.x) ** 2 + (q[1] - at.y) ** 2; if (dd < best) { best = dd; k = i; } });
  const walk = dir => { let s = ''; for (let j = 0; j <= N / 2; j++) { const q = pts[((k + dir * j) % N + N) % N]; s += (j ? 'L' : 'M') + q[0].toFixed(1) + ',' + q[1].toFixed(1); } return s; };
  return [walk(1), walk(-1)];
}
function outlinePulse(id, at, color, delay = 0) {
  const h = outlineHalves(id, at);
  if (!h) return;
  h.forEach(d => runPulse(d, color, { dur: 680, len: 0.28, width: 1.5, delay, fade: 0, peak: 0.85, thin: true }));
}
/* a new connection: a charge along the line, then a pulse round the node it points to */
function chargeEdge(edgeId) {
  if (!fxOn()) return;
  const ed = env().edges.find(x => x.id === edgeId), r = EDGE_EL.get(edgeId);
  if (!ed || !r || !r.p1) return;
  const T = EDGE_TYPES[ed.type], color = T ? T.color : selHex();
  runPulse(r.vis.getAttribute('d'), color, { dur: 440, len: 0.2, width: 2, peak: 0.9, thin: true });
  outlinePulse(ed.to, r.p2, color, 340);
}
/* deleting a node: a soft wave spreads out through the dots from where it was, while it fades (CSS .leaving) */
function dyingPulse(n, el) {
  if (!fxOn()) return;
  const w = el ? el.offsetWidth : n.w, h = el ? el.offsetHeight : 160;
  bgPulse(n.x + w / 2, n.y + h / 2, colorOf(n.color).c1, 0.5, 0.45);
}
/* an edited node: a pulse runs round its outline, starting next to what was changed */
function editPulse(n, from) {
  if (!fxOn() || !n || !NODE_EL.get(n.id)) return;
  const r = rectOf(n);
  let at = { x: r.x + r.w / 2, y: r.y };
  if (from && from.isConnected) { const b = from.getBoundingClientRect(); at = toWorld(b.left + b.width / 2, b.top + b.height / 2); }
  outlinePulse(n.id, at, colorOf(n.color).c1, 0);
}
/* points spaced along a rectangle's outline (world coordinates) */
function rectOutlinePoints(r, n) {
  const per = 2 * (r.w + r.h), out = [];
  for (let i = 0; i < n; i++) {
    let s = (i + Math.random() * 0.6) / n * per;
    if (s < r.w) out.push([r.x + s, r.y]);
    else if ((s -= r.w) < r.h) out.push([r.x + r.w, r.y + s]);
    else if ((s -= r.h) < r.w) out.push([r.x + r.w - s, r.y + r.h]);
    else out.push([r.x, r.y + r.h - (s - r.w)]);
  }
  return out;
}
/* dots that travel between scattered spots and an outline (inward: they gather; otherwise they scatter) */
function flyDots(pts, color, inward, spread = 1) {
  pts.forEach(([x, y]) => {
    const ang = Math.random() * Math.PI * 2, dist = (70 + Math.random() * 170) * spread, sx = x + Math.cos(ang) * dist, sy = y + Math.sin(ang) * dist;
    const c = svgNew('circle', { cx: 0, cy: 0, r: (1.6 + Math.random() * 1.2).toFixed(1), class: 'fx-dot' });
    c.style.fill = color; c.style.color = color;
    OVL.appendChild(c);
    const a = [`translate(${sx.toFixed(1)}px,${sy.toFixed(1)}px)`, `translate(${x.toFixed(1)}px,${y.toFixed(1)}px)`];
    const delay = Math.random() * (inward ? 180 : 140), dur = 520 + Math.random() * 220;
    const kf = inward
      ? [{ transform: a[0], opacity: 0 }, { opacity: 1, offset: 0.35 }, { transform: a[1], opacity: 0.9, offset: 0.88 }, { transform: a[1], opacity: 0 }]
      : [{ transform: a[1], opacity: 0.9 }, { opacity: 0.8, offset: 0.3 }, { transform: a[0], opacity: 0 }];
    const an = c.animate(kf, { duration: dur, delay, easing: inward ? 'cubic-bezier(.2,.8,.25,1)' : 'cubic-bezier(.4,0,.8,.6)', fill: 'both' });
    const done = () => c.remove();
    an.onfinish = done; setTimeout(done, dur + delay + 400);
  });
}
/* a removed connection breaks into short pieces that fade, and a few dots drift off it */
function fxEdgeBreak(d, color) {
  if (!fxOn() || !d) return;
  const g = svgNew('path', { d, class: 'fx-break', pathLength: '1' });
  g.style.stroke = color || 'var(--line)';
  edgeG.appendChild(g);
  const an = g.animate([
    { strokeDasharray: '1 0', opacity: 0.9 },
    { strokeDasharray: '0.07 0.03', opacity: 0.8, offset: 0.3 },
    { strokeDasharray: '0.012 0.088', opacity: 0 },
  ], { duration: 560, easing: 'cubic-bezier(.3,.6,.4,1)', fill: 'both' });
  const done = () => g.remove();
  an.onfinish = done; setTimeout(done, 1000);
  /* dots along the line, drifting a little way off */
  let L = 0;
  try { L = g.getTotalLength(); } catch (_) {}
  if (L > 4) {
    const k = Math.round(clamp(L / 60, 4, 14)), pts = [];
    for (let i = 0; i < k; i++) { const q = g.getPointAtLength(L * (i + 0.5) / k); pts.push([q.x, q.y]); }
    flyDots(pts, color || getComputedStyle(g).stroke, false, 0.22);
  }
}
/* a new panel builds itself out of dots, then its frame fades in */
function fxPanelIn(el, p, r) {
  if (!fxOn()) return;
  flyDots(rectOutlinePoints(r, Math.round(clamp((r.w + r.h) / 22, 26, 70))), COLORS[p.color] || selHex(), true);
  el.classList.remove('pf-born'); void el.offsetWidth; el.classList.add('pf-born');
  setTimeout(() => el.classList.remove('pf-born'), 1300);
}
/* a panel going away: holes open up in it and it breaks apart into dots */
function fxPanelOut(el) {
  const m = (el.style.transform || '').match(/translate\(([-\d.]+)px,\s*([-\d.]+)px\)/), w = el.offsetWidth, h = el.offsetHeight;
  if (!fxOn() || !m || !w) { el.remove(); return; }
  const x = +m[1], y = +m[2], color = getComputedStyle(el).getPropertyValue('--gc').trim() || selHex();
  el.classList.add('dying');
  const holes = rectOutlinePoints({ x: 0, y: 0, w, h }, 11).map(([hx, hy]) => ({ x: hx, y: hy }))
    .concat(Array.from({ length: 5 }, () => ({ x: Math.random() * w, y: Math.random() * h })))
    .map(o => Object.assign(o, { R: (0.16 + Math.random() * 0.22) * Math.max(w, h), at: Math.random() * 260 }));
  flyDots(rectOutlinePoints({ x, y, w, h }, Math.round(clamp((w + h) / 26, 20, 56))), color, false);
  const t0 = performance.now(), dur = 520;
  el.style.webkitMaskComposite = 'source-in'; el.style.maskComposite = 'intersect';
  const step = now => {
    if (!el.isConnected) return;
    const t = now - t0;
    const layers = holes.map(o => { const k = clamp((t - o.at) / dur, 0, 1), r = o.R * (1 - Math.pow(1 - k, 2)); return `radial-gradient(circle at ${o.x.toFixed(0)}px ${o.y.toFixed(0)}px,transparent ${r.toFixed(1)}px,#000 ${(r + 1.5).toFixed(1)}px)`; });
    el.style.maskImage = el.style.webkitMaskImage = layers.join(',');
    if (t < dur + 300) requestAnimationFrame(step); else el.remove();
  };
  requestAnimationFrame(step);
  setTimeout(() => el.remove(), 1400);
}

/* ---- reading glow: over a node's text, a soft, round light follows the pointer beneath the words, like
   the faintest highlighter. It lives inside the node (so it never spills past its edges), sits under the
   text (so the words stay crisp), and is sized to the line you are reading. */
const glow = document.createElement('div');
glow.className = 'read-glow';
glow.setAttribute('aria-hidden', 'true');
const RG = { x: 0, y: 0, tx: 0, ty: 0, raf: 0, on: false, host: null };
function glowFrame() {
  RG.raf = 0;
  const k = RM.matches ? 1 : 0.22;
  RG.x += (RG.tx - RG.x) * k; RG.y += (RG.ty - RG.y) * k;
  glow.style.transform = `translate(${RG.x.toFixed(1)}px,${RG.y.toFixed(1)}px) translate(-50%,-50%)`;
  if (Math.abs(RG.tx - RG.x) + Math.abs(RG.ty - RG.y) > 0.2) RG.raf = requestAnimationFrame(glowFrame);
}
function glowOff() { if (RG.on) { RG.on = false; glow.classList.remove('on'); } }
vp.addEventListener('pointermove', e => {
  const t = e.target;
  const ok = !!CFG.readGlow && e.pointerType !== 'touch' && !e.buttons && !S.editing && t.closest && !t.closest('button, img, .port, .rz, .grip');
  const field = ok && t.closest('.node [data-f], .node .b-text, .node .mx-out');
  if (!field) { glowOff(); return; }
  const ne = field.closest('.node');
  /* a clipping layer inside the node, under its text */
  let clip = ne.querySelector(':scope > .rg-clip');
  if (!clip) {
    clip = document.createElement('div'); clip.className = 'rg-clip';
    const sh = ne.querySelector(':scope > .nsh');   // on a shape node it goes above the shape's fill
    if (sh) sh.after(clip); else ne.insertBefore(clip, ne.firstChild);
  }
  const nr = ne.getBoundingClientRect(), z = V.z;
  const x = (e.clientX - nr.left) / z, y = (e.clientY - nr.top) / z;
  /* about two lines tall, a little wider than tall */
  const fs = parseFloat(getComputedStyle(field).fontSize) || 14, h = clamp(fs * 3.4, 34, 110);
  glow.style.width = (h * 1.7).toFixed(0) + 'px'; glow.style.height = h.toFixed(0) + 'px';
  RG.tx = x; RG.ty = y;
  if (glow.parentNode !== clip) { clip.appendChild(glow); RG.x = x; RG.y = y; }
  if (!RG.on) { RG.on = true; RG.x = x; RG.y = y; glow.classList.add('on'); }
  if (!RG.raf) RG.raf = requestAnimationFrame(glowFrame);
}, { passive: true });
vp.addEventListener('pointerleave', glowOff);
function setReadGlow(on) { CFG.readGlow = !!on; saveCfg(); if (!on) glowOff(); applyFocusLevel(); }

/* no pointer to follow on touch screens */
window.addEventListener('pointermove', e => {
  const touch = e.pointerType === 'touch';
  if (touch !== FOC.touch) { FOC.touch = touch; applyFocusLevel(); }
}, { passive: true });

/* ---- the controls: the button by the zoom (everyone), and the Comfort section in Settings */
function comfortHTML() {
  const v = Math.round(+CFG.focus || 0);
  return `<div class="fm">
    <div class="fm-lab"><span>Focus vignette</span><b class="fm-val">${v ? v + '%' : 'Off'}</b></div>
    <input type="range" class="fm-range" min="0" max="100" step="1" value="${v}" aria-label="Focus vignette strength">
    <p class="fm-hint">Softens the edges of the board so your eyes settle on the middle. A few percent is enough. F switches it on or off.</p>
    <div class="fm-lab"><span>Board effects</span></div>
    <div class="fm-segs">${FX_MODES.map(([k, n]) => `<button class="${(CFG.bgFx || 'grid') === k ? 'on' : ''}" data-fx="${k}">${n}</button>`).join('')}</div>
    <p class="fm-hint">The dot grid lights up behind the pointer and pulses as you add, drop or paste nodes; new connections send a charge along the line; panels build up and break apart. Pulses only leaves out the pointer trail.${RM.matches ? ' Off while your device asks for reduced motion.' : ''}</p>
    <label class="tog fm-tog"><input type="checkbox" class="fm-glow"${CFG.readGlow ? ' checked' : ''}><span></span>Reading glow: a faint light under the text you point at</label>
  </div>`;
}
function bindComfort(root) {
  const range = $('.fm-range', root), val = $('.fm-val', root);
  range.addEventListener('input', () => { setFocusLevel(+range.value); val.textContent = CFG.focus ? CFG.focus + '%' : 'Off'; });
  $('.fm-segs', root).addEventListener('click', e => {
    const b = e.target.closest('[data-fx]');
    if (!b) return;
    setBgFx(b.dataset.fx);
    $$('[data-fx]', root).forEach(x => x.classList.toggle('on', x === b));
  });
  $('.fm-glow', root).addEventListener('change', e => setReadGlow(e.target.checked));
}
function openFocusMenu(btn) {
  const b = btn.getBoundingClientRect();
  const m = openMenu(b.left, b.top, [{ head: 'Comfort' }, { html: comfortHTML() }], { cls: 'fmenu' });
  m.style.top = Math.max(8, b.top - m.offsetHeight - 8) + 'px';
  bindComfort(m);
}
setTimeout(() => { fxApply(); applyFocusLevel(); }, 50);

/* environments *//* ===================== live viewer count =====================
   With the relay set up (Settings → Visitor suggestions) and its live count switched on (see the README),
   every open board checks in every 20 seconds with a random id for this tab and the environment it shows.
   The relay answers with how many boards are open, overall and per environment. Nothing personal is sent.
   Without it, the indicator simply stays hidden. */
const PRES = { sid: null, timer: 0, counts: null, off: false, fails: 0 };
try { PRES.sid = sessionStorage.getItem('flogic.sid'); } catch (_) {}
if (!PRES.sid) { PRES.sid = uid('v') + Math.random().toString(36).slice(2, 8); try { sessionStorage.setItem('flogic.sid', PRES.sid); } catch (_) {} }
const presenceUrl = () => (DOC && DOC.relay ? DOC.relay.replace(/\/+$/, '') + '/presence' : '');
async function presencePing() {
  clearTimeout(PRES.timer);
  const u = presenceUrl();
  if (!u || document.hidden) { PRES.counts = null; renderPresence(); return; }
  try {
    /* plain text, so the browser doesn't need to ask the relay's permission first on every check-in */
    const r = await fetch(u, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ sid: PRES.sid, env: S.envId }) });
    const j = await r.json();
    if (!r.ok || !j.ok) throw new Error(j.error || 'HTTP ' + r.status);
    PRES.counts = j; PRES.fails = 0;
  } catch (_) {
    PRES.counts = null; PRES.fails++;
  }
  renderPresence();
  /* every 20 s; after errors (e.g. the relay has no live count yet) only every few minutes */
  PRES.timer = setTimeout(presencePing, PRES.fails ? Math.min(300000, 30000 * PRES.fails) : 20000);
}
function presenceLeave() {
  const u = presenceUrl();
  if (!u) return;
  try { navigator.sendBeacon(u + '/leave', new Blob([JSON.stringify({ sid: PRES.sid })], { type: 'text/plain' })); } catch (_) {}
}
function renderPresence() {
  const el = $('#viewers'), c = PRES.counts;
  if (!el) return;
  if (!c || !c.total) { el.hidden = true; return; }
  const here = (c.envs && c.envs[S.envId]) || 0, total = c.total, name = (env() && env().name) || 'this environment';
  el.hidden = false;
  el.innerHTML = `<span class="vw-dot"></span>${ic('users', 14)}<b>${total}</b>` +
    `<span class="vw-pop" role="tooltip"><span class="vw-row"><b>${here}</b> viewing “${esc(name)}”</span><span class="vw-row"><b>${total}</b> on the whole board</span><small>Live · counts every open tab, including yours</small></span>`;
  el.setAttribute('aria-label', `${total} viewing now, ${here} in this environment`);
}
document.addEventListener('visibilitychange', () => { if (document.hidden) presenceLeave(); else presencePing(); });
window.addEventListener('pagehide', presenceLeave);
setTimeout(presencePing, 1500);

/* Change the icon of an environment or a category: a built-in icon, one of your icons, or any emoji or
   symbol typed in. The preview at the top shows the row as it will look. */
const EMOJIS = ['📁', '📂', '🗂️', '📌', '📍', '⭐', '✨', '🔥', '💡', '🧠', '🎯', '🚀', '🧪', '🔬', '🧬', '⚗️', '📐', '📊', '📈', '🗺️', '🌍', '🏛️', '⚖️', '💬',
  '📝', '📚', '🎨', '🎵', '🎮', '🛠️', '⚙️', '🔒', '🔑', '💰', '❤️', '✅', '❓', '❗', '⚠️', '🌱', '🌙', '☀️', '⚡', '🧩', '🏁', '👀', '🤖', '🐙',
  '◆', '●', '■', '▲', '★', '✦', '◎', '§', '¶', '∑', 'π', 'Ω', 'λ', '∞', '→', '#'];
function openNavIconPicker(kind, id) {
  if (!S.canEdit) return;
  const item = kind === 'env' ? DOC.envs.find(x => x.id === id) : (DOC.folders || []).find(x => x.id === id);
  if (!item) return;
  const fallback = kind === 'env' ? 'board' : 'folder';
  let pick = item.icon || '';
  const m = openModal(`<div class="mhead"><h3>Icon for “${esc(item.name)}”</h3><button class="icon-btn" data-close aria-label="Close">${ic('x', 16)}</button></div>
    <div class="mbody ipick">
      <div class="ni-prev ${kind === 'env' ? 'env active' : 'efold open'}" id="ni-prev"></div>
      <div class="ip-head"><b>Emoji or symbol</b><small>type, paste, or press Win + . (Mac: Ctrl + Cmd + Space)</small></div>
      <div class="ni-row"><input id="ni-text" maxlength="16" placeholder="Type an emoji or symbol…" autocomplete="off" value="${esc(pick.startsWith('t:') ? pick.slice(2) : '')}"><button class="btn sm" id="ni-emo" title="Pick an emoji" aria-label="Pick an emoji">😊</button></div>
      <div class="ni-emojis" id="ni-emojis" hidden>${EMOJIS.map(x => `<button class="ipi" data-icon="t:${esc(x)}">${esc(x)}</button>`).join('')}</div>
      <div class="ip-head"><b>Icons</b></div>
      <div class="ipgrid">${BUILTIN_ICONS.concat(['folder', 'folderopen', 'board']).filter((k, i, a) => ICONS[k] && a.indexOf(k) === i).map(k => `<button class="ipi" data-icon="b:${k}" title="${k}">${ic(k, 20)}</button>`).join('')}</div>
      ${(DOC.icons || []).length ? `<div class="ip-head"><b>Your icons</b></div><div class="ipgrid">${DOC.icons.map(x => `<button class="ipi" data-icon="u:${x.id}" title="${esc(x.name)}"><img src="${esc(imgSrc(x.src))}" alt="${esc(x.name)}"></button>`).join('')}</div>` : ''}
      <div class="mrow"><button class="btn" id="ni-reset">Default icon</button><span class="grow"></span><button class="btn" data-close>Cancel</button><button class="btn primary" id="ni-ok">Use this icon</button></div>
    </div>`);
  const prev = $('#ni-prev', m.el), txt = $('#ni-text', m.el);
  const show = () => {
    prev.innerHTML = `<span class="eic">${navIcon(pick, fallback, kind === 'env' ? 15 : 13)}</span><span class="nm">${esc(item.name)}</span>`;
    $$('[data-icon]', m.el).forEach(b => b.classList.toggle('on', b.dataset.icon === pick));
  };
  show();
  const save = v => {
    m.close();
    if ((item.icon || '') === v) return;
    checkpoint();
    if (v) item.icon = v; else delete item.icon;
    changed(); renderEnvs();
  };
  txt.addEventListener('input', () => { const v = txt.value.trim(); pick = v ? 't:' + v : ''; show(); });
  txt.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') save(pick); });
  $('#ni-emo', m.el).addEventListener('click', () => { const g = $('#ni-emojis', m.el); g.hidden = !g.hidden; });
  m.el.addEventListener('click', e => {
    const b = e.target.closest('[data-icon]');
    if (!b) return;
    pick = b.dataset.icon;
    txt.value = pick.startsWith('t:') ? pick.slice(2) : '';
    show();
  });
  m.el.addEventListener('dblclick', e => { const b = e.target.closest('[data-icon]'); if (b) save(b.dataset.icon); });
  $('#ni-ok', m.el).addEventListener('click', () => save(pick));
  $('#ni-reset', m.el).addEventListener('click', () => save(''));
  setTimeout(() => txt.focus(), 30);
}function switchEnv(id) {
  endEdit();
  if (!DOC.envs.some(e => e.id === id)) id = DOC.envs[0].id;
  S.envId = id; UI.envId = id;
  const fe = DOC.envs.find(x => x.id === id);
  if (fe && fe.folder) delete UI.collapsed['fold:' + fe.folder];
  saveUI();
  try { history.replaceState(null, '', location.pathname + location.search + '#e=' + id); } catch (_) {}
  for (const [, el] of NODE_EL) { RO.unobserve(el); el.remove(); }
  NODE_EL.clear(); SIZE.clear(); DISP.clear();
  for (const [, r] of EDGE_EL) { r.g.remove(); r.lab.remove(); }
  EDGE_EL.clear();
  for (const M of [PANEL_EL, GROUP_EL]) { for (const [, el] of M) el.remove(); M.clear(); }
  S.sel.clear(); S.edgeSel = null; S.panelSel = null;
  $('#layer-filter').value = '';
  renderAll();
  const v = UI.views[id];
  if (v && isFinite(v.cx) && isFinite(v.z)) { V.z = clamp(v.z, ZMIN, ZMAX); V.x = VR.width / 2 - v.cx * V.z; V.y = VR.height / 2 - v.cy * V.z; applyView(); }
  else { fitAll(true); requestAnimationFrame(() => requestAnimationFrame(() => fitAll(true))); }
  popIn(env().nodes.map(n => n.id), true);
  if (typeof PRES !== 'undefined' && PRES.sid) presencePing();   // tell the live count which environment this tab shows now
  animateEdgesIn(120 + Math.min(env().nodes.length, 30) * 10);
}
function addEnv(folderId) {
  checkpoint();
  let k = DOC.envs.length + 1;
  while (DOC.envs.some(e => e.name === 'Environment ' + k)) k++;
  const e = makeEnv('Environment ' + k);
  if (folderId) { e.folder = folderId; delete UI.collapsed['fold:' + folderId]; }
  DOC.envs.push(e);
  changed();
  switchEnv(e.id);
  renameEnvInline(e.id);
}
/* swap a row's name for a text box; Enter or clicking away saves, Esc cancels */
function inlineRename(row, value, label, save) {
  if (!row || !S.canEdit) return;
  const span = row.querySelector('.nm'), inp = document.createElement('input');
  inp.className = 'rename'; inp.value = value; inp.setAttribute('aria-label', label);
  row.removeAttribute('draggable');
  span.replaceWith(inp);
  inp.focus(); inp.select();
  let done = false;
  const finish = ok => {
    if (done) return;
    done = true;
    const v = inp.value.trim();
    if (ok && v && v !== value) { checkpoint(); save(v); changed(); }
    renderEnvs();
  };
  inp.addEventListener('keydown', ev => { ev.stopPropagation(); if (ev.key === 'Enter') finish(true); if (ev.key === 'Escape') finish(false); });
  inp.addEventListener('blur', () => finish(true));
  inp.addEventListener('pointerdown', ev => ev.stopPropagation());
  inp.addEventListener('click', ev => ev.stopPropagation());
}
function renameEnvInline(id) {
  const e = DOC.envs.find(x => x.id === id);
  if (e) inlineRename($(`.env[data-env="${id}"]`), e.name, 'Environment name', v => { e.name = v; });
}

/* ---------- environment categories ---------- */
function folderOf(id) { return (DOC.folders || []).find(f => f.id === id); }
function addFolder(withEnv) {
  checkpoint();
  DOC.folders = DOC.folders || [];
  let k = DOC.folders.length + 1;
  while (DOC.folders.some(f => f.name === 'Category ' + k)) k++;
  const f = { id: uid('f'), name: 'Category ' + k };
  DOC.folders.push(f);
  if (withEnv) { const e = DOC.envs.find(x => x.id === withEnv); if (e) e.folder = f.id; }
  changed(); renderEnvs();
  inlineRename($(`.efold[data-fold="${f.id}"]`), f.name, 'Category name', v => { f.name = v; });
}
function renameFolderInline(id) {
  const f = folderOf(id);
  if (f) inlineRename($(`.efold[data-fold="${id}"]`), f.name, 'Category name', v => { f.name = v; });
}
function deleteFolder(id) {
  const f = folderOf(id);
  if (!f) return;
  checkpoint();
  DOC.envs.forEach(e => { if (e.folder === id) delete e.folder; });
  DOC.folders = DOC.folders.filter(x => x !== f);
  changed(); renderEnvs();
  toast(`Removed the category “${f.name}”. Its environments were kept.`, { actions: [{ label: 'Undo', fn: undo }] });
}
function moveFolder(id, d) {
  const fs = DOC.folders || [], i = fs.findIndex(f => f.id === id), j = i + d;
  if (i < 0 || j < 0 || j >= fs.length) return;
  checkpoint();
  [fs[i], fs[j]] = [fs[j], fs[i]];
  changed(); renderEnvs();
}
function setEnvFolder(envId, folderId) {
  const e = DOC.envs.find(x => x.id === envId);
  if (!e || (e.folder || null) === (folderId || null)) return;
  checkpoint();
  if (folderId) { e.folder = folderId; delete UI.collapsed['fold:' + folderId]; } else delete e.folder;
  changed(); renderEnvs();
}
function toggleFolder(id) {
  UI.collapsed['fold:' + id] = !UI.collapsed['fold:' + id];
  saveUI(); renderEnvs();
}
const sameGroup = (a, b) => (a.folder || null) === (b.folder || null) || (!folderOf(a.folder) && !folderOf(b.folder));
function duplicateEnv(id) {
  const src = DOC.envs.find(x => x.id === id);
  if (!src) return;
  checkpoint();
  const c = clone(src), map = {};
  c.id = uid('e'); c.name = src.name + ' copy';
  c.nodes.forEach(n => { const o = n.id; reIdNode(n); map[o] = n.id; });
  c.edges.forEach(x => { x.id = uid('l'); });
  c.groups.forEach(g => { g.id = uid('g'); g.members = g.members.map(m => map[m]); });
  c.panels.forEach(p => { const o = p.id; p.id = uid('p'); map[o] = p.id; p.members = p.members.map(m => map[m]); });
  c.edges.forEach(x => { x.from = map[x.from] || x.from; x.to = map[x.to] || x.to; });
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
/* move up/down among the environments it is listed with (same category) */
function envNeighbour(id, d) {
  const e = DOC.envs.find(x => x.id === id), peers = DOC.envs.filter(x => sameGroup(x, e));
  return peers[peers.indexOf(e) + d];
}
function moveEnv(id, d) {
  const other = envNeighbour(id, d);
  if (!other) return;
  checkpoint();
  const i = DOC.envs.findIndex(x => x.id === id), j = DOC.envs.indexOf(other);
  [DOC.envs[i], DOC.envs[j]] = [DOC.envs[j], DOC.envs[i]];
  renderEnvs(); changed();
}
$('#env-add').addEventListener('click', () => addEnv());
$('#cat-add').addEventListener('click', () => addFolder());
const envList = $('#env-list');
envList.addEventListener('click', e => {
  const fold = e.target.closest('.efold');
  if (fold && !fold.querySelector('input')) { toggleFolder(fold.dataset.fold); return; }
  const row = e.target.closest('.env');
  if (!row || row.querySelector('input')) return;
  if (row.dataset.env !== S.envId) switchEnv(row.dataset.env);
  closePanels();
});
envList.addEventListener('dblclick', e => {
  const fold = e.target.closest('.efold');
  if (fold) { renameFolderInline(fold.dataset.fold); return; }   /* its two clicks already toggled it closed and open again */
  const row = e.target.closest('.env');
  if (row) renameEnvInline(row.dataset.env);
});
envList.addEventListener('contextmenu', e => {
  if (!S.canEdit) return;
  const fold = e.target.closest('.efold'), row = e.target.closest('.env');
  if (!fold && !row) return;
  e.preventDefault();
  if (fold) {
    const id = fold.dataset.fold, i = DOC.folders.findIndex(f => f.id === id);
    openMenu(e.clientX, e.clientY, [
      { label: 'New environment here', icon: 'plus', fn: () => addEnv(id) },
      { label: 'Rename category', icon: 'edit', fn: () => renameFolderInline(id) },
      { label: 'Change icon…', icon: 'shape', fn: () => openNavIconPicker('fold', id) },
      { label: 'Move up', icon: 'chev', disabled: i === 0, fn: () => moveFolder(id, -1) },
      { label: 'Move down', icon: 'chev', disabled: i === DOC.folders.length - 1, fn: () => moveFolder(id, 1) },
      '-',
      { label: 'Remove category (keeps environments)', icon: 'trash', danger: true, fn: () => deleteFolder(id) },
    ]);
    return;
  }
  const id = row.dataset.env, env0 = DOC.envs.find(x => x.id === id), folders = DOC.folders || [];
  openMenu(e.clientX, e.clientY, [
    { label: 'Rename', icon: 'edit', fn: () => renameEnvInline(id) },
    { label: 'Change icon…', icon: 'shape', fn: () => openNavIconPicker('env', id) },
    { label: 'Duplicate', icon: 'copy', fn: () => duplicateEnv(id) },
    { label: 'Move up', icon: 'chev', disabled: !envNeighbour(id, -1), fn: () => moveEnv(id, -1) },
    { label: 'Move down', icon: 'chev', disabled: !envNeighbour(id, 1), fn: () => moveEnv(id, 1) },
    { head: 'Category' },
    ...folders.map(f => ({ label: f.name, icon: 'folder', check: env0.folder === f.id, fn: () => setEnvFolder(id, f.id) })),
    folderOf(env0.folder) && { label: 'No category', icon: 'board', fn: () => setEnvFolder(id, null) },
    { label: 'New category with this…', icon: 'folderplus', fn: () => addFolder(id) },
    '-',
    { label: 'Delete', icon: 'trash', danger: true, disabled: DOC.envs.length < 2, fn: () => deleteEnv(id) },
  ]);
});
/* drag environments: onto a category to file them, between rows to reorder, onto blank space to un-file */
let ENV_DRAG = null;
const clearEnvDrop = () => $$('.drop-in, .drop-before, .drop-after', envList).forEach(x => x.classList.remove('drop-in', 'drop-before', 'drop-after'));
let FOLD_DRAG = null;   // a category being dragged to reorder the categories
envList.addEventListener('dragstart', e => {
  const fold = e.target.closest('.efold[draggable]');
  if (fold) {
    FOLD_DRAG = fold.dataset.fold;
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', fold.querySelector('.nm').textContent); } catch (_) {}
    requestAnimationFrame(() => fold.classList.add('dragging'));
    return;
  }
  const row = e.target.closest('.env[draggable]');
  if (!row) return;
  ENV_DRAG = row.dataset.env;
  e.dataTransfer.effectAllowed = 'move';
  try { e.dataTransfer.setData('text/plain', row.querySelector('.nm').textContent); } catch (_) {}
  requestAnimationFrame(() => row.classList.add('dragging'));
});
envList.addEventListener('dragend', () => { ENV_DRAG = FOLD_DRAG = null; clearEnvDrop(); $$('.dragging', envList).forEach(x => x.classList.remove('dragging')); });
/* where a dragged category would go: above or below another category */
function foldDropTarget(e) {
  const host = e.target.closest('.efold, [data-fold-items]');
  if (!host) return null;
  const head = host.classList.contains('efold') ? host : host.previousElementSibling;
  if (!head || head.dataset.fold === FOLD_DRAG) return null;
  const r = head.getBoundingClientRect(), after = host !== head || e.clientY > r.top + r.height / 2;
  return { fold: head.dataset.fold, el: head, mode: after ? 'after' : 'before' };
}
function envDropTarget(e) {
  const fold = e.target.closest('.efold, .efold-empty');
  if (fold) return { folder: fold.closest('[data-fold-items]') ? fold.closest('[data-fold-items]').dataset.foldItems : fold.dataset.fold, el: fold.classList.contains('efold') ? fold : fold.closest('[data-fold-items]').previousElementSibling, mode: 'in' };
  const row = e.target.closest('.env');
  if (row && row.dataset.env !== ENV_DRAG) {
    const r = row.getBoundingClientRect(), after = e.clientY > r.top + r.height / 2;
    return { env: row.dataset.env, el: row, mode: after ? 'after' : 'before' };
  }
  if (!row) return { loose: true };
  return null;
}
envList.addEventListener('dragover', e => {
  if (!ENV_DRAG && !FOLD_DRAG) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  clearEnvDrop();
  const t = FOLD_DRAG ? foldDropTarget(e) : envDropTarget(e);
  if (t && t.el) t.el.classList.add('drop-' + t.mode);
});
envList.addEventListener('drop', e => {
  if (FOLD_DRAG) {
    e.preventDefault();
    const t = foldDropTarget(e), fs = DOC.folders, f = fs.find(x => x.id === FOLD_DRAG);
    clearEnvDrop();
    if (!t || !f) return;
    checkpoint();
    fs.splice(fs.indexOf(f), 1);
    fs.splice(fs.findIndex(x => x.id === t.fold) + (t.mode === 'after' ? 1 : 0), 0, f);
    changed(); renderEnvs();
    return;
  }
  if (!ENV_DRAG) return;
  e.preventDefault();
  const t = envDropTarget(e), id = ENV_DRAG;
  clearEnvDrop();
  if (!t) return;
  const env0 = DOC.envs.find(x => x.id === id);
  checkpoint();
  if (t.folder) { env0.folder = t.folder; delete UI.collapsed['fold:' + t.folder]; }
  else if (t.loose) delete env0.folder;
  else {
    const target = DOC.envs.find(x => x.id === t.env);
    if (target.folder && folderOf(target.folder)) env0.folder = target.folder; else delete env0.folder;
    DOC.envs.splice(DOC.envs.indexOf(env0), 1);
    DOC.envs.splice(DOC.envs.indexOf(target) + (t.mode === 'after' ? 1 : 0), 0, env0);
  }
  changed(); renderEnvs();
});
window.addEventListener('hashchange', () => {
  const id = (location.hash.match(/e=([\w-]+)/) || [])[1];
  if (id && id !== S.envId && DOC.envs.some(e => e.id === id)) switchEnv(id);
});

/* layers */
const layersEl = $('#layers');
/* the nodes a Layers row stands for: a node, or a group's or a panel's nodes */
function rowNodes(row) {
  if (row.dataset.id) return [row.dataset.id];
  const g = row.dataset.g ? groupById(row.dataset.g) : panelById(row.dataset.p);
  return g ? g.members.slice() : [];
}
layersEl.addEventListener('click', e => {
  const eye = e.target.closest('[data-act="leye"]');
  if (eye) { toggleHidden(rowNodes(eye.closest('.layer'))); return; }
  const ch = e.target.closest('[data-act="lcollapse"]');
  if (ch) { const r = ch.closest('.layer'), k = r.dataset.g || r.dataset.p; UI.collapsed[k] = !UI.collapsed[k]; saveUI(); renderLayers(); return; }
  const row = e.target.closest('.layer');
  if (!row) return;
  endEdit();
  if (row.dataset.p) {
    const p = panelById(row.dataset.p);
    if (!p) return;
    if (e.shiftKey) selectNodes(p.members.filter(id => isShown(nodeById(id))), true); else selectPanel(p.id);
    panToNodes(p.members);
    return;
  }
  if (row.dataset.g) {
    const g = groupById(row.dataset.g);
    if (g) { selectNodes(g.members.filter(id => isShown(nodeById(id))), e.shiftKey); panToNodes(g.members); }
    return;
  }
  const id = row.dataset.id, fp = foldMap().get(id);
  if (fp) toggleFold(fp);   /* a node tucked into a folded panel: open the panel to show it */
  if (e.shiftKey) { if (S.sel.has(id)) S.sel.delete(id); else S.sel.add(id); S.edgeSel = null; refreshSel(); }
  else selectNodes([id]);
  panToNodes([id]);
});
layersEl.addEventListener('dblclick', e => {
  const row = e.target.closest('.layer');
  if (!row || e.target.closest('button')) return;
  if (row.dataset.p || row.dataset.g) { if (S.canEdit) renameFrame(row.dataset.p ? 'p' : 'g', row.dataset.p || row.dataset.g); return; }
  zoomToNodes([row.dataset.id]);
});
layersEl.addEventListener('contextmenu', e => {
  const row = e.target.closest('.layer');
  if (!row || !S.canEdit) return;
  e.preventDefault();
  if (row.dataset.p) { const p = panelById(row.dataset.p); if (p) { selectPanel(p.id); openMenu(e.clientX, e.clientY, panelMenu(p)); } return; }
  if (row.dataset.g) { const g = groupById(row.dataset.g); if (g) { selectNodes(g.members); openMenu(e.clientX, e.clientY, groupMenu(g)); } return; }
  if (!S.sel.has(row.dataset.id)) selectNodes([row.dataset.id]);
  openMenu(e.clientX, e.clientY, nodeMenu(e.clientX, e.clientY));
});
/* Drag rows in Layers to change what is drawn on top (rows higher up are in front) and where things
   live: drop between rows to place them there (joining the panel or group those rows are in), onto a
   panel or group row to put them inside it, or onto the empty space below to send them to the back,
   outside any panel or group. */
let LDRAG = null;
const clearLDrop = () => { $$('.ldrop, .ldrop-before, .ldrop-after', layersEl).forEach(x => x.classList.remove('ldrop', 'ldrop-before', 'ldrop-after')); layersEl.classList.remove('ldrop-out'); };
layersEl.addEventListener('dragstart', e => {
  const row = e.target.closest('.layer[draggable]');
  if (!row || !S.canEdit) return;
  let ids = rowNodes(row);
  if (row.dataset.id && S.sel.has(row.dataset.id) && S.sel.size > 1) ids = [...S.sel];
  LDRAG = { ids, group: row.dataset.g || null, panel: row.dataset.p || null };
  e.dataTransfer.effectAllowed = 'move';
  try { e.dataTransfer.setData('text/plain', row.querySelector('.nm').textContent); } catch (_) {}
  requestAnimationFrame(() => row.classList.add('dragging'));
});
layersEl.addEventListener('dragend', () => { LDRAG = null; clearLDrop(); $$('.layer.dragging', layersEl).forEach(x => x.classList.remove('dragging')); });
/* { panel, group: where the nodes end up; anchor + front: in front of / behind which nodes; el + mark: what to highlight } */
function layerDropTarget(e) {
  const d = LDRAG, row = e.target.closest('.layer');
  if (!row) return { panel: null, group: null, anchor: env().nodes.map(n => n.id), front: false, el: null, mark: 'out' };
  const r = row.getBoundingClientRect(), y = (e.clientY - r.top) / r.height;
  if (row.dataset.p || row.dataset.g) {
    const box = row.dataset.p ? panelById(row.dataset.p) : groupById(row.dataset.g), members = box ? box.members.slice() : [];
    const home = row.dataset.g && members.length ? panelOf(members[0]) : null;
    /* the top of a panel or group row places things in front of it; the rest puts them inside it
       (a dragged group or panel can't go inside a group, and a panel can't go inside anything) */
    const inside = !(d.panel || (d.group && row.dataset.g)) && y > 0.3;
    if (inside) return { panel: row.dataset.p || (home && home.id) || null, group: row.dataset.g || null, anchor: members, front: true, el: row, mark: 'in' };
    return { panel: row.dataset.p ? null : home ? home.id : null, group: null, anchor: members, front: y <= 0.5, el: row, mark: y <= 0.5 ? 'before' : 'after' };
  }
  const id = row.dataset.id, p = panelOf(id), g = groupOf(id), before = y <= 0.5;
  return { panel: p ? p.id : null, group: g && !d.group && !d.panel ? g.id : null, anchor: [id], front: before, el: row, mark: before ? 'before' : 'after' };
}
layersEl.addEventListener('dragover', e => {
  if (!LDRAG) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  clearLDrop();
  const t = layerDropTarget(e);
  if (!t.el) layersEl.classList.add('ldrop-out');
  else t.el.classList.add(t.mark === 'in' ? 'ldrop' : 'ldrop-' + t.mark);
});
layersEl.addEventListener('dragleave', e => { if (!layersEl.contains(e.relatedTarget)) clearLDrop(); });
/* move nodes in the drawing order: just in front of (or behind) the anchor nodes */
function moveInZ(ids, anchor, front) {
  const e = env(), set = new Set(ids), moving = e.nodes.filter(n => set.has(n.id)), rest = e.nodes.filter(n => !set.has(n.id));
  const at = anchor.map(id => rest.findIndex(n => n.id === id)).filter(i => i >= 0);
  if (!moving.length) return;
  const i = !at.length ? (front ? rest.length : 0) : front ? Math.max(...at) + 1 : Math.min(...at);
  rest.splice(i, 0, ...moving);
  e.nodes = rest;
}
layersEl.addEventListener('drop', e => {
  const d = LDRAG;
  if (!d) return;
  e.preventDefault();
  const t = layerDropTarget(e);
  clearLDrop();
  const en = env(), ids = d.ids.filter(id => nodeById(id));
  if (!ids.length) return;
  endEdit(); checkpoint();
  if (!d.panel) {
    setPanel(ids, t.panel, true);
    const g = t.group && groupById(t.group);
    if (!d.group) {
      /* nodes leave the groups they were in, unless they were dropped inside the same group */
      en.groups.forEach(x => { if (x !== g) x.members = x.members.filter(id => !ids.includes(id)); });
      if (g) ids.forEach(id => { if (!g.members.includes(id)) g.members.push(id); });
    }
  }
  moveInZ(ids, t.anchor.filter(id => !ids.includes(id)), t.front);
  syncZ(); structureChanged(); refreshSel();
});
/* one step forward or back in the drawing order */
function stepZ(dir) {
  const e = env(), ns = e.nodes;
  if (!S.sel.size) return;
  checkpoint();
  if (dir > 0) for (let i = ns.length - 2; i >= 0; i--) { if (S.sel.has(ns[i].id) && !S.sel.has(ns[i + 1].id)) [ns[i], ns[i + 1]] = [ns[i + 1], ns[i]]; }
  else for (let i = 1; i < ns.length; i++) { if (S.sel.has(ns[i].id) && !S.sel.has(ns[i - 1].id)) [ns[i], ns[i - 1]] = [ns[i - 1], ns[i]]; }
  syncZ(); renderLayers(); changed();
}
/* Layers: drag on empty space to box-select rows; click empty space to deselect everything */
let LMQ = null;
layersEl.addEventListener('pointerdown', e => {
  if (e.button !== 0 || e.target.closest('.layer, button, input')) return;
  e.preventDefault();
  LMQ = { sx: e.clientX, sy: e.clientY, add: e.shiftKey || e.ctrlKey || e.metaKey, base: new Set(S.sel), moved: false, id: e.pointerId };
});
window.addEventListener('pointermove', e => {
  const m = LMQ;
  if (!m || e.pointerId !== m.id) return;
  if (!m.moved) {
    if (Math.hypot(e.clientX - m.sx, e.clientY - m.sy) < 4) return;
    m.moved = true;
    m.box = document.createElement('div');
    m.box.className = 'lmarquee';
    document.body.appendChild(m.box);
  }
  const lr = layersEl.getBoundingClientRect();
  const x1 = clamp(Math.min(m.sx, e.clientX), lr.left, lr.right), x2 = clamp(Math.max(m.sx, e.clientX), lr.left, lr.right);
  const y1 = clamp(Math.min(m.sy, e.clientY), lr.top, lr.bottom), y2 = clamp(Math.max(m.sy, e.clientY), lr.top, lr.bottom);
  Object.assign(m.box.style, { left: x1 + 'px', top: y1 + 'px', width: x2 - x1 + 'px', height: y2 - y1 + 'px' });
  /* rows the box touches; a group or panel row brings all its nodes */
  const sel = new Set(m.add ? m.base : []);
  $$('.layer', layersEl).forEach(row => {
    const r = row.getBoundingClientRect(), hit = r.bottom > y1 && r.top < y2;
    row.classList.toggle('boxed', hit);
    if (!hit) return;
    rowNodes(row).forEach(id => { if (isShown(nodeById(id))) sel.add(id); });
  });
  /* auto-scroll the list when the box reaches its top or bottom edge */
  if (e.clientY > lr.bottom - 12) layersEl.scrollTop += 12; else if (e.clientY < lr.top + 12) layersEl.scrollTop -= 12;
  S.sel = sel; S.edgeSel = null;
  refreshSel(true);
});
window.addEventListener('pointerup', e => {
  const m = LMQ;
  if (!m || e.pointerId !== m.id) return;
  LMQ = null;
  if (m.box) m.box.remove();
  if (!m.moved) { if (!m.add) clearSel(); return; }
  refreshSel();
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
/* custom colour: preview while picking, save when the picker closes */
$('#inspector').addEventListener('input', e => {
  if (!e.target.matches('[data-cc]')) return;
  const v = e.target.value;
  selNodes().forEach(n => { const el = NODE_EL.get(n.id); if (el) paintNode(el, Object.assign({}, n, { color: v })); });
});
$('#inspector').addEventListener('change', e => { if (e.target.matches('[data-cc]')) setColor(e.target.value.toLowerCase()); });
$('#inspector').addEventListener('click', e => {
  const et = e.target.closest('[data-etype]');
  if (et) { setEdgeType(S.edgeSel, et.dataset.etype); return; }
  const pc = e.target.closest('[data-pc]'), sp = selectedPanel(), sg = selectedGroup();
  if (pc) { if (sp) setPanelColor(sp.id, pc.dataset.pc); return; }
  const sw = e.target.closest('[data-sw]');
  if (sw) { setColor(sw.dataset.sw); return; }
  const b = e.target.closest('[data-ia]');
  if (!b) return;
  const id = S.edgeSel, ed = id && env().edges.find(x => x.id === id);
  switch (b.dataset.ia) {
    case 'shape': setNodeLook('shape', b.dataset.v); break;
    case 'accent': setNodeLook('accent', b.dataset.v); break;
    case 'plook': if (sp) setPanelLook(sp.id, b.dataset.v); break;
    case 'prename': if (sp) renameFrame('p', sp.id); break;
    case 'pfold': if (sp) toggleFold(sp.id); break;
    case 'unpanel': if (sp) unpanel(sp.id); break;
    case 'panel': panelFromSel(); break;
    case 'outpanel': moveToPanel([...S.sel], null); break;
    case 'grename': if (sg) renameFrame('g', sg.id); break;
    case 'type': setType(b.dataset.v); break;
    case 'arrow': if (ed) edgeSet(id, { arrow: !ed.arrow }); break;
    case 'dashed': if (ed) edgeSet(id, { dashed: !ed.dashed }); break;
    case 'elabel': editEdgeLabel(id); break;
    case 'reverse': reverseEdge(id); break;
    case 'estyle': if (ed) edgeSet(id, { style: b.dataset.v }); break;
    case 'unbend': resetBend(id); break;
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
  const knob = t.closest('.bend, .bend-hit');
  if (knob) { resetBend(knob.parentNode.dataset.e); return; }
  const eg = t.closest('[data-e]');
  if (eg) { editEdgeLabel(eg.dataset.e); return; }
  const pl = t.closest('.plabel');
  if (pl && S.canEdit && !t.closest('[data-pfold]')) { renameFrame('p', pl.dataset.p); return; }
  /* double-click on empty board: a wave through the dots, just for fun */
  if (!t.closest('.node, .pframe, .elabel, .gout, [data-e]')) { const w = toWorld(e.clientX, e.clientY); bgPulse(w.x, w.y, null, 0.5, 0.5); }
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
    ['Add a node', 'Right-click empty space · T N S'], ['Add a shape (flowcharts)', 'D'], ['Edit text', 'Double-click, or click a selected node’s text'],
    ['Connect', 'Drag from a side dot to a side dot'], ['Disconnect', 'Drag a line away'],
    ['Place freely (no snapping)', 'Hold Ctrl while dragging'], ['Connect nodes', 'Drag from a side dot'],
    ['Move a block', 'Drag its ⋮⋮ handle'], ['Nudge', 'Arrows (Shift ×4, Ctrl 1px)'],
    ['Duplicate', 'Ctrl+D'], ['Copy · paste', 'Ctrl+C · Ctrl+V'],
    ['Copy text as Markdown', 'Ctrl+Alt+C'], ['Import text', 'Ctrl+Shift+V · right-click'],
    ['Group · ungroup', 'Ctrl+G · Ctrl+Shift+G'], ['Hide · show', 'Ctrl+Shift+H or the eye in Layers'],
    ['Put selection in a panel', 'P'], ['Move into · out of a panel', 'Drag nodes onto it · off it'],
    ['Move a panel', 'Drag its edge or name'], ['Fold a panel', 'The arrow by its name'],
    ['Undo · redo', 'Ctrl+Z · Ctrl+Shift+Z'],
    ['Delete', 'Delete'], ['Fit all · selection', 'Shift+1 · Shift+2'],
    ['Zoom to 100%', 'Ctrl+0'], ['Publish', 'Ctrl+S'],
    ['Focus vignette on · off', 'F (comfort options: the button by the zoom)'],
  ].map(([a, b]) => `<div><span>${a}</span><kbd>${esc(b.replace(/Ctrl/g, MOD))}</kbd></div>`).join('');
  openModal(`<div class="mhead"><h3>Keyboard & mouse</h3><button class="icon-btn" data-close aria-label="Close">${ic('x', 16)}</button></div>
    <div class="mbody"><section><div class="keys">${K}</div></section>
    <section><h4>Text formatting</h4><div class="keys">
      <div><span><b>Bold</b></span><kbd>**bold** · ${MOD}+B</kbd></div><div><span><i>Italic</i></span><kbd>*italic* · ${MOD}+I</kbd></div>
      <div><span><mark>Highlight</mark></span><kbd>==text== · ${MOD}+E</kbd></div><div><span><s>Strikethrough</s></span><kbd>~~text~~</kbd></div>
      <div><span>Small text line</span><kbd>-# text</kbd></div><div><span>Divider line</span><kbd>___ on its own line</kbd></div>
      <div><span>Bullet</span><kbd>- text</kbd></div><div><span>Web link</span><kbd>[text](https://…)</kbd></div>
      <div><span>Link to a node</span><kbd>(text)[Node title] · ${MOD}+K</kbd></div><div><span>Format a word</span><kbd>Right-click it</kbd></div>
    </div></section>
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
    <p class="hint">${S.canEdit ? '' : 'Visitors can only view this board. '}Flogic keeps the board in <code>${DATA_PATH}</code> inside your GitHub Pages repository. To edit and publish, connect a <b>fine-grained token</b> that has <b>Contents: Read and write</b> on that one repository (add <b>Issues: Read and write</b> to see and solve visitors' suggestions). The token is stored only in this browser.</p>
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
    <div class="field"><span>Connection lines<br><small class="hint">Default for every line. Right-click a line to change just that one.</small></span><div class="segs" id="s-lines">${LINE_STYLES.map(([k, name]) => `<button data-v="${k}" class="${(DOC.lineStyle || 'fluid') === k ? 'on' : ''}">${name}</button>`).join('')}</div></div>
    <label class="tog"><input type="checkbox" id="s-nolimit"${CFG.noLimit ? ' checked' : ''}><span></span>Remove the ${NODE_LIMIT.toLocaleString()}-node limit per environment (very large boards can get slow)</label></section>
    <section><h4>${ic('bubble', 15)} Visitor suggestions</h4><p class="hint">Without a relay, visitors need a GitHub account to send suggestions. With a relay (a free Cloudflare Worker, see the README), anyone can send one without signing in. Paste the relay's address here, then publish.</p>
    <div class="grid2" style="grid-template-columns:1fr"><label>Relay address<input id="s-relay" value="${esc(DOC.relay || '')}" placeholder="https://flogic-relay.your-name.workers.dev" spellcheck="false" autocomplete="off"></label></div>
    <div class="mrow"><span class="sstat" id="s-relay-st">${DOC.relay ? 'Visitors can send suggestions without signing in' : 'Not set: visitors use GitHub to send suggestions'}</span><span class="grow"></span><button class="btn" id="s-relay-test">Test</button><button class="btn primary" id="s-relay-save">Save</button></div></section>
    <section><h4>${ic('download', 15)} Backup</h4><p class="hint">Your work autosaves in this browser. Export a copy now and then, or import one to replace this board.</p>
    <div class="mrow" style="margin-top:0"><button class="btn" id="s-exp">${ic('download', 14)} Export JSON</button><button class="btn" id="s-imp">${ic('upload', 14)} Import JSON</button>${S.connected ? `<button class="btn" id="s-pull">${ic('refresh', 14)} Reload from GitHub</button>` : ''}</div></section>` : '';
  const m = openModal(`<div class="mhead"><h3>${S.canEdit ? 'Settings' : 'Sign in to edit'}</h3><button class="icon-btn" data-close aria-label="Close">${ic('x', 16)}</button></div><div class="mbody">${conn}${prefs}<section><h4>${ic('focus', 15)} Comfort</h4>${comfortHTML()}</section></div>`);
  bindComfort(m.el);
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
  const relayIn = q('#s-relay'), relaySt = q('#s-relay-st');
  const relayVal = () => relayIn.value.trim().replace(/\/+$/, '');
  if (relayIn) {
    q('#s-relay-save').addEventListener('click', () => {
      const v = relayVal();
      if (v && !/^https:\/\/[^\s<>"']+$/i.test(v)) { relaySt.className = 'sstat err'; relaySt.textContent = 'The address must start with https://'; return; }
      if ((DOC.relay || '') === v) { relaySt.className = 'sstat ok'; relaySt.textContent = 'Saved'; return; }
      checkpoint();
      if (v) DOC.relay = v; else delete DOC.relay;
      changed();
      relaySt.className = 'sstat ok';
      relaySt.textContent = v ? 'Saved. Publish so visitors get it.' : 'Removed. Publish so visitors get it.';
      PRES.fails = 0; presencePing();
    });
    q('#s-relay-test').addEventListener('click', async () => {
      const v = relayVal();
      if (!/^https:\/\//i.test(v)) { relaySt.className = 'sstat err'; relaySt.textContent = 'Enter the relay address first'; return; }
      relaySt.className = 'sstat'; relaySt.textContent = 'Checking…';
      try {
        const r = await fetch(v, { cache: 'no-store' }), j = await r.json();
        if (!j || j.service !== 'flogic-relay') throw new Error('that address is not a Flogic relay');
        if (!j.configured) throw new Error('the relay is running but GITHUB_TOKEN, REPO or ALLOWED_ORIGIN is missing');
        relaySt.className = 'sstat ok'; relaySt.textContent = 'Relay is working ✓' + (j.presence ? ' · live viewer count on' : ' · live viewer count not set up (see the README)');
      } catch (err) { relaySt.className = 'sstat err'; relaySt.textContent = 'Not reachable: ' + err.message; }
    });
  }
  const lines = q('#s-lines');
  if (lines) lines.addEventListener('click', e => {
    const b = e.target.closest('[data-v]');
    if (!b || (DOC.lineStyle || 'fluid') === b.dataset.v) return;
    checkpoint(); DOC.lineStyle = b.dataset.v; changed(); drawEdges();
    $$('button', lines).forEach(x => x.classList.toggle('on', x === b));
  });
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
  put('[data-new="title"]', 'title'); put('[data-new="note"]', 'note'); put('[data-new="sub"]', 'sub'); put('[data-new="shape"]', 'shape');
  put('[data-cmd="undo"]', 'undo'); put('[data-cmd="redo"]', 'redo');
  put('[data-cmd="zoomout"]', 'minus', 16); put('[data-cmd="zoomin"]', 'plus', 16); put('[data-cmd="fit"]', 'fit', 16); put('[data-cmd="focus"]', 'focus', 16);
  put('#env-add', 'plus', 15); put('#cat-add', 'folderplus', 15); put('[data-cmd="help"]', 'help', 16);
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
  if (S.canEdit && S.connected) fetchSuggestions();
  setTool('select');
  const bootEl = $('#boot');
  bootEl.classList.add('done');
  setTimeout(() => bootEl.remove(), 400);
  if (S.preview) toast('Previewing as a visitor');
  else if (!S.canEdit) toast('View only · drag to pan, scroll to zoom', { ms: 3500 });
}
boot();
