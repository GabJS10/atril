import type { Highlight, Zoom } from "../api/types";
import type { ReaderPosition } from "./position";
import type { SelectionPart } from "./selectionReader";

/** What the reader screen needs to know of the view: where it is, how it is zoomed. */
export type ViewSnapshot = { position: ReaderPosition; zoom: Zoom; scale: number };

/** Where the search stands: the match in focus out of all matches, and whether it found none. */
export type FindResult = { current: number; total: number; notFound: boolean };

export type FindOptions = { again?: boolean; findPrevious?: boolean };

/** Props both viewers (pdf.js and native) take besides their document. */
export type ViewerProps = {
  /** Zoom and position to start from. Applied once, before the view is shown. */
  start: { zoom: Zoom; position: ReaderPosition | null };
  /** The view moved (scroll or zoom). Only after the start position is on screen. */
  onChange: (snapshot: ViewSnapshot) => void;
  /** The start position is on screen. Called once. */
  onRestored: (snapshot: ViewSnapshot) => void;
  /** Highlights of the book; drawn over the pages. */
  highlights: Highlight[];
  /** The user selected text and let go of the mouse. */
  onSelectionEnd: (parts: SelectionPart[], anchor: DOMRect) => void;
  /** The user clicked on the page without selecting text. */
  onSelectionClear: () => void;
  /** The user clicked on a highlight. */
  onHighlightPress: (id: string, anchor: DOMRect) => void;
  /** The search moved or changed: the match counter for the search bar. */
  onFindResult: (result: FindResult) => void;
};

/** Commands the reader's keyboard map and bar send to the viewer. Both viewers implement it. */
export type ViewerHandle = {
  goToPage: (page: number) => void;
  /** Searches the book without case or accents. An empty query clears the matches. */
  find: (query: string, options?: FindOptions) => void;
  /** Goes to a destination of the book (an entry of its index): the page and the place on it. */
  goToDestination: (dest: string | unknown[]) => void;
  /** Scrolls the highlight into view (the panel's click). */
  revealHighlight: (highlight: Highlight) => void;
  /** One page forward or back, from the page the view is on (not from React state, which can lag behind key repeats). */
  turnPage: (direction: 1 | -1) => void;
  scrollLines: (direction: 1 | -1) => void;
  scrollPages: (direction: 1 | -1) => void;
  stepZoom: (direction: 1 | -1) => void;
};
