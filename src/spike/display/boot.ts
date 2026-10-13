// SPIKE R0.2 (desechable, sin PR): con ATRIL_SPIKE_PAGES la app abre directamente la pantalla del spike.
import type { AppRouter } from "../../router";
import { spikeStatus } from "./ipc";

export async function bootSpike(router: AppRouter): Promise<void> {
  const status = await spikeStatus().catch(() => null);
  if (status?.enabled) await router.navigate({ to: "/spike-display" });
}
