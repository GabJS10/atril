import { invoke } from "@tauri-apps/api/core";
import type { AppError, Settings, SettingsPatch } from "./types";

// The only place that talks to Rust: one wrapper per command in docs/IPC.md.
// Commands reject with an AppError, see isAppError.

export function getSettings(): Promise<Settings> {
  return invoke<Settings>("get_settings");
}

export function updateSettings(patch: SettingsPatch): Promise<Settings> {
  return invoke<Settings>("update_settings", { patch });
}

export function isAppError(error: unknown): error is AppError {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    "message" in error &&
    typeof error.code === "string" &&
    typeof error.message === "string"
  );
}
