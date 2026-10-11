import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { AboutBlock } from "@/components/AboutBlock";
import { Capabilities } from "@/components/Capabilities";
import { Gallery } from "@/components/Gallery";
import { Hero } from "@/components/Hero";
import { Publishing } from "@/components/Publishing";
import { SectionHeading } from "@/components/SectionHeading";
import { Studio } from "@/components/Studio";
import { UseCases } from "@/components/UseCases";

export const Route = createFileRoute("/")({
  component: Index,
});

function Index() {
  useEffect(() => {
    document.title = "Biswa Artifacts — Create · Publish · Inspire";
  }, []);

  return (
    <>
      <Hero />
      <section id="creations" className="mx-auto max-w-6xl scroll-mt-24 px-6 pb-20 pt-12">
        <SectionHeading
          eyebrow="01 — CREATIONS"
          title="Made to be experienced."
          subtitle="More than files. More than pages. Every artifact is a world of its own."
        />
        <Gallery limit={6} />
      </section>
      <UseCases />
      <Capabilities />
      <Studio />
      <Publishing />
      <AboutBlock />
    </>
  );
}
