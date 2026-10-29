import { useUpdateCheckResult } from "../api/queries";
import { useT } from "../i18n";
import { ghostButton, primaryButton } from "../ui/buttons";
import { StateCard } from "../ui/StateCard";
import { openRelease, useUpdateNoticeStore } from "./updates";

/**
 * "Atril X está disponible" in the library shell (DESIGN.md, aviso). Only shows when the last check found a newer
 * release. It lives in the library, never in the reader.
 */
export function UpdateNotice({ className = "" }: { className?: string }) {
  const t = useT();
  const { data } = useUpdateCheckResult();
  const dismissed = useUpdateNoticeStore((state) => state.dismissed);
  const dismiss = useUpdateNoticeStore((state) => state.dismiss);
  if (!data?.available || dismissed) return null;

  return (
    <StateCard
      role="status"
      className={className}
      title={t("update.notice.title", { version: data.latestVersion })}
      body={t("update.notice.body")}
      actions={
        <>
          <button type="button" onClick={() => openRelease(data.url)} className={primaryButton}>
            {t("update.download")}
          </button>
          <button type="button" onClick={dismiss} className={ghostButton}>
            {t("update.later")}
          </button>
        </>
      }
    />
  );
}
