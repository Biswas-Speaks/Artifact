import { Activity, ArrowDown, ArrowRight, BatteryCharging, Building2, Cloud, Database, Leaf, Radio, Sun, Zap } from "lucide-react";

export type ShowcaseKind = "business" | "campus" | "learning";

export function showcaseKind(slug: string): ShowcaseKind {
  if (slug === "business-review") return "business";
  if (slug === "energy-lab") return "learning";
  return "campus";
}

export function ArtifactVisual({ kind, compact = false, animated = true }: { kind: ShowcaseKind; compact?: boolean; animated?: boolean }) {
  return (
    <div className={`artifact-visual artifact-${kind} ${compact ? "artifact-compact" : ""} flex h-full w-full flex-col justify-center ${compact ? "p-4" : "p-6 sm:p-10"}`}>
      <div className={`${compact ? "mb-3 text-[8px]" : "mb-5 text-[10px]"} visual-caption flex shrink-0 items-center justify-between font-mono uppercase`}>
        <span>{kind === "business" ? "PERFORMANCE / 2026" : kind === "campus" ? "CAMPUS / SYSTEM MAP" : "LEARNING / ENERGY FLOW"}</span>
        <span className="flex items-center gap-1.5"><span className={`size-1.5 rounded-full bg-showcase ${animated ? "animate-pulse" : ""}`} />Sample data</span>
      </div>
      {kind === "business" ? (
        <>
          <div className="flex items-end justify-between"><div><p className="visual-caption text-xs">Annual revenue</p><p className={`${compact ? "text-4xl" : "text-6xl"} mt-1 font-display font-semibold`}>$1.1M<span className="text-showcase">↗</span></p></div><span className="font-mono text-xs text-showcase">+24.8%</span></div>
          <div className={`flex shrink-0 items-end gap-2 border-b border-art-paper/20 ${compact ? "mt-3 h-16" : "mt-6 h-40"}`}>
            {[32, 39, 46, 50, 57, 66, 64, 76, 87, 91, 96, 100].map((height, i) => <div key={i} className={`chart-bar flex-1 origin-bottom rounded-t-sm bg-showcase ${animated ? "animate-chart-grow" : ""}`} style={{ height: `${height}%`, animationDelay: `${i * 45}ms` }} />)}
          </div>
          <div className="visual-caption mt-2 flex justify-between font-mono text-[10px]"><span>JAN</span><span>JUN</span><span>DEC</span></div>
        </>
      ) : kind === "campus" ? (
        <div className="flex flex-col items-center gap-3">
          <div className="mb-2 w-full"><p className={`${compact ? "text-2xl" : "text-4xl"} font-display font-semibold`}>Connected<span className="text-art-cyan">.</span></p><p className="visual-caption mt-1 font-mono text-[9px]">24 BUILDINGS / ONE LIVING NETWORK</p></div>
          <div className="flex w-full items-center justify-center gap-3"><Node icon={Radio} label="Sensors" /><Connector animated={animated} /><Node icon={Cloud} label="Cloud" /><Connector animated={animated} /><Node icon={Database} label="Analytics" /></div>
          <ArrowDown className="size-4 text-showcase" />
          <div className="flex gap-4"><Node icon={Building2} label="Buildings" /><Node icon={Zap} label="Energy" /><Node icon={Activity} label="Monitoring" /></div>
          {!compact && <p className="visual-caption mt-2 font-mono text-[10px]">24 BUILDINGS · 128 SENSORS · 99.9% UPTIME</p>}
        </div>
      ) : (
        <div className="flex flex-col items-center gap-4">
          <div className="flex w-full items-center justify-between"><p className={`${compact ? "text-2xl" : "text-4xl"} font-display font-semibold`}>Powered<br />by sunlight.</p><Sun className={`text-showcase ${compact ? "size-12" : "size-20"} ${animated ? "animate-spin-slow" : ""}`} /></div>
          <ArrowDown className="size-4 text-showcase" />
          <div className="flex w-full items-center justify-center gap-3"><Node icon={Leaf} label="Solar" /><Connector animated={animated} /><Node icon={BatteryCharging} label="Battery" /><Connector animated={animated} /><Node icon={Building2} label="Campus" /></div>
          {!compact && <p className="visual-caption font-mono text-[10px]">CAPTURE → STORE → DISTRIBUTE</p>}
        </div>
      )}
    </div>
  );
}

function Node({ icon: Icon, label }: { icon: typeof Zap; label: string }) {
  return <div className="flex min-w-0 flex-col items-center gap-2"><div className="flex size-10 items-center justify-center rounded-full border border-showcase/50 bg-showcase/15 sm:size-12"><Icon className="size-5 text-showcase" /></div><span className="visual-caption text-[10px]">{label}</span></div>;
}

function Connector({ animated }: { animated: boolean }) {
  return <div className="relative mb-5 flex min-w-4 max-w-12 flex-1 items-center text-showcase/60"><div className="h-px w-full bg-showcase/30" /><ArrowRight className="absolute right-0 size-3" />{animated && <span className="absolute left-0 size-1 rounded-full bg-showcase animate-data-flow" />}</div>;
}