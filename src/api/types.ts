// Shared IPC types, mirrored from docs/IPC.md. Keep both in sync.

export type Zoom = "page_width" | "page_fit" | "auto" | number;
export type ViewMode = "normal" | "sepia" | "night";

export type Settings = {
  language: "system" | "es" | "en";
  theme: "dark" | "light";
  defaultZoom: Zoom;
  defaultViewMode: ViewMode;
};

export type SettingsPatch = Partial<Settings>;

export type ErrorCode =
  "not_found" | "file_missing" | "invalid_pdf" | "invalid_input" | "io" | "db" | "internal";

export type AppError = {
  code: ErrorCode;
  message: string;
};

// Reading and library types (docs/IPC.md, "Tipos compartidos").

export type Book = {
  id: string;
  title: string;
  author: string | null;
  fileName: string;
  pageCount: number | null;
  fileUrl: string;
  coverUrl: string | null;
  favorite: boolean;
  missing: boolean;
  scanState: "pending" | "done" | "failed";
  currentPage: number | null;
  progress: number | null;
  addedAt: string;
  lastOpenedAt: string | null;
};

export type ReadingState = {
  page: number;
  offsetInPage: number;
  zoom: Zoom;
  viewMode: ViewMode;
  updatedAt: string;
};

export type OpenedBook = {
  book: Book;
  readingState: ReadingState | null;
};

export type ReadingStateInput = {
  page: number;
  offsetInPage: number;
  zoom: Zoom;
  viewMode: ViewMode;
  pageCount: number;
};
