'use strict';
/* Flogic: document model, undo history, local drafts and GitHub publishing. */

const DATA_PATH = 'data/flogic.json';
const ASSET_DIR = 'data/assets';
const LS = { doc: 'flogic.doc', meta: 'flogic.meta', cfg: 'flogic.cfg', ui: 'flogic.ui' };

const NODE_W = { title: 480, note: 336, sub: 216, shape: 216 };
const NODE_LIMIT = 1000;   // per environment; Settings → "Remove the node limit" lifts it
const NODE_LABEL = { title: 'Title', note: 'Note', sub: 'Sub-note', shape: 'Shape' };
/* Colours: the main set, a pastel set, two-tone gradients, or any custom '#rrggbb'. */
const COLORS = {
  default: '#7b93ff', sky: '#3fb2ec', violet: '#a98bfa', pink: '#ee6eae', amber: '#e9a43a', green: '#36c08c', red: '#ef6a6a', slate: '#8f9bb3',
  teal: '#2bb5a2', orange: '#f0844f', lime: '#9cc23c', indigo: '#6574f2', rose: '#e85d84', cyan: '#1fc2d6', gold: '#d6b13a', brown: '#b0835a',
  'p-blue': '#a8c1ff', 'p-lilac': '#cbb7ff', 'p-pink': '#ffb6d5', 'p-peach': '#ffc4a3', 'p-butter': '#f5df8a', 'p-mint': '#a6e3c8', 'p-sky': '#a3dcf2', 'p-coral': '#ffaaa8',
};
const COLOR_NAMES = { 'p-blue': 'Pastel blue', 'p-lilac': 'Pastel lilac', 'p-pink': 'Pastel pink', 'p-peach': 'Pastel peach', 'p-butter': 'Pastel yellow', 'p-mint': 'Pastel mint', 'p-sky': 'Pastel sky', 'p-coral': 'Pastel coral' };
const GRADIENTS = {
  'g-ocean': ['#3fb2ec', '#7b93ff'], 'g-dusk': ['#6574f2', '#c08bff'], 'g-grape': ['#a98bfa', '#ee6eae'], 'g-sunset': ['#ff8a5c', '#ee6eae'],
  'g-fire': ['#ef6a6a', '#e9a43a'], 'g-citrus': ['#e9a43a', '#9cc23c'], 'g-aurora': ['#36c08c', '#3fb2ec'], 'g-candy': ['#a6e3c8', '#cbb7ff'],
};
const SOLID_KEYS = Object.keys(COLORS).filter(k => !k.startsWith('p-')), PASTEL_KEYS = Object.keys(COLORS).filter(k => k.startsWith('p-'));
const isHex = c => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c);
/* { c1, c2 }: c2 is set for gradients */
function colorOf(c) {
  if (COLORS[c]) return { c1: COLORS[c], c2: null };
  if (GRADIENTS[c]) return { c1: GRADIENTS[c][0], c2: GRADIENTS[c][1] };
  if (isHex(c)) return { c1: c, c2: null };
  return { c1: COLORS.default, c2: null };
}
function colorName(c) {
  if (COLOR_NAMES[c]) return COLOR_NAMES[c];
  if (GRADIENTS[c]) return c.slice(2)[0].toUpperCase() + c.slice(3) + ' gradient';
  if (isHex(c)) return 'Custom ' + c;
  return c[0].toUpperCase() + c.slice(1);
}
function swatchBtn(k, on, attr) {
  const { c1, c2 } = colorOf(k), bg = c2 ? `linear-gradient(135deg,${c1},${c2})` : c1;
  return `<button class="sw${on ? ' on' : ''}" data-${attr}="${k}" style="--sw:${bg};--swr:${c1}" title="${esc(colorName(k))}" aria-label="${esc(colorName(k))}"></button>`;
}
/* Shape nodes: a short centred label inside a flowchart shape. r is the shape's height as a share of its
   width (it grows taller if the text needs it). Title, note and sub-note nodes only choose between
   rounded (default) and sharp corners ("rect"). Colour styles: where the node's colour shows. */
const SHAPES = [['rect', 'Process'], ['round', 'Rounded'], ['pill', 'Start / end'], ['ellipse', 'Ellipse'], ['circle', 'Circle'],
  ['diamond', 'Decision'], ['para', 'Input / output'], ['hex', 'Preparation'], ['doc', 'Document'], ['cyl', 'Database']];
/* the blocks a shape node can hold */
const SHAPE_KINDS = ['icon', 'image', 'text'];
const SHAPE_RATIO = { rect: 0.42, round: 0.42, pill: 0.3, ellipse: 0.56, circle: 1, diamond: 0.62, para: 0.4, hex: 0.4, doc: 0.5, cyl: 0.6 };
const ACCENTS = [['tint', 'Tinted fill'], ['top', 'Top line'], ['full', 'Full outline'], ['bottom', 'Bottom line'], ['left', 'Left side'], ['none', 'No outline']];
/* What a connection means. "Default" (no type) is a plain line. Each type colours the line and its
   arrow and shows a small icon badge in the middle of the line. */
const EDGE_TYPES = {
  correct:     { label: 'Correct',        icon: 'check',  color: '#2fb866', group: 'Truth' },
  wrong:       { label: 'Wrong',          icon: 'x',      color: '#ec5b5b', group: 'Truth' },
  uncertain:   { label: 'Uncertain',      icon: 'q',      color: '#e3a33b', group: 'Truth' },
  supports:    { label: 'Supports',       icon: 'plus',   color: '#2bb5a2', group: 'Evidence' },
  contradicts: { label: 'Contradicts',    icon: 'minus',  color: '#f07a4f', group: 'Evidence' },
  causes:      { label: 'Causes',         icon: 'zap',    color: '#e9a43a', group: 'Cause & effect' },
  enables:     { label: 'Enables',        icon: 'key',    color: '#3fa7ec', group: 'Cause & effect' },
  prevents:    { label: 'Prevents',       icon: 'ban',    color: '#e35d6a', group: 'Cause & effect' },
  before:      { label: 'Happens before', icon: 'clock',  color: '#a98bfa', group: 'Time & structure' },
  partof:      { label: 'Part of',        icon: 'partof', color: '#8f9bb3', group: 'Time & structure' },
  example:     { label: 'Example of',     icon: 'bulb',   color: '#8f9bb3', group: 'Time & structure' },
};
/* Connection line looks: fluid S-curves (default), geometric right angles, straight, or a rope that
   hangs between its ends (simulated, so it swings when nodes move). */
const LINE_STYLES = [['fluid', 'Fluid'], ['geometric', 'Geometric'], ['straight', 'Straight'], ['catenary', 'Rope']];
/* Groups just bundle nodes (for sorting and selecting together). Panels are the framed areas on the
   board: they have a look, a frame colour, can be folded and can be connected like a node. */
const PANEL_LOOK_IDS = ['dotted', 'outline', 'tinted', 'hatched', 'grid', 'card'];
const BLOCKS = [
  ['text', 'Text', 'Plain paragraph'],
  ['highlight', 'Highlight', 'Emphasised box'],
  ['category', 'Category', 'Labelled section'],
  ['conclusion', 'Conclusion', 'Line + takeaway'],
  ['scenarios', 'Scenarios', 'Chains of events'],
  ['checklist', 'Checklist', 'Things to tick off'],
  ['image', 'Image', 'Upload, paste, link'],
  ['icon', 'Icon', 'From your icon set'],
  ['quote', 'Quote', 'Words from an author'],
  ['math', 'Formula', 'Algebra & maths'],
  ['chem', 'Chemistry', 'Chemical formulas'],
  ['sources', 'Sources', 'Links & references'],
];

/* ---------- factories ---------- */
function makeStep(label = 'Then', text = '', alt = false) { return { id: uid('t'), label, text, alt }; }
function makeScenario(title = '') { return { id: uid('s'), title, steps: [makeStep()] }; }
function makeBlock(kind) {
  const b = { id: uid('b'), kind };
  switch (kind) {
    case 'text': b.text = ''; break;
    case 'highlight': b.label = 'Key point'; b.text = ''; break;
    case 'category': b.label = 'Category'; b.text = ''; break;
    case 'conclusion': b.label = 'Conclusion'; b.text = ''; break;
    case 'scenarios': b.label = 'Scenarios'; b.items = [makeScenario()]; break;
    case 'checklist': b.label = ''; b.items = [{ id: uid('c'), text: '', done: false }]; break;
    case 'image': b.src = ''; b.caption = ''; break;
    case 'icon': b.icon = ''; b.size = 'm'; break;
    case 'quote': b.text = ''; b.author = ''; b.cite = ''; break;
    case 'math': case 'chem': b.tex = ''; break;
    case 'sources': b.label = 'Sources'; b.items = []; break;
  }
  return b;
}
function makeNode(type) {
  return {
    id: uid('n'), type, x: 0, y: 0, w: NODE_W[type], color: 'default',
    tag: type === 'title' ? 'Title' : type === 'note' ? 'Note' : '',
    title: '', subtitle: '',
    blocks: type === 'title' || type === 'shape' ? [] : [makeBlock('text')],
    ...(type === 'shape' ? { shape: 'rect' } : {}),
  };
}
function makeEnv(name) { return { id: uid('e'), name, nodes: [], edges: [], groups: [], panels: [] }; }

/* fresh ids for pasted / duplicated content */
function reIdNode(n) {
  n.id = uid('n');
  n.blocks.forEach(b => {
    b.id = uid('b');
    (b.items || []).forEach(it => { it.id = uid('i'); (it.steps || []).forEach(s => { s.id = uid('t'); }); });
  });
  return n;
}

function nodeText(n) {
  const out = [n.tag, n.title, n.subtitle];
  n.blocks.forEach(b => {
    out.push(b.label, b.text, b.caption, b.author, b.cite, b.tex);
    (b.items || []).forEach(it => { out.push(it.title, it.text, it.t, it.u, it.note); (it.steps || []).forEach(s => out.push(s.label, s.text)); });
  });
  return out.filter(Boolean).join(' \n ');
}
function nodeName(n) {
  const t = mdPlain(n.title).trim();
  if (t) return t;
  const b = n.blocks.find(b => b.text && b.text.trim());
  if (b) return mdPlain(b.text).trim().slice(0, 48);
  return 'Untitled ' + NODE_LABEL[n.type].toLowerCase();
}

function migrate(doc) {
  if (!doc || !Array.isArray(doc.envs) || !doc.envs.length) return demoDoc();
  doc.version = 1;
  if (!LINE_STYLES.some(s => s[0] === doc.lineStyle) || doc.lineStyle === 'fluid') delete doc.lineStyle;
  if (typeof doc.relay !== 'string' || !/^https:\/\/[^\s<>"']+$/i.test(doc.relay)) delete doc.relay;
  doc.folders = Array.isArray(doc.folders) ? doc.folders.filter(f => f && f.id) : [];
  /* the owner's own icons, shared by every environment: { id, name, src } */
  doc.icons = Array.isArray(doc.icons) ? doc.icons.filter(x => x && typeof x.src === 'string' && /^(data:image\/|data\/assets\/|https:\/\/)/.test(x.src)) : [];
  doc.icons.forEach(x => { x.id = String(x.id || uid('ic')); x.name = String(x.name || 'Icon'); });
  /* icon for an environment or category: 'b:<built-in>', 'u:<your icon>' or 't:<emoji or symbol>' */
  const okIcon = x => typeof x.icon === 'string' && /^(b:[\w-]{1,30}|u:[\w-]{1,40}|t:.{1,16})$/u.test(x.icon);
  doc.folders.forEach(f => { f.name = String(f.name || 'Category'); if (!okIcon(f)) delete f.icon; });
  doc.envs.forEach(e => { if (!okIcon(e)) delete e.icon; });
  const folderIds = new Set(doc.folders.map(f => f.id));
  doc.envs.forEach(e => { if (e.folder && !folderIds.has(e.folder)) delete e.folder; });
  doc.envs.forEach(e => {
    e.id = e.id || uid('e'); e.name = e.name || 'Environment';
    e.nodes = Array.isArray(e.nodes) ? e.nodes : [];
    e.edges = Array.isArray(e.edges) ? e.edges : [];
    e.groups = Array.isArray(e.groups) ? e.groups : [];
    e.nodes.forEach(n => {
      if (!NODE_W[n.type]) n.type = 'note';
      n.w = +n.w || NODE_W[n.type]; n.x = +n.x || 0; n.y = +n.y || 0;
      n.color = COLORS[n.color] || GRADIENTS[n.color] || isHex(n.color) ? n.color : 'default';
      /* shape nodes keep their shape; other nodes only have sharp corners or the default rounded ones */
      if (n.type === 'shape') {
        if (!SHAPE_RATIO[n.shape]) n.shape = 'rect';
        /* shape nodes used to have a details line: it is now a text block under the label */
        if (n.subtitle && n.subtitle.trim()) n.blocks.unshift({ id: uid('b'), kind: 'text', text: n.subtitle });
        n.subtitle = '';
      }
      else if (n.shape !== 'rect') delete n.shape;
      if (!ACCENTS.some(s => s[0] === n.accent)) delete n.accent;
      if (n.hidden !== true) delete n.hidden;
      n.blocks = Array.isArray(n.blocks) ? n.blocks : [];
      ['tag', 'title', 'subtitle'].forEach(k => { if (typeof n[k] !== 'string') n[k] = ''; });
      n.blocks.forEach(b => {
        b.id = b.id || uid('b');
        if (['scenarios', 'checklist', 'sources'].includes(b.kind) && !Array.isArray(b.items)) b.items = [];
        if (b.kind === 'sources') b.items.forEach(s => { s.id = s.id || uid('r'); if (typeof s.note !== 'string') s.note = ''; });
        if (b.kind === 'category' && b.closed !== true) delete b.closed;
        if (b.kind === 'quote') ['text', 'author', 'cite'].forEach(k => { if (typeof b[k] !== 'string') b[k] = ''; });
        if ((b.kind === 'math' || b.kind === 'chem') && typeof b.tex !== 'string') b.tex = '';
        if (b.kind === 'icon') { if (typeof b.icon !== 'string') b.icon = ''; if (!['s', 'm', 'l'].includes(b.size)) b.size = 'm'; }
        if (b.above !== true) delete b.above;
        if (b.kind === 'scenarios') b.items.forEach(s => { s.id = s.id || uid('s'); s.steps = Array.isArray(s.steps) ? s.steps : []; });
      });
    });
    e.panels = Array.isArray(e.panels) ? e.panels : [];
    /* boards from before panels existed: a group with a look, or one that lines connect to, becomes a panel
       (it keeps its id, so its connections stay) */
    const linked = new Set(e.edges.flatMap(x => [x.from, x.to]));
    e.groups = e.groups.filter(g => {
      if (!g || !((g.look && g.look !== 'clear') || linked.has(g.id))) return true;
      e.panels.push({ id: g.id || uid('p'), name: String(g.name || 'Panel'), members: g.members || [], look: g.look === 'panel' ? 'card' : g.look === 'hatched' ? 'hatched' : 'dotted', color: g.color });
      return false;
    });
    e.groups.forEach(g => { g.id = g.id || uid('g'); g.name = String(g.name || 'Group'); delete g.look; delete g.color; });
    e.panels.forEach(p => {
      p.id = p.id || uid('p'); p.name = String(p.name || 'Panel');
      if (!PANEL_LOOK_IDS.includes(p.look)) p.look = 'dotted';
      if (!COLORS[p.color]) delete p.color;
      if (p.folded !== true) delete p.folded;
    });
    normalizeEnv(e);
    e.edges.forEach(x => {
      if (!x.bend || !isFinite(x.bend.dx) || !isFinite(x.bend.dy)) delete x.bend;
      if (!EDGE_TYPES[x.type]) delete x.type;
      if (x.style && !LINE_STYLES.some(s => s[0] === x.style)) delete x.style;
    });
  });
  return doc;
}
/* Keep groups and panels consistent: members must exist, a node is in at most one group and one panel,
   a group's nodes all sit in the same panel (or in none), groups need two nodes and panels one.
   Connections may join nodes and/or panels; ones whose end is gone are dropped. */
function normalizeEnv(e) {
  const ids = new Set(e.nodes.map(n => n.id));
  const tidy = (list, min) => {
    const used = new Set();
    list.forEach(x => { x.members = (Array.isArray(x.members) ? x.members : []).filter(id => ids.has(id) && !used.has(id) && used.add(id)); });
    return list.filter(x => x.members.length >= min);
  };
  e.panels = tidy(e.panels, 1);
  e.groups = tidy(e.groups, 2);
  const pOf = new Map();
  e.panels.forEach(p => p.members.forEach(id => pOf.set(id, p)));
  for (const g of e.groups) {
    const votes = new Map();
    g.members.forEach(id => { const p = pOf.get(id) || null; votes.set(p, (votes.get(p) || 0) + 1); });
    if (votes.size < 2) continue;
    const home = [...votes].sort((a, b) => b[1] - a[1])[0][0];
    g.members.forEach(id => {
      const p = pOf.get(id) || null;
      if (p === home) return;
      if (p) p.members = p.members.filter(m => m !== id);
      if (home) home.members.push(id);
      pOf.set(id, home);
    });
  }
  e.panels = e.panels.filter(p => p.members.length);
  const ends = new Set([...ids, ...e.panels.map(p => p.id)]);
  e.edges = e.edges.filter(x => ends.has(x.from) && ends.has(x.to) && x.from !== x.to);
}

/* ---------- starter board ---------- */
function demoDoc() {
  const e = makeEnv('Environment 1');
  const N = (type, x, y, o) => { const n = Object.assign(makeNode(type), { x, y }, o); e.nodes.push(n); return n; };
  const B = (kind, o) => Object.assign(makeBlock(kind), o);
  const S_ = (label, text, alt) => makeStep(label, text, !!alt);
  const E = (a, fs, b, ts, label = '') => e.edges.push({ id: uid('l'), from: a.id, fs, to: b.id, ts, label, arrow: true, dashed: false });

  const t = N('title', -240, -384, { tag: 'Start here', title: 'Welcome to Flogic', subtitle: 'Flow + logic. Right-click anywhere on the board to add a node, then drag from the dots on its sides to connect ideas.' });
  const a = N('note', -552, -192, { tag: 'Blocks', title: 'Build notes from blocks', blocks: [
    B('text', { text: 'Every node has a + in its corner. Use it to add text, highlights, categories, scenarios, checklists, images and sources.' }),
    B('highlight', { label: 'Tip', text: 'Double-click any text to edit it.' }),
    B('category', { label: 'Move things', text: 'Grab the 6-dot handle beside a block to reorder it, drop it into another node, or pull it onto the board.' }),
    B('conclusion', { text: 'Everything snaps to the grid so the board stays tidy. Hold Ctrl to place freely.' }),
  ] });
  const b = N('note', -168, -192, { tag: 'Scenarios', color: 'violet', title: 'Unroll a chain of events', blocks: [
    B('text', { text: 'Scenarios fold up so a node stays compact. Open one to see how it plays out.' }),
    B('scenarios', { label: 'What could happen', items: [
      { id: uid('s'), title: 'The idea holds up', steps: [S_('First', 'You sketch it on the board.'), S_('Then', 'Connections show how each part leads to the next.'), S_('Result', 'The argument reads top to bottom.')] },
      { id: uid('s'), title: 'Someone pushes back', steps: [S_('They say', 'This step does not follow.', 1), S_('You answer', 'Add a sub-note with the missing link and a source.')] },
    ] }),
  ] });
  const c = N('note', 216, -192, { tag: 'Controls', color: 'green', title: 'Getting around', blocks: [
    B('checklist', { label: 'Try these', items: ['Middle-click and drag to pan', 'Scroll to zoom', 'Drag on empty space to box-select', 'Right-click empty space to add a node', 'Ctrl+G groups the selection'].map(text => ({ id: uid('c'), text, done: false })) }),
  ] });
  const d = N('sub', -504, 264, { title: 'Sources & images', blocks: [
    B('text', { text: 'Attach references so anyone reading can check them.' }),
    B('sources', { items: [{ t: 'GitHub Pages docs', u: 'https://docs.github.com/en/pages' }] }),
  ] });
  const f = N('sub', 264, 144, { color: 'green', title: 'Publishing', blocks: [
    B('text', { text: 'Visitors see the published board, read-only. Only you can edit, after connecting GitHub in Settings.' }),
  ] });
  E(t, 'b', a, 't'); E(t, 'b', b, 't', 'for example'); E(t, 'b', c, 't');
  E(a, 'b', d, 't'); E(c, 'b', f, 't');
  return { version: 1, envs: [e] };
}

/* ---------- state ---------- */
let DOC = null;
const CFG = Object.assign({ owner: '', repo: '', branch: 'main', token: '', autoPublish: false, wheel: 'zoom', theme: 'system', snap: true, noLimit: false, focus: 3, focusLast: 3, bgFx: 'clouds', readGlow: true }, readLS(LS.cfg) || {});
const META = Object.assign({ dirty: false, baseSha: null, baseHash: null, publishedAt: 0 }, readLS(LS.meta) || {});
const UI = Object.assign({ envId: null, views: {}, collapsed: {} }, readLS(LS.ui) || {});
const S = {
  envId: null, sel: new Set(), edgeSel: null, panelSel: null,
  canEdit: false, connected: false, preview: false, local: false,
  open: {}, editing: null, tool: 'select', space: false, publishing: false,
};
let CHG = 0;                     // change counter (detects edits made during a publish)
const ASSET_CACHE = {};          // repo path -> data URL, for images uploaded this session

const saveCfg = () => writeLS(LS.cfg, CFG);
const saveMeta = () => writeLS(LS.meta, META);
const saveUI = debounce(() => writeLS(LS.ui, UI), 300);

function env() { return DOC.envs.find(e => e.id === S.envId) || DOC.envs[0]; }
function nodeById(id) { return env().nodes.find(n => n.id === id); }
function groupOf(id) { return env().groups.find(g => g.members.includes(id)); }
function panelOf(id) { return env().panels.find(p => p.members.includes(id)); }

let lsWarned = false;
function saveLocalNow() {
  if (!S.canEdit || !DOC) return;
  if (!writeLS(LS.doc, DOC) && !lsWarned) {
    lsWarned = true;
    toast('Browser storage is full. Publish or export to keep your changes.', { type: 'err', ms: 8000 });
  }
  saveMeta();
}
const saveLocal = debounce(saveLocalNow, 250);
window.addEventListener('beforeunload', () => { saveLocal.flush(); writeLS(LS.ui, UI); });

/* ---------- undo / redo (whole-document snapshots) ---------- */
const H = { undo: [], redo: [] };
function checkpoint() {
  const s = JSON.stringify(DOC);
  if (H.undo[H.undo.length - 1] === s) return;
  H.undo.push(s);
  if (H.undo.length > 150) H.undo.shift();
  H.redo.length = 0;
}
function undo() {
  const cur = JSON.stringify(DOC);
  while (H.undo.length && H.undo[H.undo.length - 1] === cur) H.undo.pop();
  if (!H.undo.length) return toast('Nothing to undo');
  H.redo.push(cur);
  restore(H.undo.pop());
}
function redo() {
  if (!H.redo.length) return toast('Nothing to redo');
  H.undo.push(JSON.stringify(DOC));
  restore(H.redo.pop());
}

/* ---------- encoding helpers ---------- */
function utf8ToB64(s) {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
function b64ToUtf8(b) {
  const bin = atob(b.replace(/\s/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}
function hashStr(str) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) { const ch = str.charCodeAt(i); h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/* ---------- GitHub ---------- */
function detectRepo() {
  const m = location.hostname.match(/^([^.]+)\.github\.io$/i);
  if (!m) return null;
  const seg = location.pathname.split('/').filter(Boolean)[0];
  return { owner: m[1], repo: seg && !/\.html?$/i.test(seg) ? seg : m[1] + '.github.io' };
}
function repoInfo() {
  const d = detectRepo() || {};
  const owner = CFG.owner || d.owner, repo = CFG.repo || d.repo;
  return owner && repo ? { owner, repo, branch: CFG.branch || 'main' } : null;
}
const GH = {
  base() { return `/repos/${encodeURIComponent(CFG.owner)}/${encodeURIComponent(CFG.repo)}`; },
  url(path) { return `${this.base()}/contents/${path.split('/').map(encodeURIComponent).join('/')}`; },
  async api(path, opt = {}) {
    const r = await fetch('https://api.github.com' + path, Object.assign({}, opt, {
      cache: 'no-store',
      headers: Object.assign({ Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + CFG.token, 'X-GitHub-Api-Version': '2022-11-28' }, opt.headers || {}),
    }));
    return r;
  },
  err(r, what) {
    const msg = r.status === 401 ? 'Token is invalid or expired'
      : r.status === 403 ? 'Token lacks permission (needs Contents: Read and write)'
      : r.status === 404 ? 'Repository or branch not found, or the token cannot see it'
      : `${what} failed (HTTP ${r.status})`;
    const e = new Error(msg); e.status = r.status; return e;
  },
  async verify() {
    if (!CFG.owner || !CFG.repo || !CFG.token) throw new Error('Fill in owner, repository and token');
    const r = await this.api(this.base());
    if (!r.ok) throw this.err(r, 'Connecting');
    const j = await r.json();
    if (!j.permissions || !j.permissions.push) { const e = new Error('This token can read the repo but cannot write to it'); e.status = 403; throw e; }
    return j;
  },
  async getFile(path) {
    const q = '?ref=' + encodeURIComponent(CFG.branch || 'main');
    const r = await this.api(this.url(path) + q);
    if (r.status === 404) return null;
    if (!r.ok) throw this.err(r, 'Loading');
    const j = await r.json();
    let text;
    if (j.content && j.encoding === 'base64') text = b64ToUtf8(j.content);
    else {
      const rr = await this.api(this.url(path) + q, { headers: { Accept: 'application/vnd.github.raw+json' } });
      if (!rr.ok) throw this.err(rr, 'Loading');
      text = await rr.text();
    }
    return { sha: j.sha, text };
  },
  async exists(path) {
    const r = await this.api(this.url(path) + '?ref=' + encodeURIComponent(CFG.branch || 'main'));
    if (r.status === 404) return false;
    if (!r.ok) throw this.err(r, 'Checking file');
    return true;
  },
  async putFile(path, b64, sha, message) {
    const body = { message, content: b64, branch: CFG.branch || 'main' };
    if (sha) body.sha = sha;
    const r = await this.api(this.url(path), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) throw this.err(r, 'Saving');
    return (await r.json()).content.sha;
  },
};

/* Images added in the editor live as data URLs until publish, then become files in data/assets/. */
async function uploadAssets() {
  const blocks = (DOC.icons || []).filter(x => x.src.startsWith('data:'));
  DOC.envs.forEach(e => e.nodes.forEach(n => n.blocks.forEach(b => { if (b.kind === 'image' && b.src && b.src.startsWith('data:')) blocks.push(b); })));
  if (!blocks.length) return;
  const extOf = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg', 'image/avif': 'avif' };
  const done = {};
  for (const b of blocks) {
    const src = b.src;
    if (done[src]) { b.src = done[src]; continue; }
    const m = src.match(/^data:([^;,]+);base64,(.*)$/);
    if (!m) continue;
    const b64 = m[2];
    let hash;
    try {
      const bin = atob(b64), bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const buf = await crypto.subtle.digest('SHA-256', bytes);
      hash = Array.from(new Uint8Array(buf)).map(x => x.toString(16).padStart(2, '0')).join('').slice(0, 24);
    } catch (e) { hash = hashStr(b64) + hashStr(b64.slice(-4096)); }
    const path = `${ASSET_DIR}/${hash}.${extOf[m[1]] || 'img'}`;
    if (!(await GH.exists(path))) await GH.putFile(path, b64, null, 'Flogic: add image');
    ASSET_CACHE[path] = src;
    done[src] = path;
    b.src = path;
  }
  saveLocalNow();
}
function imgSrc(src) { return ASSET_CACHE[src] || src; }
/* Fresh uploads take a minute to appear on Pages: fall back to raw.githubusercontent.com meanwhile. */
document.addEventListener('error', e => {
  const img = e.target;
  if (!img || img.tagName !== 'IMG' || img.dataset.fb) return;
  const src = img.getAttribute('data-src');
  if (!src || /^(data:|https?:)/i.test(src)) return;
  const ri = repoInfo();
  if (!ri) return;
  img.dataset.fb = '1';
  img.src = `https://raw.githubusercontent.com/${ri.owner}/${ri.repo}/${ri.branch}/${src}`;
}, true);
