export function SectionHeading({ eyebrow, title, subtitle }: { eyebrow: string; title: string; subtitle?: string }) {
  return (
    <div className="mb-12 max-w-3xl">
      <p className="font-mono text-[11px] tracking-[0.35em] text-accent">{eyebrow}</p>
      <h2 className="mt-4 font-display text-4xl font-bold leading-[1.02] tracking-tight md:text-6xl">{title}</h2>
      {subtitle && <p className="mt-5 text-lg text-muted-foreground">{subtitle}</p>}
    </div>
  );
}
