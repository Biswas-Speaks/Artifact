import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { Workspace } from "@/components/Workspace";

export const Route = createFileRoute("/published")({
  component: PublishedPage,
});

function PublishedPage() {
  useEffect(() => {
    document.title = "Published — Biswa Artifacts";
  }, []);
  return <Workspace view="published" />;
}
