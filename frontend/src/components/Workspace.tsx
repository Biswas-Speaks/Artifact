import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { Check, Copy, ExternalLink, FileText, Globe, Layers, Lock, Plus, Search, Trash2, Upload, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { useAuth } from '@/lib/auth';
import { StudioShell, STUDIO_TABS } from './StudioShell';

export type WorkspaceView = 'artifacts' | 'published' | 'drafts' | 'files' | 'images';

/* ── Types ────────────────────────────────────────────────────────────── */
interface ArtifactItem {
  id: string;
  name: string;
  type: string;
  subdomain: string | null;
  status: 'published' | 'draft';
  locked: boolean;
  updated_at: string;
}
interface FileItem  { id: string; name: string; size: number; created_at: string; link: string }
interface ImageItem { id: string; name: string; url: string }

/* ── API helper ───────────────────────────────────────────────────────── */
async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(opts?.headers ?? {}) },
    ...opts,
  });
  return res.json() as Promise<T>;
}

/* ── Copy helper with fallback ────────────────────────────────────────── */
async function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard) {
    try { await navigator.clipboard.writeText(text); return true; } catch { /* fall through */ }
  }
  // Fallback: create a temporary textarea
  const el = document.createElement('textarea');
  el.value = text;
  el.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0';
  document.body.appendChild(el);
  el.focus(); el.select();
  const ok = document.execCommand('copy');
  document.body.removeChild(el);
  return ok;
}

/* ══════════════════════════════════════════════════════════════════════ */

export function Workspace({ view }: { view: WorkspaceView }) {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [notice, setNotice] = useState('');
  const [copied, setCopied] = useState('');

  // Artifact state
  const [artifacts, setArtifacts] = useState<ArtifactItem[]>([]);
  const [newDraft, setNewDraft] = useState(false);
  const [title, setTitle] = useState('');

  // Publish dialog state
  const [publishTarget, setPublishTarget] = useState<ArtifactItem | null>(null);
  const [subdomain, setSubdomain] = useState('');
  const [protect, setProtect] = useState(false);
  const [password, setPassword] = useState('');
  const [publishError, setPublishError] = useState('');
  const [publishing, setPublishing] = useState(false);

  // File/image state
  const [files, setFiles] = useState<FileItem[]>([]);
  const [images, setImages] = useState<ImageItem[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);

  const assetView = view === 'files' || view === 'images';
  const heading = STUDIO_TABS.find(t => t.to === `/${view}`)?.heading ?? 'My artifacts';

  // Auth guard
  useEffect(() => {
    if (!loading && !user) void navigate({ to: '/login' });
  }, [user, loading, navigate]);

  // Load data
  useEffect(() => {
    if (!user) return;
    if (view === 'files') {
      apiFetch<{ items: FileItem[] }>('/api/files').then(d => setFiles(d.items)).catch(() => setNotice('Failed to load files'));
    } else if (view === 'images') {
      apiFetch<{ items: ImageItem[] }>('/api/images').then(d => setImages(d.items)).catch(() => setNotice('Failed to load images'));
    } else {
      apiFetch<{ items: ArtifactItem[] }>('/api/artifacts').then(d => setArtifacts(d.items)).catch(() => setNotice('Failed to load artifacts'));
    }
  }, [view, user]);

  const matches = (s: string) => s.toLowerCase().includes(search.toLowerCase());

  /* ── Artifacts ──────────────────────────────────────────────────────── */
  const visibleArtifacts = artifacts.filter(a => {
    const statusOk = view === 'artifacts' || (view === 'published' && a.status === 'published') || (view === 'drafts' && a.status === 'draft');
    return statusOk && matches(a.name);
  });

  const createArtifact = async () => {
    if (!title.trim()) return;
    const res = await apiFetch<{ id?: string; error?: string }>('/api/artifacts', {
      method: 'POST', body: JSON.stringify({ name: title.trim(), type: 'web' }),
    });
    if (res.id) { setNewDraft(false); void navigate({ to: '/editor/$slug', params: { slug: res.id } }); }
    else setNotice(res.error ?? 'Failed to create artifact');
  };

  const deleteArtifact = async (id: string, name: string) => {
    if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;
    await apiFetch(`/api/artifacts/${id}`, { method: 'DELETE' });
    setArtifacts(prev => prev.filter(a => a.id !== id));
    setNotice(`"${name}" deleted.`);
  };

  // Open publish dialog
  const openPublish = (item: ArtifactItem) => {
    setPublishTarget(item);
    setSubdomain(item.subdomain ?? item.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40));
    setProtect(item.locked);
    setPassword('');
    setPublishError('');
  };

  const doPublish = async () => {
    if (!publishTarget) return;
    setPublishError('');
    setPublishing(true);
    const res = await apiFetch<{ ok?: boolean; subdomain?: string; locked?: boolean; error?: string }>(
      `/api/artifacts/${publishTarget.id}/publish`,
      { method: 'POST', body: JSON.stringify({ subdomain, protect, password }) }
    );
    setPublishing(false);
    if (res.error) { setPublishError(res.error); return; }
    setArtifacts(prev => prev.map(a => a.id === publishTarget.id
      ? { ...a, status: 'published', subdomain: res.subdomain ?? subdomain, locked: res.locked ?? protect }
      : a
    ));
    setPublishTarget(null);
    setNotice(`Published at ${subdomain}.biswa.io${protect ? ' 🔒' : ''}`);
  };

  const doUnpublish = async (id: string) => {
    await apiFetch(`/api/artifacts/${id}/unpublish`, { method: 'POST' });
    setArtifacts(prev => prev.map(a => a.id === id ? { ...a, status: 'draft', subdomain: null, locked: false } : a));
    setNotice('Artifact unpublished.');
  };

  /* ── Files ──────────────────────────────────────────────────────────── */
  const visibleFiles = files.filter(f => matches(f.name));

  const uploadFile = async (file: File) => {
    if (file.size > 200 * 1024 * 1024) { setNotice(`${file.name} exceeds 200 MB`); return; }
    const presign = await apiFetch<{ id?: string; url?: string; error?: string }>('/api/files/presign', {
      method: 'POST', body: JSON.stringify({ name: file.name, size: file.size, type: file.type }),
    });
    if (!presign.url) { setNotice(presign.error ?? 'Could not get upload URL'); return; }
    await fetch(presign.url, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });
    const data = await apiFetch<{ items: FileItem[] }>('/api/files');
    setFiles(data.items);
    setNotice(`${file.name} uploaded.`);
  };

  const deleteFile = async (id: string) => {
    await apiFetch(`/api/files/${id}`, { method: 'DELETE' });
    setFiles(prev => prev.filter(f => f.id !== id));
  };

  /* ── Images ─────────────────────────────────────────────────────────── */
  const visibleImages = images.filter(i => matches(i.name));

  const uploadImage = async (file: File) => {
    if (!file.type.startsWith('image/')) { setNotice('Choose an image file.'); return; }
    if (file.size > 10 * 1024 * 1024) { setNotice(`${file.name} exceeds 10 MB`); return; }
    const form = new FormData();
    form.append('file', file);
    const res = await fetch('/api/images', { method: 'POST', credentials: 'include', body: form });
    const json = await res.json() as ImageItem & { error?: string };
    if (!res.ok) { setNotice(json.error ?? 'Upload failed'); return; }
    setImages(prev => [json, ...prev]);
    setNotice(`${json.name} uploaded.`);
  };

  const deleteImage = async (id: string) => {
    await apiFetch(`/api/images/${id}`, { method: 'DELETE' });
    setImages(prev => prev.filter(i => i.id !== id));
  };

  const handleFiles = (fileList: FileList | null) => {
    if (!fileList) return;
    Array.from(fileList).forEach(f => { if (view === 'images') void uploadImage(f); else void uploadFile(f); });
  };

  const copy = async (text: string) => {
    const ok = await copyText(text);
    if (ok) { setCopied(text); setTimeout(() => setCopied(''), 2000); }
    else setNotice('Could not copy — please copy manually: ' + text);
  };

  if (loading) return null;

  if (!user) {
    return (
      <StudioShell view={view}>
        <div className="py-24 text-center">
          <h1 className="font-display text-3xl font-semibold">Sign in to open your studio.</h1>
          <Button asChild className="mt-6"><Link to="/login">Sign in</Link></Button>
        </div>
      </StudioShell>
    );
  }

  return (
    <StudioShell view={view}>
      {/* Page header */}
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div>
          <h1 className="font-display text-3xl font-semibold sm:text-4xl">{heading}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {assetView ? 'Upload, copy the link, use it in any HTML.' : 'Draft, edit and publish.'}
          </p>
        </div>
        <Button onClick={() => assetView ? fileInput.current?.click() : (setTitle(''), setNewDraft(true))}>
          {assetView ? <Upload /> : <Plus />}
          {assetView ? `Upload ${view === 'images' ? 'image' : 'file'}` : 'New artifact'}
        </Button>
      </div>

      {/* Search */}
      <label className="my-6 flex w-full items-center gap-2 rounded-md border border-input px-3 sm:w-64">
        <Search size={16} className="text-muted-foreground" />
        <input aria-label="Search" placeholder="Search…" value={search} onChange={e => setSearch(e.target.value)} className="min-w-0 flex-1 bg-transparent py-2 text-sm outline-none" />
      </label>

      {notice && <p role="status" className="mb-6 border-l-2 border-accent pl-3 text-sm">{notice}</p>}

      <input ref={fileInput} type="file" multiple accept={view === 'images' ? 'image/*' : undefined} className="hidden"
        onChange={e => { handleFiles(e.target.files); e.target.value = ''; }} />

      {/* ── Asset views ───────────────────────────────────────────────── */}
      {assetView ? (
        <div onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); handleFiles(e.dataTransfer.files); }}>
          <button type="button" onClick={() => fileInput.current?.click()}
            className="mb-7 flex min-h-36 w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-secondary/30 text-sm text-muted-foreground hover:bg-secondary/50 transition-colors">
            <Upload className="size-6 text-accent" />
            Drop {view} here or click to upload {view === 'images' ? '· up to 10 MB' : '· up to 200 MB'}
          </button>

          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {(view === 'images' ? visibleImages : visibleFiles).map(item => {
              const isImg = view === 'images';
              const url  = isImg ? (item as ImageItem).url : (item as FileItem).link;
              const name = isImg ? (item as ImageItem).name : (item as FileItem).name;
              return (
                <article key={item.id} className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
                  <div className="flex aspect-[16/10] items-center justify-center bg-secondary">
                    {isImg ? <img src={url} alt={name} className="h-full w-full object-cover" /> : <FileText className="size-10 text-accent" />}
                  </div>
                  <div className="p-4">
                    <h2 title={name} className="truncate text-sm font-medium">{name}</h2>
                    {!isImg && <p className="mt-1 text-xs text-muted-foreground">{((item as FileItem).size / 1024).toFixed(1)} KB</p>}
                    {url ? (
                      <div className="mt-3 flex items-center gap-1 rounded-md border border-input bg-background px-2">
                        <code className="min-w-0 flex-1 truncate py-2 text-xs text-accent">{url}</code>
                        <Button variant="ghost" size="icon" aria-label="Copy link" onClick={() => void copy(url)}>
                          {copied === url ? <Check className="text-green-500" /> : <Copy />}
                        </Button>
                        <a href={url} target="_blank" rel="noreferrer" aria-label="Open in new tab">
                          <Button variant="ghost" size="icon" asChild><span><ExternalLink size={14} /></span></Button>
                        </a>
                      </div>
                    ) : (
                      <p className="mt-3 text-xs text-muted-foreground italic">Link generating…</p>
                    )}
                    <div className="mt-2 flex justify-end">
                      <Button variant="ghost" size="icon" aria-label={`Delete ${name}`}
                        onClick={() => void (isImg ? deleteImage(item.id) : deleteFile(item.id))}>
                        <Trash2 />
                      </Button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
          {(view === 'images' ? visibleImages : visibleFiles).length === 0 &&
            <p className="py-12 text-center text-muted-foreground">Nothing uploaded yet.</p>}
        </div>
      ) : (
        /* ── Artifact grid ──────────────────────────────────────────── */
        <>
          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {visibleArtifacts.map(item => (
              <article key={item.id} className="rounded-2xl border border-border bg-card p-4 shadow-sm transition hover:-translate-y-1 hover:shadow-md">
                {/* Card thumbnail */}
                <div className="relative flex aspect-[16/7] items-center justify-center overflow-hidden rounded-xl font-display text-4xl font-bold text-white"
                  style={{ background: 'linear-gradient(135deg, oklch(0.55 0.22 278), oklch(0.72 0.16 300))' }}>
                  {item.name.charAt(0).toUpperCase()}
                  {item.locked && <Lock size={14} className="absolute right-3 top-3 text-white/80" />}
                </div>

                {/* Title + status */}
                <div className="mt-4 flex items-center justify-between gap-2">
                  <h2 className="truncate font-display text-lg font-semibold">{item.name}</h2>
                  <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs ${
                    item.status === 'published' ? 'bg-shape-mint/20 text-foreground' : 'bg-accent/15 text-accent'
                  }`}>{item.status}</span>
                </div>

                {/* Subdomain */}
                {item.subdomain ? (
                  <a href={`http://${item.subdomain}.biswa.io`} target="_blank" rel="noreferrer"
                    className="mt-1 flex items-center gap-1 font-mono text-xs text-accent hover:underline">
                    <Globe size={11} />{item.subdomain}.biswa.io
                  </a>
                ) : (
                  <p className="mt-1 font-mono text-xs text-muted-foreground">not published</p>
                )}

                {/* Actions */}
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button variant="outline" size="sm"
                    onClick={() => void navigate({ to: '/editor/$slug', params: { slug: item.id } })}>
                    Edit
                  </Button>
                  {item.status === 'published' ? (
                    <Button variant="outline" size="sm" onClick={() => void doUnpublish(item.id)}>
                      Unpublish
                    </Button>
                  ) : (
                    <Button size="sm" onClick={() => openPublish(item)}>
                      <Globe size={14} /> Publish
                    </Button>
                  )}
                  <Button variant="outline" size="sm"
                    onClick={() => void deleteArtifact(item.id, item.name)}
                    className="ml-auto text-destructive hover:bg-destructive/10">
                    <Trash2 size={14} />
                  </Button>
                </div>
              </article>
            ))}
          </div>

          {visibleArtifacts.length === 0 && (
            <div className="py-20 text-center">
              <Layers className="mx-auto mb-4 size-8 text-muted-foreground" />
              <h2 className="font-display text-xl">Nothing here yet.</h2>
              <p className="mt-2 text-sm text-muted-foreground">Create your first artifact to get started.</p>
            </div>
          )}
        </>
      )}

      {/* ── New artifact dialog ──────────────────────────────────────── */}
      <Dialog open={newDraft} onOpenChange={setNewDraft}>
        <DialogContent>
          <DialogTitle>New artifact</DialogTitle>
          <DialogDescription>Give it a name — you'll start in the code editor.</DialogDescription>
          <form className="space-y-4" onSubmit={e => { e.preventDefault(); void createArtifact(); }}>
            <input autoFocus required maxLength={80} value={title} onChange={e => setTitle(e.target.value)}
              placeholder="My awesome site"
              className="w-full rounded-md border border-input bg-background p-3 text-sm outline-none focus:border-accent" />
            <Button type="submit" className="w-full">Create & open editor</Button>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Publish dialog ───────────────────────────────────────────── */}
      <Dialog open={!!publishTarget} onOpenChange={open => { if (!open) setPublishTarget(null); }}>
        <DialogContent className="max-w-md">
          <DialogTitle className="flex items-center gap-2">
            <Globe size={18} className="text-accent" /> Publish artifact
          </DialogTitle>
          <DialogDescription>
            Choose a subdomain to publish <b>{publishTarget?.name}</b> publicly.
          </DialogDescription>

          <div className="space-y-4 pt-2">
            {/* Subdomain input */}
            <div>
              <label className="text-sm font-medium">Subdomain</label>
              <div className="mt-1.5 flex items-center rounded-lg border border-input bg-background overflow-hidden focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/30">
                <input
                  value={subdomain}
                  onChange={e => setSubdomain(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                  placeholder="my-site"
                  maxLength={40}
                  className="min-w-0 flex-1 bg-transparent px-3 py-2.5 text-sm outline-none"
                />
                <span className="shrink-0 border-l border-input bg-secondary px-3 py-2.5 text-xs text-muted-foreground">
                  .biswa.io
                </span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">Letters, numbers and hyphens only.</p>
            </div>

            {/* Password protection toggle */}
            <div className="rounded-lg border border-border p-4">
              <label className="flex cursor-pointer items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Lock size={16} className="text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">Password protect</p>
                    <p className="text-xs text-muted-foreground">Visitors must enter a password to view</p>
                  </div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={protect}
                  onClick={() => setProtect(p => !p)}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${protect ? 'bg-accent' : 'bg-secondary'}`}
                >
                  <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${protect ? 'translate-x-5' : 'translate-x-0'}`} />
                </button>
              </label>

              {protect && (
                <div className="mt-3">
                  <label className="text-xs font-medium text-muted-foreground">Password</label>
                  <input
                    type="password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder={publishTarget?.locked ? 'Leave blank to keep existing' : 'Enter password'}
                    className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-accent"
                  />
                </div>
              )}
            </div>

            {publishError && (
              <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {publishError}
              </p>
            )}

            <div className="flex gap-2 pt-1">
              <Button variant="outline" className="flex-1" onClick={() => setPublishTarget(null)}>
                <X size={14} /> Cancel
              </Button>
              <Button className="flex-1" disabled={publishing || !subdomain} onClick={() => void doPublish()}>
                {publishing ? 'Publishing…' : <><Globe size={14} /> Publish</>}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </StudioShell>
  );
}
