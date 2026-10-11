import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import { ArrowLeft, Loader2, Monitor, Smartphone, Tablet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/editor/$slug")({
  component: Editor,
});

type Tab = "html" | "css" | "js";

interface Page {
  n: string; // filename e.g. "index.html"
  h: string; // html content
}

interface ArtifactData {
  id: string;
  name: string;
  type: string;
  status: string;
  subdomain: string | null;
  pages: Page[];
  css: string;
  js: string;
}

function Editor() {
  const { slug } = Route.useParams();
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();

  const [artifact, setArtifact] = useState<ArtifactData | null>(null);
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");

  // Current page index and tab
  const [pageIdx, setPageIdx] = useState(0);
  const [tab, setTab] = useState<Tab>("html");
  const [width, setWidth] = useState("100%");
  const [doc, setDoc] = useState("");

  // Redirect if not signed in
  useEffect(() => {
    if (!authLoading && !user) void navigate({ to: "/login" });
  }, [user, authLoading, navigate]);

  // Load artifact from API
  useEffect(() => {
    if (!user) return;
    fetch(`/api/artifacts/${slug}`, { credentials: "include" })
      .then(r => r.json())
      .then((data: ArtifactData & { error?: string }) => {
        if (data.error) { setLoadError(data.error); return; }
        setArtifact(data);
      })
      .catch(() => setLoadError("Failed to load artifact"));
  }, [slug, user]);

  // Update preview whenever content changes
  useEffect(() => {
    if (!artifact) return;
    const page = artifact.pages[pageIdx];
    if (!page) return;
    const t = setTimeout(() => {
      setDoc(
        `<!doctype html><html><head><style>${artifact.css}</style></head><body>${page.h}<script>${artifact.js}<\/script></body></html>`,
      );
    }, 300);
    return () => clearTimeout(t);
  }, [artifact, pageIdx]);

  // Update doc when tab-specific content changes
  const updateContent = useCallback((value: string) => {
    setArtifact(prev => {
      if (!prev) return prev;
      if (tab === "css") return { ...prev, css: value };
      if (tab === "js")  return { ...prev, js: value };
      // html — update current page
      const pages = prev.pages.map((p, i) =>
        i === pageIdx ? { ...p, h: value } : p,
      );
      return { ...prev, pages };
    });
  }, [tab, pageIdx]);

  const save = async () => {
    if (!artifact) return;
    setSaving(true);
    setSaveMsg("");
    try {
      const res = await fetch(`/api/artifacts/${slug}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: artifact.name,
          pages: artifact.pages,
          css: artifact.css,
          js: artifact.js,
        }),
      });
      const json = await res.json() as { ok?: boolean; error?: string };
      setSaveMsg(json.ok ? "Saved ✓" : (json.error ?? "Save failed"));
    } catch {
      setSaveMsg("Network error");
    } finally {
      setSaving(false);
      setTimeout(() => setSaveMsg(""), 2000);
    }
  };

  // Keyboard shortcut: Ctrl+S / Cmd+S
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        void save();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [artifact]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (artifact) document.title = `${artifact.name} — Editor`;
  }, [artifact]);

  if (authLoading || (!artifact && !loadError)) {
    return (
      <div className="flex min-h-svh items-center justify-center">
        <Loader2 className="animate-spin text-accent" size={32} />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="py-40 text-center">
        <p className="text-muted-foreground">{loadError}</p>
        <Button asChild className="mt-4"><Link to="/artifacts">Back to studio</Link></Button>
      </div>
    );
  }

  const currentPage = artifact!.pages[pageIdx];
  const currentValue = tab === "css" ? artifact!.css : tab === "js" ? artifact!.js : (currentPage?.h ?? "");
  const lines = currentValue.split("\n");

  return (
    <div className="flex min-h-svh flex-col pt-24">
      {/* Header */}
      <header className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
        <Button asChild variant="outline" size="sm">
          <Link to="/artifacts"><ArrowLeft /> Studio</Link>
        </Button>
        <h1 className="font-display text-lg font-semibold">{artifact!.name}</h1>
        <span className={`rounded-full px-2.5 py-0.5 text-xs ${
          artifact!.status === "published" ? "bg-shape-mint/20" : "bg-accent/15 text-accent"
        }`}>
          {artifact!.status}
        </span>

        <div className="ml-auto flex items-center gap-2">
          {/* Device preview buttons */}
          {([["375px", Smartphone], ["768px", Tablet], ["100%", Monitor]] as const).map(([w, Icon]) => (
            <Button
              key={w} variant={width === w ? "secondary" : "outline"} size="icon"
              aria-label={`Preview at ${w}`} onClick={() => setWidth(w)}
            >
              <Icon />
            </Button>
          ))}
          <Button onClick={() => void save()} disabled={saving}>
            {saving ? <Loader2 className="animate-spin" /> : null}
            {saving ? "Saving…" : "Save"}
          </Button>
          {saveMsg && <span className="text-sm text-muted-foreground">{saveMsg}</span>}
        </div>
      </header>

      <div className="grid flex-1 lg:grid-cols-[180px_1fr_1fr]">
        {/* Sidebar */}
        <aside className="hidden border-r border-border p-4 text-sm lg:block">
          <p className="mb-2 font-mono text-[10px] text-muted-foreground">PAGES</p>
          {artifact!.pages.map((p, i) => (
            <button
              key={p.n}
              onClick={() => { setPageIdx(i); setTab("html"); }}
              className={`block w-full rounded-md px-3 py-2 text-left font-mono text-xs ${
                i === pageIdx && tab === "html"
                  ? "bg-accent/15 text-accent"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {p.n}
            </button>
          ))}
          <p className="mb-2 mt-5 font-mono text-[10px] text-muted-foreground">GLOBAL</p>
          <button
            className={`block px-3 py-1.5 font-mono text-xs ${tab === "css" ? "text-accent" : "text-muted-foreground hover:text-foreground"}`}
            onClick={() => setTab("css")}
          >
            style.css
          </button>
          <button
            className={`block px-3 py-1.5 font-mono text-xs ${tab === "js" ? "text-accent" : "text-muted-foreground hover:text-foreground"}`}
            onClick={() => setTab("js")}
          >
            script.js
          </button>
        </aside>

        {/* Code editor */}
        <section className="flex min-h-[420px] flex-col border-r border-border">
          <div className="flex border-b border-border">
            {(["html", "css", "js"] as Tab[]).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-5 py-3 font-mono text-sm uppercase ${
                  tab === t ? "border-b-2 border-accent text-foreground" : "text-muted-foreground"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
          <div className="flex flex-1 overflow-auto bg-secondary/30 font-mono text-[13px] leading-6">
            <div aria-hidden className="select-none px-3 py-3 text-right text-muted-foreground/50">
              {lines.map((_, i) => <div key={i}>{i + 1}</div>)}
            </div>
            <textarea
              aria-label={`${tab} editor`}
              spellCheck={false}
              value={currentValue}
              onChange={e => updateContent(e.target.value)}
              className="min-h-full flex-1 resize-none whitespace-pre bg-transparent py-3 pr-3 outline-none"
              rows={lines.length + 4}
            />
          </div>
        </section>

        {/* Preview */}
        <section className="flex flex-col bg-secondary/20">
          <div className="flex items-center gap-2 border-b border-border px-4 py-3 text-sm text-muted-foreground">
            <span className="size-2.5 rounded-full bg-shape-coral" />
            <span className="size-2.5 rounded-full bg-shape-yellow" />
            <span className="size-2.5 rounded-full bg-shape-mint" />
            <span className="ml-3 font-mono text-xs">
              {artifact!.subdomain ? `${artifact!.subdomain}.biswa.io` : "preview"}
            </span>
          </div>
          <div className="flex flex-1 justify-center p-4">
            <iframe
              title="Live preview"
              sandbox="allow-scripts"
              srcDoc={doc}
              style={{ width, maxWidth: "100%" }}
              className="min-h-[480px] rounded-xl border border-border bg-card shadow-md"
            />
          </div>
        </section>
      </div>
    </div>
  );
}
