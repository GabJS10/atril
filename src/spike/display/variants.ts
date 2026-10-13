// SPIKE R0.2: las cuatro formas de pintar una página en WebKitGTK.
import type { Format } from "./ipc";

export type VariantId = "a" | "b" | "c" | "d";

export type Loaded = {
  /** Elemento listo para insertar: ya decodificado (img) o ya dibujado (canvas). */
  element: HTMLImageElement | HTMLCanvasElement;
  /** Milisegundos hasta tener los bytes en el front (incluye el protocolo y la IPC de WebKit). */
  transferMs: number;
  /** Milisegundos de decodificación: img.decode(), o createImageBitmap en la variante b. */
  decodeMs: number;
  /** Milisegundos de drawImage (solo la variante b). */
  drawMs: number;
};

export type Variant = {
  id: VariantId;
  label: string;
  format: Format;
  load: (url: string) => Promise<Loaded>;
};

/** `<img>` con src al protocolo: espera a `load` y luego a `img.decode()` antes de mostrarla. */
function loadWithImage(url: string): Promise<Loaded> {
  return new Promise<Loaded>((resolve, reject) => {
    const img = new Image();
    const started = performance.now();
    img.onerror = () => reject(new Error(`no se pudo cargar ${url}`));
    img.onload = () => {
      const received = performance.now();
      img.decode().then(
        () =>
          resolve({
            element: img,
            transferMs: received - started,
            decodeMs: performance.now() - received,
            drawMs: 0,
          }),
        reject,
      );
    };
    img.src = url;
  });
}

/**
 * RGBA crudo: fetch → ArrayBuffer (cabecera de 8 bytes: ancho y alto en little endian) → ImageData →
 * createImageBitmap → drawImage en un canvas del tamaño de la página.
 */
async function loadRgba(url: string): Promise<Loaded> {
  const started = performance.now();
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status} en ${url}`);
  const buffer = await response.arrayBuffer();
  const received = performance.now();
  const header = new DataView(buffer);
  const width = header.getUint32(0, true);
  const height = header.getUint32(4, true);
  const pixels = new Uint8ClampedArray(buffer, 8, width * height * 4);
  const bitmap = await createImageBitmap(new ImageData(pixels, width, height));
  const decoded = performance.now();
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
  bitmap.close();
  const drawn = performance.now();
  return {
    element: canvas,
    transferMs: received - started,
    decodeMs: decoded - received,
    drawMs: drawn - decoded,
  };
}

export const VARIANTS: readonly Variant[] = [
  { id: "a", label: "a · BMP en <img>", format: "bmp", load: loadWithImage },
  { id: "b", label: "b · RGBA → canvas", format: "rgba", load: loadRgba },
  { id: "c", label: "c · JPEG q85 en <img>", format: "jpg", load: loadWithImage },
  { id: "d", label: "d · PNG en <img>", format: "png", load: loadWithImage },
];

export function variantById(id: string | null | undefined): Variant | undefined {
  return VARIANTS.find((variant) => variant.id === id);
}
