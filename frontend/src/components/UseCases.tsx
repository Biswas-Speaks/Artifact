import { Link } from "@tanstack/react-router";
import { ArrowUpRight, Building2, GraduationCap, Network } from "lucide-react";
import { USE_CASES } from "@/lib/showcases";
import { SectionHeading } from "./SectionHeading";

export function UseCases() {
  const icons = [Building2, Network, GraduationCap];
  return <section className="mx-auto max-w-6xl px-6 pb-20 pt-10"><SectionHeading eyebrow="IN PRACTICE" title="One artifact. Many possibilities." subtitle="Business reviews, connected systems, and lessons that come alive." /><div className="grid gap-8 md:grid-cols-3">{USE_CASES.map((item, i) => { const Icon = icons[i] ?? Building2; return <Link key={item.slug} to="/a/$slug" params={{ slug: item.slug }} className="group border-t border-border pt-6"><div className="flex items-center justify-between"><Icon className="size-5 text-accent" /><ArrowUpRight className="size-4 text-muted-foreground transition-transform group-hover:-translate-y-1 group-hover:translate-x-1" /></div><p className="mt-6 font-mono text-[10px] uppercase tracking-widest text-accent">{item.sector}</p><h3 className="mt-3 font-display text-xl font-semibold">{item.title}</h3><p className="mt-3 text-sm leading-relaxed text-muted-foreground">{item.copy}</p><p className="mt-5 text-xs text-muted-foreground">{item.formats}</p></Link>; })}</div></section>;
}