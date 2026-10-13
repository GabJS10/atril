// SPIKE R0.2 (desechable, sin PR): pantalla de prueba del visor de páginas. Botones para cambiar de variante,
// lanzar la suite (scroll y zoom) y ver el JSON. Con ATRIL_SPIKE_AUTO la app entra aquí sola y guarda el resultado.
import { useEffect, useRef, useState } from "react";
import { type SpikeStatus, pageUrl, spikeSaveResults, spikeStatus } from "./ipc";
import { runSuite, runZooms, viewerPages, waitReady } from "./suite";
import { PAGE_WIDTH, PageViewer } from "./viewer";
import { VARIANTS, type VariantId, variantById } from "./variants";

const megabytes = (bytes: number): string => (bytes / 1024 / 1024).toFixed(0);

function describe(status: SpikeStatus | null): string {
  if (!status) return "consultando el backend…";
  if (status.error) return `error: ${status.error}`;
  if (!status.enabled) return "spike desactivado: define ATRIL_SPIKE_PAGES";
  if (!status.ready) return `precodificando (${status.mode})…`;
  return [
    `${status.pages.length} páginas a 1240 px y ${status.zoomPages.length} a 2480 px`,
    `formatos ${status.formats.join(", ")}`,
    `caché ${megabytes(status.cacheBytes)} MB`,
    `precodificación ${Math.round(status.precodeMs)} ms`,
    `servidas por Rust: ${status.serve.requests}`,
  ].join(" · ");
}

/** Ejecuta la suite (o solo el zoom) de una variante, guarda el JSON en el backend y devuelve el texto a mostrar. */
async function runAndSave(
  variantId: VariantId,
  container: HTMLElement,
  zoomOnly: boolean,
  report: (text: string) => void,
): Promise<string> {
  const variant = variantById(variantId);
  if (!variant) throw new Error(`variante desconocida: ${variantId}`);
  const name = zoomOnly ? `${variant.id}-zoom` : variant.id;
  try {
    const json = zoomOnly
      ? JSON.stringify(
          { variant: variant.id, zoom: await runZooms(variant, await waitReady(report), container) },
          null,
          2,
        )
      : JSON.stringify(await runSuite(variant, container, report), null, 2);
    const path = await spikeSaveResults(name, json);
    return `${json}\n\nGuardado en ${path}`;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await spikeSaveResults(name, JSON.stringify({ error: message })).catch(() => undefined);
    return `Error: ${message}`;
  }
}

export function SpikeDisplayScreen() {
  const [status, setStatus] = useState<SpikeStatus | null>(null);
  const [variantId, setVariantId] = useState<VariantId>("a");
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState("");
  const viewerRef = useRef<HTMLDivElement>(null);
  const autoStarted = useRef(false);

  // Consulta el backend hasta que termina la precodificación (o falla).
  useEffect(() => {
    let active = true;
    let timer = 0;
    const poll = (): void => {
      spikeStatus()
        .then((next) => {
          if (!active) return;
          setStatus(next);
          if (next.enabled && !next.ready && !next.error) timer = window.setTimeout(poll, 250);
        })
        .catch((error: unknown) => {
          if (active) setLog(String(error));
        });
    };
    poll();
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, []);

  // Modo automático (ATRIL_SPIKE_AUTO): una sola suite, sin botones.
  useEffect(() => {
    const container = viewerRef.current;
    const variant = variantById(status?.auto);
    if (!status?.ready || !variant || autoStarted.current || !container) return;
    autoStarted.current = true;
    void runAndSave(variant.id, container, false, setLog).then(setLog);
  }, [status]);

  // Modo manual: un visor vivo con la variante elegida, para moverse a mano con la rueda del ratón.
  useEffect(() => {
    const container = viewerRef.current;
    const variant = variantById(variantId);
    if (!status?.ready || status.auto || busy || !container || !variant) return;
    const viewer = new PageViewer({
      container,
      pages: viewerPages(status),
      variant,
      urlFor: (page, index) => pageUrl(page.t, variant.format, PAGE_WIDTH, `live-${variant.id}-${index}`),
    });
    let frame = 0;
    const loop = (): void => {
      viewer.update();
      frame = requestAnimationFrame(loop);
    };
    loop();
    return () => {
      cancelAnimationFrame(frame);
      viewer.destroy();
    };
  }, [status, variantId, busy]);

  const start = (zoomOnly: boolean): void => {
    const container = viewerRef.current;
    if (busy || !container) return;
    setBusy(true);
    setLog("");
    void runAndSave(variantId, container, zoomOnly, setLog).then((text) => {
      setLog(text);
      setBusy(false);
    });
  };

  const ready = status?.ready === true;
  return (
    <main className="flex h-screen flex-col gap-2 p-3 text-sm">
      <header className="flex flex-wrap items-baseline gap-3">
        <h1 className="font-semibold">Spike R0.2 · páginas en WebKitGTK</h1>
        <span className="opacity-70">{describe(status)}</span>
      </header>
      <nav className="flex flex-wrap gap-2">
        {VARIANTS.map((variant) => (
          <button
            key={variant.id}
            type="button"
            disabled={busy}
            aria-pressed={variant.id === variantId}
            onClick={() => setVariantId(variant.id)}
            className={variant.id === variantId ? "underline underline-offset-4" : "opacity-70"}
          >
            {variant.label}
          </button>
        ))}
        <button type="button" disabled={!ready || busy} onClick={() => start(false)}>
          Suite completa
        </button>
        <button type="button" disabled={!ready || busy} onClick={() => start(true)}>
          Solo zoom
        </button>
      </nav>
      <div ref={viewerRef} className="relative min-h-0 flex-1 overflow-y-auto bg-black" />
      <pre className="max-h-64 overflow-auto whitespace-pre-wrap text-xs">{log}</pre>
    </main>
  );
}
