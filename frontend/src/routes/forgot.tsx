import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ArrowUpRight, CheckCircle, Loader2 } from "lucide-react";

export const Route = createFileRoute("/forgot")({
  component: ForgotPassword,
});

function ForgotPassword() {
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    document.title = "Forgot password — Biswa Artifacts";
  }, []);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    const f = new FormData(e.currentTarget);
    try {
      const res = await fetch("/api/auth/forgot", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: String(f.get("email") ?? "") }),
      });
      const json = await res.json() as { ok?: boolean; error?: string };
      if (!res.ok) {
        setError(json.error ?? "Something went wrong");
      } else {
        setSent(true);
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
        Forgot password<span className="text-shape-coral">.</span>
      </h1>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
        Enter the email address on your account and we'll send a reset link.
      </p>

      {sent ? (
        <div className="mt-8 flex flex-col items-center gap-4 rounded-xl border border-border bg-card p-6 text-center">
          <CheckCircle className="size-10 text-accent" />
          <p className="font-display text-lg font-semibold">Check your inbox</p>
          <p className="text-sm text-muted-foreground">
            If that email is on an account, a reset link is on its way. The link expires in 30 minutes.
          </p>
          <Link to="/login" className="mt-2 text-sm text-accent hover:underline">
            Back to sign in
          </Link>
        </div>
      ) : (
        <form className="mt-8 space-y-4" onSubmit={(e) => void handleSubmit(e)}>
          <label className="block text-sm font-medium">
            Email address
            <input
              name="email"
              type="email"
              placeholder="you@example.com"
              autoComplete="email"
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
            {submitting ? "Sending…" : "Send reset link"}
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
