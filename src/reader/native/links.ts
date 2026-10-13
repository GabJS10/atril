import type { LinkTarget, PageLink } from "../../api/types";

export const LINK_CLASS = "atril-link";

/** Where an internal link goes: a page (1-based) and how far down it, in points at scale 1 (null: its top). */
export type InternalTarget = { page: number; y: number | null };

export function isInternal(target: LinkTarget): target is InternalTarget {
  return "page" in target;
}

/** The data attributes a link element carries, so a click can be resolved from the DOM alone. */
export function linkAttributes(link: PageLink): Record<string, string> {
  if (isInternal(link.target)) {
    return {
      "data-target-page": String(link.target.page),
      "data-target-y": link.target.y === null ? "" : String(link.target.y),
    };
  }
  return { "data-uri": link.target.uri };
}

/** Reads a link element back. Null when it does not describe a usable target. */
export function targetOfElement(element: HTMLElement): LinkTarget | null {
  const { targetPage, targetY, uri } = element.dataset;
  if (uri) return { uri };
  const page = Number(targetPage);
  if (!targetPage || !Number.isInteger(page) || page < 1) return null;
  const y = targetY === undefined || targetY === "" ? null : Number(targetY);
  return { page, y: y !== null && Number.isFinite(y) ? y : null };
}

/** Schemes the reader opens outside the app. The engine already filters them; this is the second lock. */
const EXTERNAL_SCHEMES = new Set(["http:", "https:", "mailto:"]);

export function isOpenableUri(uri: string): boolean {
  try {
    return EXTERNAL_SCHEMES.has(new URL(uri).protocol);
  } catch {
    return false;
  }
}

/** The link under a viewport point, if any. Only the pages the point is over are looked into. */
export function linkAt(container: HTMLElement, x: number, y: number): HTMLElement | null {
  for (const page of container.querySelectorAll<HTMLElement>(".page[data-page-number]")) {
    const box = page.getBoundingClientRect();
    if (x < box.left || x > box.right || y < box.top || y > box.bottom) continue;
    for (const element of page.querySelectorAll<HTMLElement>(`.${LINK_CLASS}`)) {
      const rect = element.getBoundingClientRect();
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) return element;
    }
  }
  return null;
}

export type LinkActions = {
  goTo: (target: InternalTarget) => void;
  openExternal: (uri: string) => void;
};

/** Follows a link: an internal one scrolls the book, an http, https or mailto one opens outside; anything else does nothing. */
export function followLink(target: LinkTarget, actions: LinkActions): void {
  if (isInternal(target)) actions.goTo(target);
  else if (isOpenableUri(target.uri)) actions.openExternal(target.uri);
}
