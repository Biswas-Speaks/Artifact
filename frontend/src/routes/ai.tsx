/**
 * frontend/src/routes/ai.tsx
 * BYOK AI Settings page — Google Gemini, OpenAI, and Groq.
 * Keys are encrypted server-side (AES-256-GCM) and never returned after saving.
 */
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  AlertCircle, Bot, Check, ChevronDown, Eye, EyeOff,
  KeyRound, Loader2, RefreshCw, Zap, Unplug,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { StudioShell } from "@/components/StudioShell";

export const Route = createFileRoute("/ai")({
  component: AISettingsPage,
});

// ── API helper ─────────────────────────────────────────────────────────────
async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(opts?.headers ?? {}) },
    ...opts,
  });
  return res.json() as Promise<T>;
}

// ── Provider config ────────────────────────────────────────────────────────
type ProviderKey = "gemini" | "openai" | "groq";

interface ProviderConfig {
  label: string;
  color: string;           // tailwind gradient classes for the tile accent
  bg: string;              // selected tile bg
  border: string;          // selected tile border
  text: string;            // selected tile text
  placeholder: string;     // key input placeholder
  hint: string;            // where to get key
  icon: string;            // emoji / svg char
}

const PROVIDERS: Record<ProviderKey, ProviderConfig> = {
  gemini: {
    label: "Google Gemini",
    color: "from-blue-500 to-cyan-500",
    bg: "bg-blue-500/10",
    border: "border-blue-500/60",
    text: "text-blue-500",
    placeholder: "AIzaSy…",
    hint: "aistudio.google.com → API keys",
    icon: "✦",
  },
  openai: {
    label: "OpenAI",
    color: "from-emerald-500 to-teal-500",
    bg: "bg-emerald-500/10",
    border: "border-emerald-500/60",
    text: "text-emerald-500",
    placeholder: "sk-…",
    hint: "platform.openai.com → API keys",
    icon: "◆",
  },
  groq: {
    label: "Groq",
    color: "from-orange-500 to-rose-500",
    bg: "bg-orange-500/10",
    border: "border-orange-500/60",
    text: "text-orange-500",
    placeholder: "gsk_…",
    hint: "console.groq.com → API keys",
    icon: "⚡",
  },
};

const PROVIDER_KEYS = Object.keys(PROVIDERS) as ProviderKey[];

// ── Types ──────────────────────────────────────────────────────────────────
interface AiSettings {
  connected:   boolean;
  provider?:   string;
  model?:      string;
  status?:     string;
  last4?:      string;
  verifiedAt?: string;
}

// ── Sub-components ─────────────────────────────────────────────────────────
function StatusBadge({ status }: { status?: string }) {
  if (!status) return null;
  const ok = status === "verified";
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium ${
      ok
        ? "bg-green-500/15 text-green-600 dark:text-green-400 border-green-500/30"
        : "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30"
    }`}>
      <span className={`size-1.5 rounded-full ${ok ? "bg-green-500" : "bg-red-500"}`} />
      {ok ? "Connected" : "Invalid key"}
    </span>
  );
}

function ProviderTile({
  id,
  selected,
  onSelect,
}: {
  id: ProviderKey;
  selected: boolean;
  onSelect: () => void;
}) {
  const cfg = PROVIDERS[id];
  return (
    <button
      onClick={onSelect}
      className={`group relative overflow-hidden rounded-xl border px-4 py-3 text-left transition-all duration-200 ${
        selected
          ? `${cfg.bg} ${cfg.border} ${cfg.text}`
          : "border-border text-muted-foreground hover:border-border/80 hover:text-foreground"
      }`}
    >
      {/* animated gradient bar at the top when selected */}
      {selected && (
        <span
          className={`absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r ${cfg.color}`}
        />
      )}
      <span className="flex items-center gap-2">
        <span className="text-base leading-none">{cfg.icon}</span>
        <span className="text-sm font-semibold">{cfg.label}</span>
      </span>
      {selected && (
        <span className="mt-1 block text-[10px] font-mono opacity-70">selected</span>
      )}
    </button>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────
export default function AISettingsPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  // Current settings
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [loadingSettings, setLoadingSettings] = useState(true);

  // Connect flow
  const [provider, setProvider] = useState<ProviderKey>("gemini");
  const [apiKey, setApiKey]     = useState("");
  const [showKey, setShowKey]   = useState(false);
  const [verifying, setVerifying]   = useState(false);
  const [models, setModels]         = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [verifyMsg, setVerifyMsg]   = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving]         = useState(false);
  const [saveMsg, setSaveMsg]       = useState<{ ok: boolean; text: string } | null>(null);

  // Model change
  const [changingModel, setChangingModel] = useState(false);
  const [newModel, setNewModel]     = useState("");
  const [modelMsg, setModelMsg]     = useState<{ ok: boolean; text: string } | null>(null);

  // Recheck
  const [rechecking, setRechecking] = useState(false);
  const [recheckMsg, setRecheckMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Disconnect
  const [disconnecting, setDisconnecting] = useState(false);

  useEffect(() => {
    if (!loading && !user) void navigate({ to: "/login" });
    document.title = "AI Settings — Biswa Artifacts";
  }, [user, loading, navigate]);

  const loadSettings = () => {
    setLoadingSettings(true);
    apiFetch<AiSettings>("/api/ai/settings")
      .then(d => { setSettings(d); if (d.model) setNewModel(d.model); })
      .catch(() => setSettings({ connected: false }))
      .finally(() => setLoadingSettings(false));
  };

  useEffect(() => { if (user) loadSettings(); }, [user]); // eslint-disable-line

  // ── Verify key ─────────────────────────────────────────────────────────
  const handleVerify = async () => {
    if (!apiKey.trim()) return;
    setVerifying(true);
    setVerifyMsg(null);
    setModels([]);
    const res = await apiFetch<{ ok?: boolean; models?: string[]; default?: string; error?: string }>(
      "/api/ai/verify",
      { method: "POST", body: JSON.stringify({ provider, apiKey }) }
    );
    setVerifying(false);
    if (res.error) {
      setVerifyMsg({ ok: false, text: res.error });
      return;
    }
    setModels(res.models ?? []);
    setSelectedModel(res.default ?? res.models?.[0] ?? "");
    setVerifyMsg({ ok: true, text: `✓ Key verified — ${res.models?.length ?? 0} models available` });
  };

  // ── Save ───────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!selectedModel) return;
    setSaving(true);
    setSaveMsg(null);
    const res = await apiFetch<{ ok?: boolean; error?: string }>(
      "/api/ai/settings",
      { method: "PUT", body: JSON.stringify({ provider, apiKey, model: selectedModel }) }
    );
    setSaving(false);
    if (res.error) { setSaveMsg({ ok: false, text: res.error }); return; }
    setSaveMsg({ ok: true, text: "AI key saved and connected." });
    setApiKey("");
    setModels([]);
    setVerifyMsg(null);
    loadSettings();
  };

  // ── Change model only ──────────────────────────────────────────────────
  const handleChangeModel = async () => {
    if (!newModel) return;
    setChangingModel(true);
    setModelMsg(null);
    const res = await apiFetch<{ ok?: boolean; error?: string }>(
      "/api/ai/settings",
      { method: "PATCH", body: JSON.stringify({ model: newModel }) }
    );
    setChangingModel(false);
    if (res.error) { setModelMsg({ ok: false, text: res.error }); return; }
    setModelMsg({ ok: true, text: "Model updated." });
    loadSettings();
  };

  // ── Recheck ────────────────────────────────────────────────────────────
  const handleRecheck = async () => {
    setRechecking(true);
    setRecheckMsg(null);
    const res = await apiFetch<{ ok?: boolean; status?: string; error?: string }>(
      "/api/ai/recheck",
      { method: "POST" }
    );
    setRechecking(false);
    if (res.error) { setRecheckMsg({ ok: false, text: res.error }); return; }
    setRecheckMsg({ ok: true, text: "Key re-verified successfully." });
    loadSettings();
  };

  // ── Disconnect ─────────────────────────────────────────────────────────
  const handleDisconnect = async () => {
    if (!confirm("Remove your AI key? You will need to re-enter it to use AI features.")) return;
    setDisconnecting(true);
    await apiFetch("/api/ai/settings", { method: "DELETE" });
    setDisconnecting(false);
    setSettings({ connected: false });
    setModels([]);
    setVerifyMsg(null);
    setSaveMsg(null);
    setApiKey("");
  };

  if (loading || !user) return null;

  const isConnected = settings?.connected && settings.status === "verified";
  const activeCfg   = PROVIDERS[provider];

  return (
    <StudioShell view="ai">
      <h1 className="font-display text-3xl font-semibold sm:text-4xl">AI Settings</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Connect your own API key to enable AI code generation in the editor.
        Supports Google Gemini, OpenAI, and Groq.
      </p>

      {/* BYOK info box */}
      <div className="mt-6 flex items-start gap-3 rounded-xl border border-accent/30 bg-accent/5 p-4">
        <Zap size={18} className="mt-0.5 shrink-0 text-accent" />
        <p className="text-sm text-muted-foreground">
          <strong className="text-foreground">Bring Your Own Key.</strong>{" "}
          Biswa Artifacts hosts no model and supplies no API key. You pay your provider
          directly. Your key is stored{" "}
          <strong className="text-foreground">AES-256-GCM encrypted</strong> on the server
          and is <strong className="text-foreground">never shown again</strong> after saving.
        </p>
      </div>

      <div className="mt-8 grid gap-8 lg:grid-cols-2">

        {/* ── Current connection ──────────────────────────────────────── */}
        <section className="rounded-2xl border border-border bg-card p-6">
          <div className="mb-5 flex items-center gap-2">
            <Bot size={18} className="text-accent" />
            <h2 className="font-display text-xl font-semibold">Current Connection</h2>
          </div>

          {loadingSettings ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="animate-spin" size={16} /> Loading…
            </div>
          ) : !settings?.connected ? (
            <p className="text-sm text-muted-foreground">No AI key connected yet.</p>
          ) : (
            <div className="space-y-4">
              {/* Connected provider chip */}
              {settings.provider && PROVIDERS[settings.provider as ProviderKey] && (
                <div className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm font-medium
                  ${PROVIDERS[settings.provider as ProviderKey].bg}
                  ${PROVIDERS[settings.provider as ProviderKey].border}
                  ${PROVIDERS[settings.provider as ProviderKey].text}`}>
                  <span>{PROVIDERS[settings.provider as ProviderKey].icon}</span>
                  {PROVIDERS[settings.provider as ProviderKey].label}
                </div>
              )}

              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="mb-1 font-mono text-[10px] text-muted-foreground">MODEL</p>
                  <p className="font-mono text-xs">{settings.model}</p>
                </div>
                <div>
                  <p className="mb-1 font-mono text-[10px] text-muted-foreground">STATUS</p>
                  <StatusBadge status={settings.status} />
                </div>
                <div>
                  <p className="mb-1 font-mono text-[10px] text-muted-foreground">KEY</p>
                  <p className="font-mono text-sm">••••{settings.last4}</p>
                </div>
                {settings.verifiedAt && (
                  <div>
                    <p className="mb-1 font-mono text-[10px] text-muted-foreground">LAST VERIFIED</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(settings.verifiedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                    </p>
                  </div>
                )}
              </div>

              {/* Change model */}
              <div className="rounded-lg border border-border p-3">
                <p className="mb-2 text-xs font-medium text-muted-foreground">Change model</p>
                <input
                  value={newModel}
                  onChange={e => setNewModel(e.target.value)}
                  placeholder="e.g. llama-3.3-70b-versatile"
                  className="mb-2 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-accent"
                />
                {modelMsg && (
                  <p className={`mb-2 text-xs ${modelMsg.ok ? "text-green-600 dark:text-green-400" : "text-destructive"}`}>
                    {modelMsg.ok && <Check size={12} className="mr-1 inline" />}{modelMsg.text}
                  </p>
                )}
                <Button size="sm" variant="outline" className="w-full" disabled={changingModel} onClick={() => void handleChangeModel()}>
                  {changingModel ? <Loader2 className="animate-spin" size={13} /> : <ChevronDown size={13} />}
                  Update model
                </Button>
              </div>

              {recheckMsg && (
                <p className={`text-sm ${recheckMsg.ok ? "text-green-600 dark:text-green-400" : "text-destructive"}`}>
                  {recheckMsg.ok && <Check size={13} className="mr-1 inline" />}{recheckMsg.text}
                </p>
              )}

              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" disabled={rechecking} onClick={() => void handleRecheck()}>
                  {rechecking ? <Loader2 className="animate-spin" size={13} /> : <RefreshCw size={13} />}
                  Re-check key
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-destructive hover:border-destructive/50 hover:bg-destructive/10"
                  disabled={disconnecting}
                  onClick={() => void handleDisconnect()}
                >
                  {disconnecting ? <Loader2 className="animate-spin" size={13} /> : <Unplug size={13} />}
                  Disconnect
                </Button>
              </div>
            </div>
          )}
        </section>

        {/* ── Connect / replace key ───────────────────────────────────── */}
        <section className="rounded-2xl border border-border bg-card p-6">
          <div className="mb-5 flex items-center gap-2">
            <KeyRound size={18} className="text-accent" />
            <h2 className="font-display text-xl font-semibold">
              {isConnected ? "Replace Key" : "Connect API Key"}
            </h2>
          </div>

          <div className="space-y-5">
            {/* Provider tiles — 3 columns */}
            <div>
              <label className="mb-2 block text-sm font-medium">Provider</label>
              <div className="grid grid-cols-3 gap-2">
                {PROVIDER_KEYS.map(p => (
                  <ProviderTile
                    key={p}
                    id={p}
                    selected={provider === p}
                    onSelect={() => { setProvider(p); setModels([]); setVerifyMsg(null); setApiKey(""); }}
                  />
                ))}
              </div>
            </div>

            {/* API Key input */}
            <div>
              <label className="text-sm font-medium">API Key</label>
              <div className="relative mt-1.5">
                <input
                  type={showKey ? "text" : "password"}
                  value={apiKey}
                  onChange={e => setApiKey(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") void handleVerify(); }}
                  placeholder={activeCfg.placeholder}
                  autoComplete="off"
                  className={`w-full rounded-lg border bg-background py-2.5 pl-3 pr-10 text-sm outline-none transition-colors focus:ring-2 focus:ring-accent/20 ${
                    apiKey ? `border-input focus:${activeCfg.border}` : "border-input focus:border-accent"
                  }`}
                />
                <button
                  type="button"
                  aria-label={showKey ? "Hide key" : "Show key"}
                  onClick={() => setShowKey(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showKey ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">
                Get your key at{" "}
                <a
                  href={
                    provider === "gemini" ? "https://aistudio.google.com/app/apikey"
                    : provider === "openai" ? "https://platform.openai.com/api-keys"
                    : "https://console.groq.com/keys"
                  }
                  target="_blank"
                  rel="noreferrer"
                  className={`underline underline-offset-2 ${activeCfg.text}`}
                >
                  {activeCfg.hint}
                </a>
              </p>
            </div>

            {/* Verify feedback */}
            {verifyMsg && (
              <p className={`flex items-start gap-1.5 rounded-lg border px-3 py-2 text-sm ${
                verifyMsg.ok
                  ? "border-green-500/30 bg-green-500/10 text-green-600 dark:text-green-400"
                  : "border-destructive/30 bg-destructive/10 text-destructive"
              }`}>
                {verifyMsg.ok
                  ? <Check size={14} className="mt-0.5 shrink-0" />
                  : <AlertCircle size={14} className="mt-0.5 shrink-0" />}
                {verifyMsg.text}
              </p>
            )}

            <Button
              className="w-full"
              variant="outline"
              disabled={verifying || !apiKey.trim()}
              onClick={() => void handleVerify()}
            >
              {verifying ? <Loader2 className="animate-spin" size={14} /> : <Zap size={14} />}
              {verifying ? "Verifying…" : "Verify & fetch models"}
            </Button>

            {/* Model dropdown — shown only after successful verify */}
            {models.length > 0 && (
              <div>
                <label className="text-sm font-medium">Select model</label>
                <select
                  value={selectedModel}
                  onChange={e => setSelectedModel(e.target.value)}
                  className="mt-1.5 w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-accent"
                >
                  {models.map(m => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Save feedback */}
            {saveMsg && (
              <p className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm ${
                saveMsg.ok
                  ? "border-green-500/30 bg-green-500/10 text-green-600 dark:text-green-400"
                  : "border-destructive/30 bg-destructive/10 text-destructive"
              }`}>
                {saveMsg.ok && <Check size={14} />}{saveMsg.text}
              </p>
            )}

            <Button
              className={`w-full bg-gradient-to-r ${activeCfg.color} text-white hover:opacity-90 transition-opacity`}
              disabled={saving || models.length === 0 || !selectedModel}
              onClick={() => void handleSave()}
            >
              {saving ? <Loader2 className="animate-spin" size={14} /> : <KeyRound size={14} />}
              {saving ? "Saving…" : isConnected ? "Replace & save key" : "Save & connect"}
            </Button>

            <p className="text-center text-xs text-muted-foreground">
              Encrypted AES-256-GCM · Never shown after saving
            </p>
          </div>
        </section>
      </div>

      {/* ── Provider comparison ─────────────────────────────────────────── */}
      <section className="mt-6 rounded-2xl border border-border bg-card p-6">
        <h3 className="mb-5 font-display text-lg font-semibold">Provider comparison</h3>
        <div className="grid gap-4 sm:grid-cols-3">
          {/* Gemini */}
          <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-4">
            <div className="mb-2 flex items-center gap-2">
              <span className="text-lg">✦</span>
              <span className="font-semibold text-blue-500">Google Gemini</span>
            </div>
            <ul className="space-y-1 text-xs text-muted-foreground">
              <li>✓ Generous free tier</li>
              <li>✓ Fast flash models</li>
              <li>✓ 1M token context window</li>
              <li className="text-[11px] opacity-70">Key starts with: AIzaSy…</li>
            </ul>
          </div>
          {/* OpenAI */}
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
            <div className="mb-2 flex items-center gap-2">
              <span className="text-lg">◆</span>
              <span className="font-semibold text-emerald-500">OpenAI</span>
            </div>
            <ul className="space-y-1 text-xs text-muted-foreground">
              <li>✓ GPT-4o and GPT-4.1</li>
              <li>✓ Reliable structured output</li>
              <li>✓ Wide model selection</li>
              <li className="text-[11px] opacity-70">Key starts with: sk-…</li>
            </ul>
          </div>
          {/* Groq */}
          <div className="rounded-xl border border-orange-500/20 bg-orange-500/5 p-4">
            <div className="mb-2 flex items-center gap-2">
              <span className="text-lg">⚡</span>
              <span className="font-semibold text-orange-500">Groq</span>
            </div>
            <ul className="space-y-1 text-xs text-muted-foreground">
              <li>✓ Ultra-fast LPU inference</li>
              <li>✓ Free tier available</li>
              <li>✓ Llama 3.3 · Mixtral · DeepSeek</li>
              <li className="text-[11px] opacity-70">Key starts with: gsk_…</li>
            </ul>
          </div>
        </div>
      </section>

      {/* ── How it works ────────────────────────────────────────────────── */}
      <section className="mt-6 rounded-2xl border border-border bg-card p-6">
        <h3 className="mb-4 font-display text-lg font-semibold">How AI generation works</h3>
        <div className="grid gap-4 text-sm text-muted-foreground sm:grid-cols-3">
          <div className="flex flex-col gap-1">
            <p className="font-medium text-foreground">1. You provide the key</p>
            <p>Your API key is verified against the provider and stored encrypted. It is never logged or returned.</p>
          </div>
          <div className="flex flex-col gap-1">
            <p className="font-medium text-foreground">2. You write a prompt</p>
            <p>In the editor, describe what you want. The server sends your prompt + current file content to the AI.</p>
          </div>
          <div className="flex flex-col gap-1">
            <p className="font-medium text-foreground">3. Changes applied to draft</p>
            <p>The AI response is validated and applied only to your draft. Review and publish when ready.</p>
          </div>
        </div>
      </section>
    </StudioShell>
  );
}
