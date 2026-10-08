import { useRef, useState, type PointerEvent } from "react";

export type SheetSnap = "half" | "full";

/** Drag distance (px) past which a release moves to the next snap point. */
const SNAP_THRESHOLD_PX = 60;
/** Movement (px) before a press on the header counts as a drag, not a tap. */
const DRAG_START_PX = 6;

/**
 * Vertical drag handling for the mobile bottom sheet. Dragging the header
 * up expands to full height; dragging down shrinks to half, then closes.
 * While dragging, `dragOffset` is the live pointer delta; the sheet
 * subtracts it from its snapped height.
 */
export function useSheetDrag(onClose: () => void) {
  const [snap, setSnap] = useState<SheetSnap>("half");
  const [dragOffset, setDragOffset] = useState<number | null>(null);
  const start = useRef<{ y: number; id: number; dragging: boolean } | null>(null);

  const onPointerDown = (e: PointerEvent<HTMLElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    start.current = { y: e.clientY, id: e.pointerId, dragging: false };
  };

  const onPointerMove = (e: PointerEvent<HTMLElement>) => {
    const s = start.current;
    if (!s || s.id !== e.pointerId) return;
    const dy = e.clientY - s.y;
    if (!s.dragging) {
      if (Math.abs(dy) < DRAG_START_PX) return;
      s.dragging = true;
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    setDragOffset(dy);
  };

  const finish = (e: PointerEvent<HTMLElement>) => {
    const s = start.current;
    start.current = null;
    if (!s || s.id !== e.pointerId || !s.dragging) return;
    const dy = e.clientY - s.y;
    setDragOffset(null);
    if (dy < -SNAP_THRESHOLD_PX) {
      setSnap("full");
    } else if (dy > SNAP_THRESHOLD_PX) {
      if (snap === "full" && dy < window.innerHeight * 0.45) setSnap("half");
      else {
        onClose();
        setSnap("half");
      }
    }
  };

  return {
    snap,
    setSnap,
    dragOffset,
    handleProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp: finish,
      onPointerCancel: finish,
    },
  };
}
