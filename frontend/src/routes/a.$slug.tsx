import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useEffect } from "react";
import { ArrowLeft } from "lucide-react";
import { ArtifactExperience } from "@/components/ArtifactExperience";
import { formatDate, getArtifact } from "@/lib/artifacts";

export const Route = createFileRoute("/a/$slug")({
  loader: ({ params }) => {
    const artifact = getArtifact(params.slug);
    if (!artifact) throw notFound();
    return { artifact };
  },
  notFoundComponent: ArtifactNotFound,
  component: ArtifactPage,
});

function ArtifactNotFound() {
  return (
    <section className="flex min-h-svh flex-col items-center justify-center px-6 text-center">
      <h1 className="font-display text-5xl font-bold">Artifact not found.</h1>
      <p className="mt-3 text-muted-foreground">
        It may be private, unpublished, or never existed.
      </p>
      <Link to="/explore" className="mt-6 text-accent">
        Explore artifacts →
      </Link>
    </section>
  );
}

function ArtifactPage() {
  const { artifact } = Route.useLoaderData();

  useEffect(() => {
    document.title = `${artifact.title} — Biswa Artifacts`;
  }, [artifact.title]);

  return (
    <article className="mx-auto max-w-5xl px-6 pb-28 pt-32">
      <Link
        to="/explore"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft size={14} /> All artifacts
      </Link>
      <p className="mt-10 font-mono text-[11px] uppercase tracking-[0.3em] text-accent">
        {artifact.category}
      </p>
      <h1 className="mt-3 font-display text-5xl font-bold tracking-tight md:text-7xl">
        {artifact.title}
      </h1>
      <p className="mt-5 max-w-2xl text-lg text-muted-foreground">{artifact.description}</p>
      <p className="mt-4 font-mono text-xs text-muted-foreground">
        Published {formatDate(artifact.publishedAt)} · biswa.io/a/{artifact.slug}
      </p>

      <div className="relative mt-12">
        <ArtifactExperience artifact={artifact} />
      </div>
      <p className="mt-4 font-mono text-[11px] text-muted-foreground">
        * Sample artifact for demonstration.
      </p>
    </article>
  );
}
