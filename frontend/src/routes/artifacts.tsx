import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { Workspace } from "@/components/Workspace";

export const Route = createFileRoute("/artifacts")({
  component: ArtifactsPage,
});

function ArtifactsPage() {
  useEffect(() => {
    document.title = "Creative Studio — Biswa Artifacts";
  }, []);
  return <Workspace view="artifacts" />;
}
