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
