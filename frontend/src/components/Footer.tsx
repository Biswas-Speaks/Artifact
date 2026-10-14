import { Link } from "@tanstack/react-router";

// ── Social links — edit here to change URLs ──────────────────────────────
const SOCIAL = [
  {
    label: "YouTube",
    href: "https://youtube.com/@biswa_artifacts",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M23.5 6.2a3.02 3.02 0 0 0-2.12-2.14C19.54 3.6 12 3.6 12 3.6s-7.54 0-9.38.46A3.02 3.02 0 0 0 .5 6.2C0 8.06 0 12 0 12s0 3.94.5 5.8a3.02 3.02 0 0 0 2.12 2.14C4.46 20.4 12 20.4 12 20.4s7.54 0 9.38-.46a3.02 3.02 0 0 0 2.12-2.14C24 15.94 24 12 24 12s0-3.94-.5-5.8zM9.6 15.6V8.4l6.4 3.6-6.4 3.6z" />
      </svg>
    ),
  },
  {
    label: "Instagram",
    href: "https://instagram.com/biswa.artifacts",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 1 0 0 12.324 6.162 6.162 0 0 0 0-12.324zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.406-11.845a1.44 1.44 0 1 0 0 2.881 1.44 1.44 0 0 0 0-2.881z" />
      </svg>
    ),
  },
] as const;

export function Footer() {
  return (
    <footer className="relative overflow-hidden border-t border-border">
      {/* rotating wireframe symbol */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-24 top-10 size-72 animate-spin-slow rounded-full border border-accent/30"
        style={{ borderStyle: "dashed" }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -right-10 top-24 size-40 animate-spin-slow border border-border"
        style={{ animationDirection: "reverse", transform: "rotate(45deg)" }}
      />

      <div className="mx-auto max-w-6xl px-6 py-20">
        <h2 className="font-display text-4xl font-bold leading-tight tracking-tight md:text-6xl">
          MAKE SOMETHING
          <br />
          <span className="text-outline">REMARKABLE.</span>
        </h2>

        <div className="mt-14 flex flex-col gap-10 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="font-display text-sm font-bold tracking-[0.22em]">
              BISWA<span className="text-accent">/</span>ARTIFACTS
            </p>
            <p className="mt-2 font-mono text-xs tracking-[0.3em] text-muted-foreground">
              CREATE · PUBLISH · INSPIRE
            </p>

            {/* Social links */}
            <div className="mt-4 flex items-center gap-3">
              {SOCIAL.map((s) => (
                <a
                  key={s.label}
                  href={s.href}
                  target="_blank"
                  rel="noopener noreferrer me"
                  aria-label={`${s.label} — Biswa Artifacts`}
                  className="flex items-center gap-1.5 rounded-lg border border-border bg-secondary/60 px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-accent/50 hover:text-foreground"
                >
                  {s.icon}
                  <span>{s.label}</span>
                </a>
              ))}
            </div>
          </div>

          <nav aria-label="Footer" className="flex flex-wrap gap-x-8 gap-y-3 text-sm text-muted-foreground">
            <Link to="/explore" className="transition-colors hover:text-foreground">Explore</Link>
            <Link to="/about" className="transition-colors hover:text-foreground">About</Link>
            <a href="https://github.com" target="_blank" rel="noreferrer" className="transition-colors hover:text-foreground">GitHub</a>
            <a href="mailto:hello@biswa.io" className="transition-colors hover:text-foreground">Contact</a>
            <span className="cursor-default transition-colors hover:text-foreground">Privacy</span>
            <Link to="/login" className="text-muted-foreground/60 transition-colors hover:text-foreground">
              Internal login
            </Link>
          </nav>
        </div>

        <p className="mt-14 font-mono text-xs text-muted-foreground">
          © 2026 Biswa Artifacts.
        </p>
      </div>
    </footer>
  );
}
