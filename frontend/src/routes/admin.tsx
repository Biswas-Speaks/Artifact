import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Check, Loader2, Plus, RefreshCw, ShieldCheck, Trash2, UserCheck, UserX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/lib/auth";
import { StudioShell } from "@/components/StudioShell";

export const Route = createFileRoute("/admin")({
  component: AdminPage,
});

interface AdminUser {
  id: string;
  username: string;
  email: string;
  full_name: string;
  role: "admin" | "user";
  active: boolean;
  created_at: string;
}

async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(opts?.headers ?? {}) },
    ...opts,
  });
  return res.json() as Promise<T>;
}

function AdminPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [fetching, setFetching] = useState(true);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  // New user dialog
  const [newUserOpen, setNewUserOpen] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const [newEmail, setNewEmail]       = useState("");
  const [newFullName, setNewFullName] = useState("");
  const [newRole, setNewRole]         = useState<"user" | "admin">("user");
  const [creating, setCreating]       = useState(false);
  const [createError, setCreateError] = useState("");

  useEffect(() => {
    document.title = "Admin — Biswa Artifacts";
    if (!loading) {
      if (!user) { void navigate({ to: "/login" }); return; }
      if (user.role !== "admin") { void navigate({ to: "/artifacts" }); return; }
    }
  }, [user, loading, navigate]);

  const loadUsers = async () => {
    setFetching(true);
    const res = await apiFetch<{ users?: AdminUser[]; error?: string }>("/api/admin/users");
    setFetching(false);
    if (res.users) setUsers(res.users);
  };

  useEffect(() => { if (user?.role === "admin") void loadUsers(); }, [user]);

  const showNotice = (ok: boolean, text: string) => {
    setNotice({ ok, text });
    setTimeout(() => setNotice(null), 4000);
  };

  /* ── Toggle active ───────────────────────────────────────────────── */
  const toggleActive = async (u: AdminUser) => {
    const res = await apiFetch<{ active?: boolean; error?: string }>(
      `/api/admin/users/${u.id}/active`,
      { method: "PATCH", body: JSON.stringify({ active: !u.active }) }
    );
    if (res.error) { showNotice(false, res.error); return; }
    setUsers(prev => prev.map(x => x.id === u.id ? { ...x, active: !u.active } : x));
    showNotice(true, `${u.username} is now ${!u.active ? "active" : "inactive"}.`);
  };

  /* ── Delete user ─────────────────────────────────────────────────── */
  const deleteUser = async (u: AdminUser) => {
    if (!confirm(`Delete user "${u.username}"? All their data will be removed.`)) return;
    const res = await apiFetch<{ ok?: boolean; error?: string }>(
      `/api/admin/users/${u.id}`, { method: "DELETE" }
    );
    if (res.error) { showNotice(false, res.error); return; }
    setUsers(prev => prev.filter(x => x.id !== u.id));
    showNotice(true, `User "${u.username}" deleted.`);
  };

  /* ── Reset password (sends welcome email with temp pw) ───────────── */
  const resetPassword = async (u: AdminUser) => {
    if (!confirm(`Send a password reset email to ${u.email}?`)) return;
    const res = await apiFetch<{ ok?: boolean; error?: string }>(
      "/api/auth/forgot", { method: "POST", body: JSON.stringify({ email: u.email }) }
    );
    if (res.error) { showNotice(false, res.error); return; }
    showNotice(true, `Reset email sent to ${u.email}.`);
  };

  /* ── Create user ─────────────────────────────────────────────────── */
  const createUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError("");
    setCreating(true);
    const res = await apiFetch<AdminUser & { error?: string }>("/api/admin/users", {
      method: "POST",
      body: JSON.stringify({ username: newUsername, email: newEmail, full_name: newFullName, role: newRole }),
    });
    setCreating(false);
    if (res.error) { setCreateError(res.error); return; }
    setUsers(prev => [...prev, res as AdminUser]);
    setNewUserOpen(false);
    setNewUsername(""); setNewEmail(""); setNewFullName(""); setNewRole("user");
    showNotice(true, `User "${res.username}" created. Welcome email sent.`);
  };

  if (loading || !user) return null;
  if (user.role !== "admin") return null;

  return (
    <StudioShell view="admin">
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheck size={20} className="text-accent" />
            <h1 className="font-display text-3xl font-semibold sm:text-4xl">Admin</h1>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            Manage all user accounts. {users.length} total.
          </p>
        </div>
        <Button onClick={() => { setNewUserOpen(true); setCreateError(""); }}>
          <Plus /> Create user
        </Button>
      </div>

      {notice && (
        <div className={`mt-6 flex items-center gap-2 rounded-lg border px-4 py-3 text-sm ${
          notice.ok
            ? "border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-400"
            : "border-destructive/30 bg-destructive/10 text-destructive"
        }`}>
          {notice.ok && <Check size={14} />}
          {notice.text}
        </div>
      )}

      {/* ── User table ─────────────────────────────────────────────── */}
      <div className="mt-8 overflow-hidden rounded-2xl border border-border">
        {fetching ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="animate-spin text-accent" size={28} />
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-secondary/50">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">User</th>
                <th className="hidden px-4 py-3 text-left font-medium text-muted-foreground md:table-cell">Email</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Role</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Status</th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {users.map(u => (
                <tr key={u.id} className={`transition-colors hover:bg-secondary/30 ${!u.active ? "opacity-50" : ""}`}>
                  <td className="px-4 py-3">
                    <p className="font-medium">{u.full_name || u.username}</p>
                    <p className="font-mono text-xs text-muted-foreground">@{u.username}</p>
                  </td>
                  <td className="hidden px-4 py-3 text-muted-foreground md:table-cell">{u.email}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                      u.role === "admin" ? "bg-accent/20 text-accent" : "bg-secondary text-muted-foreground"
                    }`}>
                      {u.role}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                      u.active ? "bg-green-500/15 text-green-600 dark:text-green-400" : "bg-red-500/15 text-red-600 dark:text-red-400"
                    }`}>
                      {u.active ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      {/* Toggle active */}
                      <Button
                        variant="ghost" size="icon"
                        title={u.active ? "Deactivate user" : "Activate user"}
                        disabled={u.id === user.id}
                        onClick={() => void toggleActive(u)}
                      >
                        {u.active ? <UserX size={15} /> : <UserCheck size={15} />}
                      </Button>
                      {/* Reset password */}
                      <Button
                        variant="ghost" size="icon"
                        title="Send password reset email"
                        onClick={() => void resetPassword(u)}
                      >
                        <RefreshCw size={15} />
                      </Button>
                      {/* Delete */}
                      <Button
                        variant="ghost" size="icon"
                        title="Delete user"
                        disabled={u.id === user.id}
                        className="text-destructive hover:bg-destructive/10"
                        onClick={() => void deleteUser(u)}
                      >
                        <Trash2 size={15} />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-16 text-center text-muted-foreground">No users found.</td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Create user dialog ──────────────────────────────────────── */}
      <Dialog open={newUserOpen} onOpenChange={setNewUserOpen}>
        <DialogContent className="max-w-md">
          <DialogTitle className="flex items-center gap-2">
            <Plus size={18} className="text-accent" /> Create user
          </DialogTitle>
          <DialogDescription>
            A temporary password will be generated and emailed to the user. They must change it on first login.
          </DialogDescription>

          <form onSubmit={e => void createUser(e)} className="space-y-4 pt-2">
            <div>
              <label className="text-sm font-medium">Username</label>
              <input
                required value={newUsername} onChange={e => setNewUsername(e.target.value)}
                pattern="[a-zA-Z0-9_.\-]{3,30}" title="3–30 characters, letters/numbers/. _ -"
                placeholder="john_doe"
                className="mt-1.5 w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Email</label>
              <input
                type="email" required value={newEmail} onChange={e => setNewEmail(e.target.value)}
                placeholder="john@example.com"
                className="mt-1.5 w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Full name <span className="text-muted-foreground">(optional)</span></label>
              <input
                value={newFullName} onChange={e => setNewFullName(e.target.value)}
                placeholder="John Doe"
                className="mt-1.5 w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Role</label>
              <select
                value={newRole} onChange={e => setNewRole(e.target.value as "user" | "admin")}
                className="mt-1.5 w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-accent"
              >
                <option value="user">User</option>
                <option value="admin">Admin</option>
              </select>
            </div>

            {createError && (
              <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {createError}
              </p>
            )}

            <div className="flex gap-2 pt-1">
              <Button type="button" variant="outline" className="flex-1" onClick={() => setNewUserOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={creating} className="flex-1">
                {creating ? <Loader2 className="animate-spin" /> : <Plus size={14} />}
                {creating ? "Creating…" : "Create user"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </StudioShell>
  );
}
