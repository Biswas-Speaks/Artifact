import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { Workspace } from "@/components/Workspace";

export const Route = createFileRoute("/images")({
  component: ImagesPage,
});

function ImagesPage() {
  useEffect(() => {
    document.title = "Images — Biswa Artifacts";
  }, []);
  return <Workspace view="images" />;
}
