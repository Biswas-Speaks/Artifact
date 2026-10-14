import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  AlertCircle, Check, CheckCircle2, Copy, ExternalLink, FileText,
  Globe, Layers, Lock, Mail, Plus, RefreshCw, Search, Trash2,
  Upload, X, AlertTriangle, Clock,
} from 'lucide-react';
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
  status: 'published' | 'draft' | 'suspended';
  review_status: 'approved' | 'pending' | 'rejected';
  locked: boolean;
  updated_at: string;
  published_at: string | null;
  has_changes: boolean;
}

interface QuotaInfo {
  published: number;
  maxPublished: number;
  total: number;
  maxTotal: number;
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

/* ── Skeleton helpers ─────────────────────────────────────────────── */
/* ── Gradient palette — deterministic per artifact name ────────── */
const CARD_GRADIENTS = [
  ['#7c3aed', '#6d28d9', '#4f46e5'],   // violet → indigo
  ['#e11d48', '#db2777', '#a21caf'],   // rose → fuchsia
  ['#f59e0b', '#f97316', '#e11d48'],   // amber → rose
  ['#10b981', '#0d9488', '#0891b2'],   // emerald → cyan
  ['#0ea5e9', '#2563eb', '#4f46e5'],   // sky → indigo
  ['#84cc16', '#22c55e', '#10b981'],   // lime → emerald
  ['#d946ef', '#ec4899', '#f43f5e'],   // fuchsia → rose
  ['#06b6d4', '#0ea5e9', '#2563eb'],   // cyan → blue
];

function cardGradient(name: string): [string, string, string] {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return CARD_GRADIENTS[hash % CARD_GRADIENTS.length] as [string, string, string];
}

/* ── Skeleton helpers ─────────────────────────────────────────── */
function SkeletonCard() {
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      <div className="relative aspect-[16/7] overflow-hidden bg-secondary">
        <div
          className="absolute inset-0 -translate-x-full animate-[shimmer_1.6s_infinite]"
          style={{ background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.06) 50%, transparent 100%)' }}
        />
      </div>
      <div className="p-4">
        <div className="flex items-center justify-between gap-2">
          <div className="h-5 w-32 animate-pulse rounded-md bg-secondary" />
          <div className="h-4 w-16 animate-pulse rounded-full bg-secondary" />
        </div>
        <div className="mt-1.5 h-3 w-24 animate-pulse rounded bg-secondary" />
        <div className="mt-4 flex gap-2">
          <div className="h-8 w-14 animate-pulse rounded-md bg-secondary" />
          <div className="h-8 w-20 animate-pulse rounded-md bg-secondary" />
          <div className="ml-auto h-8 w-8 animate-pulse rounded-md bg-secondary" />
        </div>
      </div>
    </div>
  );
}

function SkeletonAssetCard() {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm animate-pulse">
      <div className="aspect-[16/10] bg-secondary" />
      <div className="p-4 space-y-2">
        <div className="h-4 w-3/4 rounded bg-secondary" />
        <div className="h-3 w-1/4 rounded bg-secondary" />
        <div className="mt-3 h-8 w-full rounded-md bg-secondary" />
      </div>
    </div>
  );
}

/* ── Copy helper with fallback ────────────────────────────────────────── */
async function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard) {
    try { await navigator.clipboard.writeText(text); return true; } catch { /* fall through */ }
  }
  const el = document.createElement('textarea');
  el.value = text;
  el.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0';
  document.body.appendChild(el);
  el.focus(); el.select();
  const ok = document.execCommand('copy');
  document.body.removeChild(el);
  return ok;
}

/* ── Subdomain availability hook ─────────────────────────────────────── */
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
        if (excludeId) params.set('exclude', excludeId);
        const res = await apiFetch<{ available: boolean; reason?: string }>(`/api/subdomain-check?${params}`);
        setState({ available: res.available, reason: res.reason, checking: false });
      } catch {
        setState({ checking: false });
      }
    }, 400);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [name, excludeId]);

  return state;
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
  const [quota, setQuota] = useState<QuotaInfo | null>(null);
  const [newDraft, setNewDraft] = useState(false);
  const [title, setTitle] = useState('');
  const [dataLoading, setDataLoading] = useState(true);

  // Publish dialog state
  const [publishTarget, setPublishTarget] = useState<ArtifactItem | null>(null);
  const [subdomain, setSubdomain] = useState('');
  const [protect, setProtect] = useState(false);
  const [password, setPassword] = useState('');
  const [publishError, setPublishError] = useState('');
  const [publishing, setPublishing] = useState(false);

  // Resend verification
  const [resending, setResending] = useState(false);
  const [resendMsg, setResendMsg] = useState('');

  // File/image state
  const [files, setFiles] = useState<FileItem[]>([]);
  const [images, setImages] = useState<ImageItem[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);

  // Upload progress state
  const [uploadingFiles, setUploadingFiles] = useState<Map<string, number>>(new Map());

  const assetView = view === 'files' || view === 'images';
  const heading = STUDIO_TABS.find(t => t.to === `/${view}`)?.heading ?? 'My artifacts';

  // Subdomain availability check (live)
  const subdomainCheck = useSubdomainCheck(subdomain, publishTarget?.id);

  // Auth guard
  useEffect(() => {
    if (!loading && !user) void navigate({ to: '/login' });
  }, [user, loading, navigate]);

  // Handle ?verified= query param from email verification redirect
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const v = params.get('verified');
    if (v === 'ok') setNotice('✓ Email verified! You can now publish artifacts.');
    if (v === 'fail') setNotice('Verification link is invalid or expired. Please request a new one.');
    if (v) {
      const url = new URL(window.location.href);
      url.searchParams.delete('verified');
      window.history.replaceState({}, '', url.pathname + url.search);
    }
  }, []);

  // Load data
  useEffect(() => {
    if (!user) return;
    setDataLoading(true);
    if (view === 'files') {
      apiFetch<{ items: FileItem[] }>('/api/files')
        .then(d => setFiles(d.items))
        .catch(() => setNotice('Failed to load files'))
        .finally(() => setDataLoading(false));
    } else if (view === 'images') {
      apiFetch<{ items: ImageItem[] }>('/api/images')
        .then(d => setImages(d.items))
        .catch(() => setNotice('Failed to load images'))
        .finally(() => setDataLoading(false));
    } else {
      apiFetch<{ items: ArtifactItem[]; quota: QuotaInfo }>('/api/artifacts')
        .then(d => { setArtifacts(d.items); setQuota(d.quota); })
        .catch(() => setNotice('Failed to load artifacts'))
        .finally(() => setDataLoading(false));
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
    const res = await apiFetch<{
      ok?: boolean; subdomain?: string; locked?: boolean;
      pending?: boolean; error?: string; code?: string;
    }>(
      `/api/artifacts/${publishTarget.id}/publish`,
      { method: 'POST', body: JSON.stringify({ subdomain, protect, password }) }
    );
    setPublishing(false);
    if (res.error) {
      setPublishError(res.error);
      return;
    }
    if (res.pending) {
      setArtifacts(prev => prev.map(a => a.id === publishTarget.id
        ? { ...a, subdomain: res.subdomain ?? subdomain, review_status: 'pending', has_changes: false }
        : a
      ));
      setPublishTarget(null);
      setNotice('Submitted for review. You\'ll be notified when it\'s approved.');
      return;
    }
    setArtifacts(prev => prev.map(a => a.id === publishTarget.id
      ? { ...a, status: 'published', subdomain: res.subdomain ?? subdomain, locked: res.locked ?? protect, has_changes: false }
      : a
    ));
    // Refresh quota
    apiFetch<{ items: ArtifactItem[]; quota: QuotaInfo }>('/api/artifacts')
      .then(d => setQuota(d.quota)).catch(() => {});
    setPublishTarget(null);
    setNotice(`Published at ${subdomain}.biswa.io${protect ? ' 🔒' : ''}`);
  };

  const doUnpublish = async (id: string) => {
    await apiFetch(`/api/artifacts/${id}/unpublish`, { method: 'POST' });
    setArtifacts(prev => prev.map(a => a.id === id ? { ...a, status: 'draft', subdomain: null, locked: false } : a));
    setNotice('Artifact unpublished. Subdomain is reserved.');
  };

  const resendVerification = async () => {
    setResending(true);
    const res = await apiFetch<{ ok?: boolean; error?: string }>('/api/auth/resend-verification', { method: 'POST' });
    setResending(false);
    setResendMsg(res.ok ? 'Verification email sent! Check your inbox.' : (res.error ?? 'Failed to send'));
    setTimeout(() => setResendMsg(''), 5000);
  };

  /* ── Files ──────────────────────────────────────────────────────────── */
  const visibleFiles = files.filter(f => matches(f.name));

  const uploadFile = async (file: File) => {
    if (file.size > 200 * 1024 * 1024) { setNotice(`${file.name} exceeds 200 MB`); return; }
    const uploadKey = `${file.name}-${Date.now()}`;
    setUploadingFiles(prev => new Map(prev).set(uploadKey, 0));

    try {
      const presign = await apiFetch<{ id?: string; url?: string; error?: string }>('/api/files/presign', {
        method: 'POST', body: JSON.stringify({ name: file.name, size: file.size, type: file.type }),
      });
      if (!presign.url) {
        setNotice(presign.error ?? 'Could not get upload URL');
        setUploadingFiles(prev => { const m = new Map(prev); m.delete(uploadKey); return m; });
        return;
      }

      // Use XHR for progress tracking
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            const pct = Math.round((e.loaded / e.total) * 100);
            setUploadingFiles(prev => new Map(prev).set(uploadKey, pct));
          }
        };
        xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed: ${xhr.status}`)));
        xhr.onerror = () => reject(new Error('Network error'));
        xhr.open('PUT', presign.url!);
        xhr.setRequestHeader('Content-Type', file.type);
        xhr.send(file);
      });

      // Confirm upload succeeded so server marks it visible
      await apiFetch(`/api/files/${presign.id}/confirm`, { method: 'POST' });

      const data = await apiFetch<{ items: FileItem[] }>('/api/files');
      setFiles(data.items);
      setNotice(`${file.name} uploaded.`);
    } catch (err) {
      setNotice(`Upload failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setUploadingFiles(prev => { const m = new Map(prev); m.delete(uploadKey); return m; });
    }
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
    const uploadKey = `${file.name}-${Date.now()}`;
    setUploadingFiles(prev => new Map(prev).set(uploadKey, 0));

    try {
      const form = new FormData();
      form.append('file', file);

      const json = await new Promise<ImageItem & { error?: string }>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            const pct = Math.round((e.loaded / e.total) * 100);
            setUploadingFiles(prev => new Map(prev).set(uploadKey, pct));
          }
        };
        xhr.onload = () => {
          try { resolve(JSON.parse(xhr.responseText)); }
          catch { reject(new Error('Invalid response')); }
        };
        xhr.onerror = () => reject(new Error('Network error'));
        xhr.open('POST', '/api/images');
        xhr.withCredentials = true;
        xhr.send(form);
      });

      if (json.error) { setNotice(json.error); return; }
      setImages(prev => [json, ...prev]);
      setNotice(`${json.name} uploaded.`);
    } catch (err) {
      setNotice(`Upload failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setUploadingFiles(prev => { const m = new Map(prev); m.delete(uploadKey); return m; });
    }
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

  const isAlreadyPublished = publishTarget?.status === 'published';

  return (
    <StudioShell view={view}>
      {/* ── Email verification banner ────────────────────────────────── */}
      {!user.email_verified && !assetView && (
        <div className="mb-6 flex flex-wrap items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm">
          <Mail size={16} className="shrink-0 text-amber-500" />
          <span className="flex-1 text-amber-700 dark:text-amber-300">
            Please verify your email address to publish artifacts.
          </span>
          <Button
            size="sm"
            variant="outline"
            className="border-amber-500/40 text-amber-700 hover:bg-amber-500/10 dark:text-amber-300"
            disabled={resending}
            onClick={() => void resendVerification()}
          >
            {resending ? <RefreshCw size={13} className="animate-spin" /> : <Mail size={13} />}
            Resend verification
          </Button>
          {resendMsg && <span className="w-full text-xs text-amber-700 dark:text-amber-300">{resendMsg}</span>}
        </div>
      )}

      {/* Page header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-3xl font-semibold sm:text-4xl">{heading}</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            {assetView ? 'Upload, copy the link, use it in any HTML.' : 'Draft, edit and publish.'}
          </p>
        </div>
        <Button className="w-full sm:w-auto" onClick={() => assetView ? fileInput.current?.click() : (setTitle(''), setNewDraft(true))}>
          {assetView ? <Upload size={15} /> : <Plus size={15} />}
          {assetView ? `Upload ${view === 'images' ? 'image' : 'file'}` : 'New artifact'}
        </Button>
      </div>

      {/* Quota meters (artifact views only) */}
      {!assetView && quota && (
        <div className="mt-4 flex flex-wrap gap-4 rounded-xl border border-border bg-card/60 px-4 py-3 text-xs text-muted-foreground">
          <div className="flex items-center gap-2 min-w-0">
            <Globe size={13} className="shrink-0 text-accent" />
            <span className="shrink-0">{quota.published} / {quota.maxPublished} published</span>
            <div className="h-1.5 w-20 shrink-0 overflow-hidden rounded-full bg-secondary">
              <div className="h-full rounded-full bg-accent transition-all"
                style={{ width: `${Math.min(100, (quota.published / quota.maxPublished) * 100)}%` }} />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Layers size={13} className="shrink-0 text-muted-foreground" />
            <span>{quota.total} / {quota.maxTotal} artifacts</span>
          </div>
        </div>
      )}

      {/* Search */}
      <label className="my-5 flex w-full max-w-xs items-center gap-2 rounded-lg border border-input bg-background px-3">
        <Search size={15} className="shrink-0 text-muted-foreground" />
        <input aria-label="Search" placeholder="Search…" value={search}
          onChange={e => setSearch(e.target.value)}
          className="min-w-0 flex-1 bg-transparent py-2 text-sm outline-none" />
        {search && (
          <button onClick={() => setSearch('')} className="text-muted-foreground hover:text-foreground">
            <X size={13} />
          </button>
        )}
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

          {/* Upload progress indicators */}
          {uploadingFiles.size > 0 && (
            <div className="mb-5 space-y-2">
              {Array.from(uploadingFiles.entries()).map(([key, pct]) => {
                const name = key.replace(/-\d+$/, '');
                return (
                  <div key={key} className="rounded-lg border border-border bg-card px-4 py-3">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs font-medium truncate max-w-[80%]">{name}</span>
                      <span className="text-xs text-muted-foreground shrink-0">{pct}%</span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                      <div
                        className="h-full rounded-full bg-accent transition-all duration-200"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {dataLoading
              ? Array.from({ length: 3 }).map((_, i) => <SkeletonAssetCard key={i} />)
              : (view === 'images' ? visibleImages : visibleFiles).map(item => {
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
          {!dataLoading && (view === 'images' ? visibleImages : visibleFiles).length === 0 &&
            <p className="py-12 text-center text-muted-foreground">Nothing uploaded yet.</p>}
        </div>
      ) : (
        /* ── Artifact grid ──────────────────────────────────────────── */
        <>
          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {dataLoading
              ? Array.from({ length: 3 }).map((_, i) => <SkeletonCard key={i} />)
              : visibleArtifacts.map(item => {
                const [c1, c2, c3] = cardGradient(item.name);
                const initial = item.name.charAt(0).toUpperCase();
                return (
              <article
                key={item.id}
                className="group flex flex-col overflow-hidden rounded-2xl border border-border/60 bg-card shadow-sm
                           transition-all duration-300 ease-out
                           hover:-translate-y-1.5 hover:shadow-[0_12px_40px_-8px_rgba(0,0,0,0.25)]
                           hover:border-transparent"
                style={{ '--card-c1': c1, '--card-c2': c2, '--card-c3': c3 } as React.CSSProperties}
              >
                {/* ── Gradient thumbnail ─────────────────────────── */}
                <div
                  className="relative flex aspect-[16/7] shrink-0 items-center justify-center overflow-hidden select-none"
                  style={{ background: `linear-gradient(135deg, ${c1} 0%, ${c2} 55%, ${c3} 100%)` }}
                >
                  {/* animated noise/dot grid overlay */}
                  <div className="absolute inset-0 opacity-20"
                    style={{
                      backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.3) 1px, transparent 1px)',
                      backgroundSize: '20px 20px',
                    }}
                  />
                  {/* shimmer sweep on hover */}
                  <div
                    className="absolute inset-0 -translate-x-full transition-transform duration-700 group-hover:translate-x-full"
                    style={{ background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.15) 50%, transparent 100%)' }}
                  />
                  {/* Initial letter */}
                  <span className="relative z-10 font-display text-5xl font-black tracking-tight text-white/90 drop-shadow-lg"
                    style={{ textShadow: '0 2px 16px rgba(0,0,0,0.4)' }}>
                    {initial}
                  </span>
                  {/* Decorative glow blobs */}
                  <span className="absolute -bottom-4 -right-4 size-20 rounded-full opacity-30 blur-2xl"
                    style={{ background: c3 }} />
                  <span className="absolute -top-4 -left-4 size-16 rounded-full opacity-25 blur-xl"
                    style={{ background: c1 }} />

                  {/* Lock badge */}
                  {item.locked && (
                    <span className="absolute right-3 top-3 flex size-6 items-center justify-center rounded-full bg-black/40 backdrop-blur-sm">
                      <Lock size={11} className="text-white/90" />
                    </span>
                  )}
                  {/* Suspended overlay */}
                  {item.status === 'suspended' && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/65 backdrop-blur-[1px]">
                      <span className="rounded-full bg-destructive px-3 py-1 text-sm font-semibold text-white shadow">Suspended</span>
                    </div>
                  )}
                  {/* Under review overlay */}
                  {item.review_status === 'pending' && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-[1px]">
                      <span className="flex items-center gap-1.5 rounded-full bg-amber-500 px-3 py-1 text-sm font-semibold text-black shadow">
                        <Clock size={12} /> Under review
                      </span>
                    </div>
                  )}
                </div>

                {/* ── Card content ────────────────────────────────── */}
                <div className="flex flex-1 flex-col p-4">
                  <div className="space-y-1.5">
                    <h2 className="truncate font-display text-base font-semibold leading-snug" title={item.name}>
                      {item.name}
                    </h2>

                    {/* Status badges */}
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                        item.status === 'published' ? 'bg-green-500/15 text-green-700 dark:text-green-400' :
                        item.status === 'suspended' ? 'bg-destructive/20 text-destructive' :
                        'bg-accent/15 text-accent'
                      }`}>
                        {item.review_status === 'pending' ? 'Under review' : item.status}
                      </span>
                      {item.locked && (
                        <span className="flex items-center gap-0.5 rounded-full bg-secondary px-2 py-0.5 text-[11px] text-muted-foreground">
                          <Lock size={9} /> Locked
                        </span>
                      )}
                      {item.has_changes && item.status === 'published' && (
                        <span className="flex items-center gap-0.5 rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] text-amber-600 dark:text-amber-400">
                          <AlertCircle size={9} /> Changes
                        </span>
                      )}
                    </div>

                    {/* Subdomain link */}
                    {item.subdomain && item.status === 'published' ? (
                      <a href={`https://${item.subdomain}.biswa.io`} target="_blank" rel="noreferrer"
                        className="flex items-center gap-1 font-mono text-[11px] text-accent hover:underline truncate">
                        <Globe size={10} className="shrink-0" />{item.subdomain}.biswa.io
                      </a>
                    ) : item.review_status === 'pending' && item.subdomain ? (
                      <p className="flex items-center gap-1 font-mono text-[11px] text-amber-500 truncate">
                        <Clock size={10} className="shrink-0" />{item.subdomain}.biswa.io
                      </p>
                    ) : (
                      <p className="font-mono text-[11px] text-muted-foreground/50">not published</p>
                    )}
                  </div>

                  {/* ── Actions row ─────────────────────────────── */}
                  <div className="mt-auto flex items-center gap-1.5 border-t border-border pt-3">
                    <Button variant="outline" size="sm" className="h-8 text-xs"
                      onClick={() => void navigate({ to: '/editor/$slug', params: { slug: item.id } })}>
                      Edit
                    </Button>
                  {item.status === 'published' ? (
                    <>
                      {item.has_changes && (
                        <Button size="sm" className="h-8 bg-amber-500 text-xs text-black hover:bg-amber-400"
                          onClick={() => openPublish(item)}>
                          <RefreshCw size={12} /> Update
                        </Button>
                      )}
                      <Button variant="outline" size="sm" className="h-8 text-xs"
                        onClick={() => void doUnpublish(item.id)}>
                        Unpublish
                      </Button>
                    </>
                  ) : item.review_status === 'pending' ? (
                    <Button size="sm" variant="outline" className="h-8 text-xs" disabled>
                      <Clock size={12} /> Pending
                    </Button>
                  ) : (
                    <Button size="sm" className="h-8 text-xs"
                      onClick={() => openPublish(item)} disabled={!user.email_verified}>
                      <Globe size={12} /> Publish
                    </Button>
                  )}
                  <Button variant="ghost" size="icon" aria-label={`Delete ${item.name}`}
                    className="ml-auto h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                    onClick={() => void deleteArtifact(item.id, item.name)}>
                    <Trash2 size={14} />
                  </Button>
                </div>
                </div>
              </article>
                );
              })}
          </div>

          {!dataLoading && visibleArtifacts.length === 0 && (
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

      {/* ── Publish / Publish update dialog ─────────────────────────── */}
      <Dialog open={!!publishTarget} onOpenChange={open => { if (!open) setPublishTarget(null); }}>
        <DialogContent className="max-w-md">
          <DialogTitle className="flex items-center gap-2">
            {isAlreadyPublished
              ? <><RefreshCw size={18} className="text-amber-500" /> Publish update</>
              : <><Globe size={18} className="text-accent" /> Publish artifact</>
            }
          </DialogTitle>
          <DialogDescription>
            {isAlreadyPublished
              ? <>Push your latest changes to <b>{publishTarget?.name}</b> live.</>
              : <>Choose a subdomain to publish <b>{publishTarget?.name}</b> publicly.</>
            }
          </DialogDescription>

          <div className="space-y-4 pt-2">
            {/* Subdomain input + live availability check */}
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
              {/* Availability indicator */}
              {subdomain.length >= 3 && (
                <p className={`mt-1 flex items-center gap-1 text-xs ${
                  subdomainCheck.checking ? 'text-muted-foreground' :
                  subdomainCheck.available ? 'text-green-600 dark:text-green-400' : 'text-destructive'
                }`}>
                  {subdomainCheck.checking
                    ? <><RefreshCw size={10} className="animate-spin" /> Checking…</>
                    : subdomainCheck.available
                    ? <><CheckCircle2 size={10} /> Available</>
                    : <><AlertCircle size={10} /> {subdomainCheck.reason ?? 'Not available'}</>
                  }
                </p>
              )}
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
              <Button
                className={`flex-1 ${isAlreadyPublished ? 'bg-amber-500 text-black hover:bg-amber-400' : ''}`}
                disabled={publishing || !subdomain || (!subdomainCheck.available && !subdomainCheck.checking && subdomain.length >= 3 && publishTarget?.subdomain !== subdomain)}
                onClick={() => void doPublish()}
              >
                {publishing
                  ? 'Publishing…'
                  : isAlreadyPublished
                  ? <><RefreshCw size={14} /> Publish update</>
                  : <><Globe size={14} /> Publish</>
                }
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </StudioShell>
  );
}
