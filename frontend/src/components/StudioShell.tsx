import type { ReactNode } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Files, Image, Layers, LogOut, Pencil, Send, Settings, ShieldCheck, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth';

export const STUDIO_TABS = [
  { to: '/artifacts', title: 'All',       heading: 'My artifacts', icon: Layers,     group: 'artifacts' },
  { to: '/published', title: 'Published', heading: 'Published',    icon: Send,       group: 'artifacts' },
  { to: '/drafts',    title: 'Drafts',    heading: 'Drafts',       icon: Pencil,     group: 'artifacts' },
  { to: '/images',    title: 'Images',    heading: 'Images',       icon: Image,      group: 'media'     },
  { to: '/files',     title: 'Files',     heading: 'Files',        icon: Files,      group: 'media'     },
  { to: '/settings',  title: 'Settings',  heading: 'Settings',     icon: Settings,   group: 'account'   },
  { to: '/admin',     title: 'Admin',     heading: 'Admin',        icon: ShieldCheck, group: 'admin'    },
] as const;

type StudioTab = typeof STUDIO_TABS[number];

export function StudioShell({ view, children }: { view: string; children: ReactNode }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    void navigate({ to: '/' });
  };

  const navLink = (tab: StudioTab, indent: boolean) => (
    <Button
      key={tab.to}
      asChild
      variant="ghost"
      className={`studio-nav-link ${indent ? 'lg:pl-7' : ''} ${tab.to === `/${view}` ? 'studio-nav-active' : ''}`}
    >
      <Link to={tab.to} aria-current={tab.to === `/${view}` ? 'page' : undefined}>
        <tab.icon size={16} />
        <span>{tab.title}</span>
      </Link>
    </Button>
  );

  const artifactTabs = STUDIO_TABS.filter(t => t.group === 'artifacts');
  const mediaTabs    = STUDIO_TABS.filter(t => t.group === 'media');
  const accountTabs  = STUDIO_TABS.filter(t => t.group === 'account');
  const adminTabs    = STUDIO_TABS.filter(t => t.group === 'admin');

  return (
    <div className="studio-shell mx-auto max-w-[1440px] px-4 pb-24 pt-28 sm:px-6">
      <aside className="studio-sidebar flex flex-col border-border lg:border-r">

        {/* Brand */}
        <div className="mb-10 hidden lg:block">
          <div className="mb-3 flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Sparkles size={20} />
          </div>
          <p className="font-display text-xl font-semibold">
            Studio<span className="text-shape-coral">.</span>
          </p>
          {user && (
            <p className="mt-1 font-mono text-[10px] text-muted-foreground">
              {user.username.toUpperCase()}
            </p>
          )}
        </div>

        {/* Navigation */}
        <nav aria-label="Studio navigation" className="studio-navigation">
          <p className="hidden px-3 pb-1 font-mono text-[10px] text-muted-foreground lg:block">ARTIFACTS</p>
          {artifactTabs.map(t => navLink(t, true))}

          <p className="hidden px-3 pb-1 pt-4 font-mono text-[10px] text-muted-foreground lg:block">MEDIA</p>
          {mediaTabs.map(t => navLink(t, false))}

          <p className="hidden px-3 pb-1 pt-4 font-mono text-[10px] text-muted-foreground lg:block">ACCOUNT</p>
          {accountTabs.map(t => navLink(t, false))}

          {/* Admin — only for admin role */}
          {user?.role === 'admin' && (
            <>
              <p className="hidden px-3 pb-1 pt-4 font-mono text-[10px] text-muted-foreground lg:block">ADMIN</p>
              {adminTabs.map(t => navLink(t, false))}
            </>
          )}
        </nav>

        {/* Bottom actions */}
        <div className="mt-auto hidden pt-14 lg:block">
          <Button asChild variant="ghost" className="w-full justify-start text-muted-foreground">
            <Link to="/"><ArrowLeft />Back to gallery</Link>
          </Button>
          {user && (
            <Button
              variant="ghost"
              className="w-full justify-start text-muted-foreground"
              onClick={() => void handleLogout()}
            >
              <LogOut />Sign out
            </Button>
          )}
        </div>
      </aside>

      <main className="studio-content min-w-0">{children}</main>
    </div>
  );
}
