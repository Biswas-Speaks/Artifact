import { useState } from "react";
import { ARTIFACTS, CATEGORIES } from "@/lib/artifacts";
import { ArtifactCard } from "./ArtifactCard";

export function Gallery({ limit }: { limit?: number }) {
  const [active, setActive] = useState<(typeof CATEGORIES)[number]>("All Creations");
  const filtered = ARTIFACTS.filter((a) => active === "All Creations" || a.category === active);
  const shown = limit ? filtered.slice(0, limit) : filtered;

  return (
    <div>
      <div role="tablist" aria-label="Filter artifacts" className="mb-10 flex flex-wrap gap-2">
        {CATEGORIES.map((c) => (
          <button
            key={c}
            role="tab"
            aria-selected={active === c}
            onClick={() => setActive(c)}
            className={`rounded-full border px-4 py-1.5 text-sm transition-all duration-300 ${
              active === c
                ? "border-foreground bg-foreground text-background"
                : "border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground"
            }`}
          >
            {c}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border py-20 text-center text-muted-foreground">
          No artifacts in this collection yet.
        </div>
      ) : (
        <div key={active} className="grid animate-fade-up gap-5 md:grid-cols-2 lg:grid-cols-3">
          {shown.map((a) => (
            <ArtifactCard key={a.slug} artifact={a} />
          ))}
        </div>
      )}
      <p className="mt-6 font-mono text-[11px] text-muted-foreground">
        * Sample artifacts shown for demonstration.
      </p>
    </div>
  );
}
