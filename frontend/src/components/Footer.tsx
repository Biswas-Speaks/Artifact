import { Link } from "@tanstack/react-router";

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
