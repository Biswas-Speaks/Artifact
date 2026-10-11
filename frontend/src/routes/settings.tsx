import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Check, KeyRound, Loader2, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { StudioShell } from "@/components/StudioShell";

export const Route = createFileRoute("/settings")({
  component: SettingsPage,
});

async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(opts?.headers ?? {}) },
    ...opts,
  });
  return res.json() as Promise<T>;
}

function SettingsPage() {
  const { user, loading, refresh } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !user) void navigate({ to: "/login" });
    document.title = "Settings — Biswa Artifacts";
  }, [user, loading, navigate]);

  /* ── Profile form ──────────────────────────────────────────────────── */
  const [fullName, setFullName]   = useState("");
  const [email, setEmail]         = useState("");
  const [profileMsg, setProfileMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);

  useEffect(() => {
    if (user) { setFullName(user.full_name); setEmail(user.email); }
  }, [user]);

  const saveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingProfile(true);
    setProfileMsg(null);
    const res = await apiFetch<{ error?: string; id?: string }>("/api/settings/profile", {
      method: "PUT",
      body: JSON.stringify({ full_name: fullName, email }),
    });
    setSavingProfile(false);
    if (res.error) setProfileMsg({ ok: false, text: res.error });
    else { setProfileMsg({ ok: true, text: "Profile updated." }); void refresh(); }
  };

  /* ── Password form ─────────────────────────────────────────────────── */
  const [currentPw, setCurrentPw]   = useState("");
  const [newPw, setNewPw]           = useState("");
  const [confirmPw, setConfirmPw]   = useState("");
  const [pwMsg, setPwMsg]           = useState<{ ok: boolean; text: string } | null>(null);
  const [savingPw, setSavingPw]     = useState(false);

  const savePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPw !== confirmPw) { setPwMsg({ ok: false, text: "Passwords do not match." }); return; }
    if (newPw.length < 8)   { setPwMsg({ ok: false, text: "Password must be at least 8 characters." }); return; }
    setSavingPw(true);
    setPwMsg(null);
    const res = await apiFetch<{ ok?: boolean; error?: string }>("/api/settings/password", {
      method: "PUT",
      body: JSON.stringify({ current_password: currentPw, new_password: newPw }),
    });
    setSavingPw(false);
    if (res.error) setPwMsg({ ok: false, text: res.error });
    else { setPwMsg({ ok: true, text: "Password changed successfully." }); setCurrentPw(""); setNewPw(""); setConfirmPw(""); }
  };

  if (loading || !user) return null;

  return (
    <StudioShell view="settings">
      <h1 className="font-display text-3xl font-semibold sm:text-4xl">Settings</h1>
      <p className="mt-2 text-sm text-muted-foreground">Manage your profile and account security.</p>

      <div className="mt-10 grid gap-8 lg:grid-cols-2">
        {/* ── Profile ──────────────────────────────────────────────── */}
        <section className="rounded-2xl border border-border bg-card p-6">
          <div className="mb-5 flex items-center gap-2">
            <User size={18} className="text-accent" />
            <h2 className="font-display text-xl font-semibold">Profile</h2>
          </div>

          <form onSubmit={e => void saveProfile(e)} className="space-y-4">
            <div>
              <label className="text-sm font-medium">Username</label>
              <input
                value={user.username}
                disabled
                className="mt-1.5 w-full rounded-lg border border-input bg-secondary px-3 py-2.5 text-sm text-muted-foreground"
              />
              <p className="mt-1 text-xs text-muted-foreground">Username cannot be changed.</p>
            </div>
            <div>
              <label className="text-sm font-medium">Full name</label>
              <input
                value={fullName}
                onChange={e => setFullName(e.target.value)}
                maxLength={80}
                placeholder="Your full name"
                className="mt-1.5 w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Email address</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                className="mt-1.5 w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Role</label>
              <input
                value={user.role}
                disabled
                className="mt-1.5 w-full rounded-lg border border-input bg-secondary px-3 py-2.5 text-sm text-muted-foreground capitalize"
              />
            </div>

            {profileMsg && (
              <p className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
                profileMsg.ok
                  ? "border-green-500/30 bg-green-500/10 text-green-600 dark:text-green-400"
                  : "border-destructive/30 bg-destructive/10 text-destructive"
              }`}>
                {profileMsg.ok && <Check size={14} />}
                {profileMsg.text}
              </p>
            )}

            <Button type="submit" disabled={savingProfile} className="w-full">
              {savingProfile ? <Loader2 className="animate-spin" /> : null}
              {savingProfile ? "Saving…" : "Save profile"}
            </Button>
          </form>
        </section>

        {/* ── Password ─────────────────────────────────────────────── */}
        <section className="rounded-2xl border border-border bg-card p-6">
          <div className="mb-5 flex items-center gap-2">
            <KeyRound size={18} className="text-accent" />
            <h2 className="font-display text-xl font-semibold">Change password</h2>
          </div>

          <form onSubmit={e => void savePassword(e)} className="space-y-4">
            {!user.must_change_password && (
              <div>
                <label className="text-sm font-medium">Current password</label>
                <input
                  type="password"
                  value={currentPw}
                  onChange={e => setCurrentPw(e.target.value)}
                  required
                  placeholder="••••••••"
                  autoComplete="current-password"
                  className="mt-1.5 w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
                />
              </div>
            )}
            <div>
              <label className="text-sm font-medium">New password</label>
              <input
                type="password"
                value={newPw}
                onChange={e => setNewPw(e.target.value)}
                required
                minLength={8}
                placeholder="••••••••"
                autoComplete="new-password"
                className="mt-1.5 w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Confirm new password</label>
              <input
                type="password"
                value={confirmPw}
                onChange={e => setConfirmPw(e.target.value)}
                required
                placeholder="••••••••"
                autoComplete="new-password"
                className="mt-1.5 w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
              />
            </div>

            {pwMsg && (
              <p className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
                pwMsg.ok
                  ? "border-green-500/30 bg-green-500/10 text-green-600 dark:text-green-400"
                  : "border-destructive/30 bg-destructive/10 text-destructive"
              }`}>
                {pwMsg.ok && <Check size={14} />}
                {pwMsg.text}
              </p>
            )}

            <Button type="submit" disabled={savingPw} className="w-full">
              {savingPw ? <Loader2 className="animate-spin" /> : null}
              {savingPw ? "Saving…" : "Change password"}
            </Button>
          </form>
        </section>
      </div>
    </StudioShell>
  );
}
