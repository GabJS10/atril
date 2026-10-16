import { Cover } from "./Cover";
import { useBookDragStore } from "./bookDrag";

/** The book being dragged, following the pointer (DESIGN.md, portadas). It never takes the pointer's hits itself. */
export function BookDragGhost() {
  const drag = useBookDragStore((state) => state.drag);
  if (!drag) return null;
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed top-0 left-0 z-50 rounded-tile bg-surface-2 p-2.5 shadow-float"
      style={{ transform: `translate(${drag.x + 14}px, ${drag.y + 14}px)` }}
    >
      <Cover book={drag.book} size="xs" />
    </div>
  );
}
