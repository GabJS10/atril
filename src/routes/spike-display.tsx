import { createFileRoute } from "@tanstack/react-router";
import { SpikeDisplayScreen } from "../spike/display/SpikeDisplayScreen";

// SPIKE R0.2 (desechable, sin PR): ruta de prueba del visor de páginas.
export const Route = createFileRoute("/spike-display")({
  component: SpikeDisplayScreen,
});
