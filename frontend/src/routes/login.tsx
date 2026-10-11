import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { ArrowUpRight, Loader2, Sparkles } from "lucide-react";
import { ArtifactArtwork } from "@/components/ArtifactArtwork";

export const Route = createFileRoute("/login")({
  component: Login,
});

function Login() {
  const { login, user, loading } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    document.title = "Sign in — Biswa Artifacts";
  }, []);

  // Already signed in — redirect to studio
  useEffect(() => {
    if (!loading && user) void navigate({ to: "/artifacts" });
  }, [user, loading, navigate]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    const f = new FormData(e.currentTarget);
    const result = await login(
      String(f.get("username") ?? ""),
      String(f.get("password") ?? ""),
    );
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error ?? "Login failed");
      return;
    }
    void navigate({ to: "/artifacts" });
  };

  return (
    <section className="mx-auto grid min-h-svh max-w-6xl items-center gap-16 px-6 pb-16 pt-28 lg:grid-cols-2">
      {/* Left decorative panel */}
      <div className="hidden lg:block">
        <div className="relative aspect-square overflow-hidden rounded-lg">
          <ArtifactArtwork slug="chromatic-scales" />
          <span className="absolute left-8 top-14 font-display text-5xl font-semibold text-art-ink">
            A space for
            <br />
            your next idea.
          </span>
        </div>
        <p className="mt-5 flex items-center justify-between font-mono text-[10px] text-muted-foreground">
          <span>BISWA / ARTIFACTS</span>
          <Sparkles size={16} />
        </p>
      </div>

      {/* Login form */}
      <div className="mx-auto w-full max-w-sm">
        <p className="font-mono text-[11px] tracking-[0.35em] text-accent">STUDIO ACCESS</p>
        <h1 className="mt-3 font-display text-4xl font-bold">
          Welcome back<span className="text-shape-coral">.</span>
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          Sign in to your account to continue.
        </p>

        <form className="mt-8 space-y-4" onSubmit={(e) => void handleSubmit(e)}>
          <label className="block text-sm font-medium">
            Username or Email
            <input
              name="username"
              placeholder="your username"
              autoComplete="username"
              required
              disabled={submitting}
              className="mt-1.5 w-full rounded-lg border border-input bg-card px-3 py-2.5 text-sm outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/30 disabled:opacity-50"
            />
          </label>
          <label className="block text-sm font-medium">
            Password
            <input
              name="password"
              type="password"
              placeholder="••••••••"
              autoComplete="current-password"
              required
              disabled={submitting}
              className="mt-1.5 w-full rounded-lg border border-input bg-card px-3 py-2.5 text-sm outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/30 disabled:opacity-50"
            />
          </label>

          {error && (
            <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}

          <Button className="w-full" disabled={submitting}>
            {submitting ? <Loader2 className="animate-spin" /> : <ArrowUpRight />}
            {submitting ? "Signing in…" : "Sign in"}
          </Button>

          <div className="pt-1 text-center">
            <Link
              to="/forgot"
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              Forgot your password?
            </Link>
          </div>
        </form>

        <Link
          to="/"
          className="mt-8 inline-block text-sm text-muted-foreground hover:text-foreground"
        >
          ← Back to home
        </Link>
      </div>
    </section>
  );
}
