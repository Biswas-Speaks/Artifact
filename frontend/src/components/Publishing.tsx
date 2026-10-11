import { Eye, EyeOff, FileStack, History, Link2, Lock } from "lucide-react";
import { SectionHeading } from "./SectionHeading";

const STAGES = ["CREATE", "REFINE", "PUBLISH"];
const FEATURES = [
  { icon: Link2, label: "Public artifacts" },
  { icon: EyeOff, label: "Unlisted links" },
  { icon: Lock, label: "Password protected" },
  { icon: Eye, label: "Private drafts" },
  { icon: History, label: "Version history" },
  { icon: FileStack, label: "Multipage artifacts" },
];

export function Publishing() {
  return (
    <section className="border-y border-border bg-surface">
      <div className="mx-auto max-w-6xl px-6 py-28">
        <SectionHeading
          eyebrow="04 — PUBLISHING"
          title="From creation to the world."
          subtitle="Every published artifact receives its own shareable URL."
        />

        <div className="grid gap-5 md:grid-cols-3">
          {STAGES.map((s, i) => (
            <div key={s} className="relative h-56 rounded-2xl border border-border bg-background p-5 [perspective:800px]">
              <p className="font-mono text-[11px] tracking-[0.35em] text-accent">0{i + 1} · {s}</p>
              <div className="absolute inset-x-6 bottom-6 top-14">
                {Array.from({ length: 3 - i }).map((_, j) => (
                  <div
                    key={j}
                    className="absolute inset-0 animate-float-slow rounded-lg border border-border bg-card"
                    style={{
                      transform: `translate(${j * 10}px, ${j * -8}px) rotateX(${i === 2 ? 0 : 12 - i * 6}deg)`,
                      animationDelay: `${j * 0.6}s`,
                      opacity: 1 - j * 0.3,
                    }}
                  />
                ))}
                {i === 2 && (
                  <div className="absolute inset-0 flex flex-col justify-end rounded-lg bg-gradient-to-br from-accent/80 to-accent/30 p-4">
                    <p className="font-mono text-[10px] text-accent-foreground">biswa.io/a/orbital-tides</p>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        <ul className="mt-12 grid grid-cols-2 gap-4 md:grid-cols-6">
          {FEATURES.map(({ icon: Icon, label }) => (
            <li key={label} className="flex flex-col gap-2 text-sm">
              <Icon size={18} className="text-accent" />
              {label}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
