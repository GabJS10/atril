import { create } from "zustand";
import { openExternalUrl } from "../api/tauri";

type UpdateNoticeState = {
  /** "Ahora no" was pressed in this session. Not persisted: the notice comes back next time. */
  dismissed: boolean;
  dismiss: () => void;
};

/** Whether the update notice was dismissed (UI state, not stored). */
export const useUpdateNoticeStore = create<UpdateNoticeState>()((set) => ({
  dismissed: false,
  dismiss: () => set({ dismissed: true }),
}));

/** Opens the release page in the system browser. A refused link stays silent: the page is only a convenience. */
export function openRelease(url: string): void {
  void openExternalUrl(url).catch(() => undefined);
}
