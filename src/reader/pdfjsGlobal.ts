import * as pdfjsLib from "pdfjs-dist";

// pdf.js's viewer build reads the API from `globalThis.pdfjsLib` when it is evaluated, so it must be
// set before the viewer module runs. Import this module first (ESM evaluates imports in order).
Object.assign(globalThis, { pdfjsLib });
