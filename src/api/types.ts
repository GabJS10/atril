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
