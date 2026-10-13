// SPIKE R0.2 (desechable, sin PR): wrappers de los comandos de src-tauri/src/spike_display.rs.
// Viven aquí para no tocar src/api/tauri.ts, que solo debe tener la API de la app.
import { invoke } from "@tauri-apps/api/core";

export type Format = "bmp" | "rgba" | "jpg" | "png";

export type SpikePage = { t: number; width: number; height: number };

export type SpikeStatus = {
  enabled: boolean;
  ready: boolean;
  error: string | null;
  mode: string;
  auto: string | null;
  formats: string[];
  limit: number;
  pages: SpikePage[];
  zoomPages: SpikePage[];
  cacheBytes: number;
  precodeMs: number;
  outDir: string;
  serve: { requests: number; bytes: number; totalMs: number; maxMs: number };
};

export function spikeStatus(): Promise<SpikeStatus> {
  return invoke<SpikeStatus>("spike_status");
}

export function spikeSaveResults(name: string, json: string): Promise<string> {
  return invoke<string>("spike_save_results", { name, json });
}

/** Ruta del protocolo para una página de prueba. `tag` evita que el navegador reutilice la caché. */
export function pageUrl(t: number, format: Format, width: number, tag: string): string {
  return `atril://localhost/spike/${t}.${format}?w=${width}&v=${encodeURIComponent(tag)}`;
}
