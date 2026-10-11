import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { Gallery } from "@/components/Gallery";
import { SectionHeading } from "@/components/SectionHeading";

export const Route = createFileRoute("/explore")({
  component: Explore,
});

function Explore() {
  useEffect(() => {
    document.title = "Explore — Biswa Artifacts";
  }, []);

  return (
    <section className="mx-auto max-w-6xl px-6 pb-28 pt-40">
      <SectionHeading
        eyebrow="EXPLORE"
        title="Every artifact, one gallery."
        subtitle="Filter by medium and step inside."
      />
      <Gallery />
    </section>
  );
}
