// Serves published artifacts on  <subdomain>.BASE_DOMAIN  (with optional password gate)
const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { q } = require('./db');
const C = require('./config');

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hits = new Map(); // tiny brute-force limiter
const tooMany = (k) => { const n = (hits.get(k) || 0) + 1; hits.set(k, n); setTimeout(() => hits.delete(k), 15 * 60 * 1000).unref(); return n > 10; };

const gate = (name, err) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Protected</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0a0c14;color:#eef0f8;font-family:system-ui}
form{background:#141826;border:1px solid #242a3d;border-radius:20px;padding:30px;width:min(340px,90vw);text-align:center}
input,button{width:100%;padding:11px;border-radius:10px;border:1px solid #242a3d;font:inherit;margin-top:12px;box-sizing:border-box}
input{background:#0a0c14;color:#fff}button{background:linear-gradient(135deg,#6d5df6,#e84fb0);color:#fff;border:0;font-weight:600;cursor:pointer}
.e{color:#fb7185;font-size:13px;margin:8px 0 0}</style></head><body>
<form method="post" action="/__unlock"><div style="font-size:36px">🔒</div><h3 style="margin:6px 0 0">${esc(name)}</h3>
<p style="color:#97a0b8;margin:4px 0 0;font-size:14px">This page is password protected</p>
${err ? `<p class="e">${esc(err)}</p>` : ''}<input type="password" name="password" placeholder="Enter password" autofocus required><button>Open</button></form></body></html>`;

async function serve(req, res) {
  const sub = req.sub;
  if (!/^[a-z0-9-]{1,40}$/.test(sub)) return res.status(404).send('Not found');
  const { rows } = await q("select id,name,pages,css,js,pw_hash from artifacts where subdomain=$1 and status='published'", [sub]);
  const a = rows[0];
  if (!a) return res.status(404).send('<h2 style="font-family:system-ui;text-align:center;margin-top:20vh">This site is not published.</h2>');

  if (a.pw_hash) {
    let ok = false;
    try { ok = jwt.verify(req.cookies.ap, C.SECRET).aid === a.id; } catch {}
    if (!ok && req.method === 'POST' && req.path === '/__unlock') {
      if (tooMany((req.headers['cf-connecting-ip'] || req.ip) + sub)) return res.status(429).send(gate(a.name, 'Too many attempts. Try later.'));
      if (await bcrypt.compare(String((req.body || {}).password || ''), a.pw_hash)) {
        res.cookie('ap', jwt.sign({ aid: a.id }, C.SECRET, { expiresIn: '12h' }), { httpOnly: true, sameSite: 'lax', secure: C.PROD, maxAge: 12 * 3600e3 });
        return res.redirect('/');
      }
      return res.status(401).send(gate(a.name, 'Wrong password'));
    }
    if (!ok) return res.status(401).send(gate(a.name));
  }

  res.set('Cache-Control', 'no-cache');
  const p = decodeURIComponent(req.path);
  if (p === '/style.css') return res.type('css').send(a.css);
  if (p === '/script.js') return res.type('js').send(a.js);
  let name = p === '/' ? 'index.html' : p.slice(1);
  if (!name.endsWith('.html')) name += '.html';
  const page = a.pages.find((x) => x.n === name);
  if (!page) return res.status(404).send('Page not found');
  res.type('html').send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(a.name)}</title><link rel="stylesheet" href="/style.css"></head><body>${page.h}<script src="/script.js"></script></body></html>`);
}

module.exports = (req, res, next) => {
  const host = req.hostname.toLowerCase();
  if (host === C.BASE || host === 'www.' + C.BASE || !host.endsWith('.' + C.BASE)) return next();
  req.sub = host.slice(0, -(C.BASE.length + 1));
  express.urlencoded({ extended: false, limit: '2kb' })(req, res, () =>
    serve(req, res).catch((e) => { console.error(e); res.status(500).send('Server error'); }));
};
