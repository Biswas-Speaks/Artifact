import { useState } from "react";
import { SectionHeading } from "./SectionHeading";

function MiniSite() {
  const [pos, setPos] = useState({ x: 50, y: 50 });
  return (
    <div
      onPointerMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        setPos({ x: ((e.clientX - r.left) / r.width) * 100, y: ((e.clientY - r.top) / r.height) * 100 });
      }}
      className="relative h-44 overflow-hidden rounded-lg border border-border bg-background"
    >
      <div className="flex gap-1 border-b border-border px-2 py-1.5">
        <span className="size-2 rounded-full bg-muted-foreground/40" />
        <span className="size-2 rounded-full bg-muted-foreground/40" />
        <span className="size-2 rounded-full bg-muted-foreground/40" />
      </div>
      <div
        className="absolute size-24 rounded-full bg-accent/40 blur-2xl transition-all duration-300"
        style={{ left: `${pos.x}%`, top: `${pos.y}%`, transform: "translate(-50%,-50%)" }}
      />
      <div className="relative p-4">
        <div className="h-3 w-24 rounded bg-foreground/80" />
        <div className="mt-2 h-2 w-36 rounded bg-muted-foreground/40" />
        <div className="mt-6 grid grid-cols-3 gap-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-12 rounded border border-border bg-card/60" />
          ))}
        </div>
      </div>
    </div>
  );
}

function MiniDoc() {
  return (
    <div className="h-44 overflow-hidden rounded-lg border border-border bg-background p-5 transition-transform duration-700 group-hover:-rotate-1 group-hover:scale-[1.02]">
      <p className="font-mono text-[9px] tracking-[0.3em] text-accent">ESSAY · 04</p>
      <p className="mt-2 font-display text-lg font-bold leading-tight">On the shape of attention</p>
      <div className="mt-3 grid grid-cols-[2fr_1fr] gap-3">
        <div className="space-y-1.5">
          {[100, 92, 96, 70].map((w, i) => (
            <div key={i} className="h-1.5 rounded bg-muted-foreground/30" style={{ width: `${w}%` }} />
          ))}
        </div>
        <div className="h-14 rounded bg-gradient-to-br from-accent/60 to-accent/10" />
      </div>
    </div>
  );
}

function MiniSlides() {
  return (
    <div className="relative h-44 overflow-hidden rounded-lg border border-border bg-background [perspective:600px]">
      {[2, 1, 0].map((i) => (
        <div
          key={i}
          className="absolute inset-6 flex items-end rounded-md border border-border bg-card p-3 transition-transform duration-700 group-hover:[transform:translateZ(0)]"
          style={{ transform: `translateX(${i * 14}px) translateY(${-i * 8}px) rotateY(-${i * 8}deg)`, opacity: 1 - i * 0.25 }}
        >
          {i === 0 && <span className="font-display text-xl font-bold">Signal<span className="text-accent">.</span></span>}
        </div>
      ))}
    </div>
  );
}

function MiniCode() {
  return (
    <div className="grid h-44 grid-cols-2 overflow-hidden rounded-lg border border-border bg-background font-mono text-[10px] leading-5">
      <pre className="border-r border-border p-3 text-muted-foreground">
        <span className="text-accent">const</span> orb = <span className="text-accent">new</span> Orb();{"\n"}
        orb.<span className="text-foreground">glow</span>(0.8);{"\n"}
        orb.<span className="text-foreground">spin</span>();
      </pre>
      <div className="flex items-center justify-center">
        <div className="size-14 animate-spin-slow rounded-full border-2 border-dashed border-accent shadow-[0_0_30px_var(--color-accent)]" />
      </div>
    </div>
  );
}

const CARDS = [
  { title: "Interactive Experiences", copy: "From experimental interfaces to complete interactive stories.", Demo: MiniSite },
  { title: "Creative Documents", copy: "Documents that feel designed, not assembled.", Demo: MiniDoc },
  { title: "Cinematic Presentations", copy: "Presentations that move ideas forward.", Demo: MiniSlides },
  { title: "Code Experiments", copy: "Write it. Preview it. Bring it to life.", Demo: MiniCode },
];

export function Capabilities() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-28">
      <SectionHeading eyebrow="02 — CAPABILITIES" title="One canvas. Infinite possibilities." />
      <div className="grid gap-5 md:grid-cols-2">
        {CARDS.map(({ title, copy, Demo }, i) => (
          <article key={title} className="group rounded-2xl border border-border bg-card p-5 transition-colors hover:border-accent/50">
            <Demo />
            <p className="mt-6 font-mono text-[11px] text-muted-foreground">0{i + 1}</p>
            <h3 className="mt-1 font-display text-2xl font-semibold tracking-tight">{title}</h3>
            <p className="mt-2 text-muted-foreground">{copy}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
