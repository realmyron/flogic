'use strict';
/* Flogic: visitor suggestions.
   A static site can't accept anonymous writes, so a suggestion becomes a GitHub issue on the board's
   repository: the visitor fills in a short form here and GitHub opens pre-filled for them to submit.
   The issue carries a hidden marker saying what it points at (some text in a node, a whole node, or a
   spot on the board). In edit mode the owner's token reads those issues back, the board shows them as
   underlines / warning flags / thought bubbles, and "Solved" closes the issue. */

const SUG_MARKER = /<!--\s*flogic:(\{[\s\S]*?\})\s*-->/;
const SUG_TITLE_MAX = 100, SUG_TEXT_MAX = 1000;
let SUGS = [];
const SUGP = { loading: false, error: '', open: null, loadedAt: 0 };

/* ---------- visitor: send a suggestion ---------- */
/* what the visitor has selected, if it sits inside one node's text */
function viewerSelection() {
  const s = getSelection(), txt = s.toString().trim();
  if (!txt) return null;
  const a = s.anchorNode && (s.anchorNode.nodeType === 3 ? s.anchorNode.parentElement : s.anchorNode);
  const f = a && a.closest && a.closest('.ed'), ne = f && f.closest('.node');
  if (!ne) return { text: txt };
  const line = txt.split('\n').map(l => l.trim()).filter(Boolean).sort((p, q) => q.length - p.length)[0] || txt;
  return { text: txt, node: ne.dataset.id, f: f.dataset.f, q: line.slice(0, 300) };
}
function copyPlain(text) {
  const ok = () => toast('Copied');
  try { navigator.clipboard.writeText(text).then(ok, () => document.execCommand('copy') && ok()); } catch (_) { if (document.execCommand('copy')) ok(); }
}
/* target: { node, f, q } for text or a node, or { x, y } for a spot on the board */
const SUG_AUTHOR_MAX = 60;
function relayUrl() { return /^https:\/\/[^\s]+$/i.test(DOC.relay || '') ? DOC.relay : ''; }
function openSuggestForm(target) {
  const ri = repoInfo(), relay = relayUrl();
  if (!relay && !ri) return toast('Suggestions can be sent from the published site');
  const n = target.node && nodeById(target.node);
  const about = target.q ? `<div class="sug-quote">“${esc(target.q)}”</div><p class="hint" style="margin:6px 0 0">in <b>${esc(n ? nodeName(n) : 'a node')}</b></p>`
    : n ? `<p class="hint" style="margin:0">About the node <b>${esc(nodeName(n))}</b></p>`
    : `<p class="hint" style="margin:0">A new idea for this spot on the board, not tied to any text.</p>`;
  const m = openModal(`<div class="mhead"><h3>${ic(n ? 'warn' : 'bubble', 16)} ${n ? 'Suggest a change' : 'Suggest an idea'}</h3><button class="icon-btn" data-close aria-label="Close">${ic('x', 16)}</button></div>
    <div class="mbody">${about}
      <label class="fld">Title<input id="sg-t" maxlength="${SUG_TITLE_MAX}" placeholder="${n ? 'What should change?' : 'What should be added?'}" autocomplete="off"></label>
      <label class="fld">Details<textarea id="sg-b" maxlength="${SUG_TEXT_MAX}" rows="6" placeholder="${n ? 'Explain the error or how it could be better…' : 'Describe what you would write here…'}"></textarea><span class="sg-count" id="sg-c">0 / ${SUG_TEXT_MAX}</span></label>
      <label class="fld"><span>Your name <span class="opt">(optional)</span></span><input id="sg-a" maxlength="${SUG_AUTHOR_MAX}" placeholder="Leave empty to stay anonymous" autocomplete="nickname"></label>
      <input class="hp" id="sg-w" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
      <p class="hint" style="margin:12px 0 0">${relay ? 'No sign-in needed. Your suggestion goes straight to the owner of this board.' : 'Suggestions are posted on this board’s GitHub page, so you need a free GitHub account. The next page is already filled in: just press <b>Submit new issue</b>.'}</p>
      <div class="mrow"><span class="sstat err" id="sg-e"></span><span class="grow"></span><button class="btn" data-close>Cancel</button><button class="btn primary" id="sg-go">${relay ? ic('upload', 14) + ' Send suggestion' : ic('github', 14) + ' Continue on GitHub'}</button></div>
    </div>`);
  const t = $('#sg-t', m.el), b = $('#sg-b', m.el), a = $('#sg-a', m.el), hp = $('#sg-w', m.el), c = $('#sg-c', m.el), er = $('#sg-e', m.el), go = $('#sg-go', m.el);
  t.focus();
  b.addEventListener('input', () => { c.textContent = `${b.value.length} / ${SUG_TEXT_MAX}`; c.classList.toggle('over', b.value.length >= SUG_TEXT_MAX); });
  const collect = () => {
    const title = t.value.trim().slice(0, SUG_TITLE_MAX), text = b.value.trim().slice(0, SUG_TEXT_MAX), author = a.value.trim().replace(/\s+/g, ' ').slice(0, SUG_AUTHOR_MAX);
    const meta = target.node
      ? { v: 1, kind: 'text', env: S.envId, node: target.node, f: target.f || '', q: target.q || '' }
      : { v: 1, kind: 'bubble', env: S.envId, x: Math.round(target.x), y: Math.round(target.y) };
    if (author) meta.author = author;
    return { title, text, author, meta, where: n ? `“${nodeName(n)}” in ${env().name}` : `a spot in ${env().name}`, page: `${location.origin + location.pathname}#e=${S.envId}` };
  };
  const viaGitHub = d => {
    if (!ri) { er.textContent = 'Could not reach GitHub for this board'; return; }
    /* keep the hidden marker from ever closing its HTML comment early */
    const lt = String.fromCharCode(92) + 'u003c', gt = String.fromCharCode(92) + 'u003e';
    const json = JSON.stringify(d.meta).replace(/</g, lt).replace(/>/g, gt);
    const body = (d.meta.q ? d.meta.q.split('\n').map(l => '> ' + l).join('\n') + '\n\n' : '') + (d.text || '_(no details)_') +
      `\n\n---\n*Suggested from Flogic${d.author ? ' by **' + d.author.replace(/[*_`\[\]<>]/g, '') + '**' : ''}, about ${d.where}* · [open the board](${d.page})\n<!-- flogic:${json} -->`;
    window.open(`https://github.com/${encodeURIComponent(ri.owner)}/${encodeURIComponent(ri.repo)}/issues/new?title=${encodeURIComponent('[Suggestion] ' + d.title)}&body=${encodeURIComponent(body)}`, '_blank', 'noopener');
    m.close();
    toast('Almost done: press “Submit new issue” on the GitHub tab', { ms: 8000 });
  };
  go.addEventListener('click', async () => {
    const d = collect();
    if (!d.title) { er.textContent = 'Give it a short title'; t.focus(); return; }
    if (!relay) return viaGitHub(d);
    go.disabled = true; er.className = 'sstat'; er.textContent = 'Sending…';
    try {
      const r = await fetch(relay, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...d, website: hp.value }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) throw new Error(j.error || 'HTTP ' + r.status);
      m.close();
      toast('Thank you! Your suggestion was sent.', { ms: 5000 });
    } catch (err) {
      go.disabled = false; er.className = 'sstat err';
      er.innerHTML = `Couldn’t send: ${esc(err.message)}${ri ? ' · <a href="#" id="sg-gh">send it through GitHub instead</a>' : ''}`;
      const alt = $('#sg-gh', m.el);
      if (alt) alt.addEventListener('click', ev => { ev.preventDefault(); viaGitHub(collect()); });
    }
  });
}

/* ---------- owner: read & solve ---------- */
function parseIssue(i) {
  const body = i.body || '', mk = body.match(SUG_MARKER);
  if (!mk) return null;
  let meta;
  try { meta = JSON.parse(mk[1]); } catch (_) { return null; }
  if (!meta || typeof meta !== 'object') return null;
  const lines = body.slice(0, mk.index).split(/\n---\n/)[0].split('\n');
  while (lines.length && /^>/.test(lines[0])) lines.shift();
  const kind = meta.kind === 'bubble' || !meta.node ? 'bubble' : 'text';
  return {
    n: i.number, url: i.html_url, created: i.created_at,
    title: String(i.title || '').replace(/^\[suggestion\]\s*/i, '').trim() || 'Suggestion',
    text: lines.join('\n').trim().replace(/^_\(no details\)_$/, ''),
    /* the visitor's own name if they gave one; relay posts otherwise come from your account, so show "anonymous" */
    user: String(meta.author || '').slice(0, 60) || (meta.via === 'relay' ? '' : (i.user ? i.user.login : '')),
    avatar: meta.via === 'relay' || meta.author ? '' : (i.user ? i.user.avatar_url : ''),
    meta: { kind, env: String(meta.env || ''), node: String(meta.node || ''), f: String(meta.f || ''), q: String(meta.q || '').slice(0, 300), x: +meta.x, y: +meta.y },
  };
}
async function fetchSuggestions() {
  if (!S.canEdit || !S.connected) { SUGS = []; renderSugPanel(); return; }
  SUGP.loading = true; SUGP.error = '';
  renderSugPanel();
  try {
    const all = [];
    for (let page = 1; page <= 5; page++) {
      const r = await GH.api(`${GH.base()}/issues?state=open&per_page=100&page=${page}`);
      if (!r.ok) throw GH.err(r, 'Loading suggestions');
      const list = await r.json();
      all.push(...list);
      if (list.length < 100) break;
    }
    SUGS = all.filter(i => !i.pull_request).map(parseIssue).filter(Boolean);
    SUGP.loadedAt = Date.now();
  } catch (err) { SUGP.error = err.message; }
  SUGP.loading = false;
  refreshSuggestions();
}
async function setIssueState(n, state) {
  const r = await GH.api(`${GH.base()}/issues/${n}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(state === 'closed' ? { state, state_reason: 'completed' } : { state }),
  });
  if (r.status === 403 || r.status === 404) throw new Error('your token needs “Issues: Read and write” (Settings → Create a token)');
  if (!r.ok) throw GH.err(r, 'Updating the suggestion');
}
async function solveSuggestion(n) {
  const s = SUGS.find(x => x.n === n);
  if (!s) return;
  try {
    await setIssueState(n, 'closed');
    SUGS = SUGS.filter(x => x !== s);
    hideSugHover();
    refreshSuggestions();
    toast(`Solved: “${s.title}”`, { actions: [{ label: 'Undo', fn: async () => {
      try { await setIssueState(n, 'open'); SUGS.push(s); SUGS.sort((a, b) => b.n - a.n); refreshSuggestions(); }
      catch (err) { toast('Could not reopen: ' + err.message, { type: 'err' }); }
    } }] });
  } catch (err) { toast('Could not mark it solved: ' + err.message, { type: 'err', ms: 7000 }); }
}
function refreshSuggestions() { renderSugPanel(); markAll(); drawBubbles(); }
window.addEventListener('focus', () => { if (S.canEdit && S.connected && Date.now() - SUGP.loadedAt > 90000) fetchSuggestions(); });

/* ---------- on the board: underline + warning flag ---------- */
function sugIcon(s) { return s.meta.kind === 'bubble' ? 'bubble' : 'warn'; }
function flagEl(s, cls) {
  const b = document.createElement('button');
  b.className = 'sug-flag' + (cls ? ' ' + cls : '');
  b.dataset.sug = s.n;
  b.setAttribute('aria-label', 'Suggestion: ' + s.title);
  b.innerHTML = ic('warn', 11);
  return b;
}
/* wrap the first occurrence of q inside field (it may run across several formatted pieces) */
function wrapQuote(field, q, n) {
  const parts = [];
  let full = '';
  const w = document.createTreeWalker(field, NodeFilter.SHOW_TEXT);
  let t;
  while ((t = w.nextNode())) { parts.push({ t, start: full.length }); full += t.data; }
  const idx = q ? full.indexOf(q) : -1;
  if (idx < 0) return null;
  const end = idx + q.length;
  let last = null;
  for (const { t: node, start } of parts) {
    const a = Math.max(idx, start), b = Math.min(end, start + node.data.length);
    if (a >= b) continue;
    let target = node;
    if (a > start) target = target.splitText(a - start);
    if (b - a < target.data.length) target.splitText(b - a);
    const span = document.createElement('span');
    span.className = 'sug-mark';
    span.dataset.sug = n;
    target.parentNode.insertBefore(span, target);
    span.appendChild(target);
    last = span;
  }
  return last;
}
function clearMarks(el) {
  $$('.sug-flag', el).forEach(f => f.remove());
  $$('.sug-mark', el).forEach(m => { if (m.closest('[contenteditable]')) return; const p = m.parentNode; m.replaceWith(...m.childNodes); p.normalize(); });
}
function markNode(n) {
  const el = NODE_EL.get(n.id);
  if (!el) return;
  clearMarks(el);
  if (!S.canEdit || !SUGS.length) return;
  for (const s of SUGS) {
    if (s.meta.kind !== 'text' || s.meta.env !== S.envId || s.meta.node !== n.id) continue;
    const field = s.meta.f && $$('[data-f]', el).find(x => x.dataset.f === s.meta.f);
    if (field && field.hasAttribute('contenteditable')) continue;
    if (!field) { el.appendChild(flagEl(s, 'node-flag')); continue; }
    const mark = wrapQuote(field, s.meta.q, s.n);
    if (mark) { mark.after(flagEl(s)); continue; }
    /* the text was changed since: flag the field itself */
    const host = field.lastElementChild && field.lastElementChild.tagName === 'DIV' ? field.lastElementChild : field;
    host.appendChild(flagEl(s, 'stale'));
  }
}
function markAll() { env().nodes.forEach(markNode); }

/* ---------- thought bubbles for suggestions about an empty spot ---------- */
function drawBubbles() {
  const wrap = $('#bubbles');
  if (!wrap) return;
  const list = S.canEdit ? SUGS.filter(s => s.meta.kind === 'bubble' && s.meta.env === S.envId && isFinite(s.meta.x) && isFinite(s.meta.y)) : [];
  wrap.innerHTML = list.map(s => `<button class="sug-bubble" data-sug="${s.n}" style="transform:translate(${s.meta.x}px,${s.meta.y}px)">${ic('bubble', 14)}<span>${esc(s.title)}</span></button>`).join('');
}

/* ---------- details: shared by the panel, the pop-up and the hover card ---------- */
function ago(iso) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (!isFinite(s)) return '';
  if (s < 60) return 'just now';
  const u = [[31536000, 'y'], [2592000, 'mo'], [86400, 'd'], [3600, 'h'], [60, 'm']].find(([k]) => s >= k);
  return Math.floor(s / u[0]) + u[1] + ' ago';
}
function sugWhere(s) {
  const e = DOC.envs.find(x => x.id === s.meta.env);
  if (s.meta.kind === 'bubble') return e ? `idea on the board · ${e.name}` : 'idea on the board';
  const n = e && e.nodes.find(x => x.id === s.meta.node);
  return n ? `on “${nodeName(n)}” · ${e.name}` : 'on a node that no longer exists';
}
function sugDetailHTML(s) {
  return `<div class="sug-meta">${s.avatar ? `<img src="${esc(s.avatar + (s.avatar.includes('?') ? '&' : '?') + 's=32')}" alt="">` : ''}<span>${s.user ? esc(s.user) : 'anonymous'}</span><span>·</span><span>${ago(s.created)}</span><span>·</span><span>${esc(sugWhere(s))}</span></div>` +
    (s.meta.q ? `<div class="sug-quote">“${esc(s.meta.q)}”</div>` : '') +
    (s.text ? `<div class="sug-text">${esc(s.text)}</div>` : '<div class="sug-text muted">No details given.</div>');
}
function showSugOnBoard(s) {
  const e = DOC.envs.find(x => x.id === s.meta.env);
  if (!e) return toast('That environment no longer exists');
  if (e.id !== S.envId) switchEnv(e.id);
  if (s.meta.kind === 'bubble') {
    animateView(VR.width / 2 - (s.meta.x + 90) * V.z, VR.height / 2 - (s.meta.y + 16) * V.z, V.z);
  } else {
    const n = nodeById(s.meta.node);
    if (!n) return toast('That node no longer exists');
    selectNodes([n.id]); zoomToNodes([n.id]);
  }
  flashMarks(s.n);
}
function flashMarks(n) {
  const els = $$(`.sug-mark[data-sug="${n}"], .sug-flag[data-sug="${n}"], .sug-bubble[data-sug="${n}"]`, world);
  els.forEach(x => { x.classList.remove('hl'); void x.offsetWidth; x.classList.add('hl'); });
  setTimeout(() => els.forEach(x => x.classList.remove('hl')), 2400);
}
/* clicking a flag or bubble: pop-up with the report, and the same item opens in the list */
function openSuggestion(n) {
  const s = SUGS.find(x => x.n === n);
  if (!s) return;
  hideSugHover();
  highlightSugItem(n);
  flashMarks(n);
  const m = openModal(`<div class="mhead"><h3>${ic(sugIcon(s), 16)} ${esc(s.title)}</h3><button class="icon-btn" data-close aria-label="Close">${ic('x', 16)}</button></div>
    <div class="mbody"><div class="sug-body pop">${sugDetailHTML(s)}</div>
    <div class="mrow"><a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${ic('github', 13)} #${s.n} on GitHub</a><span class="grow"></span><button class="btn" id="sm-show">Show on board</button><button class="btn primary" id="sm-solve">${ic('check', 14)} Solved</button></div></div>`);
  $('#sm-solve', m.el).addEventListener('click', () => { m.close(); solveSuggestion(n); });
  $('#sm-show', m.el).addEventListener('click', () => { m.close(); showSugOnBoard(s); });
}

/* ---------- hover card on flags & bubbles ---------- */
let HOVER = null, hoverT = 0;
function hideSugHover() { clearTimeout(hoverT); if (HOVER) { HOVER.remove(); HOVER = null; } }
function showSugHover(target) {
  const s = SUGS.find(x => x.n === +target.dataset.sug);
  if (!s) return;
  clearTimeout(hoverT);
  if (HOVER && HOVER.dataset.sug === String(s.n)) return;
  hideSugHover();
  const h = document.createElement('div');
  h.id = 'sug-hover';
  h.dataset.sug = s.n;
  h.innerHTML = `<b>${esc(s.title)}</b><p>${esc(s.text || (s.meta.q ? '“' + s.meta.q + '”' : 'No details given.'))}</p><div class="sug-actions"><button class="btn sm primary" data-h="solve">${ic('check', 12)} Solved</button><button class="btn sm" data-h="open">Open</button></div>`;
  document.body.appendChild(h);
  const r = target.getBoundingClientRect(), hr = h.getBoundingClientRect();
  h.style.left = clamp(r.left + r.width / 2 - hr.width / 2, 8, innerWidth - hr.width - 8) + 'px';
  h.style.top = (r.bottom + 8 + hr.height > innerHeight ? r.top - hr.height - 8 : r.bottom + 8) + 'px';
  h.addEventListener('mouseenter', () => clearTimeout(hoverT));
  h.addEventListener('mouseleave', () => { hoverT = setTimeout(hideSugHover, 220); });
  h.addEventListener('click', e => {
    const b = e.target.closest('[data-h]');
    if (!b) return;
    if (b.dataset.h === 'solve') solveSuggestion(s.n); else openSuggestion(s.n);
  });
  HOVER = h;
}
document.addEventListener('mouseover', e => {
  const f = e.target.closest && e.target.closest('.sug-flag, .sug-bubble');
  if (f && S.canEdit) showSugHover(f);
});
document.addEventListener('mouseout', e => {
  const f = e.target.closest && e.target.closest('.sug-flag, .sug-bubble');
  if (f && !(e.relatedTarget && (f.contains(e.relatedTarget) || (HOVER && HOVER.contains(e.relatedTarget))))) hoverT = setTimeout(hideSugHover, 220);
});
document.addEventListener('click', e => {
  const f = e.target.closest && e.target.closest('.sug-flag, .sug-bubble');
  if (!f) return;
  e.preventDefault(); e.stopPropagation();
  openSuggestion(+f.dataset.sug);
}, true);

/* ---------- the list under Layers ---------- */
function sugItemHTML(s) {
  const open = SUGP.open === s.n;
  return `<div class="sug-it${open ? ' open' : ''}${s.meta.kind === 'bubble' ? ' bubble' : ''}" data-sug="${s.n}">
    <div class="sug-h" data-sa="toggle">${ic(sugIcon(s), 14)}<span class="nm">${esc(s.title)}</span><span class="cnt">#${s.n}</span></div>
    <div class="fold-b"><div class="fold-bi"><div class="sug-body">${sugDetailHTML(s)}
      <div class="sug-actions"><button class="btn sm primary" data-sa="solve">${ic('check', 12)} Solved</button><button class="btn sm" data-sa="show">Show</button><a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer" title="Open on GitHub">${ic('github', 13)}</a></div>
    </div></div></div></div>`;
}
function renderSugPanel() {
  const box = $('#sug-panel');
  if (!box) return;
  box.hidden = !S.canEdit;
  if (!S.canEdit) return;
  const folded = !!UI.sugFolded;
  let body;
  if (!S.connected) body = '<div class="list-empty">Connect GitHub in Settings to see suggestions from visitors.</div>';
  else if (SUGP.error) body = `<div class="list-empty err">${esc(SUGP.error)}</div>`;
  else if (SUGP.loading && !SUGS.length) body = '<div class="list-empty">Loading…</div>';
  else if (!SUGS.length) body = '<div class="list-empty">No open suggestions.<br>Visitors can right-click text, a node or empty space to send one.</div>';
  else body = SUGS.map(sugItemHTML).join('');
  const top = !!UI.sugTop;
  $('#right').classList.toggle('sug-top', top);
  const lm = $('#layers-move');
  if (lm) {
    lm.innerHTML = ic(top ? 'arrowup' : 'arrowdown', 14);
    lm.title = (top ? 'Move Layers above Suggestions' : 'Move Layers below Suggestions') + ' (or drag this header)';
    lm.setAttribute('aria-label', top ? 'Move Layers above Suggestions' : 'Move Layers below Suggestions');
  }
  box.innerHTML = `<div class="sec-head sug-head" data-sa="fold"><span><span class="lchev${folded ? '' : ' open'}">${ic('chevr', 12)}</span>Suggestions</span><span class="cnt sug-count${SUGS.length ? ' has' : ''}">${SUGS.length || ''}</span>` +
    `<button class="icon-btn sec-move" data-sa="move" title="${top ? 'Move below Layers' : 'Move above Layers'} (or drag this header)" aria-label="${top ? 'Move below Layers' : 'Move above Layers'}">${ic(top ? 'arrowdown' : 'arrowup', 14)}</button>` +
    `${S.connected ? `<button class="icon-btn${SUGP.loading ? ' spin' : ''}" data-sa="refresh" title="Check for new suggestions" aria-label="Refresh">${ic('refresh', 14)}</button>` : ''}</div>` +
    (folded ? '' : `<div class="sug-list">${body}</div>`);
}
function highlightSugItem(n) {
  SUGP.open = n;
  if (UI.sugFolded) { UI.sugFolded = false; saveUI(); }
  renderSugPanel();
  const it = $(`.sug-it[data-sug="${n}"]`);
  if (it) { it.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); it.classList.add('flash'); setTimeout(() => it.classList.remove('flash'), 1300); }
  document.body.classList.add('show-right');
}
/* the Suggestions section can sit above or below Layers */
function moveSugPanel(top) {
  UI.sugTop = top; saveUI(); renderSugPanel();
  const box = $('#sug-panel');
  box.classList.remove('moved'); void box.offsetWidth; box.classList.add('moved');
}
$('#layers-move').addEventListener('click', () => moveSugPanel(!UI.sugTop));

/* drag the Layers or Suggestions header up or down to swap the two sections */
let SEC_DRAG = null;
function sectionDragStart(e, which) {
  if (!S.canEdit || e.button !== 0 || e.target.closest('button, input')) return;
  SEC_DRAG = { which, sy: e.clientY, moved: false, id: e.pointerId };
}
function sectionDragTarget(which, y) {
  /* where the dragged section would go: upper half of the panel = top */
  const r = $('#right').getBoundingClientRect(), upper = y < r.top + r.height / 2;
  return which === 'sug' ? upper : !upper;            // returned value = "Suggestions on top?"
}
window.addEventListener('pointermove', e => {
  const d = SEC_DRAG;
  if (!d || e.pointerId !== d.id) return;
  if (!d.moved) {
    if (Math.abs(e.clientY - d.sy) < 6) return;
    d.moved = true;
    document.body.classList.add('sec-dragging');
    d.line = document.createElement('div');
    d.line.className = 'sec-drop';
    $('#right').appendChild(d.line);
  }
  const sugTop = sectionDragTarget(d.which, e.clientY), rr = $('#right').getBoundingClientRect();
  /* show where it lands: at the very top, or just above the inspector at the bottom */
  const top = (d.which === 'sug') === sugTop;
  const insp = $('#inspector'), bottomY = (insp && insp.offsetHeight ? insp.getBoundingClientRect().top : rr.bottom) - rr.top;
  d.line.style.top = (top ? 2 : bottomY - 3) + 'px';
});
window.addEventListener('pointerup', e => {
  const d = SEC_DRAG;
  if (!d || e.pointerId !== d.id) return;
  SEC_DRAG = null;
  if (!d.moved) return;
  document.body.classList.remove('sec-dragging');
  if (d.line) d.line.remove();
  const sugTop = sectionDragTarget(d.which, e.clientY);
  if (sugTop !== !!UI.sugTop) moveSugPanel(sugTop);
  SEC_NOCLICK = Date.now() + 350;     /* the header's own click (fold/unfold) shouldn't fire after a drag */
});
let SEC_NOCLICK = 0;
$('#sug-panel').addEventListener('pointerdown', e => { if (e.target.closest('.sug-head')) sectionDragStart(e, 'sug'); });
$('#layers-head').addEventListener('pointerdown', e => sectionDragStart(e, 'layers'));

$('#sug-panel').addEventListener('contextmenu', e => {
  if (!e.target.closest('.sug-head')) return;
  e.preventDefault();
  openMenu(e.clientX, e.clientY, [
    { label: 'Move above Layers', icon: 'arrowup', disabled: !!UI.sugTop, fn: () => moveSugPanel(true) },
    { label: 'Move below Layers', icon: 'arrowdown', disabled: !UI.sugTop, fn: () => moveSugPanel(false) },
    '-',
    { label: UI.sugFolded ? 'Expand' : 'Collapse', icon: 'chev', fn: () => { UI.sugFolded = !UI.sugFolded; saveUI(); renderSugPanel(); } },
    S.connected && { label: 'Check for new suggestions', icon: 'refresh', fn: fetchSuggestions },
  ]);
});
$('#sug-panel').addEventListener('click', e => {
  if (Date.now() < SEC_NOCLICK) return;
  const b = e.target.closest('[data-sa]');
  if (!b) return;
  const it = b.closest('.sug-it'), n = it ? +it.dataset.sug : null, s = n && SUGS.find(x => x.n === n);
  switch (b.dataset.sa) {
    case 'fold': UI.sugFolded = !UI.sugFolded; saveUI(); renderSugPanel(); break;
    case 'move': moveSugPanel(!UI.sugTop); break;
    case 'refresh': e.stopPropagation(); fetchSuggestions(); break;
    case 'toggle': SUGP.open = SUGP.open === n ? null : n; renderSugPanel(); if (SUGP.open) flashMarks(n); break;
    case 'solve': solveSuggestion(n); break;
    case 'show': if (s) showSugOnBoard(s); break;
  }
});
