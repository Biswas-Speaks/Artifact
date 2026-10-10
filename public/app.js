/* ── Biswa Artifacts · app.js ── */
'use strict';

// ── API client ─────────────────────────────────────────────────────────────
const api = async (path, opts = {}) => {
  const init = { method: opts.method || 'GET', credentials: 'same-origin', headers: {} };
  if (opts.form) { init.body = opts.form; }
  else if (opts.body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(opts.body);
  }
  const res = await fetch('/api' + path, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || 'Request failed'), { status: res.status });
  return data;
};

// ── Helpers ────────────────────────────────────────────────────────────────
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const fmtSize = n => n > 1e6 ? (n/1e6).toFixed(1)+' MB' : n > 1e3 ? Math.round(n/1e3)+' KB' : (n||0)+' B';
const fmtDate = d => new Date(d).toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' });
const initials = s => (s||'?').split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2);
let _toastTimer;
const toast = (msg, err) => {
  const el = $('#toast');
  el.textContent = msg;
  el.style.background = err ? 'var(--err)' : 'var(--tx)';
  el.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove('show'), 3000);
};
const copyText = async t => { try { await navigator.clipboard.writeText(t); toast('Copied!'); } catch { toast('Copy failed', true); } };
const slug = s => String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,40);

// ── State ──────────────────────────────────────────────────────────────────
let state = {
  user: null,
  config: null,
  view: 'dashboard',
  artifacts: [],
  files: [],
  images: [],
  adminUsers: [],
  artifactFilter: 'all',
  editorArtifact: null,  // full artifact being edited
  editorPage: 0,         // current page index
  editorTab: 'html',     // html / css / js
};

// ── Boot ───────────────────────────────────────────────────────────────────
async function boot() {
  applyTheme();
  try {
    const [me, cfg] = await Promise.all([api('/me'), api('/config')]);
    state.user = me.user;
    state.config = cfg;
  } catch (e) { /* not signed in */ }

  if (state.user) {
    showApp();
  } else {
    showAuth();
  }
}

// ── Theme ──────────────────────────────────────────────────────────────────
function applyTheme() {
  const stored = localStorage.getItem('theme');
  if (stored) document.documentElement.dataset.theme = stored;
}
function toggleTheme() {
  const current = document.documentElement.dataset.theme;
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  localStorage.setItem('theme', next);
  $$('.theme-btn').forEach(b => b.textContent = next === 'dark' ? '☀️' : '🌙');
  const lpBtn = $('#lp-theme-btn');
  if (lpBtn) lpBtn.textContent = next === 'dark' ? '☀️' : '🌙';
}

// ══════════════════════════════════════════════════════════════════
//  AUTH  (renders the full gallery-sphere landing page)
// ══════════════════════════════════════════════════════════════════
function showAuth() {
  $('#auth').style.display = 'block';
  $('#app').style.display = 'none';
  renderLandingPage();
  window.scrollTo({ top: 0, behavior: 'instant' });
}

// ── Artifact data (mirrors artifact-gallery-sphere/src/lib/artifacts.ts) ──
const ARTIFACTS_DATA = [
  { slug:'business-review',      title:'Quarterly Business Review',       category:'Presentations',        description:'A five-chapter business review with revenue data, animated charts, and regional breakdowns.', publishedAt:'2026-10-10', kind:'biz' },
  { slug:'smart-campus',         title:'Smart Campus Infrastructure',      category:'Interactive Websites',  description:'Explore a connected campus through system diagrams, sensor data, and an interactive energy model.', publishedAt:'2026-10-10', kind:'campus' },
  { slug:'energy-lab',           title:'The Renewable Energy Lab',         category:'Interactive Websites',  description:'Follow sunlight from generation to storage, then test your understanding in a short lesson.', publishedAt:'2026-10-10', kind:'learning' },
  { slug:'orbital-tides',        title:'Orbital Tides',                   category:'Interactive Websites',  description:'A scroll-driven journey through gravitational physics, rendered as a living diagram.',           publishedAt:'2026-09-18', kind:'orbital',   span:true },
  { slug:'field-notes-on-light', title:'Field Notes on Light',            category:'Documents',             description:'An editorial essay on optics and perception, typeset like a printed monograph.',                publishedAt:'2026-08-30', kind:'optics' },
  { slug:'signal-and-noise',     title:'Signal & Noise',                  category:'Presentations',         description:'A cinematic deck on information theory with animated transitions and 3D visuals.',               publishedAt:'2026-08-12', kind:'signal' },
  { slug:'particle-garden',      title:'Particle Garden',                 category:'Code & Experiments',    description:'Ten thousand particles responding to your cursor. A study in emergent motion.',                  publishedAt:'2026-07-25', kind:'particle' },
  { slug:'monsoon-archive',      title:'Monsoon Archive',                 category:'Visual Stories',        description:'A photographic narrative of the Kolkata rains, told in layered imagery and sound.',              publishedAt:'2026-06-14', kind:'monsoon',   span:true },
  { slug:'typographic-machines', title:'Typographic Machines',            category:'Code & Experiments',    description:'Generative letterforms built from springs, constraints, and a little chaos.',                    publishedAt:'2026-05-29', kind:'type' },
  { slug:'the-quiet-web',        title:'The Quiet Web',                   category:'Documents',             description:'A manifesto for slower, more deliberate publishing on the modern internet.',                    publishedAt:'2026-04-17', kind:'quiet' },
  { slug:'chromatic-scales',     title:'Chromatic Scales',                category:'Interactive Websites',  description:'An audible color wheel — drag across hues to hear the harmony they form.',                       publishedAt:'2026-03-08', kind:'chroma' },
];
const CATEGORIES_LP = ['All Creations','Interactive Websites','Documents','Presentations','Code & Experiments','Visual Stories'];
const USE_CASES_DATA = [
  { sector:'Business & consulting', title:'Quarterly business review',   slug:'business-review', copy:'Revenue, regional performance, and a decision-ready presentation.', formats:'Report · Data · Presentation', icon:'🏢' },
  { sector:'Engineering & IT',      title:'Smart Campus Infrastructure', slug:'smart-campus',    copy:'Live energy estimates, equipment data, and connected-system architecture.', formats:'Simulation · Specs · Diagram', icon:'🔗' },
  { sector:'Education & research',  title:'The renewable energy lab',   slug:'energy-lab',      copy:'A visual lesson with an energy-flow diagram and a short knowledge check.', formats:'Lesson · Diagram · Quiz', icon:'🎓' },
];

function formatDateLP(iso) {
  return new Date(iso).toLocaleDateString('en-US', { year:'numeric', month:'short', day:'numeric' });
}

// ── Artwork HTML generators ───────────────────────────────────────
function artworkHTML(a) {
  const heights = [32,39,46,50,57,66,64,76,87,91,96,100];
  const bars = heights.map((h,i) => `<div class="lp-biz-bar" style="height:${h}%;animation-delay:${i*45}ms"></div>`).join('');

  switch(a.kind) {
    case 'biz':
      return `<div class="lp-showcase-biz lp-art lp-art-violet" style="padding:16px 20px">
        <div class="lp-showcase-caption"><span>PERFORMANCE / 2026</span><span>● Sample data</span></div>
        <div class="lp-showcase-rev">$1.1M<em>↗</em></div>
        <div style="font-family:var(--font-mono);font-size:11px;color:var(--art-lime);margin-top:-4px;text-align:right">+24.8%</div>
        <div class="lp-showcase-bars">${bars}</div>
        <div style="display:flex;justify-content:space-between;font-family:var(--font-mono);font-size:9px;opacity:.6;margin-top:4px"><span>JAN</span><span>JUN</span><span>DEC</span></div>
      </div>`;
    case 'campus':
      return `<div class="lp-art lp-art-ink" style="padding:16px">
        <div class="lp-art-label">CAMPUS / SYSTEM MAP</div>
        <div class="lp-campus-inner" style="height:100%;padding:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px">
          <div class="lp-campus-title" style="align-self:flex-start">Connected<span>.</span></div>
          <div style="font-family:var(--font-mono);font-size:9px;color:var(--art-cyan);align-self:flex-start;opacity:.7">24 BUILDINGS / ONE NETWORK</div>
          <div class="lp-campus-nodes">
            <div class="lp-campus-node"><div class="lp-campus-node-circle">📡</div><span>Sensors</span></div>
            <div class="lp-campus-conn"></div>
            <div class="lp-campus-node"><div class="lp-campus-node-circle">☁️</div><span>Cloud</span></div>
            <div class="lp-campus-conn"></div>
            <div class="lp-campus-node"><div class="lp-campus-node-circle">📊</div><span>Analytics</span></div>
          </div>
        </div>
      </div>`;
    case 'learning':
      return `<div class="lp-art lp-art-ink" style="padding:16px;color:var(--art-paper)">
        <div class="lp-art-label">LEARNING / ENERGY FLOW</div>
        <div style="display:flex;flex-direction:column;align-items:center;gap:10px;padding-top:24px">
          <div style="display:flex;justify-content:space-between;width:100%;align-items:center">
            <div style="font-family:var(--font-display);font-size:clamp(20px,4vw,32px);font-weight:600">Powered<br>by sunlight.</div>
            <div style="font-size:40px;animation:lp-spin 24s linear infinite">☀️</div>
          </div>
          <div class="lp-campus-nodes">
            <div class="lp-campus-node"><div class="lp-campus-node-circle">🌿</div><span>Solar</span></div>
            <div class="lp-campus-conn"></div>
            <div class="lp-campus-node"><div class="lp-campus-node-circle">🔋</div><span>Battery</span></div>
            <div class="lp-campus-conn"></div>
            <div class="lp-campus-node"><div class="lp-campus-node-circle">🏛️</div><span>Campus</span></div>
          </div>
        </div>
      </div>`;
    case 'optics':
      return `<div class="lp-art lp-art-coral lp-optics-inner">
        <div class="lp-art-label">OBSERVATIONS / VOL. 01</div>
        <div class="lp-optics-ring"><div class="lp-optics-ring-inner"></div></div>
        <div class="lp-optics-title">Field notes<br>on light.</div>
      </div>`;
    case 'type':
      return `<div class="lp-art lp-art-lime lp-type-inner">
        <div class="lp-art-label">TYPE / EXPERIMENT 06</div>
        <div class="lp-type-big">Aa<span>.</span></div>
        <div style="position:absolute;bottom:16px;left:16px;font-family:var(--font-mono);font-size:9px;color:var(--art-ink)">SPRINGS × LETTERFORMS</div>
      </div>`;
    case 'quiet':
      return `<div class="lp-art lp-art-violet lp-quiet-inner">
        <div class="lp-art-label">A MANIFESTO / 2026</div>
        <div class="lp-quiet-title">Less noise.<br><span>More meaning.</span></div>
        <div style="font-family:var(--font-mono);font-size:9px;opacity:.7">THE QUIET WEB — 01</div>
      </div>`;
    case 'chroma':
      return `<div class="lp-art lp-art-cyan lp-chroma-inner">
        <div class="lp-art-label">COLOR × SOUND</div>
        <div class="lp-chroma-sphere"><div class="lp-chroma-inner-ball"></div></div>
        <div style="position:absolute;bottom:16px;font-family:var(--font-mono);font-size:9px;color:var(--art-ink)">CHROMATIC SCALES / C MAJOR</div>
      </div>`;
    case 'orbital': {
      const ellipses = [0,45,90,135].map(angle => `<ellipse rx="140" ry="45" transform="rotate(${angle})" fill="none" class="lp-orbit-ellipse" stroke-width="1.5"/>`).join('');
      return `<div class="lp-art lp-grid-art lp-art-grid">
        <div class="lp-art-label" style="color:var(--art-paper)">GRAVITATIONAL STUDIES / 001</div>
        <svg viewBox="0 0 500 300" style="width:100%;height:100%" aria-label="Orbital paths around a planet" role="img">
          <g transform="translate(250 150)">
            <g style="animation:lp-spin 24s linear infinite;transform-origin:0px 0px">${ellipses}</g>
            <circle r="26" class="lp-orbit-core"/>
            <circle cx="130" cy="-20" r="7" class="lp-orbit-particle"/>
          </g>
        </svg>
        <div class="lp-art-title-overlay" style="color:var(--art-paper)">Orbital Tides</div>
        <div class="lp-art-tag" style="color:var(--art-paper)">B / A</div>
      </div>`;
    }
    case 'signal': {
      const sigBars = Array.from({length:42},(_,i) => {
        const h = (12 + Math.abs(Math.sin(i*.48)) * (i<21?120:65)).toFixed(1);
        return `<rect x="${40+i*10}" y="${(150-h/2).toFixed(1)}" width="5" height="${h}" rx="2" class="lp-signal-bar" style="animation-delay:${i*25}ms"/>`;
      }).join('');
      return `<div class="lp-art lp-grid-art lp-art-grid">
        <div class="lp-art-label" style="color:var(--art-paper)">INFORMATION THEORY / 03</div>
        <svg viewBox="0 0 500 300" style="width:100%;height:100%" aria-label="Signal waveform" role="img">${sigBars}</svg>
        <div class="lp-art-title-overlay" style="color:var(--art-paper)">Signal & Noise</div>
        <div class="lp-art-tag" style="color:var(--art-paper)">B / A</div>
      </div>`;
    }
    case 'particle': {
      const dots = Array.from({length:100},(_,i) => {
        const a=i*2.4, r=10+Math.sqrt(i)*12;
        const cx=(250+Math.cos(a)*r*1.5).toFixed(1);
        const cy=(150+Math.sin(a)*r).toFixed(1);
        const rr=2+i%4;
        const op=(.5+(i%5)*.1).toFixed(2);
        return `<circle cx="${cx}" cy="${cy}" r="${rr}" class="lp-orbit-particle lp-particle-dot" opacity="${op}"/>`;
      }).join('');
      return `<div class="lp-art lp-grid-art lp-art-grid">
        <div class="lp-art-label" style="color:var(--art-paper)">GENERATIVE SYSTEM / 10,000</div>
        <svg viewBox="0 0 500 300" style="width:100%;height:100%" aria-label="A colorful particle field" role="img">${dots}</svg>
        <div class="lp-art-title-overlay" style="color:var(--art-paper)">Particle Garden</div>
        <div class="lp-art-tag" style="color:var(--art-paper)">B / A</div>
      </div>`;
    }
    case 'monsoon': {
      const drops = Array.from({length:30},(_,i) => {
        const x=(10+i*30)%490;
        const y=Math.random()*200;
        const del=(Math.random()*1.4).toFixed(2);
        return `<rect x="${x}" y="${y.toFixed(0)}" width="2" height="8" rx="1" class="lp-rain-drop" style="animation-delay:${del}s"/>`;
      }).join('');
      return `<div class="lp-monsoon">
        <svg class="lp-monsoon-rain" viewBox="0 0 490 240" aria-hidden="true">${drops}</svg>
        <div class="lp-monsoon-overlay">
          <div class="lp-monsoon-coord">KOLKATA / 22.5726° N</div>
          <div class="lp-monsoon-title">Monsoon Archive</div>
        </div>
      </div>`;
    }
    default:
      return `<div class="lp-art lp-art-ink" style="display:flex;align-items:center;justify-content:center">
        <div style="font-family:var(--font-display);font-size:32px;font-weight:700;color:var(--art-paper)">✦</div>
      </div>`;
  }
}

// ── Gallery HTML ──────────────────────────────────────────────────
function galleryHTML(filterCat) {
  const shown = ARTIFACTS_DATA.filter(a => filterCat === 'All Creations' || a.category === filterCat).slice(0, 6);
  if (!shown.length) return `<div style="border:2px dashed var(--bd);border-radius:16px;padding:80px 24px;text-align:center;color:var(--mu)">No artifacts in this collection yet.</div>`;
  return `<div class="lp-gallery-grid">
    ${shown.map(a => `
      <div class="lp-artifact-card${a.span?' span-2':''}">
        <div class="lp-artifact-thumb">${artworkHTML(a)}</div>
        <div class="lp-artifact-body">
          <div class="lp-artifact-meta-row">
            <span class="lp-artifact-category">${esc(a.category)}</span>
            <time class="lp-artifact-date">${formatDateLP(a.publishedAt)}</time>
          </div>
          <div class="lp-artifact-name">${esc(a.title)}</div>
          <div class="lp-artifact-desc">${esc(a.description)}</div>
          <div class="lp-artifact-cta">View artifact <span>↗</span></div>
        </div>
      </div>`).join('')}
  </div>
  <p class="lp-gallery-note">* Sample artifacts shown for demonstration.</p>`;
}

// ── Capabilities demos HTML ───────────────────────────────────────
function capabilitiesHTML() {
  const cards = [
    { num:'01', title:'Interactive Experiences', copy:'From experimental interfaces to complete interactive stories.',
      demo:`<div class="lp-mini-site">
        <div class="lp-mini-bar"><div class="lp-mini-dot"></div><div class="lp-mini-dot"></div><div class="lp-mini-dot"></div></div>
        <div class="lp-mini-content">
          <div class="lp-mini-glow" id="cap-glow" style="left:50%;top:50%"></div>
          <div class="lp-mini-h1"></div>
          <div class="lp-mini-p"></div>
          <div class="lp-mini-cards"><div class="lp-mini-card-item"></div><div class="lp-mini-card-item"></div><div class="lp-mini-card-item"></div></div>
        </div>
      </div>` },
    { num:'02', title:'Creative Documents', copy:'Documents that feel designed, not assembled.',
      demo:`<div class="lp-mini-doc">
        <div class="lp-mini-doc-tag">ESSAY · 04</div>
        <div class="lp-mini-doc-title">On the shape of attention</div>
        <div class="lp-mini-doc-grid">
          <div class="lp-mini-doc-lines">
            <div class="lp-mini-doc-line" style="width:100%"></div>
            <div class="lp-mini-doc-line" style="width:92%"></div>
            <div class="lp-mini-doc-line" style="width:96%"></div>
            <div class="lp-mini-doc-line" style="width:70%"></div>
          </div>
          <div class="lp-mini-doc-accent"></div>
        </div>
      </div>` },
    { num:'03', title:'Cinematic Presentations', copy:'Presentations that move ideas forward.',
      demo:`<div class="lp-mini-slides">
        <div class="lp-mini-slide" style="transform:translate(28px,-16px) rotateY(-16deg);opacity:.5"></div>
        <div class="lp-mini-slide" style="transform:translate(14px,-8px) rotateY(-8deg);opacity:.75"></div>
        <div class="lp-mini-slide" style="transform:none;opacity:1"><div class="lp-mini-slide-title">Signal<span>.</span></div></div>
      </div>` },
    { num:'04', title:'Code Experiments', copy:'Write it. Preview it. Bring it to life.',
      demo:`<div class="lp-mini-code">
        <pre class="lp-mini-code-editor"><em>const</em> orb = <em>new</em> Orb();
orb.<b>glow</b>(0.8);
orb.<b>spin</b>();</pre>
        <div class="lp-mini-code-preview"><div class="lp-mini-code-orb"></div></div>
      </div>` },
  ];
  return `<div class="lp-capabilities-grid">
    ${cards.map(c => `
      <article class="lp-capability-card">
        <div class="lp-capability-demo">${c.demo}</div>
        <div class="lp-cap-num">${c.num}</div>
        <div class="lp-cap-title">${c.title}</div>
        <div class="lp-cap-copy">${c.copy}</div>
      </article>`).join('')}
  </div>`;
}

// ── Studio section HTML ───────────────────────────────────────────
const STUDIO_PAGES = {
  index:   { label:'home',     lines: ['<em>&lt;main</em> <str>class="hero"</str><em>&gt;</em>','  <em>&lt;h1&gt;</em>Hello, I make things.<em>&lt;/h1&gt;</em>','  <em>&lt;a</em> <str>href="projects.html"</str><em>&gt;</em>','    See the work →','  <em>&lt;/a&gt;</em>','<em>&lt;/main&gt;</em>'], preview: '<div class="lp-studio-preview-content"><div class="lp-studio-preview-h">Hello, I make things.</div><div class="lp-studio-preview-link" onclick="lpStudioGo(\'projects\')">See the work →</div></div>' },
  about:   { label:'about',    lines: ['<em>&lt;section</em> <str>class="about"</str><em>&gt;</em>','  <em>&lt;h1&gt;</em>About<em>&lt;/h1&gt;</em>','  <em>&lt;p&gt;</em>Designer &amp; developer','     based in Kolkata.<em>&lt;/p&gt;</em>','<em>&lt;/section&gt;</em>'], preview: '<div class="lp-studio-preview-content lp-studio-preview-about"><div style="font-family:var(--font-display);font-size:20px;font-weight:700">About</div><div style="font-size:13px;color:var(--mu);margin-top:8px">Designer &amp; developer based in Kolkata.</div></div>' },
  projects:{ label:'projects', lines: ['<em>&lt;ul</em> <str>class="grid"</str><em>&gt;</em>','  <em>&lt;li</em> <str>class="card"</str><em>&gt;</em>Orbital<em>&lt;/li&gt;</em>','  <em>&lt;li</em> <str>class="card"</str><em>&gt;</em>Garden<em>&lt;/li&gt;</em>','  <em>&lt;li</em> <str>class="card"</str><em>&gt;</em>Signal<em>&lt;/li&gt;</em>','<em>&lt;/ul&gt;</em>'], preview: '<div class="lp-studio-preview-content"><div class="lp-studio-preview-projects"><div class="lp-studio-preview-proj">Orbital</div><div class="lp-studio-preview-proj">Garden</div><div class="lp-studio-preview-proj">Signal</div></div></div>' },
  contact: { label:'contact',  lines: ['<em>&lt;form</em> <str>class="contact"</str><em>&gt;</em>','  <em>&lt;input</em> <str>placeholder="Email"</str><em>&gt;</em>','  <em>&lt;button&gt;</em>Send<em>&lt;/button&gt;</em>','<em>&lt;/form&gt;</em>'], preview: '<div class="lp-studio-preview-content"><div class="lp-studio-preview-contact"><div class="lp-studio-preview-inp">Email</div><button class="lp-studio-preview-btn">Send</button></div></div>' },
};

function studioHTML(page, device) {
  const p = STUDIO_PAGES[page] || STUDIO_PAGES.index;
  const pageKeys = Object.keys(STUDIO_PAGES);
  const fileTabs = pageKeys.map(k =>
    `<button class="lp-studio-exp-item${k===page?' active':''}" onclick="lpStudioGo('${k}')" data-studio-page="${k}">
      📄 ${k}.html
    </button>`).join('');
  const previewWidth = device==='desktop'?'100%':device==='tablet'?'75%':'52%';
  const lines = p.lines.map((l,i) =>
    `<div><span class="lnum">${i+1}</span>${l}</div>`).join('');

  return `<div class="lp-studio-window">
    <div class="lp-studio-topbar">
      <div class="lp-studio-dot lp-studio-dot-red"></div>
      <div class="lp-studio-dot lp-studio-dot-grey"></div>
      <div class="lp-studio-dot lp-studio-dot-grey"></div>
      <span class="lp-studio-filename">portfolio-artifact / ${page}.html</span>
    </div>
    <div class="lp-studio-body">
      <aside class="lp-studio-explorer">
        <div class="lp-studio-exp-title">EXPLORER</div>
        <div class="lp-studio-exp-item">📁 portfolio-artifact</div>
        <div class="lp-studio-exp-indent">${fileTabs}
          <div class="lp-studio-exp-item">📁 styles</div>
          <div class="lp-studio-exp-indent lp-studio-exp-item">📄 main.css</div>
          <div class="lp-studio-exp-item">📁 scripts</div>
          <div class="lp-studio-exp-indent lp-studio-exp-item">📄 main.js</div>
          <div class="lp-studio-exp-item">📁 assets</div>
        </div>
      </aside>
      <div class="lp-studio-editor">
        <div class="lp-studio-tabs">
          <span class="lp-studio-tab active">HTML</span>
          <span class="lp-studio-tab">CSS</span>
          <span class="lp-studio-tab">JS</span>
        </div>
        <div class="lp-studio-code">${lines}</div>
      </div>
      <div class="lp-studio-preview">
        <div class="lp-studio-preview-bar">
          <div class="lp-studio-device-btns">
            <button class="lp-studio-device-btn${device==='desktop'?' active':''}" onclick="lpStudioDevice('desktop')" aria-label="Desktop preview">🖥</button>
            <button class="lp-studio-device-btn${device==='tablet'?' active':''}" onclick="lpStudioDevice('tablet')" aria-label="Tablet preview">📱</button>
            <button class="lp-studio-device-btn${device==='mobile'?' active':''}" onclick="lpStudioDevice('mobile')" aria-label="Mobile preview">📲</button>
          </div>
          <div style="display:flex;gap:4px">
            <button class="lp-studio-device-btn" onclick="lpStudioGo('index')" aria-label="Refresh">↺</button>
          </div>
        </div>
        <div class="lp-studio-preview-frame">
          <div class="lp-studio-preview-inner" style="width:${previewWidth}">${p.preview}</div>
        </div>
      </div>
    </div>
  </div>`;
}

let lpStudioPage = 'index';
let lpStudioDeviceState = 'desktop';

function lpStudioGo(page) {
  lpStudioPage = page;
  const el = $('#lp-studio-widget');
  if (el) el.innerHTML = studioHTML(page, lpStudioDeviceState);
}
function lpStudioDevice(device) {
  lpStudioDeviceState = device;
  const el = $('#lp-studio-widget');
  if (el) el.innerHTML = studioHTML(lpStudioPage, device);
}

// ── Publishing section HTML ───────────────────────────────────────
function publishingHTML() {
  const stages = [
    { label:'01 · CREATE', layers:3 },
    { label:'02 · REFINE', layers:2 },
    { label:'03 · PUBLISH', layers:1, pub:true },
  ];
  const features = [
    { icon:'🔗', label:'Public artifacts' },
    { icon:'🙈', label:'Unlisted links' },
    { icon:'🔒', label:'Password protected' },
    { icon:'👁', label:'Private drafts' },
    { icon:'⏱', label:'Version history' },
    { icon:'📑', label:'Multipage artifacts' },
  ];
  const cards = stages.map(s => {
    const layerDivs = Array.from({length:s.layers}, (_,j) =>
      `<div class="lp-pub-layer${s.pub&&j===0?' lp-pub-layer-pub':''}" style="transform:translate(${j*10}px,${j*-8}px);animation-delay:${j*.6}s;opacity:${1-j*.3}">
        ${s.pub&&j===0?`<div class="lp-pub-url">biswa.io/a/orbital-tides</div>`:''}
      </div>`).join('');
    return `<div class="lp-pub-card">
      <div class="lp-pub-label">${s.label}</div>
      <div class="lp-pub-layers">${layerDivs}</div>
    </div>`;
  }).join('');
  const featureItems = features.map(f =>
    `<li class="lp-pub-feature"><span class="lp-pub-feature-icon">${f.icon}</span>${f.label}</li>`).join('');
  return `<div class="lp-pub-grid">${cards}</div>
    <ul class="lp-pub-features">${featureItems}</ul>`;
}

// ── Full landing page HTML ────────────────────────────────────────
function renderLandingPage() {
  const isDark = document.documentElement.dataset.theme === 'dark' ||
    (!document.documentElement.dataset.theme && window.matchMedia('(prefers-color-scheme: dark)').matches);

  // Hero letters with per-letter animation
  function letterSpans(word, delayStart) {
    return word.split('').map((ch, i) =>
      `<span class="lp-hero-letter" aria-hidden="true" style="animation-delay:${(delayStart + i*0.07).toFixed(2)}s">${ch}</span>`
    ).join('');
  }

  const filterTabs = CATEGORIES_LP.map(c =>
    `<button class="lp-filter-tab${c==='All Creations'?' active':''}" data-cat="${esc(c)}">${esc(c)}</button>`
  ).join('');

  const useCaseCards = USE_CASES_DATA.map(u =>
    `<a class="lp-usecase" href="#creations">
      <div class="lp-usecase-icon">${u.icon}</div>
      <div class="lp-usecase-sector">${esc(u.sector)}</div>
      <div class="lp-usecase-title">${esc(u.title)}</div>
      <div class="lp-usecase-copy">${esc(u.copy)}</div>
      <div class="lp-usecase-formats">${esc(u.formats)}</div>
    </a>`
  ).join('');

  $('#auth').innerHTML = `
    <!-- ── NAV ── -->
    <header class="lp-nav-wrap" role="banner">
      <nav class="lp-nav" aria-label="Primary">
        <a href="#" class="lp-logo">BISWA<span>/</span>ARTIFACTS</a>
        <div class="lp-links">
          <a href="#creations">Creations</a>
          <a href="#capabilities">Capabilities</a>
          <a href="#about">About</a>
        </div>
        <div class="lp-nav-actions">
          <button class="lp-btn-studio" onclick="renderLoginPage()">Studio</button>
          <button class="lp-icon-btn" onclick="toggleTheme()" aria-label="Toggle theme" id="lp-theme-btn">${isDark?'☀️':'🌙'}</button>
          <button class="lp-icon-btn" onclick="renderLoginPage()" aria-label="Sign in">👤</button>
        </div>
      </nav>
    </header>

    <!-- ── HERO ── -->
    <section class="lp-hero" aria-label="Hero">
      <div class="lp-hero-bg" aria-hidden="true">
        <div class="lp-shape lp-shape-ring"></div>
        <div class="lp-shape lp-shape-cube"></div>
        <div class="lp-shape lp-shape-diamond"></div>
        <div class="lp-shape lp-shape-triangle"></div>
      </div>
      <div class="lp-hero-content">
        <p class="lp-hero-eyebrow">
          <span class="lp-hero-eyebrow-dot" aria-hidden="true"></span>
          An independent creative universe
        </p>
        <h1 class="lp-hero-title">
          <span class="lp-hero-biswa" aria-label="Biswa">${letterSpans('Biswa', 0.1)}</span>
          <span class="lp-hero-artifacts" aria-label="Artifacts">${letterSpans('Artifacts', 0.3)}</span>
        </h1>
        <p class="lp-hero-tagline">CREATE · PUBLISH · INSPIRE</p>
        <p class="lp-hero-sub">A little imagination. A world of possibilities.</p>
        <div class="lp-hero-cta">
          <a href="#creations" class="lp-cta-primary">Explore creations <span aria-hidden="true">↗</span></a>
          <button class="lp-cta-outline" aria-label="Remix shapes" title="Remix shapes" onclick="lpRemixShapes()">⇄</button>
        </div>
      </div>
      <a href="#creations" class="lp-hero-scroll" aria-label="Scroll to creations">↓</a>
      <div class="lp-hero-joy" aria-hidden="true">
        <div class="lp-joy-dot"></div>
        A LITTLE JOY, BY DESIGN
      </div>
    </section>

    <!-- ── CREATIONS ── -->
    <section id="creations" class="lp-section" aria-label="Creations">
      <div class="lp-max">
        <div class="lp-section-heading">
          <div class="lp-eyebrow">01 — CREATIONS</div>
          <h2 class="lp-section-title">Made to be experienced.</h2>
          <p class="lp-section-sub">More than files. More than pages. Every artifact is a world of its own.</p>
        </div>
        <div class="lp-filter-tabs" role="tablist" aria-label="Filter artifacts">
          ${filterTabs}
        </div>
        <div id="lp-gallery">${galleryHTML('All Creations')}</div>
      </div>
    </section>

    <!-- ── USE CASES ── -->
    <section class="lp-usecases" aria-label="Use cases">
      <div class="lp-max">
        <div class="lp-section-heading">
          <div class="lp-eyebrow">IN PRACTICE</div>
          <h2 class="lp-section-title">One artifact. Many possibilities.</h2>
          <p class="lp-section-sub">Business reviews, connected systems, and lessons that come alive.</p>
        </div>
        <div class="lp-usecases-grid">${useCaseCards}</div>
      </div>
    </section>

    <!-- ── CAPABILITIES ── -->
    <section id="capabilities" class="lp-capabilities" aria-label="Capabilities">
      <div class="lp-max">
        <div class="lp-section-heading">
          <div class="lp-eyebrow">02 — CAPABILITIES</div>
          <h2 class="lp-section-title">One canvas. Infinite possibilities.</h2>
        </div>
        ${capabilitiesHTML()}
      </div>
    </section>

    <!-- ── STUDIO ── -->
    <section id="studio" class="lp-studio" aria-label="Studio">
      <div class="lp-max">
        <div class="lp-section-heading">
          <div class="lp-eyebrow">03 — STUDIO</div>
          <h2 class="lp-section-title">Code meets canvas.</h2>
          <p class="lp-section-sub">A real creative development environment, built for imagination.</p>
        </div>
        <div id="lp-studio-widget">${studioHTML('index', 'desktop')}</div>
      </div>
    </section>

    <!-- ── PUBLISHING ── -->
    <section id="publishing" class="lp-publishing" aria-label="Publishing">
      <div class="lp-max">
        <div class="lp-section-heading">
          <div class="lp-eyebrow">04 — PUBLISHING</div>
          <h2 class="lp-section-title">From creation to the world.</h2>
          <p class="lp-section-sub">Every published artifact receives its own shareable URL.</p>
        </div>
        ${publishingHTML()}
      </div>
    </section>

    <!-- ── ABOUT ── -->
    <section id="about" class="lp-about" aria-label="About">
      <div class="lp-max">
        <div class="lp-about-grid">
          <div>
            <div class="lp-about-eyebrow">05 — ABOUT</div>
            <h2 class="lp-about-title">Built for the<br><span class="lp-text-outline">curious.</span></h2>
            <p class="lp-about-copy">Biswa Artifacts is an independent creative space where design, technology, and imagination meet. A home for ideas that deserve to be seen, explored, and experienced.</p>
          </div>
          <div class="lp-about-orb" aria-hidden="true">
            <div class="lp-orb-ring-outer"></div>
            <div class="lp-orb-ring-mid"></div>
            <div class="lp-orb-core"></div>
          </div>
        </div>
      </div>
    </section>

    <!-- ── FOOTER ── -->
    <footer class="lp-footer" role="contentinfo">
      <div class="lp-footer-deco-ring" aria-hidden="true"></div>
      <div class="lp-footer-deco-sq" aria-hidden="true"></div>
      <div class="lp-max lp-footer-inner">
        <h2 class="lp-footer-headline">MAKE SOMETHING<br><span class="lp-text-outline">REMARKABLE.</span></h2>
        <div class="lp-footer-bottom">
          <div>
            <div class="lp-footer-brand-name">BISWA<span>/</span>ARTIFACTS</div>
            <div class="lp-footer-tagline">CREATE · PUBLISH · INSPIRE</div>
          </div>
          <nav class="lp-footer-links" aria-label="Footer">
            <a href="#creations">Explore</a>
            <a href="#about">About</a>
            <a href="https://github.com" target="_blank" rel="noreferrer">GitHub</a>
            <a href="mailto:hello@biswa.io">Contact</a>
            <span>Privacy</span>
            <a class="lp-footer-login" href="#" onclick="renderLoginPage();return false">Internal login</a>
          </nav>
        </div>
        <p class="lp-footer-copy">© 2026 Biswa Artifacts.</p>
      </div>
    </footer>`;

  // Wire up gallery filter tabs
  $$('.lp-filter-tab').forEach(btn => btn.addEventListener('click', () => {
    $$('.lp-filter-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    $('#lp-gallery').innerHTML = galleryHTML(btn.dataset.cat);
  }));
}

// ── Login page (gallery-sphere /login style) ─────────────────────
function renderLoginPage() {
  const isDark = document.documentElement.dataset.theme === 'dark' ||
    (!document.documentElement.dataset.theme && window.matchMedia('(prefers-color-scheme: dark)').matches);

  $('#auth').innerHTML = `
    <div class="lp-login-page">
      <div class="lp-login-inner">
        <p class="lp-login-eyebrow">STUDIO ACCESS</p>
        <h1 class="lp-login-title">Welcome back.</h1>
        <p class="lp-login-sub">Sign in to access your artifact studio, files, and settings.</p>

        <div class="tabs" id="lp-auth-tabs" style="margin-top:32px">
          <button class="active" data-tab="login">Sign in</button>
          <button data-tab="reset">Reset password</button>
        </div>

        <div id="lp-auth-login">
          <div class="lp-login-form">
            <label class="lp-login-label">
              Username or Email
              <input id="a-user" type="text" class="lp-login-input" placeholder="biswas" autocomplete="username">
            </label>
            <label class="lp-login-label">
              Password
              <input id="a-pass" type="password" class="lp-login-input" placeholder="••••••••" autocomplete="current-password">
            </label>
            <button class="lp-login-btn" id="login-btn" onclick="doLogin()">Sign in</button>
            <p class="lp-login-reset-link">
              Forgot your password?
              <a href="#" onclick="switchAuthTab('reset');return false">Reset it</a>
            </p>
          </div>
        </div>

        <div id="lp-auth-reset" hidden>
          <div class="lp-login-form">
            <label class="lp-login-label">
              Registered email
              <input id="a-email" type="email" class="lp-login-input" placeholder="you@email.com">
            </label>
            <button class="lp-login-btn" onclick="doForgot()">Send reset link</button>
            <p class="lp-login-reset-link">A reset link will be sent to your email.</p>
          </div>
        </div>

        <button class="lp-login-back" onclick="showLanding()">← Back to gallery</button>
      </div>
    </div>`;

  // Wire tabs
  $$('#lp-auth-tabs button').forEach(b => b.addEventListener('click', () => switchAuthTab(b.dataset.tab)));
  // Keyboard shortcuts
  $('#a-pass')?.addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
  $('#a-user')?.addEventListener('keydown', e => { if (e.key === 'Enter') $('#a-pass')?.focus(); });
  // Focus first field
  setTimeout(() => $('#a-user')?.focus(), 50);
}

function showLanding() {
  renderLandingPage();
  // Scroll to top
  window.scrollTo({ top: 0, behavior: 'instant' });
}

function lpRemixShapes() {
  const shapes = ['.lp-shape-ring', '.lp-shape-cube', '.lp-shape-diamond', '.lp-shape-triangle'];
  shapes.forEach(sel => {
    const el = $(sel);
    if (!el) return;
    const r = (Math.random() * 30 - 15).toFixed(1);
    el.style.transform = `rotate(${r}deg) scale(${0.85 + Math.random()*0.3})`;
  });
}

function switchAuthTab(tab) {
  $$('#lp-auth-tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  const login = $('#lp-auth-login');
  const reset = $('#lp-auth-reset');
  if (login) login.hidden = tab !== 'login';
  if (reset) reset.hidden = tab !== 'reset';
}

async function doLogin() {
  const btn = $('#login-btn');
  const username = $('#a-user').value.trim();
  const password = $('#a-pass').value;
  if (!username || !password) return toast('Enter username and password', true);
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Signing in…';
  try {
    const { user } = await api('/auth/login', { method: 'POST', body: { username, password } });
    state.user = user;
    const cfg = await api('/config');
    state.config = cfg;
    showApp();
  } catch (e) {
    toast(e.message, true);
    btn.disabled = false;
    btn.textContent = 'Sign in';
  }
}

async function doForgot() {
  const email = $('#a-email').value.trim();
  if (!email) return toast('Enter your email', true);
  try {
    await api('/auth/forgot', { method: 'POST', body: { email } });
    toast('Reset link sent if the email exists');
  } catch (e) { toast(e.message, true); }
}

async function doLogout() {
  await api('/auth/logout', { method: 'POST' }).catch(() => {});
  state.user = null;
  state.artifacts = [];
  state.files = [];
  state.images = [];
  showAuth();
}

// ══════════════════════════════════════════════════════════════════
//  APP SHELL
// ══════════════════════════════════════════════════════════════════
function showApp() {
  $('#auth').style.display = 'none';
  $('#app').style.display = 'block';
  renderShell();
  navigateTo('dashboard');
}

function renderShell() {
  const u = state.user;
  const isAdmin = u?.role === 'admin';
  $('#app').innerHTML = `
    <aside id="sidebar">
      <div class="logo">
        <span class="logo-mark">✦</span>
        BISWA<span style="color:var(--ac)">/</span>ARTIFACTS
      </div>
      <button class="nav-item active" data-view="dashboard" onclick="navigateTo('dashboard')">
        ${icon('grid')} Dashboard
      </button>
      <div class="nav-section-label">STUDIO</div>
      <button class="nav-item" data-view="artifacts" onclick="navigateTo('artifacts')">
        ${icon('code')} Artifact Studio
      </button>
      <div class="nav-section-label">STORAGE</div>
      <button class="nav-item" data-view="files" onclick="navigateTo('files')">
        ${icon('folder')} Files · R2
      </button>
      <button class="nav-item" data-view="images" onclick="navigateTo('images')">
        ${icon('image')} Images · CDN
      </button>
      ${isAdmin ? `<div class="nav-section-label">ADMIN</div>
      <button class="nav-item" data-view="admin" onclick="navigateTo('admin')">
        ${icon('users')} Users
      </button>` : ''}
      <div class="nav-spacer"></div>
      <button class="nav-item" data-view="settings" onclick="navigateTo('settings')">
        ${icon('settings')} Settings
      </button>
      <button class="nav-item nav-signout" onclick="doLogout()">
        ${icon('logout')} Sign out
      </button>
    </aside>
    <div class="main-content" id="main"></div>
    <div class="toast" id="toast"></div>
    <div id="modals"></div>`;
}

function navigateTo(view) {
  state.view = view;
  $$('.nav-item[data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  const main = $('#main');
  main.innerHTML = '<div style="padding:40px;text-align:center"><span class="spinner"></span></div>';

  const views = {
    dashboard: renderDashboard,
    artifacts: renderArtifacts,
    files:     renderFiles,
    images:    renderImages,
    admin:     renderAdmin,
    settings:  renderSettings,
  };
  (views[view] || renderDashboard)();
}

// ── SVG icons ─────────────────────────────────────────────────────
function icon(name) {
  const icons = {
    grid: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>`,
    code: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>`,
    folder: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`,
    image: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`,
    users: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
    settings: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`,
    logout: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>`,
    plus: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
    edit: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`,
    trash: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>`,
    copy: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`,
    globe: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`,
    download: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`,
    x: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
    eye: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`,
    lock: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`,
    upload: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>`,
  };
  return icons[name] || '';
}

// ══════════════════════════════════════════════════════════════════
//  DASHBOARD
// ══════════════════════════════════════════════════════════════════
async function renderDashboard() {
  const u = state.user;
  try {
    const [arts, files, imgs] = await Promise.all([
      api('/artifacts'),
      api('/files'),
      api('/images'),
    ]);
    state.artifacts = arts.items || [];
    state.files = files.items || [];
    state.images = imgs.items || [];
  } catch (e) { /* use cached */ }

  const published = state.artifacts.filter(a => a.status === 'published').length;
  const drafts    = state.artifacts.filter(a => a.status === 'draft').length;

  $('#main').innerHTML = `
    <div class="fade-up">
      <div class="row" style="margin-bottom:28px;align-items:flex-start">
        <div>
          <div style="font-family:var(--font-mono);font-size:11px;letter-spacing:0.15em;color:var(--mu);margin-bottom:6px">WELCOME BACK</div>
          <h1 style="font-family:var(--font-display);font-size:28px;font-weight:700;letter-spacing:-0.01em">${esc(u?.full_name || u?.username || 'Biswas')}</h1>
        </div>
        <div class="sp"></div>
        <button class="btn btn-primary" onclick="navigateTo('artifacts');setTimeout(openNewArtifactModal,100)">
          ${icon('plus')} New artifact
        </button>
        <button class="theme-btn" onclick="toggleTheme()" style="position:static">🌙</button>
      </div>

      <div class="grid-3" style="margin-bottom:28px">
        <div class="stat-card">
          <div class="stat-icon">✦</div>
          <div class="stat-value">${state.artifacts.length}</div>
          <div class="stat-label">Total artifacts</div>
        </div>
        <div class="stat-card">
          <div class="stat-icon">🌐</div>
          <div class="stat-value">${published}</div>
          <div class="stat-label">Published</div>
        </div>
        <div class="stat-card">
          <div class="stat-icon">📄</div>
          <div class="stat-value">${state.files.length}</div>
          <div class="stat-label">Files stored</div>
        </div>
        <div class="stat-card">
          <div class="stat-icon">🖼️</div>
          <div class="stat-value">${state.images.length}</div>
          <div class="stat-label">Images on CDN</div>
        </div>
        <div class="stat-card" style="cursor:pointer" onclick="navigateTo('artifacts')">
          <div class="stat-icon">✏️</div>
          <div class="stat-value">${drafts}</div>
          <div class="stat-label">Drafts</div>
        </div>
        <div class="stat-card" style="cursor:pointer" onclick="navigateTo('settings')">
          <div class="stat-icon">⚙️</div>
          <div class="stat-value" style="font-size:14px;margin-top:4px">${esc(u?.username || '')}</div>
          <div class="stat-label">Settings</div>
        </div>
      </div>

      ${state.artifacts.length > 0 ? `
      <div style="margin-bottom:16px">
        <div class="row" style="margin-bottom:14px">
          <h2 style="font-family:var(--font-display);font-size:17px;font-weight:700">Recent artifacts</h2>
          <div class="sp"></div>
          <button class="btn btn-sm btn-ghost" onclick="navigateTo('artifacts')">View all</button>
        </div>
        <div class="grid-2">
          ${state.artifacts.slice(0,4).map(a => artifactCardHTML(a)).join('')}
        </div>
      </div>` : `
      <div class="empty">
        <div class="empty-icon">✦</div>
        <h3 style="font-family:var(--font-display)">Your creative workspace is ready</h3>
        <p>Create your first artifact — an interactive website, document, or presentation.</p>
        <button class="btn btn-primary" style="margin-top:20px" onclick="navigateTo('artifacts');setTimeout(openNewArtifactModal,100)">
          ${icon('plus')} Create first artifact
        </button>
      </div>`}
    </div>`;
}

// ══════════════════════════════════════════════════════════════════
//  ARTIFACTS
// ══════════════════════════════════════════════════════════════════
async function renderArtifacts() {
  try {
    const data = await api('/artifacts');
    state.artifacts = data.items || [];
  } catch (e) { toast(e.message, true); }

  renderArtifactsList();
}

function renderArtifactsList() {
  const f = state.artifactFilter;
  const items = state.artifacts.filter(a => f === 'all' || a.status === f || a.type === f);

  $('#main').innerHTML = `
    <div class="fade-up">
      <div class="page-header">
        <div class="page-header-text">
          <h1>Artifact Studio</h1>
          <p>Build, publish and share interactive HTML/CSS/JS experiences</p>
        </div>
        <div class="page-header-actions">
          <button class="btn" onclick="toggleTheme()">🌙</button>
          <button class="btn btn-primary" onclick="openNewArtifactModal()">
            ${icon('plus')} New artifact
          </button>
        </div>
      </div>
      <div class="filter-tabs">
        <button class="${f==='all'?'active':''}" onclick="setArtifactFilter('all')">All (${state.artifacts.length})</button>
        <button class="${f==='published'?'active':''}" onclick="setArtifactFilter('published')">Published</button>
        <button class="${f==='draft'?'active':''}" onclick="setArtifactFilter('draft')">Drafts</button>
        <button class="${f==='web'?'active':''}" onclick="setArtifactFilter('web')">Web</button>
        <button class="${f==='doc'?'active':''}" onclick="setArtifactFilter('doc')">Docs</button>
        <button class="${f==='slide'?'active':''}" onclick="setArtifactFilter('slide')">Slides</button>
      </div>
      ${items.length > 0
        ? `<div class="grid-2">${items.map(a => artifactCardHTML(a)).join('')}</div>`
        : `<div class="empty"><div class="empty-icon">✦</div><h3>No artifacts yet</h3><p>Create your first artifact to get started.</p></div>`
      }
    </div>`;
}

function setArtifactFilter(f) {
  state.artifactFilter = f;
  renderArtifactsList();
}

function artifactCardHTML(a) {
  const typeLabel = { web: 'Web', doc: 'Document', slide: 'Slides' }[a.type] || a.type;
  const typeClass = { web: 'badge-web', doc: 'badge-doc', slide: 'badge-slide' }[a.type] || 'badge-web';
  const domain = state.config ? `${state.config.proto}://${a.subdomain}.${state.config.base}` : `https://${a.subdomain}.biswa.io`;
  return `
    <div class="artifact-card" onclick="openEditor('${esc(a.id)}')">
      <div class="artifact-thumb" style="background:linear-gradient(135deg,${typeColors(a.type)[0]},${typeColors(a.type)[1]})">
        <span style="font-size:32px;opacity:0.6">${typeEmoji(a.type)}</span>
      </div>
      <div class="artifact-meta">
        <span class="artifact-name">${esc(a.name)}</span>
        <span class="badge ${a.status==='published'?'badge-pub':'badge-draft'}">${a.status}</span>
      </div>
      <div class="row" style="gap:6px">
        <span class="badge ${typeClass}">${typeLabel}</span>
        ${a.locked ? `<span class="badge" style="background:#d9770618;color:#d97706">${icon('lock')} Protected</span>` : ''}
        <span class="artifact-info" style="margin-left:auto">${fmtDate(a.updated_at)}</span>
      </div>
      ${a.status === 'published' && a.subdomain ? `
        <div class="artifact-link" title="${esc(domain)}">${icon('globe')} ${esc(a.subdomain)}.${state.config?.base || 'biswa.io'}</div>` : ''}
      <div class="artifact-actions" onclick="event.stopPropagation()">
        <button class="btn btn-sm" onclick="openEditor('${esc(a.id)}')">${icon('edit')} Edit</button>
        ${a.status === 'published' && a.subdomain
          ? `<button class="btn btn-sm" onclick="copyText('${esc(domain)}')">${icon('copy')} Copy link</button>`
          : `<button class="btn btn-sm" onclick="openPublishModal('${esc(a.id)}')">${icon('globe')} Publish</button>`}
        <button class="btn btn-sm btn-danger" onclick="deleteArtifact('${esc(a.id)}')">${icon('trash')}</button>
      </div>
    </div>`;
}

function typeColors(type) {
  return { web: ['#685CFF22','#a394ff22'], doc: ['#0ea5e922','#38bdf822'], slide: ['#ec489922','#f472b622'] }[type] || ['#68696c22','#9ca3af22'];
}
function typeEmoji(type) {
  return { web: '⚡', doc: '📄', slide: '🎞️' }[type] || '✦';
}

function openNewArtifactModal() {
  const html = `
    <div class="modal-header">
      <h2>New Artifact</h2>
      <button class="btn btn-sm btn-ghost" onclick="closeModal()">${icon('x')}</button>
    </div>
    <label>Name</label>
    <input id="na-name" placeholder="My awesome page" autofocus>
    <label>Type</label>
    <select id="na-type">
      <option value="web">⚡ Interactive Website</option>
      <option value="doc">📄 Document</option>
      <option value="slide">🎞️ Presentation</option>
    </select>
    <div class="modal-footer">
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="createArtifact()">Create &amp; Edit</button>
    </div>`;
  showModal(html);
  setTimeout(() => $('#na-name')?.focus(), 50);
}

async function createArtifact() {
  const name = $('#na-name')?.value.trim();
  const type = $('#na-type')?.value;
  if (!name) return toast('Enter a name', true);
  try {
    const { id } = await api('/artifacts', { method: 'POST', body: { name, type } });
    closeModal();
    state.artifacts = [];
    openEditor(id);
  } catch (e) { toast(e.message, true); }
}

async function deleteArtifact(id) {
  if (!confirm('Delete this artifact? This cannot be undone.')) return;
  try {
    await api(`/artifacts/${id}`, { method: 'DELETE' });
    state.artifacts = state.artifacts.filter(a => a.id !== id);
    toast('Artifact deleted');
    renderArtifactsList();
  } catch (e) { toast(e.message, true); }
}

// ── Publish modal ──────────────────────────────────────────────────
function openPublishModal(id) {
  const art = state.artifacts.find(a => a.id === id);
  const suggested = art ? slug(art.name) : '';
  const html = `
    <div class="modal-header">
      <h2>Publish artifact</h2>
      <button class="btn btn-sm btn-ghost" onclick="closeModal()">${icon('x')}</button>
    </div>
    <label>Subdomain</label>
    <div class="sub-input-wrap">
      <input id="pub-sub" placeholder="${esc(suggested)}" value="${esc(suggested)}">
      <span class="sub-suffix">.${state.config?.base || 'biswa.io'}</span>
    </div>
    <p class="form-hint">Your artifact will be live at <strong id="pub-preview">${esc(suggested)}.${state.config?.base || 'biswa.io'}</strong></p>
    <label class="toggle-row mt" style="display:flex">
      <input type="checkbox" id="pub-protect" onchange="$('#pub-pw-wrap').style.display=this.checked?'block':'none'">
      Password protect
    </label>
    <div id="pub-pw-wrap" style="display:none">
      <label>Password</label>
      <input id="pub-pw" type="password" placeholder="Set a password">
    </div>
    <div class="modal-footer">
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="doPublish('${esc(id)}')">Publish ${icon('globe')}</button>
    </div>`;
  showModal(html);
  $('#pub-sub')?.addEventListener('input', e => {
    $('#pub-preview').textContent = (e.target.value||'your-page') + '.' + (state.config?.base||'biswa.io');
  });
}

async function doPublish(id) {
  const sub = $('#pub-sub')?.value.trim();
  const protect = $('#pub-protect')?.checked;
  const password = $('#pub-pw')?.value;
  if (!sub) return toast('Enter a subdomain', true);
  if (protect && !password) return toast('Enter a password', true);
  try {
    await api(`/artifacts/${id}/publish`, { method: 'POST', body: { subdomain: sub, protect, password } });
    toast('Published! 🎉');
    closeModal();
    const data = await api('/artifacts');
    state.artifacts = data.items || [];
    renderArtifactsList();
  } catch (e) { toast(e.message, true); }
}

// ══════════════════════════════════════════════════════════════════
//  EDITOR
// ══════════════════════════════════════════════════════════════════
async function openEditor(id) {
  $('#main').innerHTML = '<div style="padding:40px;text-align:center"><span class="spinner"></span></div>';
  try {
    const art = await api(`/artifacts/${id}`);
    state.editorArtifact = art;
    state.editorPage = 0;
    state.editorTab = 'html';
    renderEditor();
  } catch (e) {
    toast(e.message, true);
    navigateTo('artifacts');
  }
}

function renderEditor() {
  const art = state.editorArtifact;
  if (!art) return;
  const pages = art.pages || [];
  const curPage = pages[state.editorPage] || { n: 'index.html', h: '' };
  const isPub = art.status === 'published';
  const domain = state.config ? `${state.config.proto}://${art.subdomain}.${state.config.base}` : '';

  $('#main').innerHTML = `
    <div style="height:100%;display:flex;flex-direction:column;gap:0">
      <div class="editor-toolbar">
        <button class="btn btn-sm btn-ghost" onclick="navigateTo('artifacts')" title="Back">← Back</button>
        <input class="editor-name" id="ed-name" value="${esc(art.name)}" placeholder="Artifact name">
        <span class="badge ${isPub?'badge-pub':'badge-draft'}">${art.status}</span>
        <div class="sp"></div>
        <button class="btn btn-sm" onclick="saveArtifact()" id="ed-save-btn">💾 Save</button>
        ${isPub
          ? `<button class="btn btn-sm btn-danger" onclick="doUnpublish('${art.id}')">Unpublish</button>
             <a class="btn btn-sm btn-primary" href="${esc(domain)}" target="_blank" rel="noopener">${icon('globe')} Live ${icon('eye')}</a>`
          : `<button class="btn btn-sm btn-primary" onclick="openPublishModal('${art.id}')">${icon('globe')} Publish</button>`}
      </div>

      <div class="editor-layout" id="editor-layout">
        <div class="editor-pane">
          <div class="editor-tab-bar" id="page-tabs">
            ${pages.map((p,i) => `
              <button class="editor-tab${i===state.editorPage?' active':''}" onclick="switchPage(${i})" title="${esc(p.n)}">
                ${esc(p.n)}<span class="tab-close" onclick="removePage(event,${i})">×</span>
              </button>`).join('')}
            <button class="editor-add-tab" onclick="addPage()" title="Add page">+</button>
          </div>
          <div class="editor-tab-bar" style="background:var(--code);border-bottom-color:#ffffff22">
            <button class="editor-tab${state.editorTab==='html'?' active':''}" onclick="switchEditorTab('html')" style="color:#cdd6f4">HTML</button>
            <button class="editor-tab${state.editorTab==='css'?' active':''}" onclick="switchEditorTab('css')" style="color:#cdd6f4">CSS</button>
            <button class="editor-tab${state.editorTab==='js'?' active':''}" onclick="switchEditorTab('js')" style="color:#cdd6f4">JS</button>
          </div>
          <textarea class="editor-textarea" id="ed-code" spellcheck="false" onkeydown="editorKeydown(event)">${esc(editorValue())}</textarea>
        </div>
        <div class="editor-pane">
          <div style="padding:8px 12px;font-size:12px;font-family:var(--font-mono);color:var(--mu);border-bottom:1px solid var(--bd);background:var(--surf)">
            Preview · ${esc(curPage.n)}
            <button class="btn btn-sm" style="float:right;margin-top:-2px" onclick="refreshPreview()">↻</button>
          </div>
          <iframe id="ed-preview" class="editor-preview" sandbox="allow-scripts allow-same-origin allow-modals"></iframe>
        </div>
      </div>
    </div>`;

  refreshPreview();

  // Auto-save on change
  let saveTimer;
  $('#ed-code')?.addEventListener('input', () => {
    syncEditorValue();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(refreshPreview, 600);
  });
}

function editorValue() {
  const art = state.editorArtifact;
  if (!art) return '';
  const page = art.pages?.[state.editorPage];
  if (state.editorTab === 'html') return page?.h || '';
  if (state.editorTab === 'css')  return art.css || '';
  if (state.editorTab === 'js')   return art.js || '';
  return '';
}

function syncEditorValue() {
  const val = $('#ed-code')?.value || '';
  const art = state.editorArtifact;
  if (!art) return;
  if (state.editorTab === 'html' && art.pages?.[state.editorPage]) {
    art.pages[state.editorPage].h = val;
  } else if (state.editorTab === 'css') {
    art.css = val;
  } else if (state.editorTab === 'js') {
    art.js = val;
  }
}

function switchPage(i) {
  syncEditorValue();
  state.editorPage = i;
  renderEditor();
}

function switchEditorTab(tab) {
  syncEditorValue();
  state.editorTab = tab;
  const textarea = $('#ed-code');
  if (textarea) textarea.value = editorValue();
  $$('.editor-tab').forEach(t => {
    if (['HTML','CSS','JS'].includes(t.textContent.trim())) {
      t.classList.toggle('active', t.textContent.trim() === tab.toUpperCase());
    }
  });
}

function addPage() {
  const art = state.editorArtifact;
  if (!art) return;
  const name = prompt('Page filename (e.g. about.html):');
  if (!name) return;
  const n = name.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g,'-') + (name.endsWith('.html') ? '' : '.html');
  if (art.pages.find(p => p.n === n)) return toast('Page already exists', true);
  art.pages.push({ n, h: `<!DOCTYPE html>\n<html lang="en">\n<head><meta charset="UTF-8"><title>${n}</title></head>\n<body>\n\n</body>\n</html>` });
  state.editorPage = art.pages.length - 1;
  renderEditor();
}

function removePage(e, i) {
  e.stopPropagation();
  const art = state.editorArtifact;
  if (!art || art.pages.length <= 1) return toast('Cannot remove the last page', true);
  if (!confirm(`Remove page "${art.pages[i].n}"?`)) return;
  art.pages.splice(i, 1);
  state.editorPage = Math.min(state.editorPage, art.pages.length - 1);
  renderEditor();
}

function refreshPreview() {
  const art = state.editorArtifact;
  if (!art) return;
  const page = art.pages?.[state.editorPage];
  const iframe = $('#ed-preview');
  if (!iframe) return;
  // Inject global CSS and JS into HTML
  let html = page?.h || '';
  if (art.css) html = html.replace('</head>', `<style>${art.css}</style></head>`).includes('</head>') ? html.replace('</head>', `<style>${art.css}</style></head>`) : html + `<style>${art.css}</style>`;
  if (art.js) html = html.replace('</body>', `<script>${art.js}<\/script></body>`).includes('</body>') ? html.replace('</body>', `<script>${art.js}<\/script></body>`) : html + `<script>${art.js}<\/script>`;
  iframe.srcdoc = html;
}

function editorKeydown(e) {
  if (e.key === 'Tab') {
    e.preventDefault();
    const ta = e.target;
    const s = ta.selectionStart, end = ta.selectionEnd;
    ta.value = ta.value.slice(0,s) + '  ' + ta.value.slice(end);
    ta.selectionStart = ta.selectionEnd = s + 2;
    syncEditorValue();
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); saveArtifact(); }
}

async function saveArtifact() {
  syncEditorValue();
  const art = state.editorArtifact;
  if (!art) return;
  const btn = $('#ed-save-btn');
  if (btn) { btn.disabled = true; btn.textContent = '…'; }
  try {
    const name = $('#ed-name')?.value.trim() || art.name;
    await api(`/artifacts/${art.id}`, { method: 'PUT', body: { name, pages: art.pages, css: art.css, js: art.js } });
    art.name = name;
    toast('Saved ✓');
    if (btn) { btn.disabled = false; btn.innerHTML = '💾 Save'; }
  } catch (e) {
    toast(e.message, true);
    if (btn) { btn.disabled = false; btn.innerHTML = '💾 Save'; }
  }
}

async function doUnpublish(id) {
  if (!confirm('Unpublish this artifact? The subdomain will stop working.')) return;
  try {
    await api(`/artifacts/${id}/unpublish`, { method: 'POST' });
    toast('Unpublished');
    const art = state.editorArtifact;
    if (art) { art.status = 'draft'; renderEditor(); }
  } catch (e) { toast(e.message, true); }
}

// ══════════════════════════════════════════════════════════════════
//  FILES
// ══════════════════════════════════════════════════════════════════
async function renderFiles() {
  $('#main').innerHTML = `
    <div class="fade-up">
      <div class="page-header">
        <div class="page-header-text">
          <h1>Files · Cloudflare R2</h1>
          <p>Drag &amp; drop to upload · Get instant shareable links</p>
        </div>
        <div class="page-header-actions">
          <button class="btn" onclick="toggleTheme()">🌙</button>
        </div>
      </div>
      <div class="drop-zone" id="file-drop">
        <div class="drop-icon">${icon('upload')}</div>
        <b>Drag &amp; drop files here</b>
        <p>or click to browse · Max 200 MB per file</p>
        <input type="file" id="file-input" multiple hidden>
      </div>
      <div id="upload-progress"></div>
      <div class="card mt" id="file-list"><div style="text-align:center;padding:20px"><span class="spinner"></span></div></div>
    </div>`;

  setupDropZone('#file-drop', '#file-input', uploadFile);
  loadFiles();
}

async function loadFiles() {
  try {
    const data = await api('/files');
    state.files = data.items || [];
    renderFileList();
  } catch (e) { toast(e.message, true); }
}

function renderFileList() {
  const el = $('#file-list');
  if (!el) return;
  if (!state.files.length) {
    el.innerHTML = '<div class="empty"><div class="empty-icon">📁</div><p>No files uploaded yet</p></div>';
    return;
  }
  el.innerHTML = state.files.map(f => `
    <div class="list-item">
      <div class="item-icon">${fileIcon(f.name)}</div>
      <div class="item-info">
        <div class="item-name">${esc(f.name)}</div>
        <div class="item-link">${esc(f.link)}</div>
        <div class="item-sub">${fmtSize(f.size)} · ${fmtDate(f.created_at)}</div>
      </div>
      <div class="item-actions">
        <button class="btn btn-sm" onclick="copyText('${esc(f.link)}')">${icon('copy')} Copy</button>
        <a class="btn btn-sm" href="${esc(f.link)}" target="_blank" rel="noopener">${icon('download')}</a>
        <button class="btn btn-sm btn-danger" onclick="deleteFile('${esc(f.id)}')">${icon('trash')}</button>
      </div>
    </div>`).join('');
}

async function uploadFile(file) {
  const prog = $('#upload-progress');
  if (prog) prog.innerHTML = `<div style="font-size:13px;color:var(--mu);padding:10px 0">Uploading <b>${esc(file.name)}</b>…<div class="progress-bar"><div class="progress-fill" style="width:30%"></div></div></div>`;
  try {
    const { id, url, type } = await api('/files/presign', { method: 'POST', body: { name: file.name, size: file.size, type: file.type } });
    await fetch(url, { method: 'PUT', headers: { 'Content-Type': type }, body: file });
    if (prog) prog.innerHTML = '';
    toast(`${file.name} uploaded`);
    await loadFiles();
  } catch (e) {
    if (prog) prog.innerHTML = '';
    toast(e.message, true);
  }
}

async function deleteFile(id) {
  if (!confirm('Delete this file?')) return;
  try {
    await api(`/files/${id}`, { method: 'DELETE' });
    state.files = state.files.filter(f => f.id !== id);
    renderFileList();
    toast('File deleted');
  } catch (e) { toast(e.message, true); }
}

function fileIcon(name) {
  const ext = name.split('.').pop().toLowerCase();
  const map = { pdf: '📕', png: '🖼️', jpg: '🖼️', jpeg: '🖼️', gif: '🖼️', webp: '🖼️', mp4: '🎬', mov: '🎬', zip: '🗜️', tar: '🗜️', gz: '🗜️', txt: '📝', md: '📝', json: '🔧', js: '🔧', ts: '🔧', css: '🎨', html: '🌐', svg: '🎨' };
  return map[ext] || '📄';
}

// ══════════════════════════════════════════════════════════════════
//  IMAGES
// ══════════════════════════════════════════════════════════════════
async function renderImages() {
  $('#main').innerHTML = `
    <div class="fade-up">
      <div class="page-header">
        <div class="page-header-text">
          <h1>Images · Cloudinary CDN</h1>
          <p>Upload images · Get optimized CDN URLs instantly</p>
        </div>
        <div class="page-header-actions">
          <button class="btn" onclick="toggleTheme()">🌙</button>
        </div>
      </div>
      <div class="drop-zone" id="img-drop">
        <div class="drop-icon">🖼️</div>
        <b>Drop images here</b>
        <p>PNG · JPG · WebP · SVG · Max 10 MB</p>
        <input type="file" id="img-input" accept="image/*" multiple hidden>
      </div>
      <div id="img-upload-prog"></div>
      <div class="grid-3 mt" id="img-grid"><div style="text-align:center;padding:40px"><span class="spinner"></span></div></div>
    </div>`;

  setupDropZone('#img-drop', '#img-input', uploadImage);
  loadImages();
}

async function loadImages() {
  try {
    const data = await api('/images');
    state.images = data.items || [];
    renderImageGrid();
  } catch (e) { toast(e.message, true); }
}

function renderImageGrid() {
  const el = $('#img-grid');
  if (!el) return;
  if (!state.images.length) {
    el.innerHTML = '<div class="empty" style="grid-column:1/-1"><div class="empty-icon">🖼️</div><p>No images uploaded yet</p></div>';
    return;
  }
  el.innerHTML = state.images.map(img => `
    <div class="img-card">
      <div class="img-thumb">
        <img src="${esc(img.url)}" alt="${esc(img.name)}" loading="lazy" onerror="this.parentNode.innerHTML='🖼️'">
      </div>
      <input value="${esc(img.name)}" style="margin-bottom:8px;font-size:13px" onchange="renameImage('${esc(img.id)}',this.value)" title="Click to rename">
      <div class="item-link" style="font-size:10px;margin-bottom:8px;cursor:pointer" onclick="copyText('${esc(img.url)}')" title="Click to copy">${esc(img.url.replace('https://res.cloudinary.com','…cdn'))}</div>
      <div class="row">
        <button class="btn btn-sm" onclick="copyText('${esc(img.url)}')">${icon('copy')} URL</button>
        <button class="btn btn-sm btn-danger" onclick="deleteImage('${esc(img.id)}')">${icon('trash')}</button>
      </div>
    </div>`).join('');
}

async function uploadImage(file) {
  const prog = $('#img-upload-prog');
  if (prog) prog.innerHTML = `<div style="font-size:13px;color:var(--mu);padding:10px 0">Uploading <b>${esc(file.name)}</b>…<div class="progress-bar"><div class="progress-fill" style="width:40%"></div></div></div>`;
  try {
    const form = new FormData();
    form.append('file', file);
    const img = await api('/images', { method: 'POST', form });
    if (prog) prog.innerHTML = '';
    toast(`${file.name} uploaded to Cloudinary`);
    state.images.unshift(img);
    renderImageGrid();
  } catch (e) {
    if (prog) prog.innerHTML = '';
    toast(e.message, true);
  }
}

async function renameImage(id, name) {
  if (!name.trim()) return;
  try {
    const updated = await api(`/images/${id}`, { method: 'PUT', body: { name } });
    const idx = state.images.findIndex(i => i.id === id);
    if (idx > -1) state.images[idx] = { ...state.images[idx], ...updated };
    toast('Renamed');
    renderImageGrid();
  } catch (e) { toast(e.message, true); }
}

async function deleteImage(id) {
  if (!confirm('Delete this image from Cloudinary?')) return;
  try {
    await api(`/images/${id}`, { method: 'DELETE' });
    state.images = state.images.filter(i => i.id !== id);
    renderImageGrid();
    toast('Image deleted');
  } catch (e) { toast(e.message, true); }
}

// ══════════════════════════════════════════════════════════════════
//  ADMIN
// ══════════════════════════════════════════════════════════════════
async function renderAdmin() {
  if (state.user?.role !== 'admin') return navigateTo('dashboard');
  try {
    const data = await api('/admin/users');
    state.adminUsers = data.users || [];
  } catch (e) { toast(e.message, true); return; }
  renderAdminView();
}

function renderAdminView() {
  $('#main').innerHTML = `
    <div class="fade-up">
      <div class="page-header">
        <div class="page-header-text">
          <h1>User Management</h1>
          <p>Manage accounts · Invite users · Control access</p>
        </div>
        <div class="page-header-actions">
          <button class="btn" onclick="toggleTheme()">🌙</button>
          <button class="btn btn-primary" onclick="openNewUserModal()">${icon('plus')} Add user</button>
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr>
            <th>User</th>
            <th>Username</th>
            <th>Email</th>
            <th>Role</th>
            <th>Status</th>
            <th>Joined</th>
            <th>Actions</th>
          </tr></thead>
          <tbody>
            ${state.adminUsers.map(u => `
              <tr>
                <td><div class="row" style="gap:8px"><div class="avatar">${initials(u.full_name||u.username)}</div>${esc(u.full_name||u.username)}</div></td>
                <td><span style="font-family:var(--font-mono);font-size:12px">@${esc(u.username)}</span></td>
                <td style="font-size:13px">${esc(u.email)}</td>
                <td><span class="badge ${u.role==='admin'?'badge-web':'badge-doc'}">${u.role}</span></td>
                <td><span class="badge ${u.active?'badge-pub':'badge-draft'}">${u.active?'Active':'Inactive'}</span></td>
                <td style="font-size:12px;color:var(--mu)">${fmtDate(u.created_at)}</td>
                <td>
                  <div class="row" style="gap:6px">
                    ${u.id !== state.user?.id ? `
                      <button class="btn btn-sm" onclick="toggleUserActive('${esc(u.id)}', ${!u.active})">${u.active?'Deactivate':'Activate'}</button>
                      <button class="btn btn-sm btn-danger" onclick="deleteUser('${esc(u.id)}')">${icon('trash')}</button>
                    ` : '<span style="font-size:12px;color:var(--mu)">You</span>'}
                  </div>
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
}

function openNewUserModal() {
  showModal(`
    <div class="modal-header">
      <h2>Add user</h2>
      <button class="btn btn-sm btn-ghost" onclick="closeModal()">${icon('x')}</button>
    </div>
    <label>Username</label>
    <input id="nu-user" placeholder="username" autocomplete="off">
    <label>Email</label>
    <input id="nu-email" type="email" placeholder="user@email.com">
    <label>Full name</label>
    <input id="nu-name" placeholder="Full Name">
    <label>Role</label>
    <select id="nu-role">
      <option value="user">User</option>
      <option value="admin">Admin</option>
    </select>
    <p class="form-hint mt-sm">A temporary password will be sent to their email.</p>
    <div class="modal-footer">
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="createUser()">Create &amp; send invite</button>
    </div>`);
}

async function createUser() {
  const username = $('#nu-user')?.value.trim();
  const email = $('#nu-email')?.value.trim();
  const full_name = $('#nu-name')?.value.trim();
  const role = $('#nu-role')?.value;
  if (!username || !email) return toast('Username and email are required', true);
  try {
    await api('/admin/users', { method: 'POST', body: { username, email, full_name, role } });
    toast('User created · invite email sent');
    closeModal();
    const data = await api('/admin/users');
    state.adminUsers = data.users || [];
    renderAdminView();
  } catch (e) { toast(e.message, true); }
}

async function toggleUserActive(id, active) {
  try {
    await api(`/admin/users/${id}/active`, { method: 'PATCH', body: { active } });
    toast(active ? 'User activated' : 'User deactivated');
    const data = await api('/admin/users');
    state.adminUsers = data.users || [];
    renderAdminView();
  } catch (e) { toast(e.message, true); }
}

async function deleteUser(id) {
  if (!confirm('Permanently delete this user and all their data?')) return;
  try {
    await api(`/admin/users/${id}`, { method: 'DELETE' });
    state.adminUsers = state.adminUsers.filter(u => u.id !== id);
    renderAdminView();
    toast('User deleted');
  } catch (e) { toast(e.message, true); }
}

// ══════════════════════════════════════════════════════════════════
//  SETTINGS
// ══════════════════════════════════════════════════════════════════
async function renderSettings() {
  let profile;
  try {
    profile = await api('/settings');
  } catch (e) { profile = state.user; }

  $('#main').innerHTML = `
    <div class="fade-up" style="max-width:560px">
      <div class="page-header">
        <div class="page-header-text">
          <h1>Settings</h1>
          <p>Manage your account and preferences</p>
        </div>
        <button class="btn" onclick="toggleTheme()">🌙 Toggle theme</button>
      </div>

      <div class="settings-section">
        <div class="settings-section-header">Profile</div>
        <div class="settings-section-body">
          <div class="row" style="margin-bottom:16px">
            <div class="avatar" style="width:48px;height:48px;font-size:18px">${initials(profile?.full_name||profile?.username||'B')}</div>
            <div>
              <div style="font-weight:600">${esc(profile?.full_name||profile?.username||'')}</div>
              <div style="font-size:13px;color:var(--mu)">@${esc(profile?.username||'')}</div>
            </div>
            <span class="badge badge-web" style="margin-left:auto">${esc(profile?.role||'user')}</span>
          </div>
          <label>Full name</label>
          <input id="s-name" value="${esc(profile?.full_name||'')}">
          <label>Email</label>
          <input id="s-email" type="email" value="${esc(profile?.email||'')}">
          <button class="btn btn-primary" style="margin-top:16px" onclick="saveProfile()">Save profile</button>
        </div>
      </div>

      <div class="settings-section">
        <div class="settings-section-header">Change password</div>
        <div class="settings-section-body">
          ${profile?.must_change_password ? '<div style="background:#d9770618;border:1px solid #d9770630;border-radius:8px;padding:10px 14px;font-size:13px;margin-bottom:14px;color:#d97706">Please change your temporary password</div>' : ''}
          <label>Current password</label>
          <input id="s-cur" type="password" placeholder="Enter current password">
          <label>New password</label>
          <input id="s-new" type="password" placeholder="At least 8 characters">
          <label>Confirm new password</label>
          <input id="s-conf" type="password" placeholder="Repeat new password">
          <button class="btn btn-primary" style="margin-top:16px" onclick="changePassword()">Update password</button>
        </div>
      </div>

      <div class="settings-section">
        <div class="settings-section-header" style="color:var(--err)">Danger zone</div>
        <div class="settings-section-body">
          <p style="font-size:13px;color:var(--mu);margin-bottom:14px">Sign out of all sessions on this device.</p>
          <button class="btn btn-danger" onclick="doLogout()">Sign out</button>
        </div>
      </div>
    </div>`;
}

async function saveProfile() {
  const full_name = $('#s-name')?.value.trim();
  const email = $('#s-email')?.value.trim();
  try {
    const updated = await api('/settings/profile', { method: 'PUT', body: { full_name, email } });
    state.user = { ...state.user, ...updated };
    toast('Profile saved');
  } catch (e) { toast(e.message, true); }
}

async function changePassword() {
  const current_password = $('#s-cur')?.value;
  const new_password = $('#s-new')?.value;
  const confirm = $('#s-conf')?.value;
  if (new_password !== confirm) return toast('Passwords do not match', true);
  if (new_password.length < 8) return toast('Password must be at least 8 characters', true);
  try {
    await api('/settings/password', { method: 'PUT', body: { current_password, new_password } });
    toast('Password updated');
    ['#s-cur','#s-new','#s-conf'].forEach(s => { const el = $(s); if (el) el.value = ''; });
  } catch (e) { toast(e.message, true); }
}

// ══════════════════════════════════════════════════════════════════
//  MODAL HELPERS
// ══════════════════════════════════════════════════════════════════
function showModal(html) {
  const modals = $('#modals');
  modals.innerHTML = `
    <div class="modal-overlay show" id="modal-overlay" onclick="handleOverlayClick(event)">
      <div class="modal-box">${html}</div>
    </div>`;
}

function closeModal() {
  const overlay = $('#modal-overlay');
  if (overlay) overlay.remove();
}

function handleOverlayClick(e) {
  if (e.target.id === 'modal-overlay') closeModal();
}

// ══════════════════════════════════════════════════════════════════
//  DROP ZONE HELPER
// ══════════════════════════════════════════════════════════════════
function setupDropZone(dropSel, inputSel, handler) {
  const drop = $(dropSel);
  const input = $(inputSel);
  if (!drop || !input) return;

  drop.addEventListener('click', () => input.click());
  input.addEventListener('change', () => [...input.files].forEach(handler));

  drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('dragover'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('dragover'));
  drop.addEventListener('drop', e => {
    e.preventDefault();
    drop.classList.remove('dragover');
    [...e.dataTransfer.files].forEach(handler);
  });
}

// ══════════════════════════════════════════════════════════════════
//  GLOBAL EXPOSE & INIT
// ══════════════════════════════════════════════════════════════════
// Expose functions needed by inline event handlers
Object.assign(window, {
  toggleTheme, doLogin, doForgot, doLogout, switchAuthTab,
  navigateTo, openNewArtifactModal, createArtifact, deleteArtifact,
  openPublishModal, doPublish, setArtifactFilter,
  openEditor, saveArtifact, addPage, removePage, switchPage, switchEditorTab,
  refreshPreview, editorKeydown, doUnpublish,
  deleteFile, copyText,
  renameImage, deleteImage,
  renderAdmin, openNewUserModal, createUser, toggleUserActive, deleteUser,
  saveProfile, changePassword,
  closeModal, handleOverlayClick,
});

boot();
