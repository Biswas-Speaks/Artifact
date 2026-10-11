import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { ARTIFACTS, type Artifact } from '@/lib/artifacts';

export type StudioItem = Artifact & { status: 'published' | 'draft' };
export type StudioAsset = { file: File; url: string };
export type ArtifactCode = { html: string; css: string; js: string };
export const DEMO_USER = 'demo';
export const DEMO_PASSWORD = 'demo@123';
export const starterCode = (title: string): ArtifactCode => ({
  html: `<div class="s on"><h1>${title}</h1><p>Press → to continue</p></div>\n<div class="s"><h1>Why it matters</h1><p>Three bullet points, one story.</p></div>\n<div class="s"><h1>Thank you ✦</h1><p>CREATE · PUBLISH · INSPIRE</p></div>\n<div class="nv"><button onclick="go(-1)">←</button><button onclick="go(1)">→</button></div>`,
  css: `body{margin:0;font-family:system-ui;background:linear-gradient(160deg,#2b2370,#6b5cff 55%,#e05cb8);color:#fff;height:100vh;overflow:hidden}\n.s{position:absolute;inset:0;display:none;flex-direction:column;align-items:center;justify-content:center;text-align:center}\n.s.on{display:flex;animation:in .5s}\nh1{font-size:clamp(2rem,8vw,4.5rem);margin:0}\n.nv{position:fixed;right:20px;bottom:20px;display:flex;gap:10px}\n.nv button{border:0;border-radius:99px;padding:10px 18px;font-size:18px;cursor:pointer}\n@keyframes in{from{opacity:0;transform:translateY(12px)}}`,
  js: `let i=0;const s=document.querySelectorAll('.s');\nfunction go(d){s[i].classList.remove('on');i=(i+d+s.length)%s.length;s[i].classList.add('on')}\ndocument.onkeydown=e=>{if(e.key==='ArrowRight')go(1);if(e.key==='ArrowLeft')go(-1)}`,
});

type StudioContext = { signedIn: boolean; items: StudioItem[]; assets: StudioAsset[]; code: Record<string, ArtifactCode>; addAssets: (files: File[]) => void; removeAsset: (url: string) => void; login: (user: string, pass: string) => boolean; logout: () => void; changeStatus: (slug: string, status: StudioItem['status']) => void; createDraft: (title: string) => string; deleteItem: (slug: string) => void; saveCode: (slug: string, code: ArtifactCode) => void; editItem: (slug: string, title: string, description: string) => void };
const initialItems: StudioItem[] = ARTIFACTS.map((a, i) => ({ ...a, status: i > 7 ? 'draft' : 'published' }));
const Context = createContext<StudioContext | null>(null);
export function DemoStudioProvider({ children }: { children: ReactNode }) {
  const [signedIn, setSignedIn] = useState(false);
  const [items, setItems] = useState(initialItems);
  const [assets, setAssets] = useState<StudioAsset[]>([]);
  const [code, setCode] = useState<Record<string, ArtifactCode>>({});
  useEffect(() => { setSignedIn(window.sessionStorage.getItem('biswa-demo-login') === 'yes'); }, []);
  const login = (user: string, pass: string) => { if (user.trim() !== DEMO_USER || pass !== DEMO_PASSWORD) return false; window.sessionStorage.setItem('biswa-demo-login', 'yes'); setSignedIn(true); return true; };
  const logout = () => { window.sessionStorage.removeItem('biswa-demo-login'); setSignedIn(false); setItems(initialItems); setAssets([]); setCode({}); };
  const changeStatus = (slug: string, status: StudioItem['status']) => setItems(items => items.map(a => a.slug === slug ? { ...a, status } : a));
  const createDraft = (title: string) => { const slug = `draft-${Date.now()}`; setItems(items => [...items, { slug, title, category: 'Presentations', description: 'A new idea, waiting to take shape.', publishedAt: '2026-10-11', hue: 280, status: 'draft' }]); setCode(c => ({ ...c, [slug]: starterCode(title) })); return slug; };
  const deleteItem = (slug: string) => setItems(items => items.filter(a => a.slug !== slug));
  const saveCode = (slug: string, next: ArtifactCode) => setCode(c => ({ ...c, [slug]: next }));
  const editItem = (slug: string, title: string, description: string) => setItems(items => items.map(a => a.slug === slug ? { ...a, title, description } : a));
  const addAssets = (files: File[]) => setAssets(assets => [...assets, ...files.map(file => ({ file, url: URL.createObjectURL(file) }))]);
  const removeAsset = (url: string) => { URL.revokeObjectURL(url); setAssets(assets => assets.filter(a => a.url !== url)); };
  return <Context.Provider value={{ signedIn, items, assets, code, addAssets, removeAsset, login, logout, changeStatus, createDraft, deleteItem, saveCode, editItem }}>{children}</Context.Provider>;
}
export function useDemoStudio() { const value = useContext(Context); if (!value) throw new Error('Demo studio provider is missing'); return value; }
