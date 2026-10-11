import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, useCallback, useRef } from "react";
import {
  AlertCircle, ArrowLeft, Check, CheckCircle2, Clock, Globe,
  History, Loader2, Monitor, RefreshCw, RotateCcw, Smartphone, Tablet, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/editor/$slug")({
  component: Editor,
});

type Tab = "html" | "css" | "js";

interface Page { n: string; h: string; }

interface ArtifactData {
  id: string;
  name: string;
  type: string;
  status: string;
  review_status: string;
  subdomain: string | null;
  locked: boolean;
  pages: Page[];
  css: string;
  js: string;
  has_changes: boolean;
  published_at: string | null;
}

interface ArtifactVersion {
  id: string;
  published_at: string;
}

/* ── API helper ───────────────────────────────────────────────────────── */
async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(opts?.headers ?? {}) },
    ...opts,
  });
  return res.json() as Promise<T>;
}

/* ── Subdomain availability ───────────────────────────────────────────── */
function useSubdomainCheck(name: string, excludeId?: string) {
  const [state, setState] = useState<{ available?: boolean; reason?: string; checking: boolean }>({ checking: false });
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!name || name.length < 3) { setState({ checking: false }); return; }
    setState({ checking: true });
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ name });
        if (excludeId) params.set("exclude", excludeId);
        const res = await apiFetch<{ available: boolean; reason?: string }>(`/api/subdomain-check?${params}`);
        setState({ available: res.available, reason: res.reason, checking: false });
      } catch { setState({ checking: false }); }
    }, 400);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [name, excludeId]);

  return state;
}

function Editor() {
  const { slug } = Route.useParams();
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();

  const [artifact, setArtifact] = useState<ArtifactData | null>(null);
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");

  const [pageIdx, setPageIdx] = useState(0);
  const [tab, setTab] = useState<Tab>("html");
  const [width, setWidth] = useState("100%");
  const [doc, setDoc] = useState("");

  // Publish dialog
  const [publishOpen, setPublishOpen] = useState(false);
  const [pubSubdomain, setPubSubdomain] = useState("");
  const [protect, setProtect] = useState(false);
  const [pubPassword, setPubPassword] = useState("");
  const [pubError, setPubError] = useState("");
  const [publishing, setPublishing] = useState(false);

  // Version history modal
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [versions, setVersions] = useState<ArtifactVersion[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [restoringVid, setRestoringVid] = useState<string | null>(null);

  // Revert confirm
  const [revertOpen, setRevertOpen] = useState(false);
  const [reverting, setReverting] = useState(false);

  const subdomainCheck = useSubdomainCheck(pubSubdomain, slug);

  useEffect(() => {
    if (!authLoading && !user) void navigate({ to: "/login" });
  }, [user, authLoading, navigate]);

  useEffect(() => {
    if (!user) return;
    fetch(`/api/artifacts/${slug}`, { credentials: "include" })
      .then(r => r.json())
      .then((data: ArtifactData & { error?: string }) => {
        if (data.error) { setLoadError(data.error); return; }
        setArtifact(data);
        setPubSubdomain(data.subdomain ?? data.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40));
        setProtect(false);
      })
      .catch(() => setLoadError("Failed to load artifact"));
  }, [slug, user]);

  // Update preview
  useEffect(() => {
    if (!artifact) return;
    const page = artifact.pages[pageIdx];
    if (!page) return;
    const t = setTimeout(() => {
      setDoc(`<!doctype html><html><head><style>${artifact.css}</style></head><body>${page.h}<script>${artifact.js}<\/script></body></html>`);
    }, 300);
    return () => clearTimeout(t);
  }, [artifact, pageIdx]);

  const updateContent = useCallback((value: string) => {
    setArtifact(prev => {
      if (!prev) return prev;
      if (tab === "css") return { ...prev, css: value, has_changes: true };
      if (tab === "js")  return { ...prev, js: value, has_changes: true };
      const pages = prev.pages.map((p, i) => i === pageIdx ? { ...p, h: value } : p);
      return { ...prev, pages, has_changes: true };
    });
  }, [tab, pageIdx]);

  const save = async () => {
    if (!artifact) return;
    setSaving(true); setSaveMsg("");
    try {
      const res = await fetch(`/api/artifacts/${slug}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: artifact.name, pages: artifact.pages, css: artifact.css, js: artifact.js }),
      });
      const json = await res.json() as { ok?: boolean; error?: string };
      setSaveMsg(json.ok ? "Saved ✓" : (json.error ?? "Save failed"));
      if (json.ok) {
        // After save, mark has_changes compared to live — server now tracks it
        // We optimistically know there might be changes
        setArtifact(prev => prev ? { ...prev, has_changes: prev.status === 'published' } : prev);
      }
    } catch { setSaveMsg("Network error"); }
    finally { setSaving(false); setTimeout(() => setSaveMsg(""), 2500); }
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") { e.preventDefault(); void save(); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [artifact]); // eslint-disable-line

  useEffect(() => {
    if (artifact) document.title = `${artifact.name} — Editor`;
  }, [artifact]);

  /* ── Publish ─────────────────────────────────────────────────────── */
  const openPublish = () => {
    setPubError(""); setPublishOpen(true);
  };

  const doPublish = async () => {
    if (!artifact) return;
    setPubError(""); setPublishing(true);
    const res = await apiFetch<{
      ok?: boolean; subdomain?: string; locked?: boolean;
      pending?: boolean; error?: string;
    }>(`/api/artifacts/${slug}/publish`, {
      method: "POST",
      body: JSON.stringify({ subdomain: pubSubdomain, protect, password: pubPassword }),
    });
    setPublishing(false);
    if (res.error) { setPubError(res.error); return; }

    setArtifact(prev => prev ? {
      ...prev,
      status: res.pending ? prev.status : "published",
      review_status: res.pending ? "pending" : "approved",
      subdomain: res.subdomain ?? pubSubdomain,
      locked: res.locked ?? protect,
      has_changes: false,
    } : prev);
    setPublishOpen(false);
    if (res.pending) {
      setSaveMsg("Submitted for review");
    }
  };

  /* ── Version history ─────────────────────────────────────────────── */
  const openVersions = async () => {
    setVersionsOpen(true);
    setVersionsLoading(true);
    try {
      const res = await apiFetch<{ versions: ArtifactVersion[] }>(`/api/artifacts/${slug}/versions`);
      setVersions(res.versions);
    } catch { /* silently fail */ }
    finally { setVersionsLoading(false); }
  };

  const restoreVersion = async (vid: string) => {
    if (!confirm("Restore this version into your draft? Your current draft will be overwritten.")) return;
    setRestoringVid(vid);
    try {
      const res = await apiFetch<{ ok?: boolean; error?: string }>(
        `/api/artifacts/${slug}/versions/${vid}/restore`, { method: "POST" }
      );
      if (res.ok) {
        // Reload artifact
        const fresh = await apiFetch<ArtifactData & { error?: string }>(`/api/artifacts/${slug}`);
        if (!fresh.error) {
          setArtifact(fresh);
          setSaveMsg("Version restored into draft ✓");
          setTimeout(() => setSaveMsg(""), 3000);
        }
        setVersionsOpen(false);
      }
    } finally { setRestoringVid(null); }
  };

  /* ── Revert draft ────────────────────────────────────────────────── */
  const doRevert = async () => {
    if (!artifact) return;
    setReverting(true);
    try {
      const res = await apiFetch<{ ok?: boolean; error?: string }>(
        `/api/artifacts/${slug}/revert`, { method: "POST" }
      );
      if (res.ok) {
        const fresh = await apiFetch<ArtifactData & { error?: string }>(`/api/artifacts/${slug}`);
        if (!fresh.error) setArtifact({ ...fresh, has_changes: false });
        setSaveMsg("Reverted to live version ✓");
        setTimeout(() => setSaveMsg(""), 3000);
      }
    } finally { setReverting(false); setRevertOpen(false); }
  };

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

  const a = artifact!;
  const currentPage = a.pages[pageIdx];
  const currentValue = tab === "css" ? a.css : tab === "js" ? a.js : (currentPage?.h ?? "");
  const lines = currentValue.split("\n");
  const isPublished = a.status === "published";
  const isPending   = a.review_status === "pending";

  return (
    <div className="flex min-h-svh flex-col pt-24">
      {/* Header */}
      <header className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
        <Button asChild variant="outline" size="sm">
          <Link to="/artifacts"><ArrowLeft /> Studio</Link>
        </Button>
        <h1 className="font-display text-lg font-semibold">{a.name}</h1>

        {/* Status badge */}
        <span className={`rounded-full px-2.5 py-0.5 text-xs ${
          isPublished ? "bg-shape-mint/20" :
          isPending   ? "bg-amber-500/20 text-amber-600 dark:text-amber-400" :
          "bg-accent/15 text-accent"
        }`}>
          {isPending ? "under review" : a.status}
        </span>

        {/* Unpublished changes badge */}
        {a.has_changes && isPublished && (
          <span className="flex items-center gap-1 rounded-full bg-amber-500/15 px-2.5 py-0.5 text-xs font-medium text-amber-600 dark:text-amber-400">
            <AlertCircle size={10} /> Unpublished changes
          </span>
        )}

        {/* Live URL */}
        {a.subdomain && isPublished && (
          <a
            href={`https://${a.subdomain}.biswa.io`}
            target="_blank" rel="noreferrer"
            className="flex items-center gap-1 font-mono text-xs text-accent hover:underline"
          >
            <Globe size={11} />{a.subdomain}.biswa.io
          </a>
        )}

        <div className="ml-auto flex items-center gap-2 flex-wrap">
          {/* Device preview buttons */}
          {(["375px", "768px", "100%"] as const).map((w, i) => {
            const Icon = [Smartphone, Tablet, Monitor][i];
            return (
              <Button key={w} variant={width === w ? "secondary" : "outline"} size="icon"
                aria-label={`Preview at ${w}`} onClick={() => setWidth(w)}>
                <Icon />
              </Button>
            );
          })}

          {/* Version history (only if published) */}
          {isPublished && (
            <Button variant="outline" size="sm" onClick={() => void openVersions()}>
              <History size={14} /> History
            </Button>
          )}

          {/* Revert to live */}
          {a.has_changes && isPublished && (
            <Button variant="outline" size="sm" onClick={() => setRevertOpen(true)}
              className="text-muted-foreground">
              <RotateCcw size={13} /> Revert
            </Button>
          )}

          {/* Save button */}
          <Button onClick={() => void save()} disabled={saving}>
            {saving ? <Loader2 className="animate-spin" /> : null}
            {saving ? "Saving…" : "Save"}
          </Button>

          {/* Publish / Publish update */}
          {!isPending && (
            <Button
              onClick={() => openPublish()}
              className={isPublished && a.has_changes ? "bg-amber-500 text-black hover:bg-amber-400" : ""}
            >
              {isPublished
                ? (a.has_changes ? <><RefreshCw size={14} /> Publish update</> : <><Globe size={14} /> Published</>)
                : <><Globe size={14} /> Publish</>
              }
            </Button>
          )}
          {isPending && (
            <Button variant="outline" disabled>
              <Clock size={14} /> Under review
            </Button>
          )}

          {saveMsg && <span className="text-sm text-muted-foreground">{saveMsg}</span>}
        </div>
      </header>

      <div className="grid flex-1 lg:grid-cols-[180px_1fr_1fr]">
        {/* Sidebar */}
        <aside className="hidden border-r border-border p-4 text-sm lg:block">
          <p className="mb-2 font-mono text-[10px] text-muted-foreground">PAGES</p>
          {a.pages.map((p, i) => (
            <button key={p.n} onClick={() => { setPageIdx(i); setTab("html"); }}
              className={`block w-full rounded-md px-3 py-2 text-left font-mono text-xs ${
                i === pageIdx && tab === "html"
                  ? "bg-accent/15 text-accent" : "text-muted-foreground hover:text-foreground"
              }`}>
              {p.n}
            </button>
          ))}
          <p className="mb-2 mt-5 font-mono text-[10px] text-muted-foreground">GLOBAL</p>
          {(["css", "js"] as const).map(t => (
            <button key={t}
              className={`block px-3 py-1.5 font-mono text-xs ${tab === t ? "text-accent" : "text-muted-foreground hover:text-foreground"}`}
              onClick={() => setTab(t)}>
              {t === "css" ? "style.css" : "script.js"}
            </button>
          ))}
        </aside>

        {/* Code editor */}
        <section className="flex min-h-[420px] flex-col border-r border-border">
          <div className="flex border-b border-border">
            {(["html", "css", "js"] as Tab[]).map(t => (
              <button key={t} onClick={() => setTab(t)}
                className={`px-5 py-3 font-mono text-sm uppercase ${
                  tab === t ? "border-b-2 border-accent text-foreground" : "text-muted-foreground"
                }`}>
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
              {a.subdomain && isPublished ? `${a.subdomain}.biswa.io` : "preview"}
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

      {/* ── Publish dialog ──────────────────────────────────────────── */}
      <Dialog open={publishOpen} onOpenChange={o => { if (!o) setPublishOpen(false); }}>
        <DialogContent className="max-w-md">
          <DialogTitle className="flex items-center gap-2">
            {isPublished
              ? <><RefreshCw size={18} className="text-amber-500" /> Publish update</>
              : <><Globe size={18} className="text-accent" /> Publish artifact</>
            }
          </DialogTitle>
          <DialogDescription>
            {isPublished
              ? "Push your latest draft changes live."
              : `Choose a subdomain for "${a.name}".`}
          </DialogDescription>

          <div className="space-y-4 pt-2">
            <div>
              <label className="text-sm font-medium">Subdomain</label>
              <div className="mt-1.5 flex overflow-hidden rounded-lg border border-input bg-background focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/30">
                <input
                  value={pubSubdomain}
                  onChange={e => setPubSubdomain(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                  placeholder="my-site"
                  maxLength={40}
                  className="min-w-0 flex-1 bg-transparent px-3 py-2.5 text-sm outline-none"
                />
                <span className="shrink-0 border-l border-input bg-secondary px-3 py-2.5 text-xs text-muted-foreground">
                  .biswa.io
                </span>
              </div>
              {pubSubdomain.length >= 3 && (
                <p className={`mt-1 flex items-center gap-1 text-xs ${
                  subdomainCheck.checking ? "text-muted-foreground" :
                  subdomainCheck.available ? "text-green-600 dark:text-green-400" : "text-destructive"
                }`}>
                  {subdomainCheck.checking
                    ? <><RefreshCw size={10} className="animate-spin" /> Checking…</>
                    : subdomainCheck.available
                    ? <><CheckCircle2 size={10} /> Available</>
                    : <><AlertCircle size={10} /> {subdomainCheck.reason ?? "Not available"}</>
                  }
                </p>
              )}
            </div>

            <div className="rounded-lg border border-border p-4">
              <label className="flex cursor-pointer items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">Password protect</p>
                  <p className="text-xs text-muted-foreground">Visitors must enter a password</p>
                </div>
                <button type="button" role="switch" aria-checked={protect}
                  onClick={() => setProtect(p => !p)}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${protect ? "bg-accent" : "bg-secondary"}`}>
                  <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${protect ? "translate-x-5" : "translate-x-0"}`} />
                </button>
              </label>
              {protect && (
                <input
                  type="password"
                  value={pubPassword}
                  onChange={e => setPubPassword(e.target.value)}
                  placeholder={a.locked ? "Leave blank to keep existing" : "Enter password"}
                  className="mt-3 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-accent"
                />
              )}
            </div>

            {pubError && (
              <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {pubError}
              </p>
            )}

            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setPublishOpen(false)}>
                <X size={14} /> Cancel
              </Button>
              <Button
                className={`flex-1 ${isPublished ? "bg-amber-500 text-black hover:bg-amber-400" : ""}`}
                disabled={publishing || !pubSubdomain || (subdomainCheck.available === false && a.subdomain !== pubSubdomain)}
                onClick={() => void doPublish()}
              >
                {publishing ? "Publishing…" : isPublished ? <><RefreshCw size={14} /> Publish update</> : <><Globe size={14} /> Publish</>}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Version history modal ─────────────────────────────────── */}
      <Dialog open={versionsOpen} onOpenChange={setVersionsOpen}>
        <DialogContent className="max-w-md">
          <DialogTitle className="flex items-center gap-2">
            <History size={18} className="text-accent" /> Version history
          </DialogTitle>
          <DialogDescription>
            Restore a previous live version into your draft. Your draft will be overwritten (but not published automatically).
          </DialogDescription>

          <div className="mt-2 space-y-2">
            {versionsLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="animate-spin text-accent" size={24} />
              </div>
            ) : versions.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">No previous versions saved yet.</p>
            ) : (
              versions.map(v => (
                <div key={v.id} className="flex items-center justify-between rounded-lg border border-border px-4 py-3">
                  <div>
                    <p className="text-sm font-medium">
                      {new Date(v.published_at).toLocaleString(undefined, {
                        dateStyle: "medium", timeStyle: "short",
                      })}
                    </p>
                    <p className="text-xs text-muted-foreground">Live snapshot</p>
                  </div>
                  <Button
                    size="sm" variant="outline"
                    disabled={restoringVid === v.id}
                    onClick={() => void restoreVersion(v.id)}
                  >
                    {restoringVid === v.id ? <Loader2 className="animate-spin" size={13} /> : <RotateCcw size={13} />}
                    Restore
                  </Button>
                </div>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Revert confirmation dialog ────────────────────────────── */}
      <Dialog open={revertOpen} onOpenChange={setRevertOpen}>
        <DialogContent className="max-w-sm">
          <DialogTitle>Revert draft to live?</DialogTitle>
          <DialogDescription>
            Your current draft changes will be discarded and replaced with the live version. This cannot be undone.
          </DialogDescription>
          <div className="mt-4 flex gap-3">
            <Button variant="outline" className="flex-1" onClick={() => setRevertOpen(false)}>Cancel</Button>
            <Button
              variant="destructive"
              className="flex-1"
              disabled={reverting}
              onClick={() => void doRevert()}
            >
              {reverting ? <Loader2 className="animate-spin" size={14} /> : <RotateCcw size={14} />}
              {reverting ? "Reverting…" : "Revert draft"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
