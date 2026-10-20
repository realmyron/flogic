'use strict';
/* Flogic: shared helpers, icons and small UI primitives (menu, toast, modal). */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

const GRID = 24;          // snap unit (world px)
const GAP = 48;           // preferred spacing between nodes
const WORLD = 50000;      // board spans -50k..50k on both axes (100k x 100k)
const ZMIN = 0.1, ZMAX = 4;
const SIDES = ['t', 'r', 'b', 'l'];
const SVGNS = 'http://www.w3.org/2000/svg';
const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const MOD = IS_MAC ? '⌘' : 'Ctrl';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const snapV = v => Math.round(v / GRID) * GRID;
const uid = p => p + Math.random().toString(36).slice(2, 8) + (Date.now() % 46656).toString(36);
const clone = o => JSON.parse(JSON.stringify(o));
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function debounce(fn, ms) {
  let t = 0;
  const f = () => { clearTimeout(t); t = setTimeout(fn, ms); };
  f.flush = () => { clearTimeout(t); fn(); };
  f.cancel = () => clearTimeout(t);
  return f;
}
function getPath(o, p) { return p.split('.').reduce((a, k) => (a == null ? a : a[k]), o); }
function setPath(o, p, v) { const a = p.split('.'), l = a.pop(); a.reduce((x, k) => x[k], o)[l] = v; }
function safeUrl(u) {
  u = String(u || '').trim();
  if (!u) return '';
  if (!/^[a-z][a-z0-9+.-]*:/i.test(u)) u = 'https://' + u;
  return /^https?:\/\/[^\s]+$/i.test(u) ? u : '';
}
/* text with formatting marks removed (for layer names, search, link matching) */
function mdPlain(s) {
  return String(s || '')
    .replace(/\(([^()\n]+?)\)\[[^\[\]\n]+?\]/g, '$1').replace(/\[([^\[\]\n]+?)\]\([^)\s]+\)/g, '$1')
    .replace(/\*\*|==|~~/g, '').replace(/(^|[^*\w])\*(\S[^*\n]*?)\*/g, '$1$2').replace(/(^|[^_\w])_(\S[^_\n]*?)_(?!\w)/g, '$1$2')
    .replace(/^-#\s+/gm, '');
}
function hostOf(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return u; } }
function readLS(k) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
function writeLS(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }
function isTyping() {
  const a = document.activeElement;
  return !!(a && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)));
}

/* ---------- icons (24px grid, stroke) ---------- */
const ICONS = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  x: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  check: '<path d="M5 12.5l4.2 4.2L19 7"/>',
  chev: '<path d="M6 9l6 6 6-6"/>',
  chevr: '<path d="M9 6l6 6-6 6"/>',
  grip: '<g fill="currentColor" stroke="none"><circle cx="9" cy="5.5" r="1.7"/><circle cx="15" cy="5.5" r="1.7"/><circle cx="9" cy="12" r="1.7"/><circle cx="15" cy="12" r="1.7"/><circle cx="9" cy="18.5" r="1.7"/><circle cx="15" cy="18.5" r="1.7"/></g>',
  text: '<path d="M4 6.5h16M4 12h16M4 17.5h10"/>',
  highlight: '<path d="m9 11-6 6v3h9l3-3"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/>',
  category: '<path d="M4 9h16M4 15h16M10 3.5 8 20.5M16 3.5l-2 17"/>',
  conclusion: '<path d="M4 5.5h16M4 10.5h9"/><path d="M3.5 15h17" opacity=".45"/><path d="m13 19 2.5 2 4.5-5"/>',
  scenarios: '<circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="8" r="2"/><path d="M6 7v10"/><path d="M18 10c0 4.5-5 4-10.5 7.5"/>',
  checklist: '<rect x="3.5" y="4.5" width="6" height="6" rx="1.6"/><path d="m4.6 16.4 1.8 1.8 3.1-3.6"/><path d="M13.5 7.5H21M13.5 16.5H21"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="3.2"/><circle cx="9" cy="10" r="1.8"/><path d="m21 15.5-5-5-9.5 9.5"/>',
  sources: '<path d="M10 13.5a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1.2 1.2"/><path d="M14 10.5a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1.2-1.2"/>',
  link: '<path d="M10 13.5a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1.2 1.2"/><path d="M14 10.5a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1.2-1.2"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  cursor: '<path d="M5.5 3.5 19 10l-6.2 1.8L10.4 18z"/>',
  hand: '<path d="M18 11.5V7a1.5 1.5 0 0 0-3 0v4"/><path d="M15 10.5V5a1.5 1.5 0 0 0-3 0v5.5"/><path d="M12 10V6a1.5 1.5 0 0 0-3 0v6.5"/><path d="M9 12.5v-1a1.5 1.5 0 0 0-3 0V14a7 7 0 0 0 7 7h.5a6.5 6.5 0 0 0 6.5-6.5v-3a1.5 1.5 0 0 0-3 0"/>',
  title: '<path d="M6 5v14M18 5v14M6 12h12"/>',
  note: '<rect x="4" y="4" width="16" height="16" rx="4.5"/><path d="M8.5 9.5h7M8.5 13.5h4.5"/>',
  sub: '<rect x="6.5" y="6.5" width="11" height="11" rx="3.2"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
  fit: '<path d="M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15"/>',
  board: '<rect x="3.5" y="3.5" width="17" height="17" rx="4"/><path d="M3.5 9.5h17M9.5 20.5v-11"/>',
  icon: '<path d="M12 3.6l2.5 5.2 5.7.8-4.1 4 1 5.7L12 16.6l-5.1 2.7 1-5.7-4.1-4 5.7-.8z"/>',
  users: '<circle cx="9" cy="8" r="3.2"/><path d="M3 19c.6-3.3 3-5 6-5s5.4 1.7 6 5"/><path d="M15.5 5.2a3 3 0 0 1 0 5.6M17.5 14.4c1.9.6 3.1 2.2 3.5 4.6"/>',
  shape: '<path d="M8.5 3 14 8.5 8.5 14 3 8.5z"/><circle cx="16.5" cy="16.5" r="4.5"/>',
  panel: '<rect x="3" y="4" width="18" height="16" rx="4"/><path d="M3 9.5h18M7 6.8h4"/>',
  group: '<rect x="3" y="3" width="18" height="18" rx="4.5" stroke-dasharray="3 3"/><rect x="7" y="7" width="5.5" height="5.5" rx="1.4"/><rect x="11.5" y="11.5" width="5.5" height="5.5" rx="1.4"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2.5"/><path d="M8 11V7.5a4 4 0 0 1 8 0V11"/>',
  unlock: '<rect x="5" y="11" width="14" height="10" rx="2.5"/><path d="M8 11V7.5a4 4 0 0 1 7.7-1.6"/>',
  eye: '<path d="M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
  q: '<path d="M9 9.2a3 3 0 1 1 4.4 2.6c-.9.5-1.4 1.2-1.4 2.1v.4"/><path d="M12 17.8h.01"/>',
  zap: '<path d="M13 2.5 4.5 13.5H11l-1 8 8.5-11H12z"/>',
  key: '<circle cx="8" cy="15.5" r="4"/><path d="m11 12.5 8.5-8.5M15.5 8l2.5 2.5M13.5 10l2 2"/>',
  ban: '<circle cx="12" cy="12" r="8.5"/><path d="m6 6 12 12"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  partof: '<rect x="3.5" y="3.5" width="17" height="17" rx="3.5"/><rect x="8.5" y="8.5" width="7" height="7" rx="1.5"/>',
  bulb: '<path d="M9.5 18h5M10.5 21h3"/><path d="M12 3a6 6 0 0 0-3.6 10.8c.7.5 1.1 1.3 1.1 2.1v.1h5v-.1c0-.8.4-1.6 1.1-2.1A6 6 0 0 0 12 3z"/>',
  arrowup: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  arrowdown: '<path d="M12 5v14M6 13l6 6 6-6"/>',
  warn: '<path d="M10.3 4.6 2.9 17.4A2 2 0 0 0 4.6 20.4h14.8a2 2 0 0 0 1.7-3L13.7 4.6a2 2 0 0 0-3.4 0z"/><path d="M12 9.5v4.2M12 16.8h.01"/>',
  bubble: '<path d="M20.5 11.2c0 3.9-3.8 7-8.5 7-1.1 0-2.2-.2-3.2-.5L4 19.5l1.4-3.8C4.2 14.5 3.5 12.9 3.5 11.2c0-3.9 3.8-7 8.5-7s8.5 3.1 8.5 7z"/>',
  github: '<path d="M9 19c-4.3 1.4-4.3-2.5-6-3m12 5v-3.5c0-1 .1-1.4-.5-2 2.8-.3 5.5-1.4 5.5-6a4.6 4.6 0 0 0-1.3-3.2 4.2 4.2 0 0 0-.1-3.2s-1.1-.3-3.5 1.3a12.3 12.3 0 0 0-6.2 0C6.5 2.8 5.4 3.1 5.4 3.1a4.2 4.2 0 0 0-.1 3.2A4.6 4.6 0 0 0 4 9.5c0 4.6 2.7 5.7 5.5 6-.6.6-.6 1.2-.5 2V21"/>',
  folder: '<path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>',
  folderopen: '<path d="M3.5 16.5v-9a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v1"/><path d="M3.6 17.2 6 11.6a2 2 0 0 1 1.8-1.2H20a1 1 0 0 1 .9 1.4l-2.4 5.5a2 2 0 0 1-1.8 1.2H5.2a1.7 1.7 0 0 1-1.6-1.3z"/>',
  folderplus: '<path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/><path d="M12 10.5v5M9.5 13h5"/>',
  fluid: '<path d="M4 19c8 0 8-14 16-14"/>',
  geo: '<path d="M4 19h7a2 2 0 0 0 2-2V7a2 2 0 0 1 2-2h5"/>',
  straight: '<path d="M4.5 19.5 19.5 4.5"/><circle cx="4.5" cy="19.5" r="1.4"/><circle cx="19.5" cy="4.5" r="1.4"/>',
  rope: '<path d="M3 6c4 13 14 13 18 0"/><circle cx="3" cy="6" r="1.4"/><circle cx="21" cy="6" r="1.4"/>',
  quote: '<path d="M3.5 5.5h6.5v6l-2.7 6.5H4.7l2.3-6.5H3.5zM14 5.5h6.5v6l-2.7 6.5h-2.6l2.3-6.5H14z"/>',
  math: '<path d="M4 6h7M7.5 2.5v7M14 5l5 5M19 5l-5 5M4 16h7M14 15h5M14 19h5"/>',
  chem: '<path d="M9.5 3h5M10 3v5.5L4.8 18a2 2 0 0 0 1.8 3h10.8a2 2 0 0 0 1.8-3L14 8.5V3"/><path d="M7.5 14h9"/>',
  focus: '<circle cx="12" cy="12" r="3"/><path d="M3 8V5a2 2 0 0 1 2-2h3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3"/>',
  bold: '<path d="M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z"/>',
  italic: '<path d="M10 5h8M6 19h8M14 5l-4 14"/>',
  strike: '<path d="M5 12h14M16 7.5A4 3 0 0 0 12 5c-2.5 0-4 1.3-4 3s1.5 2.6 4 3.2M8 16.5A4 3 0 0 0 12 19c2.5 0 4-1.3 4-3"/>',
  mark: '<path d="m9 11-6 6v3h9l3-3"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/>',
  small: '<path d="M4 7h9M8.5 7v11M14 12h6M17 12v6"/>',
  nodelink: '<rect x="3" y="3" width="8" height="8" rx="2"/><rect x="13" y="13" width="8" height="8" rx="2"/><path d="M7 11v2a4 4 0 0 0 4 4h2"/>',
  text2: '<path d="M4 6h16M4 10h16M4 14h10M4 18h7"/>',
  eyeoff: '<path d="M10.6 5.6A9.6 9.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-2.6 3.4M6.6 6.6C3.9 8.3 2.5 12 2.5 12s3.5 6.5 9.5 6.5a9 9 0 0 0 5.4-1.9"/><path d="M9.9 9.9a2.8 2.8 0 0 0 4 4"/><path d="M3 3l18 18"/>',
  upload: '<path d="M12 15.5V4M7 8.5l5-4.5 5 4.5"/><path d="M4 15v3.5A2.5 2.5 0 0 0 6.5 21h11a2.5 2.5 0 0 0 2.5-2.5V15"/>',
  download: '<path d="M12 4v11.5M7 11l5 4.5 5-4.5"/><path d="M4 15v3.5A2.5 2.5 0 0 0 6.5 21h11a2.5 2.5 0 0 0 2.5-2.5V15"/>',
  settings: '<path d="M4 7h9M17 7h3M4 12h3M11 12h9M4 17h11M19 17h1"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="17" r="2"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2.5 12h2M19.5 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  monitor: '<rect x="3" y="4" width="18" height="12.5" rx="2.5"/><path d="M8 20.5h8M12 16.5v4"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.6 9.6a2.5 2.5 0 1 1 3.4 2.3c-.6.3-1 .8-1 1.5v.5"/><path d="M12 17h.01"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
  arrowr: '<path d="M4 12h15M13 6l6 6-6 6"/>',
  dash: '<path d="M3 12h4M10 12h4M17 12h4"/>',
  swap: '<path d="M7 4 3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7"/>',
  tidy: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.8"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.8"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.8"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.8"/>',
  alignl: '<path d="M4 3v18"/><rect x="8" y="6" width="12" height="4.5" rx="1.2"/><rect x="8" y="13.5" width="7" height="4.5" rx="1.2"/>',
  alignc: '<path d="M12 3v18"/><rect x="5" y="6" width="14" height="4.5" rx="1.2"/><rect x="7.5" y="13.5" width="9" height="4.5" rx="1.2"/>',
  alignt: '<path d="M3 4h18"/><rect x="6" y="8" width="4.5" height="12" rx="1.2"/><rect x="13.5" y="8" width="4.5" height="7" rx="1.2"/>',
  front: '<rect x="9" y="9" width="11" height="11" rx="2.5"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/>',
  back: '<rect x="4" y="4" width="11" height="11" rx="2.5" opacity=".45"/><path d="M19 9v9a2 2 0 0 1-2 2H8"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  layers: '<path d="m12 3.5 9 5-9 5-9-5z"/><path d="m3 13.5 9 5 9-5"/>',
  logout: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l-5-5 5-5M5 12h11"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.3-4.6L4 8M4 4v4h4M4 13a8 8 0 0 0 14.3 4.6L20 16M20 20v-4h-4"/>',
};
function ic(name, size = 16) {
  return `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
}

/* ---------- context menu ---------- */
let MENU = null;
function openMenu(x, y, items, opt = {}) {
  closeMenu();
  items = items.filter(Boolean).filter((it, i, a) => !(it === '-' && (i === 0 || a[i - 1] === '-' || i === a.length - 1)));
  const m = document.createElement('div');
  m.className = 'menu' + (opt.cls ? ' ' + opt.cls : '');
  m.setAttribute('role', 'menu');
  m.innerHTML = items.map((it, i) => {
    if (it === '-') return '<div class="msep"></div>';
    if (it.head) return `<div class="mh">${esc(it.head)}</div>`;
    if (it.swatches) return `<div class="mswatches">${(it.keys || Object.keys(COLORS)).map(k => swatchBtn(k, it.value === k, 'sw')).join('')}</div>`;
    if (it.shapes) return `<div class="mshapes">${SHAPES.map(([k, name]) => `<button class="shb${it.value === k ? ' on' : ''}" data-shape="${k}" title="${name}" aria-label="${name}">${shapeIcon(k)}</button>`).join('')}</div>`;
    if (it.html) return it.html;
    return `<button class="mi${it.danger ? ' danger' : ''}" role="menuitem" data-i="${i}"${it.disabled ? ' disabled' : ''}>${it.icon ? ic(it.icon, 15) : '<span class="ic-sp"></span>'}<span>${esc(it.label)}</span>${it.kbd ? `<kbd>${esc(it.kbd)}</kbd>` : ''}${it.check !== undefined ? `<span class="mchk">${it.check ? ic('check', 14) : ''}</span>` : ''}</button>`;
  }).join('');
  document.body.appendChild(m);
  const r = m.getBoundingClientRect();
  const left = clamp(x, 8, innerWidth - r.width - 8), top = clamp(y, 8, innerHeight - r.height - 8);
  m.style.left = left + 'px'; m.style.top = top + 'px';
  m.style.setProperty('--ox', (x - left) + 'px'); m.style.setProperty('--oy', (y - top) + 'px');
  m.addEventListener('pointerdown', e => e.stopPropagation());
  m.addEventListener('mousedown', e => { if (!e.target.closest('input')) e.preventDefault(); });   // keep focus (and text selection) where it was
  m.addEventListener('contextmenu', e => e.preventDefault());
  m.addEventListener('click', e => {
    if (opt.onClick && opt.onClick(e) === true) { closeMenu(); return; }
    const sw = e.target.closest('[data-sw]');
    if (sw) { const it = items.find(x => x && x.swatches); closeMenu(); it.fn(sw.dataset.sw); return; }
    const shp = e.target.closest('[data-shape]');
    if (shp) { const it = items.find(x => x && x.shapes); closeMenu(); it.fn(shp.dataset.shape); return; }
    const b = e.target.closest('[data-i]');
    if (b && !b.disabled) { const it = items[+b.dataset.i]; closeMenu(); it.fn && it.fn(); }
  });
  m._items = items;
  MENU = m;
  return m;
}
function closeMenu() { if (MENU) { MENU.remove(); MENU = null; } }
function menuKey(e) {
  if (!MENU) return false;
  const btns = $$('.mi:not(:disabled), .bm', MENU);
  let i = btns.findIndex(b => b.classList.contains('act'));
  if (e.key === 'Escape') { closeMenu(); return true; }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Tab') {
    e.preventDefault();
    const d = e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey) ? -1 : 1;
    if (i >= 0) btns[i].classList.remove('act');
    i = (i + d + btns.length) % btns.length;
    btns[i].classList.add('act');
    return true;
  }
  if (e.key === 'Enter' && i >= 0) { e.preventDefault(); btns[i].click(); return true; }
  return true;
}
document.addEventListener('pointerdown', e => { if (MENU && !MENU.contains(e.target)) closeMenu(); }, true);
window.addEventListener('blur', closeMenu);

/* ---------- toast ---------- */
function toast(msg, o = {}) {
  const root = $('#toast-root');
  const t = document.createElement('div');
  t.className = 'toast ' + (o.type || '');
  t.setAttribute('role', 'status');
  t.innerHTML = `<span>${esc(msg)}</span>` + (o.actions || []).map((a, i) => `<button data-i="${i}">${esc(a.label)}</button>`).join('');
  root.appendChild(t);
  while (root.children.length > 3) root.firstChild.remove();
  let gone = false;
  const close = () => { if (gone) return; gone = true; t.classList.add('out'); setTimeout(() => t.remove(), 200); };
  t.addEventListener('click', e => { const b = e.target.closest('button'); if (b) { o.actions[+b.dataset.i].fn(); close(); } });
  setTimeout(close, o.ms || 3200);
  return close;
}

/* ---------- modal ---------- */
function openModal(html, o = {}) {
  const ov = document.createElement('div');
  ov.className = 'modal-ov';
  ov.innerHTML = `<div class="modal ${o.cls || ''}" role="dialog" aria-modal="true">${html}</div>`;
  document.body.appendChild(ov);
  const onk = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  const close = () => {
    if (ov.classList.contains('out')) return;
    ov.classList.add('out');
    setTimeout(() => ov.remove(), 160);
    document.removeEventListener('keydown', onk, true);
    o.onClose && o.onClose();
  };
  document.addEventListener('keydown', onk, true);
  ov.addEventListener('pointerdown', e => { if (e.target === ov) close(); });
  $$('[data-close]', ov).forEach(b => b.addEventListener('click', close));
  return { el: ov.firstChild, close };
}
const modalOpen = () => !!document.querySelector('.modal-ov:not(.out), .lightbox');

function openLightbox(src, caption) {
  const lb = document.createElement('div');
  lb.className = 'lightbox';
  lb.innerHTML = `<img src="${esc(src)}" alt="">${caption ? `<p>${esc(caption)}</p>` : ''}`;
  const close = () => { lb.remove(); document.removeEventListener('keydown', k, true); };
  const k = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  lb.addEventListener('click', close);
  document.addEventListener('keydown', k, true);
  document.body.appendChild(lb);
}
