// SPIKE R0.2: estadísticas básicas (percentiles sobre milisegundos).

export type Summary = { n: number; p50: number; p95: number; max: number; mean: number };

const round = (value: number): number => Math.round(value * 10) / 10;

export function summarize(values: readonly number[]): Summary {
  if (values.length === 0) return { n: 0, p50: 0, p95: 0, max: 0, mean: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const at = (p: number): number => sorted[Math.round((sorted.length - 1) * p)] ?? 0;
  const total = sorted.reduce((sum, value) => sum + value, 0);
  return {
    n: sorted.length,
    p50: round(at(0.5)),
    p95: round(at(0.95)),
    max: round(sorted[sorted.length - 1] ?? 0),
    mean: round(total / sorted.length),
  };
}

export const nextFrame = (): Promise<number> =>
  new Promise((resolve) => requestAnimationFrame((time) => resolve(time)));

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => window.setTimeout(resolve, ms));
