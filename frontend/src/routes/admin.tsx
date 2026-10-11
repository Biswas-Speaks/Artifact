import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  Check, CheckCircle2, Clock, ExternalLink, Loader2, Plus, RefreshCw,
  ShieldCheck, ShieldX, Trash2, UserCheck, UserX, X, AlertTriangle,
  Globe, FileText, Users as UsersIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/lib/auth";
import { StudioShell } from "@/components/StudioShell";

export const Route = createFileRoute("/admin")({
  component: AdminPage,
});

type AdminTab = "pending" | "reports" | "artifacts" | "users";

/* ── Types ────────────────────────────────────────────────────────────── */
interface AdminUser {
  id: string;
  username: string;
  email: string;
  full_name: string;
  role: "admin" | "user";
  active: boolean;
  trusted: boolean;
  banned: boolean;
  email_verified: boolean;
  is_admin: boolean;
  created_at: string;
}

interface AdminArtifact {
  id: string;
  name: string;
  type: string;
  subdomain: string | null;
  status: string;
  review_status: string;
  updated_at: string;
  published_at: string | null;
  username: string;
  email: string;
}

interface AdminReport {
  id: string;
  reason: string;
  message: string;
  created_at: string;
  status: string;
  artifact_id: string;
  artifact_name: string;
  subdomain: string | null;
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

function AdminPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  const [tab, setTab] = useState<AdminTab>("pending");
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [fetching, setFetching] = useState(false);

  // Data
  const [users, setUsers]         = useState<AdminUser[]>([]);
  const [artifacts, setArtifacts] = useState<AdminArtifact[]>([]);
  const [pending, setPending]     = useState<AdminArtifact[]>([]);
  const [reports, setReports]     = useState<AdminReport[]>([]);

  // New user dialog
  const [newUserOpen,   setNewUserOpen]   = useState(false);
  const [newUsername,   setNewUsername]   = useState("");
  const [newEmail,      setNewEmail]      = useState("");
  const [newFullName,   setNewFullName]   = useState("");
  const [newRole,       setNewRole]       = useState<"user" | "admin">("user");
  const [creating,      setCreating]      = useState(false);
  const [createError,   setCreateError]   = useState("");

  useEffect(() => {
    document.title = "Admin — Biswa Artifacts";
    if (!loading) {
      if (!user) { void navigate({ to: "/login" }); return; }
      if (!user.is_admin) { void navigate({ to: "/artifacts" }); return; }
    }
  }, [user, loading, navigate]);

  const showNotice = (ok: boolean, text: string) => {
    setNotice({ ok, text });
    setTimeout(() => setNotice(null), 5000);
  };

  /* ── Data loading ────────────────────────────────────────────────── */
  const loadTab = async (t: AdminTab) => {
    setFetching(true);
    try {
      if (t === "users") {
        const r = await apiFetch<{ users: AdminUser[] }>("/api/admin/users");
        setUsers(r.users ?? []);
      } else if (t === "artifacts") {
        const r = await apiFetch<{ artifacts: AdminArtifact[] }>("/api/admin/artifacts");
        setArtifacts(r.artifacts ?? []);
      } else if (t === "pending") {
        const r = await apiFetch<{ artifacts: AdminArtifact[] }>("/api/admin/pending");
        setPending(r.artifacts ?? []);
      } else if (t === "reports") {
        const r = await apiFetch<{ reports: AdminReport[] }>("/api/admin/reports");
        setReports(r.reports ?? []);
      }
    } catch { showNotice(false, "Failed to load data"); }
    finally { setFetching(false); }
  };

  useEffect(() => {
    if (user?.is_admin) void loadTab(tab);
  }, [user, tab]);

  /* ── User actions ────────────────────────────────────────────────── */
  const toggleActive = async (u: AdminUser) => {
    const res = await apiFetch<{ active?: boolean; error?: string }>(
      `/api/admin/users/${u.id}/active`,
      { method: "PATCH", body: JSON.stringify({ active: !u.active }) }
    );
    if (res.error) { showNotice(false, res.error); return; }
    setUsers(prev => prev.map(x => x.id === u.id ? { ...x, active: !u.active } : x));
    showNotice(true, `${u.username} is now ${!u.active ? "active" : "inactive"}.`);
  };

  const toggleBan = async (u: AdminUser) => {
    const banning = !u.banned;
    if (banning && !confirm(`Ban user "${u.username}"? All their artifacts will be suspended.`)) return;
    const res = await apiFetch<{ ok?: boolean; error?: string }>(
      `/api/admin/users/${u.id}/ban`,
      { method: "PATCH", body: JSON.stringify({ banned: banning }) }
    );
    if (res.error) { showNotice(false, res.error); return; }
    setUsers(prev => prev.map(x => x.id === u.id ? { ...x, banned: banning } : x));
    showNotice(true, `${u.username} ${banning ? "banned" : "unbanned"}.`);
  };

  const deleteUser = async (u: AdminUser) => {
    if (!confirm(`Delete user "${u.username}"? All their data will be removed.`)) return;
    const res = await apiFetch<{ ok?: boolean; error?: string }>(
      `/api/admin/users/${u.id}`, { method: "DELETE" }
    );
    if (res.error) { showNotice(false, res.error); return; }
    setUsers(prev => prev.filter(x => x.id !== u.id));
    showNotice(true, `User "${u.username}" deleted.`);
  };

  const resetPassword = async (u: AdminUser) => {
    if (!confirm(`Send a password reset email to ${u.email}?`)) return;
    await apiFetch<{ ok?: boolean }>("/api/auth/forgot", {
      method: "POST", body: JSON.stringify({ email: u.email }),
    });
    showNotice(true, `Reset email sent to ${u.email}.`);
  };

  const createUser = async (e: React.FormEvent) => {
    e.preventDefault(); setCreateError(""); setCreating(true);
    const res = await apiFetch<AdminUser & { error?: string }>("/api/admin/users", {
      method: "POST",
      body: JSON.stringify({ username: newUsername, email: newEmail, full_name: newFullName, role: newRole }),
    });
    setCreating(false);
    if (res.error) { setCreateError(res.error); return; }
    setUsers(prev => [...prev, res as AdminUser]);
    setNewUserOpen(false);
    setNewUsername(""); setNewEmail(""); setNewFullName(""); setNewRole("user");
    showNotice(true, `User "${res.username}" created.`);
  };

  /* ── Artifact actions ────────────────────────────────────────────── */
  const approveArtifact = async (id: string) => {
    const res = await apiFetch<{ ok?: boolean; error?: string }>(
      `/api/admin/artifacts/${id}/approve`, { method: "POST" }
    );
    if (res.error) { showNotice(false, res.error); return; }
    setPending(prev => prev.filter(a => a.id !== id));
    setArtifacts(prev => prev.map(a => a.id === id ? { ...a, status: "published", review_status: "approved" } : a));
    showNotice(true, "Artifact approved and published.");
  };

  const suspendArtifact = async (id: string) => {
    if (!confirm("Suspend this artifact?")) return;
    const res = await apiFetch<{ ok?: boolean; error?: string }>(
      `/api/admin/artifacts/${id}/suspend`, { method: "POST" }
    );
    if (res.error) { showNotice(false, res.error); return; }
    setArtifacts(prev => prev.map(a => a.id === id ? { ...a, status: "suspended" } : a));
    showNotice(true, "Artifact suspended.");
  };

  const restoreArtifact = async (id: string) => {
    const res = await apiFetch<{ ok?: boolean; error?: string }>(
      `/api/admin/artifacts/${id}/restore`, { method: "POST" }
    );
    if (res.error) { showNotice(false, res.error); return; }
    setArtifacts(prev => prev.map(a => a.id === id ? { ...a, status: "published", review_status: "approved" } : a));
    showNotice(true, "Artifact restored.");
  };

  const deleteArtifact = async (id: string) => {
    if (!confirm("Delete this artifact permanently?")) return;
    await apiFetch(`/api/admin/artifacts/${id}`, { method: "DELETE" });
    setArtifacts(prev => prev.filter(a => a.id !== id));
    showNotice(true, "Artifact deleted.");
  };

  /* ── Report actions ──────────────────────────────────────────────── */
  const closeReport = async (id: string) => {
    await apiFetch(`/api/admin/reports/${id}/close`, { method: "PATCH" });
    setReports(prev => prev.map(r => r.id === id ? { ...r, status: "closed" } : r));
  };

  if (loading || !user) return null;
  if (!user.is_admin) return null;

  const TABS: { id: AdminTab; label: string; icon: React.ReactNode }[] = [
    { id: "pending",   label: `Pending (${pending.length})`, icon: <Clock size={14} /> },
    { id: "reports",   label: `Reports (${reports.filter(r => r.status === "open").length})`, icon: <AlertTriangle size={14} /> },
    { id: "artifacts", label: "All artifacts", icon: <Globe size={14} /> },
    { id: "users",     label: "Users", icon: <UsersIcon size={14} /> },
  ];

  return (
    <StudioShell view="admin">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div className="flex items-center gap-2">
          <ShieldCheck size={20} className="text-accent" />
          <h1 className="font-display text-3xl font-semibold sm:text-4xl">Admin</h1>
        </div>
        {tab === "users" && (
          <Button onClick={() => { setNewUserOpen(true); setCreateError(""); }}>
            <Plus /> Create user
          </Button>
        )}
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

      {/* Tab bar */}
      <div className="mt-6 flex gap-2 border-b border-border pb-px">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 rounded-t-md px-4 py-2.5 text-sm font-medium transition-colors ${
              tab === t.id
                ? "border-b-2 border-accent text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}>
            {t.icon}{t.label}
          </button>
        ))}
        <button onClick={() => void loadTab(tab)} className="ml-auto p-2 text-muted-foreground hover:text-foreground" title="Refresh">
          <RefreshCw size={14} className={fetching ? "animate-spin" : ""} />
        </button>
      </div>

      {/* ── Pending approvals ─────────────────────────────────────── */}
      {tab === "pending" && (
        <div className="mt-6">
          {fetching ? (
            <div className="flex justify-center py-20"><Loader2 className="animate-spin text-accent" size={28} /></div>
          ) : pending.length === 0 ? (
            <div className="py-16 text-center">
              <CheckCircle2 className="mx-auto mb-3 text-green-500" size={32} />
              <p className="text-muted-foreground">No artifacts awaiting review.</p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-2xl border border-border">
              <table className="w-full text-sm">
                <thead className="bg-secondary/50">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Artifact</th>
                    <th className="hidden px-4 py-3 text-left font-medium text-muted-foreground md:table-cell">Author</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Subdomain</th>
                    <th className="px-4 py-3 text-right font-medium text-muted-foreground">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {pending.map(a => (
                    <tr key={a.id} className="hover:bg-secondary/30">
                      <td className="px-4 py-3 font-medium">{a.name}</td>
                      <td className="hidden px-4 py-3 text-muted-foreground md:table-cell">{a.username}</td>
                      <td className="px-4 py-3 font-mono text-xs text-accent">{a.subdomain}</td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-2">
                          <Button size="sm" onClick={() => void approveArtifact(a.id)}
                            className="bg-green-600 hover:bg-green-500 text-white">
                            <Check size={13} /> Approve
                          </Button>
                          <Button size="sm" variant="outline"
                            className="text-destructive hover:bg-destructive/10"
                            onClick={() => void suspendArtifact(a.id)}>
                            <X size={13} /> Reject
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Reports ───────────────────────────────────────────────── */}
      {tab === "reports" && (
        <div className="mt-6">
          {fetching ? (
            <div className="flex justify-center py-20"><Loader2 className="animate-spin text-accent" size={28} /></div>
          ) : reports.length === 0 ? (
            <p className="py-16 text-center text-muted-foreground">No reports yet.</p>
          ) : (
            <div className="overflow-hidden rounded-2xl border border-border">
              <table className="w-full text-sm">
                <thead className="bg-secondary/50">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Artifact</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Reason</th>
                    <th className="hidden px-4 py-3 text-left font-medium text-muted-foreground md:table-cell">Details</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Status</th>
                    <th className="px-4 py-3 text-right font-medium text-muted-foreground">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {reports.map(r => (
                    <tr key={r.id} className={`hover:bg-secondary/30 ${r.status === "closed" ? "opacity-50" : ""}`}>
                      <td className="px-4 py-3">
                        <p className="font-medium">{r.artifact_name}</p>
                        {r.subdomain && (
                          <a href={`https://${r.subdomain}.biswa.io`} target="_blank" rel="noreferrer"
                            className="flex items-center gap-1 font-mono text-xs text-accent hover:underline">
                            <ExternalLink size={9} />{r.subdomain}.biswa.io
                          </a>
                        )}
                      </td>
                      <td className="px-4 py-3 capitalize">{r.reason}</td>
                      <td className="hidden px-4 py-3 text-muted-foreground md:table-cell max-w-xs truncate">
                        {r.message || <span className="italic text-muted-foreground/50">—</span>}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2 py-0.5 text-xs ${
                          r.status === "open"
                            ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                            : "bg-secondary text-muted-foreground"
                        }`}>
                          {r.status}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-2">
                          {r.status === "open" && (
                            <>
                              <Button size="sm" variant="outline"
                                onClick={() => void suspendArtifact(r.artifact_id)}
                                className="text-destructive hover:bg-destructive/10">
                                <ShieldX size={12} /> Suspend
                              </Button>
                              <Button size="sm" variant="ghost" onClick={() => void closeReport(r.id)}>
                                <Check size={12} /> Close
                              </Button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── All artifacts ─────────────────────────────────────────── */}
      {tab === "artifacts" && (
        <div className="mt-6">
          {fetching ? (
            <div className="flex justify-center py-20"><Loader2 className="animate-spin text-accent" size={28} /></div>
          ) : artifacts.length === 0 ? (
            <p className="py-16 text-center text-muted-foreground">No artifacts found.</p>
          ) : (
            <div className="overflow-hidden rounded-2xl border border-border">
              <table className="w-full text-sm">
                <thead className="bg-secondary/50">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Artifact</th>
                    <th className="hidden px-4 py-3 text-left font-medium text-muted-foreground md:table-cell">Author</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Status</th>
                    <th className="px-4 py-3 text-right font-medium text-muted-foreground">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {artifacts.map(a => (
                    <tr key={a.id} className="hover:bg-secondary/30">
                      <td className="px-4 py-3">
                        <p className="font-medium">{a.name}</p>
                        {a.subdomain && a.status === "published" && (
                          <a href={`https://${a.subdomain}.biswa.io`} target="_blank" rel="noreferrer"
                            className="flex items-center gap-1 font-mono text-xs text-accent hover:underline">
                            <Globe size={9} />{a.subdomain}.biswa.io
                          </a>
                        )}
                      </td>
                      <td className="hidden px-4 py-3 text-muted-foreground md:table-cell">{a.username}</td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2.5 py-0.5 text-xs ${
                          a.status === "published"  ? "bg-green-500/15 text-green-700 dark:text-green-400" :
                          a.status === "suspended"  ? "bg-destructive/20 text-destructive" :
                          a.review_status === "pending" ? "bg-amber-500/15 text-amber-600 dark:text-amber-400" :
                          "bg-secondary text-muted-foreground"
                        }`}>
                          {a.review_status === "pending" ? "pending" : a.status}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-1">
                          {a.status === "suspended" ? (
                            <Button variant="ghost" size="sm" onClick={() => void restoreArtifact(a.id)}
                              className="text-green-600">
                              <CheckCircle2 size={13} /> Restore
                            </Button>
                          ) : (
                            <Button variant="ghost" size="sm" onClick={() => void suspendArtifact(a.id)}
                              className="text-destructive hover:bg-destructive/10">
                              <ShieldX size={13} /> Suspend
                            </Button>
                          )}
                          <Button variant="ghost" size="icon"
                            className="text-destructive hover:bg-destructive/10"
                            onClick={() => void deleteArtifact(a.id)}>
                            <Trash2 size={14} />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Users ─────────────────────────────────────────────────── */}
      {tab === "users" && (
        <div className="mt-6">
          {fetching ? (
            <div className="flex justify-center py-20"><Loader2 className="animate-spin text-accent" size={28} /></div>
          ) : (
            <div className="overflow-hidden rounded-2xl border border-border">
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
                    <tr key={u.id} className={`transition-colors hover:bg-secondary/30 ${!u.active || u.banned ? "opacity-60" : ""}`}>
                      <td className="px-4 py-3">
                        <p className="font-medium">{u.full_name || u.username}</p>
                        <p className="font-mono text-xs text-muted-foreground">@{u.username}</p>
                        {!u.email_verified && (
                          <span className="text-[10px] text-amber-500">unverified</span>
                        )}
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
                        {u.banned ? (
                          <span className="rounded-full bg-destructive/15 px-2.5 py-0.5 text-xs font-medium text-destructive">Banned</span>
                        ) : u.active ? (
                          <span className="rounded-full bg-green-500/15 px-2.5 py-0.5 text-xs font-medium text-green-600 dark:text-green-400">Active</span>
                        ) : (
                          <span className="rounded-full bg-secondary px-2.5 py-0.5 text-xs font-medium text-muted-foreground">Inactive</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <Button variant="ghost" size="icon" title={u.active ? "Deactivate" : "Activate"}
                            disabled={u.id === user.id} onClick={() => void toggleActive(u)}>
                            {u.active ? <UserX size={15} /> : <UserCheck size={15} />}
                          </Button>
                          <Button variant="ghost" size="icon"
                            title={u.banned ? "Unban user" : "Ban user"}
                            disabled={u.id === user.id}
                            className={u.banned ? "text-green-600" : "text-destructive hover:bg-destructive/10"}
                            onClick={() => void toggleBan(u)}>
                            {u.banned ? <ShieldCheck size={15} /> : <ShieldX size={15} />}
                          </Button>
                          <Button variant="ghost" size="icon" title="Send password reset"
                            onClick={() => void resetPassword(u)}>
                            <RefreshCw size={15} />
                          </Button>
                          <Button variant="ghost" size="icon" title="Delete user"
                            disabled={u.id === user.id}
                            className="text-destructive hover:bg-destructive/10"
                            onClick={() => void deleteUser(u)}>
                            <Trash2 size={15} />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {users.length === 0 && (
                    <tr><td colSpan={5} className="py-16 text-center text-muted-foreground">No users found.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

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
              <input required value={newUsername} onChange={e => setNewUsername(e.target.value)}
                pattern="[a-zA-Z0-9_.\-]{3,30}" title="3–30 characters, letters/numbers/. _ -"
                placeholder="john_doe"
                className="mt-1.5 w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/30" />
            </div>
            <div>
              <label className="text-sm font-medium">Email</label>
              <input type="email" required value={newEmail} onChange={e => setNewEmail(e.target.value)}
                placeholder="john@example.com"
                className="mt-1.5 w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/30" />
            </div>
            <div>
              <label className="text-sm font-medium">Full name <span className="text-muted-foreground">(optional)</span></label>
              <input value={newFullName} onChange={e => setNewFullName(e.target.value)}
                placeholder="John Doe"
                className="mt-1.5 w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/30" />
            </div>
            <div>
              <label className="text-sm font-medium">Role</label>
              <select value={newRole} onChange={e => setNewRole(e.target.value as "user" | "admin")}
                className="mt-1.5 w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-accent">
                <option value="user">User</option>
                <option value="admin">Admin</option>
              </select>
            </div>

            {createError && (
              <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{createError}</p>
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
