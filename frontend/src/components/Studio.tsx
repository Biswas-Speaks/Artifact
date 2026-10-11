import { File, Folder, Maximize2, Monitor, RotateCw, Smartphone, Tablet } from "lucide-react";
import { useState } from "react";
import { SectionHeading } from "./SectionHeading";

type Page = "index" | "about" | "projects" | "contact";

const CODE: Record<Page, string[]> = {
  index: ['<main class="hero">', '  <h1>Hello, I make things.</h1>', '  <a href="projects.html">', "    See the work →", "  </a>", "</main>"],
  about: ['<section class="about">', "  <h1>About</h1>", "  <p>Designer & developer", "     based in Kolkata.</p>", "</section>"],
  projects: ['<ul class="grid">', '  <li class="card">Orbital</li>', '  <li class="card">Garden</li>', '  <li class="card">Signal</li>', "</ul>"],
  contact: ['<form class="contact">', '  <input placeholder="Email">', "  <button>Send</button>", "</form>"],
};

function highlight(line: string) {
  return line.split(/(<\/?[a-z0-9]+|"[^"]*"|>)/g).map((part, i) =>
    part.startsWith("<") ? (
      <span key={i} className="text-accent">{part}</span>
    ) : part.startsWith('"') ? (
      <span key={i} className="text-muted-foreground">{part}</span>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

function Preview({ page, go }: { page: Page; go: (p: Page) => void }) {
  return (
    <div className="flex h-full flex-col bg-card">
      <div className="flex gap-3 border-b border-border px-3 py-2 text-[11px]">
        {(["index", "about", "projects", "contact"] as Page[]).map((p) => (
          <button key={p} onClick={() => go(p)} className={p === page ? "text-accent" : "text-muted-foreground hover:text-foreground"}>
            {p === "index" ? "home" : p}
          </button>
        ))}
      </div>
      <div key={page} className="flex-1 animate-fade-up p-5">
        {page === "index" && (
          <>
            <p className="font-display text-2xl font-bold leading-tight">Hello, I make things.</p>
            <button onClick={() => go("projects")} className="mt-4 text-sm text-accent">See the work →</button>
          </>
        )}
        {page === "about" && (
          <>
            <p className="font-display text-2xl font-bold">About</p>
            <p className="mt-2 text-sm text-muted-foreground">Designer & developer based in Kolkata.</p>
          </>
        )}
        {page === "projects" && (
          <div className="grid grid-cols-2 gap-2">
            {["Orbital", "Garden", "Signal"].map((n) => (
              <div key={n} className="rounded-md border border-border bg-background p-3 text-sm">{n}</div>
            ))}
          </div>
        )}
        {page === "contact" && (
          <div className="space-y-2">
            <div className="rounded-md border border-border bg-background px-3 py-2 text-sm text-muted-foreground">Email</div>
            <div className="inline-block rounded-md bg-foreground px-3 py-1.5 text-sm text-background">Send</div>
          </div>
        )}
      </div>
    </div>
  );
}

export function Studio() {
  const [page, setPage] = useState<Page>("index");
  const [device, setDevice] = useState<"desktop" | "tablet" | "mobile">("desktop");
  const width = device === "desktop" ? "100%" : device === "tablet" ? "75%" : "52%";

  return (
    <section className="mx-auto max-w-6xl px-6 py-28">
      <SectionHeading
        eyebrow="03 — STUDIO"
        title="Code meets canvas."
        subtitle="A real creative development environment, built for imagination."
      />

      <div className="overflow-hidden rounded-2xl border border-border bg-background shadow-2xl shadow-accent/10">
        <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
          <span className="size-2.5 rounded-full bg-destructive/70" />
          <span className="size-2.5 rounded-full bg-muted-foreground/40" />
          <span className="size-2.5 rounded-full bg-muted-foreground/40" />
          <span className="ml-4 font-mono text-[11px] text-muted-foreground">portfolio-artifact / {page}.html</span>
        </div>

        <div className="grid min-h-[420px] font-mono text-xs md:grid-cols-[180px_1fr_1fr]">
          <aside className="hidden border-r border-border p-3 text-muted-foreground md:block">
            <p className="mb-2 text-[10px] tracking-widest">EXPLORER</p>
            <p className="flex items-center gap-1.5 text-foreground"><Folder size={12} /> portfolio-artifact</p>
            <div className="ml-3 mt-1 space-y-1">
              {(["index", "about", "projects", "contact"] as Page[]).map((p) => (
                <button key={p} onClick={() => setPage(p)} className={`flex items-center gap-1.5 ${p === page ? "text-accent" : "hover:text-foreground"}`}>
                  <File size={12} /> {p}.html
                </button>
              ))}
              <p className="flex items-center gap-1.5"><Folder size={12} /> styles</p>
              <p className="ml-4 flex items-center gap-1.5"><File size={12} /> main.css</p>
              <p className="flex items-center gap-1.5"><Folder size={12} /> scripts</p>
              <p className="ml-4 flex items-center gap-1.5"><File size={12} /> main.js</p>
              <p className="flex items-center gap-1.5"><Folder size={12} /> assets</p>
            </div>
          </aside>

          <div className="border-r border-border">
            <div className="flex border-b border-border text-[11px]">
              {["HTML", "CSS", "JS"].map((t, i) => (
                <span key={t} className={`px-4 py-2 ${i === 0 ? "border-b-2 border-accent text-foreground" : "text-muted-foreground"}`}>{t}</span>
              ))}
            </div>
            <pre className="p-4 leading-6">
              {CODE[page].map((line, i) => (
                <div key={i}>
                  <span className="mr-4 inline-block w-4 select-none text-right text-muted-foreground/50">{i + 1}</span>
                  {highlight(line)}
                </div>
              ))}
            </pre>
          </div>

          <div className="flex flex-col bg-surface">
            <div className="flex items-center justify-between border-b border-border px-3 py-1.5 text-muted-foreground">
              <div className="flex gap-1">
                {([["desktop", Monitor], ["tablet", Tablet], ["mobile", Smartphone]] as const).map(([d, Icon]) => (
                  <button key={d} aria-label={`${d} preview`} onClick={() => setDevice(d)} className={`rounded p-1.5 ${device === d ? "bg-background text-foreground" : "hover:text-foreground"}`}>
                    <Icon size={13} />
                  </button>
                ))}
              </div>
              <div className="flex gap-1">
                <button aria-label="Refresh preview" onClick={() => setPage("index")} className="rounded p-1.5 hover:text-foreground"><RotateCw size={13} /></button>
                <button aria-label="Fullscreen preview" className="rounded p-1.5 hover:text-foreground"><Maximize2 size={13} /></button>
              </div>
            </div>
            <div className="flex flex-1 justify-center p-4 font-sans">
              <div className="overflow-hidden rounded-lg border border-border transition-all duration-500" style={{ width }}>
                <Preview page={page} go={setPage} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
