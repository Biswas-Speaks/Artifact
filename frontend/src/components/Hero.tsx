import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUpRight, Pause, Play, Shuffle, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PlaygroundInput } from "./Hero3D";

const Hero3D = lazy(() => import("./Hero3D"));

function canUseWebGL() {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

function StaticFallback() {
  return <div className="hero-fallback pointer-events-none absolute inset-0" aria-hidden><span className="fallback-ring" /><span className="fallback-cube" /><span className="fallback-diamond" /><span className="fallback-triangle" /></div>;
}

function Letters({ word, delay, className }: { word: string; delay: number; className?: string }) {
  return (
    <span className={`block overflow-hidden ${className ?? ""}`} aria-label={word}>
      {word.split("").map((ch, i) => (
        <span
          key={i}
          aria-hidden
          className="animate-letter-rise"
          style={{ animationDelay: `${delay + i * 0.07}s` }}
        >
          {ch}
        </span>
      ))}
    </span>
  );
}

export function Hero() {
  const [mode, setMode] = useState<"pending" | "3d" | "static">("pending");
  const [colors, setColors] = useState<string[]>([]);
  const [paused, setPaused] = useState(false);
  const [joy, setJoy] = useState(0);
  const input = useRef<PlaygroundInput>({x:0,y:0,active:false,remix:0,paused:false});

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const styles = getComputedStyle(document.documentElement);
    const canvas = document.createElement("canvas");
    canvas.width=canvas.height=1;
    const ctx = canvas.getContext("2d");
    if (ctx) setColors(["--shape-coral","--shape-blue","--shape-yellow","--shape-mint","--shape-violet","--shape-coral"].map((token) => {
      ctx.fillStyle=styles.getPropertyValue(token).trim(); ctx.fillRect(0,0,1,1);
      const data=ctx.getImageData(0,0,1,1).data;
      return `rgb(${data[0]},${data[1]},${data[2]})`;
    }));
    input.current.paused = reduced;
    setPaused(reduced);
    setMode(!reduced && canUseWebGL() ? "3d" : "static");
  }, []);

  return (
    <section className="art-hero relative flex items-center justify-center overflow-hidden px-6 pb-12 pt-24" onPointerMove={(e) => { const rect=e.currentTarget.getBoundingClientRect(); input.current.x=(e.clientX-rect.left)/rect.width*2-1; input.current.y=1-(e.clientY-rect.top)/rect.height*2; input.current.active=true; }} onPointerLeave={() => { input.current.active=false; }}>
      {mode === "3d" && colors.length > 0 && (
        <Suspense fallback={<StaticFallback />}><Hero3D input={input} colors={colors} onPop={() => setJoy((n)=>n+1)} /></Suspense>
      )}
      {mode !== "3d" && <StaticFallback />}

      <div className="pointer-events-none relative z-10 text-center">
        <p className="mb-5 flex items-center justify-center gap-2 animate-fade-up font-mono text-[10px] uppercase text-muted-foreground">
          <Sparkles className="size-3 text-accent" /> An independent creative universe
        </p>
        <h1 className="font-display font-bold leading-[0.95] tracking-normal">
          <Letters word="Biswa" delay={0.1} className="hero-word" />
          <Letters word="Artifacts" delay={0.3} className="hero-artifacts mt-1" />
        </h1>
        <p
           className="mt-6 animate-fade-up font-mono text-[10px] text-muted-foreground sm:text-xs"
           style={{ animationDelay: "1s" }}
        >
          CREATE · PUBLISH · INSPIRE
        </p>
        <p
          className="mx-auto mt-4 max-w-md animate-fade-up text-base text-muted-foreground md:text-lg"
          style={{ animationDelay: "1.1s" }}
        >
          A little imagination. A world of possibilities.
        </p>
        <div className="pointer-events-auto mt-7 flex items-center justify-center gap-2"><Button asChild className="h-11 rounded-full px-6"><a href="#creations">Explore creations <ArrowUpRight className="size-4" /></a></Button><Button variant="outline" size="icon" className="size-11 rounded-full bg-background/80" title="Remix shapes" aria-label="Remix shapes" onClick={() => { input.current.remix+=1; setJoy((n)=>n+1); }}><Shuffle className="size-4" /></Button></div>
      </div>

      <a
        href="#creations"
        aria-label="Scroll to creations"
        className="absolute bottom-7 left-1/2 z-10 -translate-x-1/2 text-muted-foreground"
        style={{ animationDelay: "2.3s" }}
      >
        <ArrowDown className="size-4" />
      </a>
      <span className="absolute bottom-7 left-6 flex items-center gap-2 font-mono text-[9px] text-muted-foreground sm:left-10"><span className="size-1.5 rounded-full bg-shape-mint" /> A LITTLE JOY, BY DESIGN<span className="sr-only" role="status">{joy > 0 ? `Shapes remixed ${joy} times` : ""}</span></span>
      <Button variant="ghost" size="icon" className="absolute bottom-4 right-6 rounded-full" title={paused ? "Play shapes" : "Pause shapes"} aria-label={paused ? "Play shapes" : "Pause shapes"} onClick={() => { input.current.paused=!paused; setPaused(!paused); }}>{paused ? <Play className="size-3" /> : <Pause className="size-3" />}</Button>
    </section>
  );
}
