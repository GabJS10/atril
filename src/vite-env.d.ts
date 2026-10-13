/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Development switch for the reader's viewer: "native" or "pdfjs" (see src/reader/viewerKind.ts). */
  readonly VITE_ATRIL_VIEWER?: string;
}
