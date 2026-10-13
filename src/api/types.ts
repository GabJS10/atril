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

// Library types (docs/IPC.md, fase 2).

export type BookSort = "title" | "author" | "added" | "last_opened" | "progress";
export type BookStatus = "unread" | "reading" | "finished";

export type BookQuery = {
  text?: string;
  collectionId?: string;
  favoritesOnly?: boolean;
  status?: BookStatus;
  sort?: BookSort;
  descending?: boolean;
};

export type Collection = {
  id: string;
  name: string;
  position: number;
  bookCount: number;
  sampleBooks: Book[];
};

export type HomeData = {
  continueReading: Book[];
  favorites: Book[];
  favoriteCount: number;
  bookCount: number;
  collections: Collection[];
};

export type ScanStatus = { running: boolean; found: number };

export type LibraryFolder = { id: string; path: string; addedAt: string };

export type ScanMetadata = {
  pageCount: number;
  title?: string;
  author?: string;
};

export type ImportRejection = { path: string; error: AppError };

export type ImportResult = { imported: Book[]; rejected: ImportRejection[] };

// Highlights (docs/IPC.md, fase 3).

export type HighlightColor = "ochre" | "sienna" | "sage" | "slate";

/** x1, y1, x2, y2 in PDF user space (origin bottom-left). */
export type PdfRect = [number, number, number, number];

export type HighlightInput = {
  bookId: string;
  page: number;
  rects: PdfRect[];
  text: string;
  color: HighlightColor;
  note?: string | null;
};

export type Highlight = {
  id: string;
  bookId: string;
  page: number;
  rects: PdfRect[];
  text: string;
  color: HighlightColor;
  note: string | null;
  createdAt: string;
  updatedAt: string;
};

export type HighlightPatch = { color?: HighlightColor; note?: string | null };

/** Result of `export_highlights`: how many highlights were written to the Markdown file. */
export type HighlightExport = { count: number };

// Native PDF engine (docs/IPC.md, "Motor de PDF (v0.7)").

/** Page size and PDF-to-viewer matrix at scale 1: the same as pdf.js's `getViewport({ scale: 1 })`. */
export type PageGeometry = {
  width: number;
  height: number;
  transform: [number, number, number, number, number, number];
};

export type OpenedDocument = {
  pageCount: number;
  pageBaseUrl: string;
  pages: PageGeometry[];
};
