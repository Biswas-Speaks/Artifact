import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { Workspace } from "@/components/Workspace";

export const Route = createFileRoute("/drafts")({
  component: DraftsPage,
});

function DraftsPage() {
  useEffect(() => {
    document.title = "Drafts — Biswa Artifacts";
  }, []);
  return <Workspace view="drafts" />;
}
