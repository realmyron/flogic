'use strict';
/* Flogic: document model, undo history, local drafts and GitHub publishing. */

const DATA_PATH = 'data/flogic.json';
const ASSET_DIR = 'data/assets';
const LS = { doc: 'flogic.doc', meta: 'flogic.meta', cfg: 'flogic.cfg', ui: 'flogic.ui' };

const NODE_W = { title: 480, note: 336, sub: 216 };
const NODE_LIMIT = 1000;   // per environment; Settings → "Remove the node limit" lifts it
const NODE_LABEL = { title: 'Title', note: 'Note', sub: 'Sub-note' };
const COLORS = { default: '#7b93ff', sky: '#3fb2ec', violet: '#a98bfa', pink: '#ee6eae', amber: '#e9a43a', green: '#36c08c', red: '#ef6a6a', slate: '#8f9bb3' };
const BLOCKS = [
  ['text', 'Text', 'Plain paragraph'],
  ['highlight', 'Highlight', 'Emphasised box'],
  ['category', 'Category', 'Labelled section'],
  ['conclusion', 'Conclusion', 'Line + takeaway'],
  ['scenarios', 'Scenarios', 'Chains of events'],
  ['checklist', 'Checklist', 'Things to tick off'],
  ['image', 'Image', 'Upload, paste, link'],
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
    case 'sources': b.label = 'Sources'; b.items = []; break;
  }
  return b;
}
function makeNode(type) {
  return {
    id: uid('n'), type, x: 0, y: 0, w: NODE_W[type], color: 'default',
    tag: type === 'title' ? 'Title' : type === 'note' ? 'Note' : '',
    title: '', subtitle: '',
    blocks: type === 'title' ? [] : [makeBlock('text')],
  };
}
function makeEnv(name) { return { id: uid('e'), name, nodes: [], edges: [], groups: [] }; }

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
    out.push(b.label, b.text, b.caption);
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
  if (doc.lineStyle !== 'geometric') delete doc.lineStyle;
  doc.folders = Array.isArray(doc.folders) ? doc.folders.filter(f => f && f.id) : [];
  doc.folders.forEach(f => { f.name = String(f.name || 'Category'); });
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
      n.color = COLORS[n.color] ? n.color : 'default';
      if (n.hidden !== true) delete n.hidden;
      n.blocks = Array.isArray(n.blocks) ? n.blocks : [];
      ['tag', 'title', 'subtitle'].forEach(k => { if (typeof n[k] !== 'string') n[k] = ''; });
      n.blocks.forEach(b => {
        b.id = b.id || uid('b');
        if (['scenarios', 'checklist', 'sources'].includes(b.kind) && !Array.isArray(b.items)) b.items = [];
        if (b.kind === 'sources') b.items.forEach(s => { s.id = s.id || uid('r'); if (typeof s.note !== 'string') s.note = ''; });
        if (b.kind === 'category' && b.closed !== true) delete b.closed;
        if (b.kind === 'scenarios') b.items.forEach(s => { s.id = s.id || uid('s'); s.steps = Array.isArray(s.steps) ? s.steps : []; });
      });
    });
    const ids = new Set(e.nodes.map(n => n.id));
    e.edges = e.edges.filter(x => ids.has(x.from) && ids.has(x.to));
    e.edges.forEach(x => { if (!x.bend || !isFinite(x.bend.dx) || !isFinite(x.bend.dy)) delete x.bend; });
    e.groups.forEach(g => { g.members = (g.members || []).filter(id => ids.has(id)); });
    e.groups = e.groups.filter(g => g.members.length > 1);
  });
  return doc;
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
const CFG = Object.assign({ owner: '', repo: '', branch: 'main', token: '', autoPublish: false, wheel: 'zoom', theme: 'system', snap: true, noLimit: false }, readLS(LS.cfg) || {});
const META = Object.assign({ dirty: false, baseSha: null, baseHash: null, publishedAt: 0 }, readLS(LS.meta) || {});
const UI = Object.assign({ envId: null, views: {}, collapsed: {} }, readLS(LS.ui) || {});
const S = {
  envId: null, sel: new Set(), edgeSel: null,
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
  const blocks = [];
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
