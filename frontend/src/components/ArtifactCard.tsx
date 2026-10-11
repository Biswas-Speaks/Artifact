import { Link } from "@tanstack/react-router";
import { ArrowUpRight } from "lucide-react";
import { type Artifact, formatDate } from "@/lib/artifacts";
import { ArtifactVisual, showcaseKind } from "./ArtifactVisual";
import { ArtifactArtwork } from "./ArtifactArtwork";
import { useRef } from "react";

export function ArtifactPreview({ artifact, className }: { artifact: Artifact; className?: string }) {
  const art = useRef<HTMLDivElement>(null);
  return (
    <div className={`artifact-reactive relative overflow-hidden ${className ?? ""}`} onPointerMove={(e) => { if (!art.current || e.pointerType === "touch" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return; const r=e.currentTarget.getBoundingClientRect(); const x=(e.clientX-r.left)/r.width-.5; const y=(e.clientY-r.top)/r.height-.5; art.current.style.setProperty("--art-pointer-x", `${x*20}px`); art.current.style.setProperty("--art-pointer-y", `${y*20}px`); art.current.style.setProperty("--art-pointer-turn", `${x*12}deg`); art.current.style.transform=`perspective(700px) rotateX(${-y*6}deg) rotateY(${x*6}deg) scale(1.025)`; }} onPointerLeave={() => { if (art.current) { art.current.style.transform=""; art.current.style.setProperty("--art-pointer-x", "0px"); art.current.style.setProperty("--art-pointer-y", "0px"); art.current.style.setProperty("--art-pointer-turn", "0deg"); } }}>
      <div ref={art} className="artifact-reactive-inner h-full w-full">
      {["business-review", "smart-campus", "energy-lab"].includes(artifact.slug) ? <ArtifactVisual kind={showcaseKind(artifact.slug)} compact /> : <ArtifactArtwork slug={artifact.slug} compact />}
      </div>
    </div>
  );
}

export function ArtifactCard({ artifact }: { artifact: Artifact }) {
  return (
    <Link
      to="/a/$slug"
      params={{ slug: artifact.slug }}
      className={`group flex flex-col rounded-lg border border-border bg-card p-3 transition-all duration-500 hover:-translate-y-1 hover:border-accent/50 focus-visible:outline-2 focus-visible:outline-accent ${
        artifact.span ? "md:col-span-2" : ""
      }`}
    >
      <ArtifactPreview artifact={artifact} className="aspect-[16/10] rounded-md" />
      <div className="flex flex-1 flex-col px-2 pb-2 pt-5">
        <div className="flex items-center justify-between font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
          <span className="text-accent">{artifact.category}</span>
          <time dateTime={artifact.publishedAt}>{formatDate(artifact.publishedAt)}</time>
        </div>
        <h3 className="mt-3 font-display text-2xl font-semibold tracking-tight">{artifact.title}</h3>
        <p className="mt-2 flex-1 text-sm leading-relaxed text-muted-foreground">{artifact.description}</p>
        <span className="mt-5 inline-flex items-center gap-1 text-sm font-medium">
          View artifact
          <ArrowUpRight size={15} className="transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
        </span>
      </div>
    </Link>
  );
}
