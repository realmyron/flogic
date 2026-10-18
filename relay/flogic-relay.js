/* Flogic suggestion relay: a Cloudflare Worker.
   Visitors can't write to your GitHub repository themselves (that needs a token, and a token in a public
   web page would be stolen). This small worker keeps the token private: the board sends it a suggestion,
   it checks it, and it creates the GitHub issue for the visitor. No sign-in needed on their side.

   Settings in Cloudflare (Worker → Settings → Variables and Secrets):
     GITHUB_TOKEN    (Secret) fine-grained token with only "Issues: Read and write" on your board's repo
     REPO            (Text)   e.g.  realmyron/realmyron.github.io
     ALLOWED_ORIGIN  (Text)   your site, e.g.  https://realmyron.github.io   (several: separate with commas)
*/

const LIMIT_PER_HOUR = 10;            // suggestions per visitor (IP) per hour, per worker instance
const HITS = new Map();

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowed = String(env.ALLOWED_ORIGIN || '').split(',').map(s => s.trim().replace(/\/+$/, '')).filter(Boolean);
    const originOk = allowed.includes(origin);
    const cors = {
      'Access-Control-Allow-Origin': originOk ? origin : (allowed[0] || 'null'),
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
      'Vary': 'Origin',
    };
    const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method === 'GET') return reply(200, { ok: true, service: 'flogic-relay', configured: !!(env.GITHUB_TOKEN && env.REPO && allowed.length) });
    if (request.method !== 'POST') return reply(405, { error: 'Use POST' });
    if (!originOk) return reply(403, { error: 'This site is not allowed to send suggestions here' });
    if (!env.GITHUB_TOKEN || !env.REPO) return reply(500, { error: 'The relay is not set up yet' });

    const ip = request.headers.get('CF-Connecting-IP') || 'unknown', now = Date.now();
    const hits = (HITS.get(ip) || []).filter(t => now - t < 3600e3);
    if (hits.length >= LIMIT_PER_HOUR) return reply(429, { error: 'Too many suggestions in the last hour. Please try again later.' });

    let data;
    try { data = await request.json(); } catch (_) { return reply(400, { error: 'Bad request' }); }
    if (!data || typeof data !== 'object') return reply(400, { error: 'Bad request' });
    if (data.website) return reply(200, { ok: true });             // hidden spam-trap field was filled in: ignore quietly

    const title = clean(data.title, 100), text = clean(data.text, 1000), author = clean(data.author, 60).replace(/\s+/g, ' ');
    if (!title) return reply(400, { error: 'Please add a title' });

    /* only keep the fields Flogic understands, with the right types and sizes */
    const m = data.meta && typeof data.meta === 'object' ? data.meta : {};
    const meta = { v: 1, via: 'relay', kind: m.kind === 'text' ? 'text' : 'bubble', env: clean(m.env, 40) };
    if (meta.kind === 'text') { meta.node = clean(m.node, 40); meta.f = clean(m.f, 80); meta.q = clean(m.q, 300); }
    else { meta.x = Math.round(+m.x) || 0; meta.y = Math.round(+m.y) || 0; }
    if (author) meta.author = author;

    const where = clean(data.where, 160).replace(/[\[\]<>]/g, '');
    const page = /^https:\/\/[^\s<>()]+$/.test(String(data.page || '')) && allowed.some(a => String(data.page).startsWith(a + '/')) ? String(data.page) : '';
    const bs = String.fromCharCode(92), json = JSON.stringify(meta).replace(/</g, bs + 'u003c').replace(/>/g, bs + 'u003e');
    const quote = meta.q ? meta.q.split('\n').map(l => '> ' + l).join('\n') + '\n\n' : '';
    const body = `${quote}${text || '_(no details)_'}\n\n---\n*Suggested from Flogic by **${author ? author.replace(/[*_`\[\]<>]/g, '') : 'an anonymous visitor'}**${where ? ', about ' + where : ''}*${page ? ` · [open the board](${page})` : ''}\n<!-- flogic:${json} -->`;

    const r = await fetch(`https://api.github.com/repos/${env.REPO}/issues`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'flogic-relay',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ title: '[Suggestion] ' + title, body }),
    });
    if (!r.ok) return reply(502, { error: `GitHub refused the suggestion (HTTP ${r.status}). The relay's token may be wrong or expired.` });
    hits.push(now); HITS.set(ip, hits);
    const issue = await r.json();
    return reply(201, { ok: true, number: issue.number });
  },
};

function clean(v, max) {
  return String(v == null ? '' : v).replace(/\r/g, '').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '').trim().slice(0, max);
}
