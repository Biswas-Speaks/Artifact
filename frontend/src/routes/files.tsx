import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { Workspace } from "@/components/Workspace";

export const Route = createFileRoute("/files")({
  component: FilesPage,
});

function FilesPage() {
  useEffect(() => {
    document.title = "Files — Biswa Artifacts";
  }, []);
  return <Workspace view="files" />;
}
