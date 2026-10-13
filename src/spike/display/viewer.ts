// SPIKE R0.2: visor virtualizado de prueba. Solo existen en el DOM las páginas dentro de la ventana visible ±2;
// el resto son huecos del tamaño de la página. Se manipula el DOM a mano (sin React) para que el coste de
// la propia UI no contamine los fotogramas que se miden.
import type { SpikePage } from "./ipc";
import type { Loaded, Variant } from "./variants";

export const PAGE_WIDTH = 1240;
export const GAP = 16;
const MARGIN = 2;

export type ViewerMetrics = {
  requested: number;
  errors: number;
  /** Cargas que llegaron cuando la página ya había salido de la ventana. */
  lateDiscards: number;
  /** Veces que una página entra en pantalla. */
  enters: number;
  /** De ellas, las que no tenían la imagen lista al entrar: son las páginas en blanco visibles. */
  blankEnters: number;
  /** Páginas que salieron de pantalla antes de estar listas. */
  abandoned: number;
  /** Fotogramas con alguna página visible sin imagen. */
  blankFrames: number;
  /** Desde que una página en blanco entra en pantalla hasta que tiene imagen. */
  enterLatencyMs: number[];
  /** Desde que se pide la página (entra en la ventana ±2) hasta que tiene imagen. */
  readyMs: number[];
  transferMs: number[];
  decodeMs: number[];
  drawMs: number[];
};

function emptyMetrics(): ViewerMetrics {
  return {
    requested: 0,
    errors: 0,
    lateDiscards: 0,
    enters: 0,
    blankEnters: 0,
    abandoned: 0,
    blankFrames: 0,
    enterLatencyMs: [],
    readyMs: [],
    transferMs: [],
    decodeMs: [],
    drawMs: [],
  };
}

type Slot = { root: HTMLDivElement; ready: boolean; cancelled: boolean };

export type ViewerOptions = {
  container: HTMLElement;
  pages: readonly SpikePage[];
  variant: Variant;
  urlFor: (page: SpikePage, index: number) => string;
};

export class PageViewer {
  metrics: ViewerMetrics = emptyMetrics();
  private readonly stage = document.createElement("div");
  private readonly tops: number[] = [];
  private readonly slots = new Map<number, Slot>();
  private readonly pendingEnter = new Map<number, number>();
  private visible = new Set<number>();
  private destroyed = false;

  constructor(private readonly options: ViewerOptions) {
    let y = 0;
    for (const page of options.pages) {
      this.tops.push(y);
      y += page.height + GAP;
    }
    this.stage.style.cssText = `position:relative;width:${PAGE_WIDTH}px;height:${y}px;margin:0 auto;`;
    options.container.appendChild(this.stage);
  }

  topOf(index: number): number {
    return this.tops[index] ?? 0;
  }

  /** Índice de la última página que empieza en `y` o antes. */
  indexAt(y: number): number {
    let low = 0;
    let high = this.tops.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if (this.topOf(mid) <= y) low = mid;
      else high = mid - 1;
    }
    return low;
  }

  /** Salta `count` páginas desde la primera visible (un salto de lectura grande). */
  jumpBy(count: number): void {
    const target = Math.min(
      this.options.pages.length - 1,
      this.indexAt(this.options.container.scrollTop) + count,
    );
    this.options.container.scrollTop = this.topOf(target);
  }

  /** True si hay páginas visibles y todas tienen ya su imagen. */
  visibleReady(): boolean {
    if (this.visible.size === 0) return false;
    for (const index of this.visible) {
      if (this.slots.get(index)?.ready !== true) return false;
    }
    return true;
  }

  resetMetrics(): void {
    this.metrics = emptyMetrics();
  }

  /** Llamar en cada fotograma (o tras cada movimiento de scroll): crea, recicla y mide. */
  update(): void {
    if (this.destroyed) return;
    const { container, pages } = this.options;
    const top = container.scrollTop;
    const bottom = top + container.clientHeight;
    const first = this.indexAt(top);
    let last = first;
    while (last + 1 < pages.length && this.topOf(last + 1) < bottom) last++;

    const visible = new Set<number>();
    for (let index = first; index <= last; index++) visible.add(index);

    const from = Math.max(0, first - MARGIN);
    const to = Math.min(pages.length - 1, last + MARGIN);
    for (const index of [...this.slots.keys()]) {
      if (index < from || index > to) this.remove(index);
    }
    for (let index = from; index <= to; index++) {
      if (!this.slots.has(index)) this.create(index);
    }

    const now = performance.now();
    let blank = false;
    for (const index of visible) {
      const ready = this.slots.get(index)?.ready === true;
      if (!ready) blank = true;
      if (!this.visible.has(index)) {
        this.metrics.enters++;
        if (!ready) {
          this.metrics.blankEnters++;
          this.pendingEnter.set(index, now);
        }
      }
    }
    for (const index of this.visible) {
      if (!visible.has(index) && this.pendingEnter.delete(index)) this.metrics.abandoned++;
    }
    if (blank) this.metrics.blankFrames++;
    this.visible = visible;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const index of [...this.slots.keys()]) this.remove(index);
    this.stage.remove();
  }

  private create(index: number): void {
    const page = this.options.pages[index];
    if (!page) return;
    const root = document.createElement("div");
    root.dataset.page = String(index);
    root.style.cssText = `position:absolute;left:0;top:${this.topOf(index)}px;width:${PAGE_WIDTH}px;height:${page.height}px;background:#1d1d1d;`;
    this.stage.appendChild(root);
    const slot: Slot = { root, ready: false, cancelled: false };
    this.slots.set(index, slot);
    this.metrics.requested++;
    const started = performance.now();
    this.options.variant.load(this.options.urlFor(page, index)).then(
      (loaded) => this.settle(index, slot, page, loaded, started),
      () => {
        this.metrics.errors++;
      },
    );
  }

  private settle(index: number, slot: Slot, page: SpikePage, loaded: Loaded, started: number): void {
    if (slot.cancelled) {
      this.metrics.lateDiscards++;
      return;
    }
    loaded.element.style.cssText = `display:block;width:${PAGE_WIDTH}px;height:${page.height}px;`;
    slot.root.replaceChildren(loaded.element);
    slot.ready = true;
    const now = performance.now();
    const metrics = this.metrics;
    metrics.readyMs.push(now - started);
    metrics.transferMs.push(loaded.transferMs);
    metrics.decodeMs.push(loaded.decodeMs);
    metrics.drawMs.push(loaded.drawMs);
    const enteredAt = this.pendingEnter.get(index);
    if (enteredAt !== undefined) {
      metrics.enterLatencyMs.push(now - enteredAt);
      this.pendingEnter.delete(index);
    }
  }

  private remove(index: number): void {
    const slot = this.slots.get(index);
    if (!slot) return;
    slot.cancelled = true;
    slot.root.remove();
    this.slots.delete(index);
    if (this.pendingEnter.delete(index)) this.metrics.abandoned++;
  }
}
