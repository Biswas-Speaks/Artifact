import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { AboutBlock } from "@/components/AboutBlock";

export const Route = createFileRoute("/about")({
  component: About,
});

function About() {
  useEffect(() => {
    document.title = "About — Biswa Artifacts";
  }, []);

  return (
    <div className="pt-16">
      <AboutBlock />
    </div>
  );
}
