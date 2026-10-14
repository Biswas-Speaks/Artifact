import { Link } from "@tanstack/react-router";
import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

// ── Social links — single source of truth (same as Footer.tsx) ──────────────
export const SOCIAL = [
  {
    label: "YouTube",
    href: "https://youtube.com/@biswa_artifacts",
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M23.5 6.2a3.02 3.02 0 0 0-2.12-2.14C19.54 3.6 12 3.6 12 3.6s-7.54 0-9.38.46A3.02 3.02 0 0 0 .5 6.2C0 8.06 0 12 0 12s0 3.94.5 5.8a3.02 3.02 0 0 0 2.12 2.14C4.46 20.4 12 20.4 12 20.4s7.54 0 9.38-.46a3.02 3.02 0 0 0 2.12-2.14C24 15.94 24 12 24 12s0-3.94-.5-5.8zM9.6 15.6V8.4l6.4 3.6-6.4 3.6z" />
      </svg>
    ),
  },
  {
    label: "Instagram",
    href: "https://instagram.com/biswa.artifacts",
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 1 0 0 12.324 6.162 6.162 0 0 0 0-12.324zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.406-11.845a1.44 1.44 0 1 0 0 2.881 1.44 1.44 0 0 0 0-2.881z" />
      </svg>
    ),
  },
] as const;

export function Nav() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const stored = window.localStorage.getItem("biswa-theme");
    const prefers = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const isDark = stored ? stored === "dark" : prefers;
    setDark(isDark);
    document.documentElement.classList.toggle("dark", isDark);
  }, []);

  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    window.localStorage.setItem("biswa-theme", next ? "dark" : "light");
  };

  return (
    <header className="fixed inset-x-0 top-0 z-50 flex justify-center px-4 pt-4">
      <nav
        aria-label="Primary"
        className="flex w-full max-w-5xl items-center justify-between rounded-full border border-border bg-background/70 px-5 py-2.5 backdrop-blur-xl"
      >
        <Link to="/" className="font-display text-sm font-bold tracking-[0.22em]">
          BISWA<span className="text-accent">/</span>ARTIFACTS
        </Link>

        <div className="hidden items-center gap-7 text-sm text-muted-foreground md:flex">
          <Link to="/explore" className="transition-colors hover:text-foreground" activeProps={{ className: "text-foreground" }}>
            Explore
          </Link>
          <Link to="/" hash="creations" className="transition-colors hover:text-foreground">
            Creations
          </Link>
          <Link to="/about" className="transition-colors hover:text-foreground" activeProps={{ className: "text-foreground" }}>
            About
          </Link>
        </div>

        <div className="flex items-center gap-1">
          {/* Social icons — shown on medium+ screens */}
          <div className="hidden items-center gap-1 md:flex">
            {SOCIAL.map((s) => (
              <a
                key={s.label}
                href={s.href}
                target="_blank"
                rel="noopener noreferrer me"
                aria-label={`${s.label} — Biswa Artifacts`}
                className="rounded-full p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              >
                {s.icon}
              </a>
            ))}
          </div>

          <button
            onClick={toggle}
            aria-label="Toggle theme"
            className="rounded-full p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            {dark ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        </div>
      </nav>
    </header>
  );
}
