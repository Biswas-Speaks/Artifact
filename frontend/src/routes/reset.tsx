import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ArrowUpRight, CheckCircle, Loader2 } from "lucide-react";

export const Route = createFileRoute("/reset")({
  validateSearch: (s: Record<string, unknown>) => ({ token: String(s["token"] ?? "") }),
  component: ResetPassword,
});

function ResetPassword() {
  const { token } = Route.useSearch();
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    document.title = "Reset password — Biswa Artifacts";
  }, []);

  if (!token) {
    return (
      <section className="mx-auto flex min-h-svh max-w-sm flex-col justify-center px-6 pb-16 pt-28">
        <p className="text-sm text-muted-foreground">
          Invalid or missing reset token.{" "}
          <Link to="/forgot" className="text-accent hover:underline">
            Request a new link
          </Link>
          .
        </p>
      </section>
    );
  }

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");
    const f = new FormData(e.currentTarget);
    const password = String(f.get("password") ?? "");
    const confirm = String(f.get("confirm") ?? "");

    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/reset", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const json = await res.json() as { ok?: boolean; error?: string };
      if (!res.ok) {
        setError(json.error ?? "Something went wrong");
      } else {
        setDone(true);
        setTimeout(() => void navigate({ to: "/login" }), 3000);
      }
    } catch {
      setError("Network error — check your connection");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="mx-auto flex min-h-svh max-w-sm flex-col justify-center px-6 pb-16 pt-28">
      <p className="font-mono text-[11px] tracking-[0.35em] text-accent">PASSWORD RESET</p>
      <h1 className="mt-3 font-display text-4xl font-bold">
        New password<span className="text-shape-coral">.</span>
      </h1>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
        Choose a strong password — at least 8 characters.
      </p>

      {done ? (
        <div className="mt-8 flex flex-col items-center gap-4 rounded-xl border border-border bg-card p-6 text-center">
          <CheckCircle className="size-10 text-accent" />
          <p className="font-display text-lg font-semibold">Password updated</p>
          <p className="text-sm text-muted-foreground">
            Redirecting you to sign in…
          </p>
        </div>
      ) : (
        <form className="mt-8 space-y-4" onSubmit={(e) => void handleSubmit(e)}>
          <label className="block text-sm font-medium">
            New password
            <input
              name="password"
              type="password"
              placeholder="••••••••"
              autoComplete="new-password"
              required
              minLength={8}
              disabled={submitting}
              className="mt-1.5 w-full rounded-lg border border-input bg-card px-3 py-2.5 text-sm outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/30 disabled:opacity-50"
            />
          </label>
          <label className="block text-sm font-medium">
            Confirm password
            <input
              name="confirm"
              type="password"
              placeholder="••••••••"
              autoComplete="new-password"
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
            {submitting ? "Saving…" : "Set new password"}
          </Button>
        </form>
      )}

      <Link
        to="/login"
        className="mt-8 inline-block text-sm text-muted-foreground hover:text-foreground"
      >
        ← Back to sign in
      </Link>
    </section>
  );
}
