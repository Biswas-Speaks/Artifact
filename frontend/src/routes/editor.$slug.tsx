import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, useCallback, useRef } from "react";
import {
  AlertCircle, ArrowLeft, Bot, CheckCircle2, Clock, Globe,
  History, Loader2, Monitor, RefreshCw, RotateCcw, Send,
  Smartphone, Tablet, X, Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/lib/auth";
import CodeMirror from "@uiw/react-codemirror";
import { vscodeDark } from "@uiw/codemirror-theme-vscode";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { javascript } from "@codemirror/lang-javascript";

export const Route = createFileRoute("/editor/$slug")({
  component: Editor,
});

type Tab = "html" | "css" | "js";
interface Page { n: string; h: string; }

interface ArtifactData {
  id: string; name: string; type: string; status: string;
  review_status: string; subdomain: string | null; locked: boolean;
  pages: Page[]; css: string; js: string;
  has_changes: boolean; published_at: string | null;
}

interface ArtifactVersion {
  id: string;
  source: "manual" | "ai" | "rollback";
  prompt: string | null;
  size_bytes: number;
  created_at: string;
}

interface AiMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  version_id: string | null;
  created_at: string;
}

interface AiSettings {
  connected: boolean;
  provider?: string;
  model?: string;
  status?: string;
}

async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(opts?.headers ?? {}) },
    ...opts,
  });
  return res.json() as Promise<T>;
}

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

/* ── Skeleton ─────────────────────────────────────────────────────────── */
function EditorSkeleton() {
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      <div className="flex items-center gap-3 border-b border-border px-4 py-3 shrink-0">
        <div className="h-8 w-20 rounded-md bg-secondary animate-pulse" />
        <div className="h-5 w-40 rounded-md bg-secondary animate-pulse" />
        <div className="ml-auto flex gap-2">
          <div className="h-8 w-16 rounded-md bg-secondary animate-pulse" />
          <div className="h-8 w-20 rounded-md bg-secondary animate-pulse" />
        </div>
      </div>
      <div className="grid flex-1 overflow-hidden lg:grid-cols-[180px_1fr_1fr]">
        <div className="hidden border-r border-border p-4 lg:block">
          {[1,2,3,4].map(i => <div key={i} className="h-7 w-full rounded-md bg-secondary animate-pulse mb-2" />)}
        </div>
        <div className="flex flex-col border-r border-border">
          <div className="flex gap-0 border-b border-border shrink-0">
            {["HTML","CSS","JS"].map(t => (
              <div key={t} className="h-11 w-16 border-r border-border flex items-center justify-center">
                <div className="h-3 w-8 rounded bg-secondary animate-pulse" />
              </div>
            ))}
          </div>
          <div className="flex-1 bg-[#1e1e1e] p-4 space-y-2">
            {Array.from({length: 16}).map((_,i) => (
              <div key={i} className="h-3 rounded bg-white/5 animate-pulse" style={{width:`${30+Math.random()*60}%`}} />
            ))}
          </div>
        </div>
        <div className="flex flex-col bg-secondary/20">
          <div className="flex items-center gap-2 border-b border-border px-4 py-3">
            {["coral","yellow","mint"].map(c => <div key={c} className={`size-2.5 rounded-full bg-shape-${c} opacity-50`} />)}
          </div>
          <div className="flex-1 animate-pulse bg-secondary/10" />
        </div>
      </div>
    </div>
  );
}

/* ── Source badge ─────────────────────────────────────────────────────── */
function SourceBadge({ source }: { source: string }) {
  const cfg = source === "ai"
    ? { cls: "bg-purple-500/15 text-purple-600 dark:text-purple-400", label: "AI" }
    : source === "rollback"
    ? { cls: "bg-amber-500/15 text-amber-600 dark:text-amber-400",  label: "Rollback" }
    : { cls: "bg-secondary text-muted-foreground",                   label: "Manual" };
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-mono font-medium ${cfg.cls}`}>
      {cfg.label}
    </span>
  );
}

/* ── Example prompt chips ─────────────────────────────────────────────── */
const EXAMPLE_PROMPTS = [
  "Make the header sticky and add a smooth scroll",
  "Add a dark/light mode toggle button",
  "Create an about.html page linked from the nav",
  "Make the layout responsive for mobile",
];

/* ══════════════════════════════════════════════════════════════════════ */

function Editor() {
  const { slug } = Route.useParams();
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();

  const [artifact, setArtifact]   = useState<ArtifactData | null>(null);
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving]       = useState(false);
  const [saveMsg, setSaveMsg]     = useState("");

  const [pageIdx, setPageIdx]         = useState(0);
  const [tab, setTab]                 = useState<Tab>("html");
  const [previewWidth, setPreviewWidth] = useState("100%");
  const [doc, setDoc]                 = useState("");

  // changed files tracker (for dot indicators)
  const [changedFiles, setChangedFiles] = useState<Set<string>>(new Set());

  const [publishOpen, setPublishOpen] = useState(false);
  const [pubSubdomain, setPubSubdomain] = useState("");
  const [protect, setProtect]         = useState(false);
  const [pubPassword, setPubPassword] = useState("");
  const [pubError, setPubError]       = useState("");
  const [publishing, setPublishing]   = useState(false);

  const [versionsOpen, setVersionsOpen]     = useState(false);
  const [versions, setVersions]             = useState<ArtifactVersion[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [restoringVid, setRestoringVid]     = useState<string | null>(null);

  const [revertOpen, setRevertOpen] = useState(false);
  const [reverting, setReverting]   = useState(false);

  // AI panel
  const [aiSettings, setAiSettings]   = useState<AiSettings | null>(null);
  const [aiOpen, setAiOpen]           = useState(false);
  const [aiMessages, setAiMessages]   = useState<AiMessage[]>([]);
  const [aiPrompt, setAiPrompt]       = useState("");
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiError, setAiError]         = useState("");
  const [lastAiVersionId, setLastAiVersionId] = useState<string | null>(null);
  const aiAbortRef                    = useRef<AbortController | null>(null);
  const chatEndRef                    = useRef<HTMLDivElement | null>(null);

  const subdomainCheck = useSubdomainCheck(pubSubdomain, slug);

  useEffect(() => { if (!authLoading && !user) void navigate({ to: "/login" }); }, [user, authLoading, navigate]);

  // Load artifact
  useEffect(() => {
    if (!user) return;
    fetch(`/api/artifacts/${slug}`, { credentials: "include" })
      .then(r => r.json())
      .then((data: ArtifactData & { error?: string }) => {
        if (data.error) { setLoadError(data.error); return; }
        setArtifact(data);
        setPubSubdomain(data.subdomain ?? data.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40));
      })
      .catch(() => setLoadError("Failed to load artifact"));
  }, [slug, user]);

  // Load AI settings
  useEffect(() => {
    if (!user) return;
    apiFetch<AiSettings>("/api/ai/settings")
      .then(d => setAiSettings(d))
      .catch(() => setAiSettings({ connected: false }));
  }, [user]);

  // Load AI messages when panel opens
  useEffect(() => {
    if (!aiOpen || !artifact) return;
    apiFetch<{ messages: AiMessage[] }>(`/api/artifacts/${artifact.id}/ai/messages`)
      .then(d => setAiMessages(d.messages))
      .catch(() => {});
  }, [aiOpen, artifact]);

  // Scroll to bottom of chat
  useEffect(() => {
    if (aiOpen) chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [aiMessages, aiOpen]);

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
        method: "PUT", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: artifact.name, pages: artifact.pages, css: artifact.css, js: artifact.js }),
      });
      const json = await res.json() as { ok?: boolean; error?: string };
      setSaveMsg(json.ok ? "Saved ✓" : (json.error ?? "Save failed"));
      if (json.ok) setArtifact(prev => prev ? { ...prev, has_changes: prev.status === "published" } : prev);
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

  const doPublish = async () => {
    if (!artifact) return;
    setPubError(""); setPublishing(true);
    const res = await apiFetch<{ ok?: boolean; subdomain?: string; locked?: boolean; pending?: boolean; error?: string }>(
      `/api/artifacts/${slug}/publish`,
      { method: "POST", body: JSON.stringify({ subdomain: pubSubdomain, protect, password: pubPassword }) }
    );
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
    if (res.pending) setSaveMsg("Submitted for review");
  };

  const openVersions = async () => {
    setVersionsOpen(true); setVersionsLoading(true);
    try {
      const res = await apiFetch<{ versions: ArtifactVersion[] }>(`/api/artifacts/${slug}/versions`);
      setVersions(res.versions);
    } catch { /* ignore */ }
    finally { setVersionsLoading(false); }
  };

  const restoreVersion = async (vid: string) => {
    if (!confirm("Restore this version into your draft? Current draft will be saved as a new version first.")) return;
    setRestoringVid(vid);
    try {
      const res = await apiFetch<{ ok?: boolean }>(`/api/artifacts/${slug}/versions/${vid}/restore`, { method: "POST" });
      if (res.ok) {
        const fresh = await apiFetch<ArtifactData & { error?: string }>(`/api/artifacts/${slug}`);
        if (!fresh.error) { setArtifact(fresh); setSaveMsg("Version restored ✓"); setTimeout(() => setSaveMsg(""), 3000); }
        setVersionsOpen(false);
        setChangedFiles(new Set());
      }
    } finally { setRestoringVid(null); }
  };

  const doRevert = async () => {
    if (!artifact) return;
    setReverting(true);
    try {
      const res = await apiFetch<{ ok?: boolean }>(`/api/artifacts/${slug}/revert`, { method: "POST" });
      if (res.ok) {
        const fresh = await apiFetch<ArtifactData & { error?: string }>(`/api/artifacts/${slug}`);
        if (!fresh.error) setArtifact({ ...fresh, has_changes: false });
        setSaveMsg("Reverted to live ✓"); setTimeout(() => setSaveMsg(""), 3000);
      }
    } finally { setReverting(false); setRevertOpen(false); }
  };

  // ── AI generation ────────────────────────────────────────────────────────
  const doGenerate = async (promptText?: string) => {
    if (!artifact) return;
    const text = (promptText ?? aiPrompt).trim();
    if (!text || aiGenerating) return;

    setAiGenerating(true);
    setAiError("");

    const ac = new AbortController();
    aiAbortRef.current = ac;

    try {
      const res = await fetch(`/api/artifacts/${artifact.id}/ai`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: text }),
        signal: ac.signal,
      });
      const json = await res.json() as {
        note?: string; changedFiles?: string[]; versionId?: string;
        artifact?: ArtifactData; error?: string; code?: string;
      };

      if (json.error) {
        setAiError(json.error);
        return;
      }

      if (json.artifact) {
        setArtifact(json.artifact);
        setChangedFiles(new Set(json.changedFiles ?? []));
        if (json.versionId) setLastAiVersionId(json.versionId);
      }

      // Refresh chat messages
      const msgs = await apiFetch<{ messages: AiMessage[] }>(`/api/artifacts/${artifact.id}/ai/messages`);
      setAiMessages(msgs.messages);
      setAiPrompt("");

      // Feedback message
      const changed = (json.changedFiles ?? []).join(", ");
      setSaveMsg(`AI: ${json.note ?? "Done"} (${changed})`);
      setTimeout(() => setSaveMsg(""), 6000);

    } catch (err: unknown) {
      if ((err as Error).name !== "AbortError") {
        setAiError("Generation failed. Please try again.");
      }
    } finally {
      setAiGenerating(false);
      aiAbortRef.current = null;
    }
  };

  const cancelGenerate = () => {
    aiAbortRef.current?.abort();
  };

  // Undo last AI change = restore the version saved before the last AI generation
  const undoLastAi = async () => {
    if (!lastAiVersionId || !artifact) return;
    if (!confirm("Undo last AI change? This will restore the draft to before the last generation.")) return;
    setRestoringVid(lastAiVersionId);
    try {
      const res = await apiFetch<{ ok?: boolean }>(`/api/artifacts/${slug}/versions/${lastAiVersionId}/restore`, { method: "POST" });
      if (res.ok) {
        const fresh = await apiFetch<ArtifactData>(`/api/artifacts/${slug}`);
        setArtifact(fresh);
        setLastAiVersionId(null);
        setChangedFiles(new Set());
        setSaveMsg("AI change undone ✓");
        setTimeout(() => setSaveMsg(""), 3000);
      }
    } finally { setRestoringVid(null); }
  };

  /* ── Loading / error states ─────────────────────────────────────────── */
  if (authLoading || (!artifact && !loadError)) return <EditorSkeleton />;
  if (loadError) return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4">
      <p className="text-muted-foreground">{loadError}</p>
      <Button asChild><Link to="/artifacts"><ArrowLeft size={14} /> Back to Studio</Link></Button>
    </div>
  );

  const a = artifact!;
  const currentPage  = a.pages[pageIdx];
  const currentValue = tab === "css" ? a.css : tab === "js" ? a.js : (currentPage?.h ?? "");
  const isPublished  = a.status === "published";
  const isPending    = a.review_status === "pending";
  const aiConnected  = aiSettings?.connected && aiSettings.status === "verified";

  return (
    <div className="flex flex-col overflow-hidden" style={{ height: "100vh" }}>

      {/* ── Header ────────────────────────────────────────────────── */}
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-background px-4 py-2.5 z-10">
        <Button asChild variant="outline" size="sm">
          <Link to="/artifacts"><ArrowLeft size={14} /> Studio</Link>
        </Button>

        <h1 className="font-display text-base font-semibold">{a.name}</h1>

        <span className={`rounded-full px-2 py-0.5 text-xs ${
          isPublished ? "bg-shape-mint/20 text-foreground" :
          isPending   ? "bg-amber-500/20 text-amber-600 dark:text-amber-400" :
          "bg-accent/15 text-accent"
        }`}>
          {isPending ? "under review" : a.status}
        </span>

        {a.has_changes && isPublished && (
          <span className="flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">
            <AlertCircle size={9} /> Unpublished changes
          </span>
        )}

        {a.subdomain && isPublished && (
          <a href={`https://${a.subdomain}.biswa.io`} target="_blank" rel="noreferrer"
            className="flex items-center gap-1 font-mono text-xs text-accent hover:underline">
            <Globe size={11} />{a.subdomain}.biswa.io
          </a>
        )}

        <div className="ml-auto flex items-center gap-1.5 flex-wrap">
          {(["375px", "768px", "100%"] as const).map((w, i) => {
            const Icon = [Smartphone, Tablet, Monitor][i];
            return (
              <Button key={w} variant={previewWidth === w ? "secondary" : "outline"} size="icon"
                className="h-8 w-8" aria-label={`Preview ${w}`} onClick={() => setPreviewWidth(w)}>
                <Icon size={14} />
              </Button>
            );
          })}

          {/* AI panel toggle */}
          <Button
            variant={aiOpen ? "secondary" : "outline"}
            size="sm"
            className={`h-8 ${aiConnected ? "text-purple-500" : "text-muted-foreground"}`}
            onClick={() => setAiOpen(v => !v)}
            title={aiConnected ? "AI code generator" : "Connect an API key to enable AI"}
          >
            <Bot size={13} /> AI
          </Button>

          {lastAiVersionId && (
            <Button variant="outline" size="sm" className="h-8 text-purple-500" disabled={!!restoringVid}
              onClick={() => void undoLastAi()}>
              {restoringVid ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />}
              Undo AI
            </Button>
          )}

          <Button variant="outline" size="sm" className="h-8" onClick={() => void openVersions()}>
            <History size={13} /> History
          </Button>

          {a.has_changes && isPublished && (
            <Button variant="outline" size="sm" className="h-8 text-muted-foreground" onClick={() => setRevertOpen(true)}>
              <RotateCcw size={13} /> Revert
            </Button>
          )}

          <Button size="sm" className="h-8" onClick={() => void save()} disabled={saving}>
            {saving ? <Loader2 size={13} className="animate-spin" /> : null}
            {saving ? "Saving…" : "Save"}
          </Button>

          {!isPending && (
            <Button size="sm"
              className={`h-8 ${isPublished && a.has_changes ? "bg-amber-500 text-black hover:bg-amber-400" : ""}`}
              onClick={() => { setPubError(""); setPublishOpen(true); }}>
              {isPublished
                ? a.has_changes ? <><RefreshCw size={13} /> Publish update</> : <><Globe size={13} /> Published</>
                : <><Globe size={13} /> Publish</>}
            </Button>
          )}
          {isPending && <Button variant="outline" size="sm" className="h-8" disabled><Clock size={13} /> Under review</Button>}
          {saveMsg && <span className="max-w-xs truncate text-xs text-muted-foreground">{saveMsg}</span>}
        </div>
      </header>

      {/* ── Main body ─────────────────────────────────────────────── */}
      <div className={`grid flex-1 overflow-hidden ${aiOpen ? "lg:grid-cols-[160px_1fr_1fr_320px]" : "lg:grid-cols-[160px_1fr_1fr]"}`}>

        {/* Sidebar */}
        <aside className="hidden overflow-y-auto border-r border-border bg-background p-3 text-sm lg:flex lg:flex-col">
          <p className="mb-1.5 font-mono text-[10px] text-muted-foreground">PAGES</p>
          {a.pages.map((p, i) => (
            <button key={p.n} onClick={() => { setPageIdx(i); setTab("html"); }}
              className={`group flex w-full items-center justify-between rounded px-2.5 py-1.5 text-left font-mono text-xs transition-colors ${
                i === pageIdx && tab === "html" ? "bg-accent/15 text-accent" : "text-muted-foreground hover:text-foreground"
              }`}>
              <span>{p.n}</span>
              {changedFiles.has(p.n) && <span className="size-1.5 rounded-full bg-purple-500 shrink-0" />}
            </button>
          ))}
          <p className="mb-1.5 mt-4 font-mono text-[10px] text-muted-foreground">GLOBAL</p>
          {(["css", "js"] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`flex w-full items-center justify-between rounded px-2.5 py-1.5 text-left font-mono text-xs transition-colors ${
                tab === t ? "text-accent" : "text-muted-foreground hover:text-foreground"
              }`}>
              <span>{t === "css" ? "style.css" : "script.js"}</span>
              {changedFiles.has(t === "css" ? "style.css" : "script.js") && (
                <span className="size-1.5 rounded-full bg-purple-500 shrink-0" />
              )}
            </button>
          ))}
        </aside>

        {/* Code editor */}
        <section className="flex min-w-0 flex-col overflow-hidden border-r border-border">
          <div className="flex shrink-0 border-b border-border bg-background">
            {(["html", "css", "js"] as Tab[]).map(t => (
              <button key={t} onClick={() => setTab(t)}
                className={`px-5 py-2.5 font-mono text-xs uppercase tracking-wide transition-colors ${
                  tab === t ? "border-b-2 border-accent text-foreground" : "text-muted-foreground hover:text-foreground"
                }`}>{t}</button>
            ))}
          </div>
          <div className="flex-1 overflow-hidden">
            <CodeMirror
              key={`${tab}-${pageIdx}`}
              value={currentValue}
              height="100%"
              theme={vscodeDark}
              extensions={[tab === "html" ? html() : tab === "css" ? css() : javascript()]}
              onChange={updateContent}
              style={{ height: "100%", fontSize: "13px" }}
              basicSetup={{
                lineNumbers: true, foldGutter: false, dropCursor: false,
                allowMultipleSelections: false, indentOnInput: true,
                bracketMatching: true, closeBrackets: true,
                autocompletion: true, highlightActiveLine: true,
              }}
            />
          </div>
        </section>

        {/* Preview */}
        <section className="flex min-w-0 flex-col overflow-hidden bg-secondary/10">
          <div className="flex shrink-0 items-center gap-2 border-b border-border bg-background px-4 py-2.5">
            <span className="size-2.5 rounded-full bg-shape-coral" />
            <span className="size-2.5 rounded-full bg-shape-yellow" />
            <span className="size-2.5 rounded-full bg-shape-mint" />
            <span className="ml-3 font-mono text-xs text-muted-foreground">
              {a.subdomain && isPublished ? `${a.subdomain}.biswa.io` : "preview"}
            </span>
          </div>
          <div className="flex flex-1 overflow-auto items-start justify-center p-3">
            <iframe
              title="Live preview"
              sandbox="allow-scripts"
              srcDoc={doc}
              style={{ width: previewWidth, maxWidth: "100%", minHeight: "100%" }}
              className="rounded-lg border border-border bg-white shadow-sm transition-all duration-300"
            />
          </div>
        </section>

        {/* AI Chat Panel */}
        {aiOpen && (
          <aside className="flex flex-col overflow-hidden border-l border-border bg-background">
            <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
              <div className="flex items-center gap-2">
                <Bot size={16} className="text-purple-500" />
                <span className="text-sm font-semibold">AI Generator</span>
                {aiConnected && (
                  <span className="rounded-full bg-green-500/15 px-1.5 py-0.5 font-mono text-[9px] text-green-600 dark:text-green-400">
                    {aiSettings?.model?.split("-").slice(0, 2).join("-")}
                  </span>
                )}
              </div>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setAiOpen(false)}>
                <X size={13} />
              </Button>
            </div>

            {!aiConnected ? (
              /* Not connected — CTA */
              <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
                <div className="flex size-12 items-center justify-center rounded-xl bg-secondary">
                  <Zap size={22} className="text-muted-foreground" />
                </div>
                <p className="text-sm font-medium">Connect an API key to enable AI</p>
                <p className="text-xs text-muted-foreground">
                  Bring your own Google Gemini or OpenAI key. Your key is encrypted on the server.
                </p>
                <Button asChild size="sm" variant="outline">
                  <Link to="/ai">Configure AI settings →</Link>
                </Button>
              </div>
            ) : (
              <>
                {/* Message list */}
                <div className="flex-1 overflow-y-auto p-3 space-y-3">
                  {aiMessages.length === 0 && (
                    <div className="space-y-2 pt-2">
                      <p className="text-xs text-muted-foreground">Try an example:</p>
                      {EXAMPLE_PROMPTS.map(p => (
                        <button key={p} onClick={() => void doGenerate(p)}
                          className="block w-full rounded-lg border border-border bg-secondary/50 px-3 py-2 text-left text-xs text-muted-foreground transition-colors hover:border-accent/40 hover:text-foreground">
                          {p}
                        </button>
                      ))}
                    </div>
                  )}

                  {aiMessages.map(msg => (
                    <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                      <div className={`max-w-[85%] rounded-xl px-3 py-2 text-xs ${
                        msg.role === "user"
                          ? "bg-accent text-accent-foreground"
                          : "bg-secondary/60 text-foreground"
                      }`}>
                        <p>{msg.content}</p>
                        {msg.role === "assistant" && msg.version_id && changedFiles.size > 0 && (
                          <p className="mt-1 font-mono text-[10px] opacity-60">
                            Changed: {[...changedFiles].join(", ")}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}

                  {aiGenerating && (
                    <div className="flex justify-start">
                      <div className="flex items-center gap-2 rounded-xl bg-secondary/60 px-3 py-2 text-xs text-muted-foreground">
                        <Loader2 size={12} className="animate-spin" />
                        Generating…
                      </div>
                    </div>
                  )}

                  {aiError && (
                    <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                      {aiError}
                    </div>
                  )}

                  <div ref={chatEndRef} />
                </div>

                {/* Input area */}
                <div className="shrink-0 border-t border-border p-3">
                  <div className="relative">
                    <textarea
                      value={aiPrompt}
                      onChange={e => setAiPrompt(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          void doGenerate();
                        }
                      }}
                      placeholder="Describe a change… (Enter to send, Shift+Enter for newline)"
                      maxLength={4000}
                      rows={3}
                      disabled={aiGenerating}
                      className="w-full resize-none rounded-lg border border-input bg-background p-2.5 pr-10 text-xs outline-none focus:border-accent disabled:opacity-50"
                    />
                    {aiGenerating ? (
                      <button onClick={cancelGenerate}
                        className="absolute right-2 bottom-2 rounded p-1 text-destructive hover:bg-destructive/10"
                        title="Cancel">
                        <X size={14} />
                      </button>
                    ) : (
                      <button
                        onClick={() => void doGenerate()}
                        disabled={!aiPrompt.trim()}
                        className="absolute right-2 bottom-2 rounded p-1 text-accent hover:bg-accent/10 disabled:opacity-30"
                        title="Send (Enter)">
                        <Send size={14} />
                      </button>
                    )}
                  </div>
                  <p className="mt-1 text-right font-mono text-[10px] text-muted-foreground">
                    {aiPrompt.length}/4000
                  </p>
                </div>
              </>
            )}
          </aside>
        )}
      </div>

      {/* ── Publish dialog ───────────────────────────────────────── */}
      <Dialog open={publishOpen} onOpenChange={o => { if (!o) setPublishOpen(false); }}>
        <DialogContent className="max-w-md">
          <DialogTitle className="flex items-center gap-2">
            {isPublished ? <><RefreshCw size={18} className="text-amber-500" /> Publish update</> : <><Globe size={18} className="text-accent" /> Publish artifact</>}
          </DialogTitle>
          <DialogDescription>
            {isPublished ? "Push your latest draft changes live." : `Choose a subdomain for "${a.name}".`}
          </DialogDescription>
          <div className="space-y-4 pt-2">
            <div>
              <label className="text-sm font-medium">Subdomain</label>
              <div className="mt-1.5 flex overflow-hidden rounded-lg border border-input bg-background focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/30">
                <input value={pubSubdomain}
                  onChange={e => setPubSubdomain(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                  placeholder="my-site" maxLength={40}
                  className="min-w-0 flex-1 bg-transparent px-3 py-2.5 text-sm outline-none" />
                <span className="shrink-0 border-l border-input bg-secondary px-3 py-2.5 text-xs text-muted-foreground">.biswa.io</span>
              </div>
              {pubSubdomain.length >= 3 && (
                <p className={`mt-1 flex items-center gap-1 text-xs ${
                  subdomainCheck.checking ? "text-muted-foreground" :
                  subdomainCheck.available ? "text-green-600 dark:text-green-400" : "text-destructive"}`}>
                  {subdomainCheck.checking ? <><RefreshCw size={10} className="animate-spin" /> Checking…</> :
                   subdomainCheck.available ? <><CheckCircle2 size={10} /> Available</> :
                   <><AlertCircle size={10} /> {subdomainCheck.reason ?? "Not available"}</>}
                </p>
              )}
            </div>
            <div className="rounded-lg border border-border p-4">
              <label className="flex cursor-pointer items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">Password protect</p>
                  <p className="text-xs text-muted-foreground">Visitors must enter a password</p>
                </div>
                <button type="button" role="switch" aria-checked={protect} onClick={() => setProtect(p => !p)}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${protect ? "bg-accent" : "bg-secondary"}`}>
                  <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${protect ? "translate-x-5" : "translate-x-0"}`} />
                </button>
              </label>
              {protect && (
                <input type="password" value={pubPassword} onChange={e => setPubPassword(e.target.value)}
                  placeholder={a.locked ? "Leave blank to keep existing" : "Enter password"}
                  className="mt-3 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-accent" />
              )}
            </div>
            {pubError && (
              <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{pubError}</p>
            )}
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setPublishOpen(false)}><X size={14} /> Cancel</Button>
              <Button
                className={`flex-1 ${isPublished ? "bg-amber-500 text-black hover:bg-amber-400" : ""}`}
                disabled={publishing || !pubSubdomain || (subdomainCheck.available === false && a.subdomain !== pubSubdomain)}
                onClick={() => void doPublish()}>
                {publishing ? "Publishing…" : isPublished ? <><RefreshCw size={14} /> Publish update</> : <><Globe size={14} /> Publish</>}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Version history modal ────────────────────────────────── */}
      <Dialog open={versionsOpen} onOpenChange={setVersionsOpen}>
        <DialogContent className="max-w-lg">
          <DialogTitle className="flex items-center gap-2">
            <History size={18} className="text-accent" /> Version history
          </DialogTitle>
          <DialogDescription>Restore a previous version into your draft (current draft is saved first).</DialogDescription>
          <div className="mt-2 max-h-96 space-y-2 overflow-y-auto">
            {versionsLoading ? (
              <div className="flex justify-center py-8"><Loader2 className="animate-spin text-accent" size={24} /></div>
            ) : versions.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">No saved versions yet.</p>
            ) : versions.map(v => (
              <div key={v.id} className="flex items-start justify-between gap-3 rounded-lg border border-border px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex items-center gap-2">
                    <SourceBadge source={v.source} />
                    <span className="text-xs text-muted-foreground">
                      {new Date(v.created_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {v.size_bytes > 0 ? `${Math.round(v.size_bytes / 1024)} KB` : ""}
                    </span>
                  </div>
                  {v.prompt && (
                    <p className="truncate text-xs text-muted-foreground" title={v.prompt}>{v.prompt}</p>
                  )}
                </div>
                <Button size="sm" variant="outline" disabled={restoringVid === v.id} onClick={() => void restoreVersion(v.id)}>
                  {restoringVid === v.id ? <Loader2 className="animate-spin" size={13} /> : <RotateCcw size={13} />} Restore
                </Button>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Revert confirmation ──────────────────────────────────── */}
      <Dialog open={revertOpen} onOpenChange={setRevertOpen}>
        <DialogContent className="max-w-sm">
          <DialogTitle>Revert draft to live?</DialogTitle>
          <DialogDescription>Your current draft changes will be discarded. This cannot be undone.</DialogDescription>
          <div className="mt-4 flex gap-3">
            <Button variant="outline" className="flex-1" onClick={() => setRevertOpen(false)}>Cancel</Button>
            <Button variant="destructive" className="flex-1" disabled={reverting} onClick={() => void doRevert()}>
              {reverting ? <Loader2 className="animate-spin" size={14} /> : <RotateCcw size={14} />}
              {reverting ? "Reverting…" : "Revert draft"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
