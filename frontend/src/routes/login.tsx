import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { AlertCircle, ArrowRight, Check, Eye, EyeOff, Loader2, Sparkles } from "lucide-react";

export const Route = createFileRoute("/login")({
  component: LoginPage,
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

// ── hCaptcha helper (loaded via CDN script, no npm dependency) ─────────────
declare global {
  interface Window {
    hcaptcha?: {
      render: (el: HTMLElement, opts: object) => string;
      reset: (id?: string) => void;
      getResponse: (id?: string) => string;
      execute: (id?: string) => void;
    };
  }
}

const HCAPTCHA_SITE_KEY = "10000000-ffff-ffff-ffff-000000000001"; // free always-pass test key

function useCaptcha(containerRef: React.RefObject<HTMLDivElement | null>, enabled: boolean) {
  const widgetId = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled || !containerRef.current) return;
    const render = () => {
      if (!containerRef.current || widgetId.current !== null) return;
      if (window.hcaptcha) {
        widgetId.current = window.hcaptcha.render(containerRef.current, {
          sitekey: HCAPTCHA_SITE_KEY,
          theme: document.documentElement.classList.contains("dark") ? "dark" : "light",
          size: "normal",
        });
      }
    };
    if (window.hcaptcha) { render(); return; }
    // Load script if not already present
    if (!document.getElementById("hcaptcha-script")) {
      const s = document.createElement("script");
      s.id = "hcaptcha-script";
      s.src = "https://hcaptcha.com/1/api.js";
      s.async = true;
      s.defer = true;
      s.onload = render;
      document.head.appendChild(s);
    } else {
      const check = setInterval(() => { if (window.hcaptcha) { clearInterval(check); render(); } }, 100);
    }
  }, [enabled, containerRef]);

  const getToken = () => {
    if (!enabled) return "bypass";
    return window.hcaptcha?.getResponse(widgetId.current ?? undefined) ?? "";
  };
  const reset = () => {
    if (window.hcaptcha && widgetId.current !== null) window.hcaptcha.reset(widgetId.current);
  };

  return { getToken, reset };
}

// ── Password strength ──────────────────────────────────────────────────────
function PasswordStrength({ pw }: { pw: string }) {
  if (!pw) return null;
  const checks = [pw.length >= 8, /[A-Z]/.test(pw), /[0-9]/.test(pw), /[^A-Za-z0-9]/.test(pw)];
  const score = checks.filter(Boolean).length;
  const label = ["Too short", "Weak", "Fair", "Good", "Strong"][score];
  const colors = ["bg-red-500", "bg-red-400", "bg-amber-400", "bg-yellow-400", "bg-green-500"];
  return (
    <div className="mt-1.5">
      <div className="flex gap-1">
        {[1, 2, 3, 4].map(i => (
          <div key={i} className={`h-1 flex-1 rounded-full transition-all ${i <= score ? colors[score] : "bg-secondary"}`} />
        ))}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────
function LoginPage() {
  const { login, refresh, user, loading } = useAuth();
  const navigate = useNavigate();

  const [tab, setTab] = useState<"signin" | "signup">("signin");

  // Sign-in state
  const [siUsername, setSiUsername] = useState("");
  const [siPassword, setSiPassword] = useState("");
  const [siShowPw,   setSiShowPw]   = useState(false);
  const [siError,    setSiError]    = useState("");
  const [siLoading,  setSiLoading]  = useState(false);

  // Sign-up state
  const [suUsername, setSuUsername] = useState("");
  const [suEmail,    setSuEmail]    = useState("");
  const [suFullName, setSuFullName] = useState("");
  const [suPassword, setSuPassword] = useState("");
  const [suShowPw,   setSuShowPw]   = useState(false);
  const [suError,    setSuError]    = useState("");
  const [suLoading,  setSuLoading]  = useState(false);
  const [suDone,     setSuDone]     = useState(false);

  const captchaRef = useRef<HTMLDivElement>(null);
  const { getToken, reset } = useCaptcha(captchaRef, tab === "signup");

  useEffect(() => { document.title = tab === "signup" ? "Create account — Biswa Artifacts" : "Sign in — Biswa Artifacts"; }, [tab]);
  useEffect(() => { if (!loading && user) void navigate({ to: "/artifacts" }); }, [user, loading, navigate]);

  // ── Sign in ──────────────────────────────────────────────────────────────
  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setSiError(""); setSiLoading(true);
    const result = await login(siUsername, siPassword);
    setSiLoading(false);
    if (!result.ok) { setSiError(result.error ?? "Login failed"); return; }
    void navigate({ to: "/artifacts" });
  };

  // ── Sign up ──────────────────────────────────────────────────────────────
  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setSuError("");

    // Basic client-side validation
    if (!/^[a-zA-Z0-9_.-]{3,30}$/.test(suUsername))
      return setSuError("Username: 3–30 chars, letters/numbers/. _ -");
    if (!/^\S+@\S+\.\S+$/.test(suEmail))
      return setSuError("Enter a valid email address");
    if (suPassword.length < 8)
      return setSuError("Password must be at least 8 characters");

    const token = getToken();
    if (!token) return setSuError("Please complete the captcha verification");

    setSuLoading(true);
    const res = await apiFetch<{ user?: object; error?: string }>("/api/auth/signup", {
      method: "POST",
      body: JSON.stringify({ username: suUsername, email: suEmail, full_name: suFullName, password: suPassword }),
    });
    setSuLoading(false);
    if (res.error) { reset(); setSuError(res.error); return; }

    // Signup successful — refresh auth state and redirect
    await refresh();
    setSuDone(true);
    setTimeout(() => void navigate({ to: "/artifacts" }), 1200);
  };

  return (
    <section className="mx-auto grid min-h-svh max-w-5xl items-center gap-12 px-6 pb-16 pt-28 lg:grid-cols-[1fr_420px]">

      {/* ── Left decorative panel ────────────────────────────────────── */}
      <div className="hidden lg:flex flex-col gap-8">
        <div className="rounded-2xl border border-border bg-gradient-to-br from-accent/20 via-secondary to-background p-10">
          <div className="mb-6 flex size-12 items-center justify-center rounded-xl bg-accent text-accent-foreground">
            <Sparkles size={24} />
          </div>
          <h2 className="font-display text-4xl font-bold leading-tight">
            A space for<br />your next idea<span className="text-accent">.</span>
          </h2>
          <p className="mt-4 text-sm text-muted-foreground leading-relaxed">
            Build interactive websites, documents, and presentations. Publish to your own subdomain in one click.
          </p>
          <div className="mt-8 space-y-2.5 text-sm text-muted-foreground">
            {["Write HTML · CSS · JS with live preview", "Publish to name.biswa.io instantly", "AI code generation with your own key", "File & image CDN included"].map(f => (
              <p key={f} className="flex items-center gap-2">
                <Check size={14} className="shrink-0 text-accent" />{f}
              </p>
            ))}
          </div>
        </div>
        <p className="flex items-center justify-between px-1 font-mono text-[10px] text-muted-foreground">
          <span>BISWA / ARTIFACTS</span>
          <Sparkles size={13} />
        </p>
      </div>

      {/* ── Auth card ────────────────────────────────────────────────── */}
      <div className="mx-auto w-full max-w-sm">
        {/* Tab switcher */}
        <div className="mb-8 flex rounded-xl border border-border bg-secondary/40 p-1">
          {(["signin", "signup"] as const).map(t => (
            <button key={t} type="button"
              onClick={() => { setTab(t); setSiError(""); setSuError(""); }}
              className={`flex-1 rounded-lg py-2 text-sm font-medium transition-all ${
                tab === t ? "bg-card shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
              }`}>
              {t === "signin" ? "Sign in" : "Create account"}
            </button>
          ))}
        </div>

        {/* ── SIGN IN FORM ─────────────────────────────────────────── */}
        {tab === "signin" && (
          <form onSubmit={e => void handleSignIn(e)} className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium">Username or Email</label>
              <input
                value={siUsername}
                onChange={e => setSiUsername(e.target.value)}
                placeholder="your_username"
                autoComplete="username"
                required
                disabled={siLoading}
                className="w-full rounded-lg border border-input bg-card px-3 py-2.5 text-sm outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/30 disabled:opacity-50"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">Password</label>
              <div className="relative">
                <input
                  value={siPassword}
                  onChange={e => setSiPassword(e.target.value)}
                  type={siShowPw ? "text" : "password"}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  required
                  disabled={siLoading}
                  className="w-full rounded-lg border border-input bg-card px-3 py-2.5 pr-10 text-sm outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/30 disabled:opacity-50"
                />
                <button type="button" tabIndex={-1}
                  aria-label={siShowPw ? "Hide password" : "Show password"}
                  onClick={() => setSiShowPw(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  {siShowPw ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>

            {siError && (
              <p role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                <AlertCircle size={15} className="mt-0.5 shrink-0" />{siError}
              </p>
            )}

            <Button className="w-full" size="lg" disabled={siLoading}>
              {siLoading ? <Loader2 className="animate-spin" /> : <ArrowRight />}
              {siLoading ? "Signing in…" : "Sign in"}
            </Button>

            <div className="text-center">
              <Link to="/forgot" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                Forgot password?
              </Link>
            </div>
          </form>
        )}

        {/* ── SIGN UP FORM ─────────────────────────────────────────── */}
        {tab === "signup" && !suDone && (
          <form onSubmit={e => void handleSignUp(e)} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="mb-1.5 block text-sm font-medium">Full name <span className="text-muted-foreground text-xs">(optional)</span></label>
                <input
                  value={suFullName}
                  onChange={e => setSuFullName(e.target.value)}
                  placeholder="Biswa Ranjan"
                  maxLength={80}
                  autoComplete="name"
                  disabled={suLoading}
                  className="w-full rounded-lg border border-input bg-card px-3 py-2.5 text-sm outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/30 disabled:opacity-50"
                />
              </div>
              <div className="col-span-2 sm:col-span-1">
                <label className="mb-1.5 block text-sm font-medium">Username</label>
                <input
                  value={suUsername}
                  onChange={e => setSuUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_.-]/g, ""))}
                  placeholder="biswa42"
                  autoComplete="username"
                  required
                  maxLength={30}
                  minLength={3}
                  disabled={suLoading}
                  className="w-full rounded-lg border border-input bg-card px-3 py-2.5 text-sm outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/30 disabled:opacity-50"
                />
                <p className="mt-1 text-xs text-muted-foreground">3–30 chars, letters/numbers/. _ -</p>
              </div>
              <div className="col-span-2 sm:col-span-1">
                <label className="mb-1.5 block text-sm font-medium">Email</label>
                <input
                  value={suEmail}
                  onChange={e => setSuEmail(e.target.value)}
                  type="email"
                  placeholder="you@example.com"
                  autoComplete="email"
                  required
                  disabled={suLoading}
                  className="w-full rounded-lg border border-input bg-card px-3 py-2.5 text-sm outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/30 disabled:opacity-50"
                />
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium">Password</label>
              <div className="relative">
                <input
                  value={suPassword}
                  onChange={e => setSuPassword(e.target.value)}
                  type={suShowPw ? "text" : "password"}
                  placeholder="At least 8 characters"
                  autoComplete="new-password"
                  required
                  minLength={8}
                  disabled={suLoading}
                  className="w-full rounded-lg border border-input bg-card px-3 py-2.5 pr-10 text-sm outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/30 disabled:opacity-50"
                />
                <button type="button" tabIndex={-1}
                  aria-label={suShowPw ? "Hide password" : "Show password"}
                  onClick={() => setSuShowPw(v => !v)}
                  className="absolute right-3 top-[14px] text-muted-foreground hover:text-foreground">
                  {suShowPw ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
              <PasswordStrength pw={suPassword} />
            </div>

            {/* hCaptcha widget */}
            <div>
              <div ref={captchaRef} className="overflow-hidden rounded-lg" />
              <p className="mt-1 text-xs text-muted-foreground">Complete the captcha to continue</p>
            </div>

            {suError && (
              <p role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                <AlertCircle size={15} className="mt-0.5 shrink-0" />{suError}
              </p>
            )}

            <Button className="w-full" size="lg" disabled={suLoading}>
              {suLoading ? <Loader2 className="animate-spin" /> : <ArrowRight />}
              {suLoading ? "Creating account…" : "Create account"}
            </Button>

            <p className="text-center text-xs text-muted-foreground">
              By signing up you agree to our terms of service.
            </p>
          </form>
        )}

        {/* ── SUCCESS ──────────────────────────────────────────────── */}
        {tab === "signup" && suDone && (
          <div className="py-6 text-center">
            <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-full bg-green-500/15">
              <Check size={28} className="text-green-500" />
            </div>
            <h2 className="font-display text-xl font-semibold">Account created!</h2>
            <p className="mt-2 text-sm text-muted-foreground">Redirecting to your studio…</p>
            <p className="mt-1 text-xs text-muted-foreground">Check your email to verify your address.</p>
          </div>
        )}

        <Link to="/" className="mt-8 inline-block text-sm text-muted-foreground hover:text-foreground transition-colors">
          ← Back to home
        </Link>
      </div>
    </section>
  );
}
