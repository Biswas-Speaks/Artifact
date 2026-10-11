export function AboutBlock() {
  return (
    <section className="mx-auto grid max-w-6xl items-center gap-16 px-6 py-28 md:grid-cols-[1.3fr_1fr]">
      <div>
        <p className="font-mono text-[11px] tracking-[0.35em] text-accent">05 — ABOUT</p>
        <h2 className="mt-4 font-display text-5xl font-bold leading-[0.95] tracking-tight md:text-7xl">
          Built for the
          <br />
          <span className="text-outline">curious.</span>
        </h2>
        <p className="mt-8 max-w-xl text-lg leading-relaxed text-muted-foreground">
          Biswa Artifacts is an independent creative space where design, technology, and imagination meet. A home for
          ideas that deserve to be seen, explored, and experienced.
        </p>
      </div>
      <div aria-hidden className="relative mx-auto aspect-square w-full max-w-sm overflow-hidden">
        <div className="absolute inset-0 animate-spin-slow rounded-full border border-border" />
        <div className="absolute inset-[15%] animate-spin-slow border border-accent/50" style={{ animationDirection: "reverse" }} />
        <div className="absolute inset-[32%] rounded-full bg-gradient-to-br from-accent to-accent/20 animate-float-slow" />
      </div>
    </section>
  );
}
