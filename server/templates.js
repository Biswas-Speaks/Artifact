module.exports = {
  web: () => ({
    pages: [
      {
        n: 'index.html',
        h: '<header><b>✦ Studio</b><a href="about.html">About</a></header>\n<main>\n  <h1>Hello, <span>world</span></h1>\n  <p>Edit me — the preview updates live.</p>\n  <button id="b">Click me</button>\n</main>',
      },
      {
        n: 'about.html',
        h: '<header><b>✦ Studio</b><a href="index.html">Home</a></header>\n<main>\n  <h1>About</h1>\n  <p>A second page in the same artifact.</p>\n</main>',
      },
    ],
    css: 'body{margin:0;font-family:system-ui;background:#0f1220;color:#fff;text-align:center}\nheader{display:flex;justify-content:space-between;padding:18px 28px}\na{color:#a5b4fc;text-decoration:none}\nmain{padding:12vh 20px}\nh1{font-size:52px;animation:u .8s both}h1 span{color:#e84fb0}\nbutton{padding:12px 22px;border:0;border-radius:10px;background:#6d5df6;color:#fff;cursor:pointer}\n@keyframes u{from{opacity:0;transform:translateY(20px)}}',
    js: "var b=document.getElementById('b');\nif(b)b.onclick=function(){b.textContent='🎉 Nice!'}",
  }),

  doc: () => ({
    pages: [
      {
        n: 'index.html',
        h: '<article>\n  <small>DOCUMENT</small>\n  <h1>Project proposal</h1>\n  <p class="by">By Biswa</p>\n  <h2>Overview</h2>\n  <p>Write your content here. Use headings, lists and quotes.</p>\n  <blockquote>Good design is as little design as possible.</blockquote>\n</article>',
      },
    ],
    css: 'body{margin:0;background:#faf8f4;color:#222;font:18px/1.7 Georgia,serif}\narticle{max-width:680px;margin:auto;padding:60px 24px;animation:f 1s both}\nsmall{letter-spacing:.2em;color:#e84fb0;font-weight:700}\nh1{font-size:44px;margin:6px 0}.by{color:#888}\nblockquote{border-left:4px solid #6d5df6;margin:24px 0;padding-left:16px;font-style:italic}\n@keyframes f{from{opacity:0}}',
    js: '',
  }),

  slide: () => ({
    pages: [
      {
        n: 'index.html',
        h: '<div class="s on"><h1>Big idea</h1><p>Press → to continue</p></div>\n<div class="s"><h1>Why it matters</h1><p>Three bullet points, one story.</p></div>\n<div class="s"><h1>Thank you ✦</h1><p>CREATE · PUBLISH · INSPIRE</p></div>\n<div class="nv"><button onclick="go(-1)">←</button><button onclick="go(1)">→</button></div>',
      },
    ],
    css: 'body{margin:0;overflow:hidden;background:linear-gradient(135deg,#1e1b4b,#6d5df6,#e84fb0);color:#fff;font-family:system-ui;height:100vh}\n.s{position:absolute;inset:0;display:none;flex-direction:column;align-items:center;justify-content:center;text-align:center}\n.s.on{display:flex;animation:z .6s both}.s h1{font-size:64px;margin:0}\n.nv{position:fixed;bottom:20px;right:20px}.nv button{margin-left:8px;border:0;border-radius:99px;padding:8px 16px;cursor:pointer}\n@keyframes z{from{opacity:0;transform:scale(.9)}}',
    js: "var i=0,S=document.querySelectorAll('.s');\nfunction go(d){S[i].classList.remove('on');i=(i+d+S.length)%S.length;S[i].classList.add('on')}\ndocument.onkeydown=function(e){if(e.key=='ArrowRight')go(1);if(e.key=='ArrowLeft')go(-1)}",
  }),
};
