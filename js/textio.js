'use strict';
/* Flogic: board text. Nodes become readable Markdown-style text and come back again.

   "Copy text" gives clean Markdown for sharing. "Copy text for AI" gives the same text plus each node's
   id and settings in a hidden line under its heading, with instructions on top, so an AI (or you) can
   edit it and "Import text" updates those nodes instead of making copies. Text without ids (or with new
   headings) becomes new nodes. Connections are written as "→ [Target](#id)" lines. */

/* ===================== writing ===================== */
/* parents before what they lead to: start from nodes nothing points to (top-left first), then follow
   each node's outgoing links left to right */
function textOrder(ns) {
  const ids = new Set(ns.map(n => n.id)), es = env().edges.filter(x => ids.has(x.from) && ids.has(x.to));
  const byPos = (a, b) => (a.y - b.y) || (a.x - b.x);
  const kids = new Map(ns.map(n => [n.id, []])), hasIn = new Set(es.map(x => x.to));
  es.forEach(x => kids.get(x.from).push(nodeById(x.to)));
  kids.forEach(a => a.sort((p, q) => (p.x - q.x) || (p.y - q.y)));
  const order = [], seen = new Set();
  const visit = n => { if (seen.has(n.id)) return; seen.add(n.id); order.push(n); kids.get(n.id).forEach(visit); };
  ns.filter(n => !hasIn.has(n.id)).sort(byPos).forEach(visit);
  ns.slice().sort(byPos).forEach(visit);
  return { order, es };
}
/* lines of text that would otherwise read as a block (a heading, list, quote…) get a leading backslash */
const TX_SPECIAL = /^(#{1,6}(\s|$)|>|\$\$|\[icon:|<!--|→|->\s|!\[|[-*+]\s+\[[ xX]\]\s|[-*+]\s+\[[^\]]*\]\(\S+\)\s*$|(-{3,}|\*{3,}|_{3,})\s*$|\d+[.)]\s+\*\*|\*\*[^*]+\*\*\s*$|\*[^*\s][^*]*\*\s*$|\\)/;
const txEsc = s => String(s || '').split('\n').map(l => TX_SPECIAL.test(l) ? '\\' + l : l).join('\n');
const txUnesc = l => l.startsWith('\\') ? l.slice(1) : l;
const TX_HEAD = { title: '#', note: '##', sub: '###', shape: '###' };
/* sync: raw text, ids and settings (for "Copy text for AI" and importing back); otherwise clean Markdown */
function boardText(ns, { sync = false } = {}) {
  const { order, es } = textOrder(ns);
  const out = s => sync ? txEsc(s) : mdOut(s);
  const inl = s => sync ? String(s || '').replace(/\n+/g, ' ') : mdOut(s, true);
  const quote = s => s.split('\n').map(l => '> ' + l).join('\n');
  const sections = order.map(n => {
    const L = [];
    L.push(`${TX_HEAD[n.type]} ${sync ? inl(n.title) : (mdOut(n.title, true) || nodeName(n))}`.trimEnd());
    if (sync) {
      const meta = [`id=${n.id}`];
      if (n.type === 'shape') meta.push('type=shape', `shape=${n.shape || 'rect'}`);
      else if (n.shape === 'rect') meta.push('shape=rect');
      if (n.color && n.color !== 'default') meta.push(`color=${n.color}`);
      if (n.accent) meta.push(`accent=${n.accent}`);
      L.push(`<!-- node ${meta.join(' ')} -->`);
    }
    if (n.tag && n.type !== 'shape') L.push(`*${inl(n.tag)}*`);
    if (n.type === 'title' && n.subtitle) L.push('', out(n.subtitle));
    n.blocks.forEach(b => {
      if (n.type === 'shape' && !SHAPE_KINDS.includes(b.kind)) return;
      L.push('');
      if (b.kind === 'text') L.push(out(b.text));
      else if (b.kind === 'highlight') L.push(quote(`**${inl(b.label) || 'Note'}:** ${sync ? b.text || '' : mdOut(b.text)}`));
      else if (b.kind === 'category') L.push(`#### ${inl(b.label) || 'Category'}`, ...(b.text ? [out(b.text).replace(/\n{2,}/g, '\n')] : []));
      else if (b.kind === 'conclusion') L.push('---', '', `**${inl(b.label) || 'Conclusion'}:** ${sync ? b.text || '' : mdOut(b.text)}`);
      else if (b.kind === 'scenarios') {
        if (b.label) L.push(`**${inl(b.label)}**`);
        b.items.forEach((s, i) => {
          L.push(`${i + 1}. **${inl(s.title) || 'Scenario ' + (i + 1)}**`);
          s.steps.forEach(st => {
            const lab = inl(st.label), txt = inl(st.text);
            L.push(`   - ${lab ? (st.alt ? `*${lab}:*` : `**${lab}:**`) + ' ' : ''}${txt}`);
          });
        });
      } else if (b.kind === 'checklist') {
        if (b.label) L.push(`**${inl(b.label)}**`);
        b.items.forEach(it => L.push(`- [${it.done ? 'x' : ' '}] ${inl(it.text)}`));
      } else if (b.kind === 'sources') {
        L.push(`**${inl(b.label) || 'Sources'}**`);
        b.items.forEach(s => {
          L.push(`- [${(s.t || hostOf(s.u)).replace(/[\[\]]/g, '')}](${s.u})`);
          if (s.note && s.note.trim()) L.push(out(s.note).split('\n').map(l => '  ' + l).join('\n'));
        });
      } else if (b.kind === 'quote') {
        L.push(quote(out(b.text) || ''));
        const by = [b.author && `**${inl(b.author)}**`, b.cite && `*${inl(b.cite)}*`].filter(Boolean).join(', ');
        if (by) L.push('>', `> — ${by}`);
      } else if (b.kind === 'math' || b.kind === 'chem') {
        const tex = (b.tex || '').trim(), body = b.kind === 'chem' ? `\\ce{${tex}}` : tex;
        if (!tex && !sync) L.pop();
        else L.push(body.includes('\n') ? `$$\n${body}\n$$` : `$$${body}$$`);
      } else if (b.kind === 'image') {
        if (!b.src && !sync) L.pop();
        else if (b.src && b.src.startsWith('data:')) L.push(sync ? `![${inl(b.caption)}](flogic:image/${b.id})` : `*[Image${b.caption ? ': ' + mdPlain(b.caption) : ''}]*`);
        else { let u = b.src || ''; if (!sync) try { if (u) u = new URL(u, location.href).href; } catch (_) {} L.push(`![${inl(b.caption)}](${u})`); }
      } else if (b.kind === 'icon') {
        if (!sync) L.pop();
        else L.push(`[icon: ${b.icon || 'none'}${(b.size || 'm') !== 'm' ? ' size=' + b.size : ''}${b.above ? ' above' : ''}]`);
      }
    });
    const outs = es.filter(x => x.from === n.id);
    if (outs.length) {
      L.push('', '→ ' + outs.map(x => {
        const t = nodeById(x.to), T = EDGE_TYPES[x.type];
        return `${T ? `**${T.label}** ` : ''}[${nodeName(t).replace(/[\[\]]/g, '')}](#${sync ? t.id : mdSlug(nodeName(t))})${x.label ? ` *(${x.label})*` : ''}`;
      }).join(' · '));
    }
    return L.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  });
  return sections.join('\n\n') + '\n';
}

/* what "Copy text for AI" puts on top: how to read and write this format */
const TX_GUIDE = `=== FLOGIC FORMAT INSTRUCTIONS ===
This is a Flogic board (a canvas of notes connected by arrows), written as text. Edit it, improve it or add to it, then reply with the WHOLE board in this same format, inside one code block, with nothing else in it and without these instructions. It will be imported back into the board.

NODES
- Every node starts with a heading:  "# " a big title node · "## " a note · "### " a small sub-note.
- The "<!-- node id=… -->" line under a heading identifies an existing node. Keep it exactly as it is, so that node is updated instead of copied. For a NEW node, leave the line out (or write "<!-- node color=green -->" to pick its colour).
- A flowchart shape: "### Label" with "<!-- node type=shape shape=diamond -->" (shapes: rect, round, pill, ellipse, circle, diamond, para, hex, doc, cyl). It holds only text, images and icons.
- A line in single *asterisks* right under the heading is the node's small label, e.g. *Evidence*.
- In a "# " title node, the first paragraph is its subtitle.
- Colours: default, sky, violet, pink, amber, green, red, slate, teal, orange, lime, indigo, rose, cyan, gold, brown.

BLOCKS (a node's content, separated by blank lines)
- Text: plain paragraphs. Inline: **bold**, *italic*, ~~strike~~, ==highlight==, "-# " at the start of a line for small print, (shown text)[Exact node title] to link to another node.
- Highlight box: > **Label:** text
- Quote: > the quoted words   then   > — **Author**, *Source and year*
- Category (a titled section that can fold): #### Label   with its text on the very next lines
- Conclusion: a line with ---   then   **Conclusion:** the takeaway   (any bold label before the colon works)
- Checklist: an optional **Label** line, then "- [ ] to do" and "- [x] done"
- Scenarios (what-if chains): an optional **Label** line, then "1. **Scenario title**" with its steps indented under it: "   - **Then:** what happens"  (write *Step:* in italics to put a step on the other side of the chain)
- Sources: **Sources** then "- [Title](https://…)" with an optional indented line under it saying what the source shows
- Formula: $$x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}$$     Chemistry: $$\\ce{2H2 + O2 -> 2H2O}$$
- Image: ![caption](https://…)  — keep lines like ![…](flogic:image/…) exactly as they are
- Icon: [icon: b:bulb]  (built-in: check, x, q, warn, zap, key, ban, clock, bulb, link, image, eye, lock, …; add "size=s" or "size=l")
- To start a text line with one of the symbols above as plain text, put a backslash before it: \\# not a heading

CONNECTIONS
- Arrows from a node go on a line at the end of that node, starting with "→ ", separated by " · ":
  → [Target title](#target-id) · **Supports** [Another node](#another-node) *(optional label)*
- A bold word before a target sets the kind of connection: Correct, Wrong, Uncertain, Supports, Contradicts, Causes, Enables, Prevents, Happens before, Part of, Example of.
- To point at a new node, use its exact title: [New node title](#new-node-title).
- Removing a target from a node's arrow line removes that connection.
=== END OF INSTRUCTIONS ===`;

/* copy to the clipboard (with a fallback for older browsers) */
function copyToClipboard(text, done) {
  const fallback = () => {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.cssText = 'position:fixed;left:-9999px;top:0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); done(); } catch (_) { toast('Could not copy', { type: 'err' }); }
    ta.remove();
  };
  try { navigator.clipboard.writeText(text).then(done, fallback); } catch (_) { fallback(); }
}
function copyTextForAI(ids) {
  const ns = ids.map(nodeById).filter(n => n && !n.hidden);
  if (!ns.length) return toast('Select one or more nodes first');
  endEdit();
  const text = `${TX_GUIDE}\n\n${boardText(ns, { sync: true })}`;
  copyToClipboard(text, () => toast(`Copied ${ns.length} node${ns.length > 1 ? 's' : ''} with instructions. Paste it into an AI chat, then use Import text with its reply.`, { ms: 6000 }));
  return text;
}

/* ===================== reading ===================== */
const TX_LIST = { scen: /^\d+[.)]\s+\*\*(.*?)\*\*\s*$/, chk: /^[-*+]\s+\[([ xX])\]\s+(.*)$/, src: /^[-*+]\s+\[([^\]]*)\]\((\S+?)\)\s*$/ };
const txAttrs = s => { const o = {}; for (const m of String(s).matchAll(/([\w-]+)=("([^"]*)"|\S+)/g)) o[m[1].toLowerCase()] = m[3] != null ? m[3] : m[2]; return o; };
function edgeTypeOf(word) {
  const w = String(word || '').trim().toLowerCase();
  if (!w) return null;
  const hit = Object.entries(EDGE_TYPES).find(([k, t]) => k === w || t.label.toLowerCase() === w);
  return hit ? hit[0] : undefined;
}
/* text -> { nodes: [{ level, title, meta, tag, subtitle, blocks, links, line }], warnings } */
function parseBoardText(raw) {
  let text = String(raw || '').replace(/\r\n?/g, '\n');
  /* the instructions, if they were pasted back in */
  text = text.replace(/^=+\s*FLOGIC[^\n]*INSTRUCTIONS[^\n]*$[\s\S]*?^=+\s*END OF INSTRUCTIONS[^\n]*$/gim, '');
  /* a reply wrapped in code blocks: keep the blocks that hold nodes */
  const fenced = [...text.matchAll(/^(`{3,}|~{3,})[^\n]*\n([\s\S]*?)^\1\s*$/gm)].map(m => m[2]).filter(s => /^#{1,3}(\s|$)/m.test(s));
  if (fenced.length) text = fenced.join('\n\n');
  const lines = text.split('\n'), warnings = [], sections = [];
  let cur = null, pre = [];
  lines.forEach((line, i) => {
    const h = line.match(/^(#{1,3})(?:\s+(.*?))?\s*#*\s*$/);
    if (h && !line.startsWith('\\')) {
      /* an older copy put the node's *label* on the line above its heading */
      const host = cur ? cur.lines : pre;
      let tag = null;
      let k = host.length - 1;
      while (k >= 0 && !host[k].trim()) k--;
      const tm = k >= 0 && host[k].trim().match(/^\*([^*\s][^*]*)\*$/);
      if (tm && (k === 0 || !host[k - 1].trim())) { tag = tm[1].trim(); host.splice(k); }
      cur = { level: h[1].length, title: (h[2] || '').trim(), lines: [], line: i + 1, tagAbove: tag };
      sections.push(cur);
    } else if (cur) cur.lines.push(line); else pre.push(line);
  });
  const nodes = sections.map(s => parseNodeText(s, warnings));
  return { nodes, warnings };
}
function parseNodeText(s, warnings) {
  const L = s.lines, node = { level: s.level, title: s.title, meta: {}, tag: s.tagAbove, subtitle: null, blocks: [], links: [], line: s.line };
  let i = 0;
  const blank = () => { while (i < L.length && !L[i].trim()) i++; };
  blank();
  let m = i < L.length && L[i].trim().match(/^<!--\s*node\b([\s\S]*?)-->$/i);
  if (m) { node.meta = txAttrs(m[1]); i++; blank(); }
  m = i < L.length && L[i].trim().match(/^\*([^*\s][^*]*?)\*$/);
  if (m && node.tag == null) { node.tag = m[1].trim(); i++; }
  const B = node.blocks;
  let lastText = null, afterRule = false, label = null;
  const special = tl => /^(#{4,6}\s|>|\$\$|<!--|→|->|!\[|\[icon:|\*\[Image)/i.test(tl) || /^(-{3,}|\*{3,}|_{3,})$/.test(tl) ||
    TX_LIST.scen.test(tl) || TX_LIST.chk.test(tl) || TX_LIST.src.test(tl);
  const push = b => { B.push(b); lastText = null; afterRule = false; label = null; };
  const nextFilled = j => { while (j < L.length && !L[j].trim()) j++; return j < L.length ? L[j].trim() : ''; };
  while (i < L.length) {
    const raw = L[i], tl = raw.trim();
    if (!tl) { i++; continue; }
    /* connections */
    if ((m = tl.match(/^(→|->)\s*(.*)$/))) { node.links.push(...parseLinks(m[2], node, warnings)); i++; lastText = null; continue; }
    if (/^<!--[\s\S]*-->$/.test(tl)) { i++; continue; }
    /* category: #### Label, then its text */
    if ((m = tl.match(/^#{4,6}\s+(.*)$/))) {
      i++;
      const body = [];
      while (i < L.length && L[i].trim() && !special(L[i].trim())) body.push(txUnesc(L[i])), i++;
      push(Object.assign(makeBlock('category'), { label: m[1].trim(), text: body.join('\n') }));
      continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(tl)) { afterRule = true; i++; continue; }
    /* formula: $$…$$ on one line or across several; \ce{…} makes it chemistry */
    if (tl.startsWith('$$')) {
      let tex;
      if ((m = tl.match(/^\$\$([\s\S]*?)\$\$$/)) && tl.length > 3) { tex = m[1]; i++; }
      else {
        const acc = [tl.slice(2)]; i++;
        while (i < L.length && !L[i].includes('$$')) acc.push(L[i++]);
        if (i < L.length) { acc.push(L[i].slice(0, L[i].indexOf('$$'))); i++; }
        tex = acc.join('\n');
      }
      tex = tex.trim();
      const ce = tex.match(/^\\ce\{([\s\S]*)\}$/);
      push(Object.assign(makeBlock(ce ? 'chem' : 'math'), { tex: ce ? ce[1].trim() : tex }));
      continue;
    }
    /* quote or highlight */
    if (tl.startsWith('>')) {
      const q = [];
      while (i < L.length && L[i].trim().startsWith('>')) q.push(L[i].trim().replace(/^>\s?/, '')), i++;
      const hm = q[0].match(/^\*\*(.+?):\*\*\s*(.*)$/);
      if (hm) push(Object.assign(makeBlock('highlight'), { label: hm[1].trim(), text: [hm[2], ...q.slice(1)].join('\n').trim() }));
      else {
        while (q.length && !q[q.length - 1].trim()) q.pop();
        let author = '', cite = '';
        const bm = q.length && q[q.length - 1].match(/^(?:—|–|--)\s*(.*)$/);
        if (bm) {
          q.pop();
          const by = bm[1].trim(), a = by.match(/\*\*(.+?)\*\*/), c = by.match(/(?:^|,\s*)\*([^*]+)\*\s*$/);
          if (a || c) { author = a ? a[1] : ''; cite = c ? c[1] : ''; }
          else { const k = by.indexOf(', '); author = k > 0 ? by.slice(0, k) : by; cite = k > 0 ? by.slice(k + 2) : ''; }
        }
        while (q.length && !q[q.length - 1].trim()) q.pop();
        push(Object.assign(makeBlock('quote'), { text: q.map(txUnesc).join('\n'), author: author.trim(), cite: cite.trim() }));
      }
      continue;
    }
    /* image; flogic:image/<id> points at an image that already lives on the board */
    if ((m = tl.match(/^!\[([^\]]*)\]\((.*)\)$/))) {
      const src = m[2].trim();
      const own = src.startsWith('flogic:image/'), asset = /^data\/assets\/[\w.-]+$/.test(src);
      push(Object.assign(makeBlock('image'), { caption: m[1], src: own ? '' : asset ? src : (safeUrl(src) || ''), ref: own ? src.slice(13) : null }));
      i++; continue;
    }
    if (/^\*\[Image[^\]]*\]\*$/i.test(tl)) { warnings.push(`“${node.title || 'A node'}”: an image that only lives on the board can't come back from plain text, so it was left out`); i++; continue; }
    if ((m = tl.match(/^\[icon:\s*([^\]]*)\]$/i))) {
      const parts = m[1].trim().split(/\s+/), ref = parts[0] && parts[0] !== 'none' ? (/^[bu]:/.test(parts[0]) ? parts[0] : 'b:' + parts[0]) : '';
      const size = (parts.find(p => /^size=/.test(p)) || 'size=m').slice(5);
      if (ref.startsWith('b:') && !ICONS[ref.slice(2)]) warnings.push(`“${node.title || 'A node'}”: there is no built-in icon called “${ref.slice(2)}”`);
      push(Object.assign(makeBlock('icon'), { icon: ref, size: ['s', 'm', 'l'].includes(size) ? size : 'm' }, parts.includes('above') ? { above: true } : {}));
      i++; continue;
    }
    /* a **Label** line in front of a list names that list */
    if ((m = tl.match(/^\*\*([^*]+?)\*\*$/)) && !/:$/.test(m[1])) {
      const nx = nextFilled(i + 1);
      if (TX_LIST.scen.test(nx) || TX_LIST.chk.test(nx) || TX_LIST.src.test(nx)) { label = m[1].trim(); i++; continue; }
    }
    if (TX_LIST.scen.test(tl)) {
      const items = [];
      while (i < L.length) {
        const t2 = L[i].trim();
        if (!t2) { if (TX_LIST.scen.test(nextFilled(i)) || (items.length && /^\s+[-*+]\s/.test(L[i + 1] || ''))) { i++; continue; } break; }
        let sm;
        if ((sm = t2.match(TX_LIST.scen))) { items.push({ id: uid('s'), title: sm[1].trim(), steps: [] }); i++; continue; }
        if (items.length && (sm = L[i].match(/^\s*[-*+]\s+(.*)$/)) && !TX_LIST.chk.test(t2) && !TX_LIST.src.test(t2)) {
          const st = sm[1], a = st.match(/^\*\*(.+?):\*\*\s*(.*)$/), b = st.match(/^\*([^*]+?):\*\s*(.*)$/);
          items[items.length - 1].steps.push(makeStep(a ? a[1].trim() : b ? b[1].trim() : '', a ? a[2] : b ? b[2] : st, !!b));
          i++; continue;
        }
        break;
      }
      items.forEach(it => { if (!it.steps.length) it.steps.push(makeStep()); });
      push(Object.assign(makeBlock('scenarios'), { label: label || 'Scenarios', items }));
      continue;
    }
    if (TX_LIST.chk.test(tl)) {
      const items = [];
      let cm;
      while (i < L.length && (cm = L[i].trim().match(TX_LIST.chk))) { items.push({ id: uid('c'), text: cm[2].trim(), done: cm[1] !== ' ' }); i++; }
      push(Object.assign(makeBlock('checklist'), { label: label || '', items }));
      continue;
    }
    if (TX_LIST.src.test(tl)) {
      const items = [];
      let sm;
      while (i < L.length) {
        if ((sm = L[i].trim().match(TX_LIST.src))) { const u = safeUrl(sm[2]); if (u) items.push({ id: uid('r'), t: sm[1].trim(), u, note: '' }); i++; continue; }
        if (items.length && /^\s{2,}\S/.test(L[i]) && !TX_LIST.src.test(L[i].trim())) { const it = items[items.length - 1]; it.note = (it.note ? it.note + '\n' : '') + txUnesc(L[i].trim()); i++; continue; }
        break;
      }
      push(Object.assign(makeBlock('sources'), { label: label || 'Sources', items }));
      continue;
    }
    /* conclusion: **Label:** text after a --- line */
    if (afterRule && (m = tl.match(/^\*\*(.+?):\*\*\s*(.*)$/))) {
      const body = [m[2]]; i++;
      while (i < L.length && L[i].trim() && !special(L[i].trim())) body.push(txUnesc(L[i])), i++;
      push(Object.assign(makeBlock('conclusion'), { label: m[1].trim(), text: body.join('\n').trim() }));
      continue;
    }
    /* anything else is text; paragraphs in a row make one text block */
    const para = [];
    while (i < L.length && L[i].trim() && (para.length === 0 || !special(L[i].trim()))) { para.push(txUnesc(L[i])); i++; if (special(tl) && para.length === 1) break; }
    const t = para.join('\n');
    afterRule = false; label = null;
    if (node.level === 1 && node.subtitle == null && !B.length) { node.subtitle = t; continue; }
    if (lastText) lastText.text += '\n\n' + t;
    else { lastText = Object.assign(makeBlock('text'), { text: t }); B.push(lastText); }
  }
  return node;
}
/* "[**Type**] [Name](#anchor) [*(label)*]" items; plain names work too */
function parseLinks(s, node, warnings) {
  const out = [];
  const re = /(?:\*\*([^*]+)\*\*\s*)?\[([^\]]+)\]\(([^)]*)\)(?:\s*\*\(([^)]*)\)\*)?/g;
  let m, any = false;
  while ((m = re.exec(s))) {
    any = true;
    const type = edgeTypeOf(m[1]);
    if (type === undefined) warnings.push(`“${node.title || 'A node'}”: “${m[1]}” is not a connection type, so a plain line was used`);
    out.push({ type: type || null, name: m[2].trim(), anchor: m[3].trim().replace(/^#/, ''), label: (m[4] || '').trim() });
  }
  if (!any) s.split(/\s*[·,;]\s*/).map(x => x.trim()).filter(Boolean).forEach(x => {
    const tm = x.match(/^\*\*([^*]+)\*\*\s*(.*)$/), type = tm ? edgeTypeOf(tm[1]) : null;
    out.push({ type: type || null, name: (tm ? tm[2] : x).replace(/[*_\[\]]/g, '').trim(), anchor: '', label: '' });
  });
  return out;
}

/* ===================== planning & applying ===================== */
const txSlug = s => mdSlug(String(s || '').replace(/\(([^()\n]+?)\)\[([^\[\]\n]+?)\]/g, '$1'));
const txType = p => p.meta.type === 'shape' ? 'shape' : ['title', 'note', 'sub'][p.level - 1] || 'note';
/* what an import would do, without doing it */
function planImport(parsed, opts = {}) {
  const e = env(), byId = new Map(e.nodes.map(n => [n.id, n])), used = new Set();
  const items = parsed.nodes.map(p => {
    const ex = p.meta.id && byId.get(p.meta.id);
    const existing = ex && !used.has(ex.id) ? ex : null;
    if (existing) used.add(existing.id);
    return { p, existing };
  });
  const warnings = parsed.warnings.slice();
  parsed.nodes.forEach(p => { if (p.meta.id && !byId.has(p.meta.id)) warnings.push(`“${p.title || 'A node'}” has an id that isn't on this board, so it will be added as a new node`); });
  /* where each arrow points: an id, then a node in this text, then a node on the board (by title) */
  const resolve = link => {
    const a = link.anchor, sa = txSlug(a), sn = txSlug(link.name);
    let it = items.find(x => x.existing && x.existing.id === a) || items.find(x => x.p.meta.id === a && a);
    if (!it) it = items.find(x => sa && txSlug(x.p.title) === sa) || items.find(x => sn && txSlug(x.p.title) === sn);
    if (it) return { item: it };
    const n = byId.get(a) || e.nodes.find(x => sn && txSlug(nodeName(x)) === sn) || e.nodes.find(x => sa && txSlug(nodeName(x)) === sa);
    return n ? { node: n } : null;
  };
  let links = 0, removed = 0;
  const unresolved = [];
  const inSet = new Set(items.filter(x => x.existing).map(x => x.existing.id));
  items.forEach(x => {
    x.targets = [];
    x.p.links.forEach(l => {
      const r = resolve(l);
      if (!r) { unresolved.push(l.name); return; }
      if (r.item === x || r.node === x.existing) return;
      x.targets.push(Object.assign({}, l, r)); links++;
    });
    if (x.existing) {
      const keep = new Set(x.targets.map(t => t.node ? t.node.id : t.item.existing && t.item.existing.id).filter(Boolean));
      removed += e.edges.filter(ed => ed.from === x.existing.id && inSet.has(ed.to) && !keep.has(ed.to)).length;
    }
  });
  if (unresolved.length) warnings.push(`No node found for: ${[...new Set(unresolved)].map(n => `“${n}”`).join(', ')} (those arrows are skipped)`);
  items.forEach(x => x.p.blocks.forEach(b => { if (b.ref && !findBlock(b.ref)) warnings.push(`“${x.p.title || 'A node'}”: an image it refers to is no longer on this board`); }));
  const missing = (opts.scope || []).filter(id => byId.has(id) && !inSet.has(id));
  return { items, links, removed, warnings, missing, updates: items.filter(x => x.existing).length, creates: items.filter(x => !x.existing).length };
}
function findBlock(id) {
  for (const en of DOC.envs) for (const n of en.nodes) { const b = n.blocks.find(x => x.id === id); if (b) return b; }
  return null;
}
/* put the text of a parsed node into a node */
function fillNode(n, p, isNew) {
  const type = txType(p);
  if (n.type !== type) {
    if (n.w === NODE_W[n.type] || (type === 'shape' && n.w > 360)) n.w = NODE_W[type];
    n.type = type;
  }
  n.title = p.title || '';
  if (p.tag != null) n.tag = p.tag; else if (!isNew) n.tag = '';
  if (type === 'title') n.subtitle = p.subtitle || '';
  const mt = p.meta;
  if (type === 'shape') n.shape = SHAPE_RATIO[mt.shape] ? mt.shape : (SHAPE_RATIO[n.shape] ? n.shape : 'rect');
  else if (mt.shape === 'rect') n.shape = 'rect'; else if (!isNew && mt.id) delete n.shape;
  if (mt.color && (COLORS[mt.color] || GRADIENTS[mt.color] || isHex(mt.color))) n.color = mt.color;
  if (mt.accent && ACCENTS.some(a => a[0] === mt.accent)) n.accent = mt.accent;
  /* blocks: images that live on the board come back from their old block */
  const old = isNew ? [] : n.blocks;
  n.blocks = p.blocks.map(b => {
    const c = Object.assign({}, b);
    if (c.kind === 'image' && c.ref) {
      const src = findBlock(c.ref);
      if (!src) return null;            // the image it pointed at is gone
      c.src = src.src; if (!c.caption) c.caption = src.caption;
    }
    delete c.ref;
    return c;
  }).filter(Boolean);
  /* blocks a shape node can't show (kept from before) stay where they were */
  if (type === 'shape') old.filter(b => !SHAPE_KINDS.includes(b.kind)).forEach(b => n.blocks.push(b));
  /* like a note made by hand, an empty note still has a text block to type in */
  if ((type === 'note' || type === 'sub') && !n.blocks.length) n.blocks = [makeBlock('text')];
}
/* new nodes in rows under `origin`: parents above what they lead to, clear of other nodes */
function layoutNew(items, origin) {
  const fresh = items.filter(x => x.created), ids = new Set(fresh.map(x => x.node.id));
  if (!fresh.length) return;
  const level = new Map(fresh.map(x => [x.node.id, 0]));
  for (let k = 0; k < 30; k++) {
    let ch = false;
    fresh.forEach(x => x.targets.forEach(t => {
      const to = t.item ? t.item.node : null;
      if (to && ids.has(to.id) && to !== x.node && level.get(to.id) <= level.get(x.node.id) && level.get(x.node.id) < 25) { level.set(to.id, level.get(x.node.id) + 1); ch = true; }
    }));
    if (!ch) break;
  }
  const rows = [];
  fresh.forEach(x => { const l = level.get(x.node.id); (rows[l] = rows[l] || []).push(x.node); });
  const size = n => { const el = NODE_EL.get(n.id); return { w: el ? el.offsetWidth : n.w, h: el ? el.offsetHeight : 160 }; };
  let y = origin.y;
  rows.filter(Boolean).forEach(row => {
    const ws = row.map(size), total = ws.reduce((a, s) => a + s.w, 0) + GAP * (row.length - 1);
    let x = origin.x - total / 2;
    row.forEach((n, k) => { n.x = snapV(x); n.y = snapV(y); x += ws[k].w + GAP; });
    y += Math.max(...ws.map(s => s.h)) + GAP * 1.5;
  });
  /* move the whole group down until it doesn't sit on top of other nodes */
  const others = env().nodes.filter(n => !ids.has(n.id) && !n.hidden).map(n => rectOf(n, true));
  const box = () => { const ns = fresh.map(x => x.node); const rs = ns.map(n => ({ x: n.x, y: n.y, w: size(n).w, h: size(n).h })); return { x: Math.min(...rs.map(r => r.x)) - GRID, y: Math.min(...rs.map(r => r.y)) - GRID, x2: Math.max(...rs.map(r => r.x + r.w)) + GRID, y2: Math.max(...rs.map(r => r.y + r.h)) + GRID }; };
  for (let k = 0; k < 200; k++) {
    const b = box();
    if (!others.some(r => r.x < b.x2 && r.x + r.w > b.x && r.y < b.y2 && r.y + r.h > b.y)) break;
    fresh.forEach(x => { x.node.y += GRID * 4; });
  }
}
/* which sides a new arrow uses: facing each other */
function facingSides(a, b) {
  const ra = rectOf(a, true), rb = rectOf(b, true);
  const dx = (rb.x + rb.w / 2) - (ra.x + ra.w / 2), dy = (rb.y + rb.h / 2) - (ra.y + ra.h / 2);
  if (Math.abs(dy) * 1.4 > Math.abs(dx)) return dy > 0 ? ['b', 't'] : ['t', 'b'];
  return dx > 0 ? ['r', 'l'] : ['l', 'r'];
}
function applyImport(plan, opts = {}) {
  endEdit(); checkpoint();
  const e = env(), byId = new Map(e.nodes.map(n => [n.id, n]));
  if (!CFG.noLimit && e.nodes.length + plan.creates > NODE_LIMIT) { toast(`That would go over the ${NODE_LIMIT.toLocaleString()}-node limit`, { type: 'err' }); return; }
  /* 1. nodes */
  plan.items.forEach(x => {
    if (x.existing) { fillNode(x.existing, x.p, false); x.node = x.existing; return; }
    const n = makeNode(txType(x.p));
    n.blocks = [];
    fillNode(n, x.p, true);
    if (x.p.tag == null) n.tag = '';
    e.nodes.push(n);
    x.node = n; x.created = true;
  });
  /* 2. nodes that were selected but aren't in the text, if asked */
  if (opts.deleteMissing && plan.missing.length) {
    const gone = new Set(plan.missing);
    e.nodes = e.nodes.filter(n => !gone.has(n.id));
    e.edges = e.edges.filter(x => !gone.has(x.from) && !gone.has(x.to));
    gone.forEach(id => { const el = NODE_EL.get(id); if (el) { NODE_EL.delete(id); RO.unobserve(el); el.remove(); SIZE.delete(id); DISP.delete(id); } });
  }
  structureChanged();
  plan.items.forEach(x => { if (x.existing) renderNode(x.node); });
  /* 3. place the new nodes: at the spot you picked, else under the nodes that were updated, else mid-screen */
  const upd = plan.items.filter(x => x.existing).map(x => x.node);
  let origin = opts.at;
  if (!origin && upd.length) { const bb = bboxOf(upd, true); origin = { x: bb.x + bb.w / 2, y: bb.y + bb.h + GAP * 2 }; }
  if (!origin) { const c = toWorld(VR.left + VR.width / 2, VR.top + VR.height * 0.3); origin = c; }
  layoutNew(plan.items, origin);
  /* 4. connections */
  const inSet = new Set(plan.items.map(x => x.node.id));
  let added = 0, dropped = 0;
  plan.items.forEach(x => {
    const from = x.node, want = new Map();
    x.targets.forEach(t => { const to = t.item ? t.item.node : byId.get(t.node.id); if (to && to !== from && e.nodes.includes(to)) want.set(to.id, t); });
    if (x.existing) {
      const before = e.edges.length;
      e.edges = e.edges.filter(ed => !(ed.from === from.id && inSet.has(ed.to) && !want.has(ed.to)));
      dropped += before - e.edges.length;
    }
    want.forEach((t, toId) => {
      let ed = e.edges.find(q => q.from === from.id && q.to === toId);
      if (!ed) {
        const [fs, ts] = facingSides(from, nodeById(toId));
        ed = { id: uid('l'), from: from.id, fs, to: toId, ts, label: '', arrow: true, dashed: false };
        e.edges.push(ed); added++;
      }
      if (t.type) ed.type = t.type; else delete ed.type;
      ed.label = t.label || '';
    });
  });
  structureChanged();
  const all = plan.items.map(x => x.node.id), made = plan.items.filter(x => x.created).map(x => x.node.id);
  S.sel = new Set(all); S.edgeSel = null; refreshSel();
  if (made.length) { popIn(made, true); zoomToNodes(all); const bb = bboxOf(made.map(nodeById), true); bgPulse(bb.x + bb.w / 2, bb.y + bb.h / 2, null, 0.9, 0.6); }
  const parts = [plan.updates && `${plan.updates} updated`, made.length && `${made.length} new`, added && `${added} connection${added > 1 ? 's' : ''} added`, dropped && `${dropped} removed`].filter(Boolean);
  toast(parts.length ? 'Imported: ' + parts.join(', ') : 'Imported (nothing changed)', { actions: [{ label: 'Undo', fn: undo }] });
}

/* ===================== import window ===================== */
/* opts.at: where new nodes go (a board position); opts.scope: the nodes that were selected */
function openImport(text, opts = {}) {
  if (!S.canEdit) return toast('Only the owner can import into this board');
  const m = openModal(`<div class="mhead"><h3>${ic('upload', 16)} Import text</h3><button class="icon-btn" data-close aria-label="Close">${ic('x', 16)}</button></div>
    <div class="mbody imp">
      ${opts.note ? `<p class="hint" style="margin-top:0">${esc(opts.note)}</p>` : ''}
      <div class="imp-sum" id="imp-sum"></div>
      <ul class="imp-warn" id="imp-warn" hidden></ul>
      <textarea id="imp-text" spellcheck="false" placeholder="Paste Flogic text here (${MOD}+V)…"></textarea>
      <label class="tog" id="imp-del-row" hidden><input type="checkbox" id="imp-del"><span></span><span id="imp-del-t"></span></label>
      <div class="mrow"><button class="btn" id="imp-file">${ic('folderopen', 14)} Open a file…</button><span class="grow"></span><button class="btn" data-close>Cancel</button><button class="btn primary" id="imp-go">Import</button></div>
    </div>`, { cls: 'imp-modal' });
  const q = s => $(s, m.el), ta = q('#imp-text');
  ta.value = text || '';
  let plan = null, T = 0;
  const update = () => {
    plan = planImport(parseBoardText(ta.value), opts);
    const chip = (n, t, cls = '') => n ? `<span class="imp-chip ${cls}"><b>${n}</b> ${t}</span>` : '';
    q('#imp-sum').innerHTML = (plan.updates + plan.creates)
      ? chip(plan.updates, plan.updates === 1 ? 'node updated' : 'nodes updated') + chip(plan.creates, plan.creates === 1 ? 'new node' : 'new nodes', 'new') +
        chip(plan.links, plan.links === 1 ? 'connection' : 'connections') + chip(plan.removed, plan.removed === 1 ? 'connection removed' : 'connections removed', 'del')
      : `<span class="imp-empty">${ta.value.trim() ? 'No nodes found. Each node needs a heading line starting with #, ## or ###.' : 'Paste text, or open a file.'}</span>`;
    const w = q('#imp-warn');
    w.hidden = !plan.warnings.length;
    w.innerHTML = plan.warnings.slice(0, 8).map(x => `<li>${ic('warn', 13)}<span>${esc(x)}</span></li>`).join('') + (plan.warnings.length > 8 ? `<li><span>…and ${plan.warnings.length - 8} more</span></li>` : '');
    const k = plan.missing.length;
    q('#imp-del-row').hidden = !k;
    q('#imp-del-t').textContent = `Also delete the ${k} selected node${k > 1 ? 's' : ''} that ${k > 1 ? 'are' : 'is'} not in the text`;
    q('#imp-go').disabled = !(plan.updates + plan.creates);
  };
  ta.addEventListener('input', () => { clearTimeout(T); T = setTimeout(update, 200); });
  ta.addEventListener('keydown', e => e.stopPropagation());
  q('#imp-file').addEventListener('click', () => pickTextFile(t => { ta.value = t; update(); }));
  q('#imp-go').addEventListener('click', () => { if (!plan || !(plan.updates + plan.creates)) return; m.close(); applyImport(plan, { at: opts.at, deleteMissing: q('#imp-del').checked }); });
  update();
  setTimeout(() => { if (!ta.value) ta.focus(); }, 30);
}
function pickTextFile(fn) {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = '.txt,.md,.markdown,text/plain,text/markdown';
  inp.addEventListener('change', () => {
    const f = inp.files && inp.files[0];
    if (!f) return;
    if (f.size > 5e6) return toast('That file is too big to import', { type: 'err' });
    const r = new FileReader();
    r.onload = () => fn(String(r.result || ''));
    r.onerror = () => toast('Could not read that file', { type: 'err' });
    r.readAsText(f);
  });
  inp.click();
}
function importFromClipboard(opts = {}) {
  if (!S.canEdit) return;
  const fail = () => openImport('', Object.assign({ note: 'Your browser did not let Flogic read the clipboard. Paste the text below instead.' }, opts));
  try { navigator.clipboard.readText().then(t => openImport(t, opts), fail); } catch (_) { fail(); }
}
function importFromFile(opts = {}) {
  if (!S.canEdit) return;
  pickTextFile(t => openImport(t, opts));
}
