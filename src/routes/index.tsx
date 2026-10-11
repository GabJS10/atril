import { createFileRoute } from "@tanstack/react-router";
import { LibraryScreen } from "../library/LibraryScreen";

export const Route = createFileRoute("/")({
  component: LibraryScreen,
});
