import { useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Maximize2, Pause, Play, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ArtifactVisual, showcaseKind } from "./ArtifactVisual";
import { ArtifactArtwork } from "./ArtifactArtwork";
import { campusDemand, LEARNING_ANSWER, QUARTER_REVENUE, revenueTotal, type Quarter } from "@/lib/showcases";
import type { Artifact } from "@/lib/artifacts";
import { getStory } from "@/lib/stories";
import { StoryExperience } from "./StoryExperience";

const SLIDES = [
  { title: "A strong year, built together.", copy: "Revenue grew across all three regions, with our largest gains in enterprise accounts.", metric: "$1.1M", label: "Annual revenue" },
  { title: "Momentum in every market.", copy: "North America leads revenue. Europe and Asia Pacific are our next growth opportunities.", metric: "+24.8%", label: "Year-over-year growth" },
  { title: "What comes next.", copy: "Invest in enterprise onboarding, grow the partner network, and expand our renewable infrastructure.", metric: "3", label: "Strategic priorities" },
] as const;

export function ArtifactExperience({ artifact }: { artifact: Artifact }) {
  if (getStory(artifact.slug)) return <StoryExperience slug={artifact.slug} />;
  return <LegacyArtifactExperience artifact={artifact} />;
}

function LegacyArtifactExperience({ artifact }: { artifact: Artifact }) {
  const kind = showcaseKind(artifact.slug);
  const [tab, setTab] = useState("Overview");
  const [animated, setAnimated] = useState(true);
  const [quarter, setQuarter] = useState<Quarter>("Q4");
  const [occupancy, setOccupancy] = useState(65);
  const [answer, setAnswer] = useState<string | null>(null);
  const [slide, setSlide] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const tabs = kind === "business" ? ["Overview", "Data", "Diagram", "Presentation"] : kind === "learning" ? ["Overview", "Diagram", "Knowledge check"] : ["Overview", "Data", "Diagram"];
  const currentSlide = SLIDES[slide] ?? SLIDES[0];
  const isShowcase = ["business-review", "smart-campus", "energy-lab"].includes(artifact.slug);

  async function toggleFullscreen() {
    if (!container.current) return;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await container.current.requestFullscreen();
    } catch {
      setFullscreen((value) => !value);
    }
  }

  return (
    <div ref={container} className={`artifact-experience border border-border bg-card ${fullscreen ? "fixed inset-0 z-50 overflow-auto" : "rounded-lg overflow-hidden"}`}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-6">
        <div role="tablist" aria-label="Artifact views" className="flex flex-wrap gap-1">
          {isShowcase ? tabs.map((item) => <Button key={item} role="tab" id={`tab-${item}`} aria-selected={tab === item} aria-controls="artifact-panel" variant={tab === item ? "secondary" : "ghost"} size="sm" onClick={() => setTab(item)}>{item}</Button>) : <span className="font-mono text-xs">{artifact.title}</span>}
        </div>
        <div className="flex gap-1">
          <Button variant="ghost" size="icon" title={animated ? "Pause animation" : "Play animation"} aria-label={animated ? "Pause animation" : "Play animation"} onClick={() => setAnimated(!animated)}>{animated ? <Pause /> : <Play />}</Button>
          <Button variant="ghost" size="icon" title="Toggle fullscreen" aria-label="Toggle fullscreen" onClick={toggleFullscreen}><Maximize2 /></Button>
        </div>
      </div>
      <div id="artifact-panel" role="tabpanel" aria-labelledby={`tab-${tab}`} className="min-h-[420px]">
        {!isShowcase ? <div className="h-[420px] sm:h-[520px]"><ArtifactArtwork slug={artifact.slug} animated={animated} /></div> : tab === "Diagram" ? <div className="h-[420px]"><ArtifactVisual kind={kind} animated={animated} /></div> : tab === "Presentation" ? (
          <div className="presentation-stage flex min-h-[420px] flex-col justify-between p-6 sm:p-10">
            <div key={slide} className={animated ? "animate-fade-up" : ""}><p className="font-mono text-xs text-accent">2026 / BUSINESS REVIEW</p><h2 className="mt-6 max-w-xl font-display text-3xl font-semibold sm:text-5xl">{currentSlide.title}</h2><p className="mt-5 max-w-lg text-muted-foreground">{currentSlide.copy}</p><p className="mt-6 font-display text-4xl">{currentSlide.metric}</p><p className="mt-1 text-sm text-muted-foreground">{currentSlide.label}</p></div>
            <div className="mt-8 flex items-center justify-between"><span className="font-mono text-xs text-muted-foreground">0{slide + 1} / 03</span><div className="flex gap-2"><Button variant="outline" size="icon" disabled={slide === 0} aria-label="Previous slide" onClick={() => setSlide(slide - 1)}><ArrowLeft /></Button><Button variant="outline" size="icon" disabled={slide === 2} aria-label="Next slide" onClick={() => setSlide(slide + 1)}><ArrowRight /></Button></div></div>
          </div>
        ) : tab === "Knowledge check" ? (
          <div className="p-6 sm:p-10"><p className="font-mono text-xs text-accent">01 / KNOWLEDGE CHECK</p><h2 className="mt-5 font-display text-2xl font-semibold">Which component converts sunlight into electricity?</h2><div className="mt-6 grid max-w-lg gap-3">{[LEARNING_ANSWER, "Battery storage", "Power inverter"].map((option) => <Button key={option} variant={answer === option ? "secondary" : "outline"} className="justify-start" onClick={() => setAnswer(option)}>{answer === option && <Check />}{option}</Button>)}</div>{answer && <p role="status" className="mt-6 text-sm text-muted-foreground">{answer === LEARNING_ANSWER ? "Correct. Photovoltaic cells convert sunlight into electrical energy." : "Not quite. Batteries store energy; inverters convert DC to AC. Solar panels capture sunlight."}</p>}<Button variant="ghost" className="mt-5" onClick={() => setAnswer(null)}><RotateCcw />Try again</Button></div>
        ) : (
          <div className="grid lg:grid-cols-[1.1fr_1fr]">
            <div className="min-h-[360px]"><ArtifactVisual kind={kind} animated={animated} /></div>
            <div className="border-t border-border p-6 lg:border-l lg:border-t-0 sm:p-8">
              <p className="font-mono text-[10px] uppercase tracking-widest text-accent">{kind === "business" ? "Business & consulting" : kind === "learning" ? "Education & research" : "Engineering & IT"}</p>
              <h2 className="mt-4 font-display text-2xl font-semibold">{kind === "business" ? "Performance at a glance." : kind === "learning" ? "From sunlight to a smarter campus." : "A connected campus."}</h2>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{kind === "business" ? "One quarterly review brings financial data, analysis, and the presentation together." : kind === "learning" ? "Solar panels generate DC electricity. An inverter converts it to AC, while batteries store surplus energy for later." : "Sensors connect buildings to a shared energy network. Adjust occupancy to explore estimated demand."}</p>
              {kind === "business" ? <div className="mt-6"><div role="group" aria-label="Quarter" className="flex gap-1">{(Object.keys(QUARTER_REVENUE) as Quarter[]).map((q) => <Button key={q} size="sm" variant={q === quarter ? "secondary" : "ghost"} onClick={() => setQuarter(q)}>{q}</Button>)}</div><p className="mt-5 font-display text-3xl">${revenueTotal(quarter)}k</p><p className="mt-1 text-xs text-muted-foreground">{quarter} revenue · USD</p><table className="mt-5 w-full text-left text-sm"><thead><tr className="border-b border-border text-muted-foreground"><th className="pb-2 font-normal">Month</th><th className="pb-2 text-right font-normal">Revenue</th></tr></thead><tbody>{QUARTER_REVENUE[quarter].map((value, i) => <tr key={i} className="border-b border-border"><td className="py-2">{["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][(Number(quarter.slice(1)) - 1) * 3 + i]}</td><td className="py-2 text-right font-mono">${value}k</td></tr>)}</tbody></table></div> : kind === "campus" ? <div className="mt-6"><label htmlFor="occupancy" className="flex justify-between text-sm"><span>Building occupancy</span><span className="font-mono">{occupancy}%</span></label><input id="occupancy" type="range" min="0" max="100" value={occupancy} onChange={(e) => setOccupancy(Number(e.target.value))} className="mt-4 w-full accent-accent" /><div className="mt-6 grid grid-cols-2 gap-4"><div><p className="font-display text-3xl">{campusDemand(occupancy)}</p><p className="mt-1 text-xs text-muted-foreground">Estimated demand · kW</p></div><div><p className="font-display text-3xl">128</p><p className="mt-1 text-xs text-muted-foreground">Connected sensors</p></div></div><p className="mt-5 text-xs text-muted-foreground">Illustrative model: 120 kW baseline + 2.4 kW per occupancy point.</p>{tab === "Data" && <table className="mt-5 w-full text-left text-sm"><tbody>{[["Science block", "48 sensors"], ["Library", "32 sensors"], ["Student housing", "48 sensors"]].map(([name, value]) => <tr key={name} className="border-b border-border"><td className="py-2">{name}</td><td className="text-right text-muted-foreground">{value}</td></tr>)}</tbody></table>}</div> : <div className="mt-6 space-y-4">{[["01", "Capture", "Photovoltaic cells absorb light and generate current."], ["02", "Store", "Surplus energy charges the battery system."], ["03", "Distribute", "The campus draws clean energy as demand rises."]].map(([n, title, copy]) => <div key={n} className="flex gap-4 border-t border-border pt-4"><span className="font-mono text-xs text-accent">{n}</span><div><h3 className="text-sm font-medium">{title}</h3><p className="mt-1 text-xs leading-relaxed text-muted-foreground">{copy}</p></div></div>)}</div>}
            </div>
          </div>
        )}
      </div>
      <div className="flex justify-between border-t border-border px-6 py-3 font-mono text-[10px] text-muted-foreground"><span>BISWA ARTIFACTS / {kind.toUpperCase()}</span><span>ILLUSTRATIVE SAMPLE</span></div>
    </div>
  );
}