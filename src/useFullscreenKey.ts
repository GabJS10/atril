import { useEffect } from "react";
import { toggleFullscreen } from "./api/tauri";

/** F11 switches the window to full screen, in every screen of the app. */
export function useFullscreenKey(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "F11" || event.ctrlKey || event.metaKey || event.altKey) return;
      event.preventDefault();
      void toggleFullscreen().catch(() => undefined); // Not running inside Tauri (e.g. a plain browser).
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
