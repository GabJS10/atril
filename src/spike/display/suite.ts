// SPIKE R0.2: suite automática por variante: scroll de lectura, scroll rápido con saltos y zoom.
import { pageUrl, type SpikePage, type SpikeStatus, spikeStatus } from "./ipc";
import { nextFrame, sleep, type Summary, summarize } from "./metrics";
import { PAGE_WIDTH, PageViewer, type ViewerMetrics } from "./viewer";
import type { Variant } from "./variants";

/** Páginas del visor virtualizado: la lista de páginas de prueba repetida hasta 300. */
export const VIEWER_PAGES = 300;
const ZOOM_WIDTH = 2480;
const ZOOM_SCALE = 2;
const READING = { pxPerSecond: 200, durationMs: 45_000 };
const FAST = { pxPerSecond: 4000, durationMs: 20_000, jumpEveryMs: 4000, jumpPages: 20 };

type ScrollPlan = {
  pxPerSecond: number;
  durationMs: number;
  jumpEveryMs?: number;
  jumpPages?: number;
};

export type ScrollResult = {
  durationMs: number;
  frames: number;
  jumps: number;
  frameMs: Summary & { over50: number };
  blankFrames: number;
  enters: number;
  blankEnters: number;
  abandoned: number;
  requested: number;
  errors: number;
  lateDiscards: number;
  enterLatencyMs: Summary;
  readyMs: Summary;
  transferMs: Summary;
  decodeMs: Summary;
  drawMs: Summary;
  rustServe: { requests: number; bytes: number; totalMs: number; maxMsSinceStart: number };
};

export type ZoomResult = {
  page: number;
  /** Milisegundos hasta el primer fotograma con el transform (zoom instantáneo). */
  scaleMs: number;
  /** Milisegundos hasta mostrar la imagen de 2480 px nítida. */
  sharpMs: number;
  transferMs: number;
  decodeMs: number;
  drawMs: number;
  /** Fotogramas durante el zoom en los que la página no tenía ningún elemento (parpadeo). */
  blankFrames: number;
  frames: number;
  sharpPixelWidth: number;
};

export type SuiteResult = {
  variant: string;
  label: string;
  format: string;
  startedAt: string;
  display: {
    innerWidth: number;
    innerHeight: number;
    devicePixelRatio: number;
    hardwareConcurrency: number;
    userAgent: string;
  };
  config: {
    viewerPages: number;
    pageWidth: number;
    zoomWidth: number;
    zoomScale: number;
    reading: typeof READING;
    fast: typeof FAST;
  };
  precode: {
    formats: string[];
    limit: number;
    pages1240: number;
    pages2480: number;
    cacheBytes: number;
    precodeMs: number;
  };
  reading: ScrollResult;
  fast: ScrollResult;
  zoom: ZoomResult[];
};

/** Espera a que el backend tenga las páginas precodificadas. */
export async function waitReady(onStep: (text: string) => void): Promise<SpikeStatus> {
  const deadline = performance.now() + 120_000;
  for (;;) {
    const status = await spikeStatus();
    if (status.error) throw new Error(status.error);
    if (!status.enabled) throw new Error("spike desactivado: falta ATRIL_SPIKE_PAGES");
    if (status.ready) return status;
    if (performance.now() > deadline) throw new Error("la precodificación no termina");
    onStep(`precodificando (${status.mode})…`);
    await sleep(250);
  }
}

/** Las páginas del visor: la lista de páginas de prueba repetida hasta `VIEWER_PAGES`. */
export function viewerPages(status: SpikeStatus): SpikePage[] {
  const pool = status.pages;
  const pages: SpikePage[] = [];
  for (let index = 0; index < VIEWER_PAGES; index++) {
    const page = pool[index % pool.length];
    if (!page) throw new Error("no hay páginas de prueba");
    pages.push(page);
  }
  return pages;
}

async function warmUp(viewer: PageViewer): Promise<void> {
  const deadline = performance.now() + 5_000;
  while (!viewer.visibleReady() && performance.now() < deadline) {
    viewer.update();
    await sleep(20);
  }
  viewer.update();
}

/** Mueve el contenedor a velocidad constante y, si el plan lo pide, salta páginas de golpe. */
function scroll(
  container: HTMLElement,
  viewer: PageViewer,
  plan: ScrollPlan,
): Promise<{ frameMs: number[]; jumps: number }> {
  return new Promise((resolve) => {
    const frameMs: number[] = [];
    let jumps = 0;
    let start = -1;
    let previous = -1;
    let nextJump = plan.jumpEveryMs ?? Number.POSITIVE_INFINITY;
    const tick = (now: number): void => {
      if (start < 0) {
        start = now;
        previous = now;
        viewer.update();
        requestAnimationFrame(tick);
        return;
      }
      const dt = now - previous;
      previous = now;
      frameMs.push(dt);
      const elapsed = now - start;
      if (plan.jumpPages && elapsed >= nextJump) {
        viewer.jumpBy(plan.jumpPages);
        jumps++;
        nextJump += plan.jumpEveryMs ?? 0;
      }
      container.scrollTop += (plan.pxPerSecond * dt) / 1000;
      viewer.update();
      if (elapsed < plan.durationMs) requestAnimationFrame(tick);
      else resolve({ frameMs, jumps });
    };
    requestAnimationFrame(tick);
  });
}

async function runScrollScenario(
  variant: Variant,
  status: SpikeStatus,
  container: HTMLElement,
  plan: ScrollPlan,
  tag: string,
): Promise<ScrollResult> {
  container.replaceChildren();
  container.scrollTop = 0;
  const viewer = new PageViewer({
    container,
    pages: viewerPages(status),
    variant,
    urlFor: (page, index) => pageUrl(page.t, variant.format, PAGE_WIDTH, `${tag}-${index}`),
  });
  try {
    await warmUp(viewer);
    viewer.resetMetrics();
    container.scrollTop = 0;
    const before = (await spikeStatus()).serve;
    const started = performance.now();
    const { frameMs, jumps } = await scroll(container, viewer, plan);
    const durationMs = performance.now() - started;
    const after = (await spikeStatus()).serve;
    return summarizeScenario(viewer.metrics, frameMs, jumps, durationMs, before, after);
  } finally {
    viewer.destroy();
  }
}

function summarizeScenario(
  metrics: ViewerMetrics,
  frameMs: number[],
  jumps: number,
  durationMs: number,
  before: SpikeStatus["serve"],
  after: SpikeStatus["serve"],
): ScrollResult {
  return {
    durationMs: Math.round(durationMs),
    frames: frameMs.length,
    jumps,
    frameMs: { ...summarize(frameMs), over50: frameMs.filter((dt) => dt > 50).length },
    blankFrames: metrics.blankFrames,
    enters: metrics.enters,
    blankEnters: metrics.blankEnters,
    abandoned: metrics.abandoned,
    requested: metrics.requested,
    errors: metrics.errors,
    lateDiscards: metrics.lateDiscards,
    enterLatencyMs: summarize(metrics.enterLatencyMs),
    readyMs: summarize(metrics.readyMs),
    transferMs: summarize(metrics.transferMs),
    decodeMs: summarize(metrics.decodeMs),
    drawMs: summarize(metrics.drawMs),
    rustServe: {
      requests: after.requests - before.requests,
      bytes: after.bytes - before.bytes,
      totalMs: Math.round((after.totalMs - before.totalMs) * 10) / 10,
      maxMsSinceStart: after.maxMs,
    },
  };
}

const pixelWidth = (element: HTMLImageElement | HTMLCanvasElement): number =>
  element instanceof HTMLImageElement ? element.naturalWidth : element.width;

/**
 * Zoom 100 % → 200 %: primero el transform CSS sobre la imagen de 1240 px (al instante) y después la de 2480 px,
 * que se decodifica antes de cambiarla. Se vigila cada fotograma por si la página se queda sin elemento.
 */
async function runZoom(
  variant: Variant,
  status: SpikeStatus,
  container: HTMLElement,
  t: number,
): Promise<ZoomResult> {
  const low = status.pages.find((page) => page.t === t);
  const high = status.zoomPages.find((page) => page.t === t);
  if (!low || !high) throw new Error(`la página ${t} no tiene versión de zoom`);
  container.replaceChildren();
  container.scrollTop = 0;
  const holder = document.createElement("div");
  holder.style.cssText = `position:relative;margin:24px auto;width:${PAGE_WIDTH}px;height:${low.height}px;transform-origin:0 0;`;
  container.appendChild(holder);
  const tag = `zoom-${t}-${Date.now()}`;

  const loadedLow = await variant.load(pageUrl(t, variant.format, PAGE_WIDTH, `${tag}-lo`));
  loadedLow.element.style.cssText = `display:block;width:${PAGE_WIDTH}px;height:${low.height}px;`;
  holder.replaceChildren(loadedLow.element);
  await nextFrame();

  let frames = 0;
  let blankFrames = 0;
  let watching = true;
  const watch = (): void => {
    if (!watching) return;
    frames++;
    if (holder.childElementCount === 0) blankFrames++;
    requestAnimationFrame(watch);
  };
  requestAnimationFrame(watch);

  const started = performance.now();
  holder.style.transform = `scale(${ZOOM_SCALE})`;
  await nextFrame();
  const scaleMs = performance.now() - started;

  const loadedHigh = await variant.load(pageUrl(t, variant.format, ZOOM_WIDTH, `${tag}-hi`));
  loadedHigh.element.style.cssText = `display:block;width:${ZOOM_WIDTH}px;height:auto;`;
  holder.replaceChildren(loadedHigh.element);
  holder.style.transform = "";
  await nextFrame();
  const sharpMs = performance.now() - started;
  watching = false;
  container.replaceChildren();

  return {
    page: t,
    scaleMs: Math.round(scaleMs * 10) / 10,
    sharpMs: Math.round(sharpMs * 10) / 10,
    transferMs: loadedHigh.transferMs,
    decodeMs: loadedHigh.decodeMs,
    drawMs: loadedHigh.drawMs,
    blankFrames,
    frames,
    sharpPixelWidth: pixelWidth(loadedHigh.element),
  };
}

/** Zoom sobre las páginas de prueba de texto y de escaneo (las que tienen versión a 2480 px). */
export async function runZooms(
  variant: Variant,
  status: SpikeStatus,
  container: HTMLElement,
): Promise<ZoomResult[]> {
  const results: ZoomResult[] = [];
  for (const page of status.zoomPages) {
    results.push(await runZoom(variant, status, container, page.t));
  }
  container.replaceChildren();
  return results;
}

/** Suite completa de una variante. Devuelve el JSON que guarda el backend en `<out>/<variante>.json`. */
export async function runSuite(
  variant: Variant,
  container: HTMLElement,
  onStep: (text: string) => void,
): Promise<SuiteResult> {
  const status = await waitReady(onStep);
  onStep(`${variant.label}: scroll de lectura…`);
  const reading = await runScrollScenario(variant, status, container, READING, "reading");
  onStep(`${variant.label}: scroll rápido con saltos…`);
  const fast = await runScrollScenario(variant, status, container, FAST, "fast");
  onStep(`${variant.label}: zoom…`);
  const zoom = await runZooms(variant, status, container);
  return {
    variant: variant.id,
    label: variant.label,
    format: variant.format,
    startedAt: new Date().toISOString(),
    display: {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio,
      hardwareConcurrency: navigator.hardwareConcurrency,
      userAgent: navigator.userAgent,
    },
    config: {
      viewerPages: VIEWER_PAGES,
      pageWidth: PAGE_WIDTH,
      zoomWidth: ZOOM_WIDTH,
      zoomScale: ZOOM_SCALE,
      reading: READING,
      fast: FAST,
    },
    precode: {
      formats: status.formats,
      limit: status.limit,
      pages1240: status.pages.length,
      pages2480: status.zoomPages.length,
      cacheBytes: status.cacheBytes,
      precodeMs: Math.round(status.precodeMs),
    },
    reading,
    fast,
    zoom,
  };
}
