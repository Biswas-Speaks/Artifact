import { useEffect, useRef } from 'react';

export function ParticleCanvas({ paused }: { paused: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const pointer = useRef({ x: -200, y: -200 });
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const ctx = el.getContext('2d');
    if (!ctx) return;
    const width = el.clientWidth, height = 260;
    el.width = width * 2; el.height = height * 2; ctx.scale(2, 2);
    const css = getComputedStyle(document.documentElement);
    const colors = ['coral','blue','yellow','mint','violet'].map(c => css.getPropertyValue(`--shape-${c}`).trim());
    const particles = Array.from({ length: 160 }, (_, i) => ({ x: (i * 137.5) % width, y: (i * 79.3) % height, vx: 0, vy: 0, color: colors[i % 5] ?? 'currentColor' }));
    let frame = 0, last = 0;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    function draw(now: number) {
      if (!ctx) return;
      const dt = Math.min((now - last) / 16.667 || 1, 3); last = now;
      ctx.clearRect(0, 0, width, height);
      particles.forEach(p => {
        if (!paused && !reduced) {
          const dx = p.x - pointer.current.x, dy = p.y - pointer.current.y, d = Math.hypot(dx, dy) + 1;
          if (d < 70) { p.vx += dx / d * .9 * dt; p.vy += dy / d * .9 * dt; }
          p.vx *= Math.pow(.93, dt); p.vy *= Math.pow(.93, dt);
          p.x = (p.x + p.vx * dt + Math.sin(p.y / 30) * .2 * dt + width) % width;
          p.y = (p.y + p.vy * dt + height) % height;
        }
        ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2); ctx.fill();
      });
      if (!paused && !reduced) frame = requestAnimationFrame(draw);
    }
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [paused]);
  return <canvas ref={canvas} aria-label="Interactive garden of 160 particles" className="h-[260px] w-full touch-none" onPointerMove={e => { const r = e.currentTarget.getBoundingClientRect(); pointer.current = { x: e.clientX - r.left, y: e.clientY - r.top }; }} onPointerLeave={() => { pointer.current = { x: -200, y: -200 }; }} />;
}