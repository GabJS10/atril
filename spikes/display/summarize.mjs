#!/usr/bin/env node
// Resume los resultados del spike R0.2 (bench.sh) en tablas Markdown.
// Uso: node spikes/display/summarize.mjs <carpeta-resultados>
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const dir = process.argv[2];
if (!dir) {
  console.error("uso: summarize.mjs <carpeta-resultados>");
  process.exit(1);
}
const file = (name) => path.join(dir, name);
const read = (name) => JSON.parse(readFileSync(file(name), "utf8"));
const num = (value, digits = 1) => (typeof value === "number" ? value.toFixed(digits) : "–");
const mb = (bytes) => (bytes / 1024 / 1024).toFixed(0);
const out = [];
const print = (line = "") => out.push(line);

if (existsSync(file("bench-encode.json"))) {
  const bench = read("bench-encode.json");
  print("### Coste de codificar en Rust (banco, sin WebKit)");
  print("| Formato | Ancho | Páginas | p50 ms | p95 ms | máx ms | media ms | tamaño medio KiB |");
  print("|---|---|---|---|---|---|---|---|");
  for (const row of bench.rows) {
    print(
      `| ${row.format} | ${row.width} | ${row.pages} | ${num(row.encodeMs.p50)} | ${num(row.encodeMs.p95)} | ${num(row.encodeMs.max)} | ${num(row.encodeMs.mean)} | ${num(row.bytes.mean / 1024, 0)} |`,
    );
  }
  print(
    `Decodificar el PNG de origen a 1240 px: p50 ${num(bench.decodeSourcePngMs1240.p50)} ms, máx ${num(bench.decodeSourcePngMs1240.max)} ms.`,
  );
  print();
}

const ids = ["a", "b", "c", "d"].filter((id) => existsSync(file(`${id}.json`)));
const results = Object.fromEntries(ids.map((id) => [id, read(`${id}.json`)]));
const valid = ids.filter((id) => !results[id].error);
for (const id of ids.filter((item) => results[item].error))
  print(`Variante ${id}: error: ${results[id].error}`);

const scenarioTitle = {
  reading: "Scroll de lectura (200 px/s, 45 s)",
  fast: "Scroll rápido (4000 px/s, 20 s, saltos de 20 páginas cada 4 s)",
};
for (const scenario of ["reading", "fast"]) {
  print(`### ${scenarioTitle[scenario]}`);
  print(
    "| Variante | Fotogramas | p50 ms | p95 ms | máx ms | >50 ms | Fotogramas con blanco | Entradas en blanco | Latencia en blanco p50 / p95 / máx ms | Carga p50 / p95 / máx ms | Transporte p50 ms | Decodificación p50 ms | Saltos | Peticiones Rust |",
  );
  print("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const id of valid) {
    const s = results[id][scenario];
    print(
      `| ${id} | ${s.frames} | ${num(s.frameMs.p50)} | ${num(s.frameMs.p95)} | ${num(s.frameMs.max)} | ${s.frameMs.over50} | ${s.blankFrames} | ${s.blankEnters} / ${s.enters} | ${num(s.enterLatencyMs.p50)} / ${num(s.enterLatencyMs.p95)} / ${num(s.enterLatencyMs.max)} | ${num(s.readyMs.p50)} / ${num(s.readyMs.p95)} / ${num(s.readyMs.max)} | ${num(s.transferMs.p50)} | ${num(s.decodeMs.p50)} | ${s.jumps} | ${s.rustServe.requests} |`,
    );
  }
  print();
}

print("### Zoom 100 % → 200 % (página de texto y de escaneo)");
print(
  "| Variante | Página | Transform ms | Nítida ms | Transporte ms | Decodificación ms | Dibujo ms | Fotogramas sin elemento | Ancho nítido px |",
);
print("|---|---|---|---|---|---|---|---|---|");
for (const id of valid) {
  for (const z of results[id].zoom) {
    print(
      `| ${id} | ${z.page < 30 ? "texto" : "escaneo"} | ${num(z.scaleMs)} | ${num(z.sharpMs)} | ${num(z.transferMs)} | ${num(z.decodeMs)} | ${num(z.drawMs)} | ${z.blankFrames} / ${z.frames} | ${z.sharpPixelWidth} |`,
    );
  }
}
print();

// Picos de memoria: VmHWM del proceso; se suman los procesos WebKit del mismo tipo.
const parsePeaks = (name) => {
  const peaks = {};
  for (const line of readFileSync(file(name), "utf8").trim().split("\n")) {
    const [key, value] = line.split(" ");
    peaks[key] = (peaks[key] ?? 0) + Number(value);
  }
  return peaks;
};
print("### Memoria (MB; pico = VmHWM; entre paréntesis, máximo muestreado cada segundo)");
print(
  "| Variante | Caché precodificada | RSS app (pico) | WebKit web (pico) | WebKit red (pico) | WebKit GPU (pico) | Sistema usado (máx.) | Swap usado (máx.) | RSS app sin caché (pico − caché) |",
);
print("|---|---|---|---|---|---|---|---|---|");
for (const id of valid) {
  const peaks = parsePeaks(`peaks-${id}.txt`);
  const rows = readFileSync(file(`rss-${id}.csv`), "utf8")
    .trim()
    .split("\n")
    .slice(1)
    .map((line) => line.split(",").map(Number));
  const maxOf = (index) => Math.max(...rows.map((row) => row[index] ?? 0));
  const cache = results[id].precode.cacheBytes;
  const appPeak = (peaks.app_hwm_kb ?? 0) * 1024;
  const kbToMb = (kb) => mb(kb * 1024);
  print(
    `| ${id} | ${mb(cache)} | ${mb(appPeak)} (${kbToMb(maxOf(1))}) | ${kbToMb(peaks.webkit_web_hwm_kb ?? 0)} (${kbToMb(maxOf(2))}) | ${kbToMb(peaks.webkit_net_hwm_kb ?? 0)} | ${kbToMb(peaks.webkit_gpu_hwm_kb ?? 0)} | ${maxOf(6)} | ${maxOf(7)} | ${mb(appPeak - cache)} |`,
  );
}
print();

const precode = valid.length ? results[valid[0]].precode : null;
if (precode) {
  print(
    `Precodificación de ${precode.formats.join(", ")} (${precode.pages1240} páginas a 1240 px y ${precode.pages2480} a 2480 px): ${num(precode.precodeMs, 0)} ms, caché ${mb(precode.cacheBytes)} MB.`,
  );
}
console.log(out.join("\n"));
