/// <reference types="vitest/config" />
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { type Plugin, defineConfig } from "vite";
import { viteStaticCopy } from "vite-plugin-static-copy";

const host = process.env.TAURI_DEV_HOST;

// JPEG 2000 is decoded by the backend through this file, which pdf.js loads in place of openjpeg.wasm.
const jpxBridgeSource = "src/reader/jpxBridge.js";
// pdf.js's own JavaScript decoder, served under another name: the bridge imports it for the images the backend
// refuses, and it is copied from node_modules at build time, so no binary is committed.
const jsFallbackSource = "node_modules/pdfjs-dist/wasm/openjpeg_nowasm_fallback.js";
const jsFallbackName = "openjpeg_js_fallback.js";

/**
 * Fails the build unless dist/pdfjs/wasm holds our JPEG 2000 bridge under pdf.js's fallback name, the renamed copy of
 * pdf.js's JavaScript decoder, and no openjpeg.wasm: pdf.js would otherwise compile a decoder that WebKitGTK refuses
 * (relaxed SIMD).
 */
function jpxBridgeCheck(): Plugin {
  let root = process.cwd();
  let outDir = "dist";
  return {
    name: "atril-jpx-bridge-check",
    apply: "build",
    configResolved(config) {
      root = config.root;
      outDir = config.build.outDir;
    },
    closeBundle() {
      const wasmDir = path.resolve(root, outDir, "pdfjs/wasm");
      if (existsSync(path.join(wasmDir, "openjpeg.wasm"))) {
        throw new Error(
          "dist/pdfjs/wasm/openjpeg.wasm must not be shipped: JPEG 2000 goes through jpxBridge.js",
        );
      }
      const fallback = path.join(wasmDir, "openjpeg_nowasm_fallback.js");
      if (!existsSync(fallback))
        throw new Error(`${fallback} is missing: pdf.js would have no JPEG 2000 decoder`);
      if (!readFileSync(fallback).equals(readFileSync(path.resolve(root, jpxBridgeSource)))) {
        throw new Error(`${fallback} is not ${jpxBridgeSource}`);
      }
      const jsFallback = path.join(wasmDir, jsFallbackName);
      if (!existsSync(jsFallback)) {
        throw new Error(`${jsFallback} is missing: the bridge imports it for the images the backend refuses`);
      }
      if (!readFileSync(jsFallback).equals(readFileSync(path.resolve(root, jsFallbackSource)))) {
        throw new Error(`${jsFallback} is not pdf.js's ${jsFallbackSource}`);
      }
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  // The router plugin must run before the React plugin.
  plugins: [
    tanstackRouter({
      target: "react",
      routeFileIgnorePattern: String.raw`\.test\.tsx?$`,
    }),
    react(),
    tailwindcss(),
    // pdf.js reads WebAssembly decoders (JBIG2, and the JPEG 2000 bridge below), CMaps, standard fonts and ICC
    // profiles from these folders. They are served under /pdfjs/ in dev and copied to dist/pdfjs/ in the build.
    viteStaticCopy({
      targets: [
        {
          // Everything pdf.js ships, except openjpeg.wasm and its fallback, which the bridge replaces.
          src: [
            "node_modules/pdfjs-dist/wasm/*",
            "!node_modules/pdfjs-dist/wasm/openjpeg.wasm",
            "!node_modules/pdfjs-dist/wasm/openjpeg_nowasm_fallback.js",
          ],
          dest: "pdfjs/wasm",
          rename: { stripBase: true },
        },
        // The bridge takes pdf.js's fallback name: the worker imports it once openjpeg.wasm fails to load.
        // stripBase drops the folders of its source path; a plain string rename would keep them.
        {
          src: jpxBridgeSource,
          dest: "pdfjs/wasm",
          rename: { stripBase: true, name: "openjpeg_nowasm_fallback.js" },
        },
        // pdf.js's JavaScript decoder under another name (second level, imported by the bridge).
        { src: jsFallbackSource, dest: "pdfjs/wasm", rename: { stripBase: true, name: jsFallbackName } },
        { src: "node_modules/pdfjs-dist/cmaps/*", dest: "pdfjs/cmaps", rename: { stripBase: true } },
        {
          src: "node_modules/pdfjs-dist/standard_fonts/*",
          dest: "pdfjs/standard_fonts",
          rename: { stripBase: true },
        },
        { src: "node_modules/pdfjs-dist/iccs/*", dest: "pdfjs/iccs", rename: { stripBase: true } },
      ],
    }),
    jpxBridgeCheck(),
  ],

  // Tauri: keep Rust errors visible and use a fixed port.
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: { ignored: ["**/src-tauri/**", "**/.claude/worktrees/**"] },
  },

  test: {
    environment: "jsdom",
    globals: false,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    css: false,
    // The bridge imports the renamed pdf.js decoder from its own folder. The file only exists in dist/ after the build,
    // so the tests resolve that import to node_modules, where the build copies it from.
    alias: [{ find: /^\.\/openjpeg_js_fallback\.js$/, replacement: path.resolve(jsFallbackSource) }],
  },
});
