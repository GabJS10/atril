import { createFileRoute } from "@tanstack/react-router";
import { SettingsScreen } from "../library/SettingsScreen";

export const Route = createFileRoute("/settings")({
  component: SettingsScreen,
});
