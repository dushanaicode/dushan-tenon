import { type PointerEvent, type RefObject, useEffect, useRef } from "react";

export function useHoverIntent(
  setOpen: (open: boolean) => void,
  content: RefObject<HTMLElement | null>,
  enabled: boolean,
) {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const cancel = () => clearTimeout(timer.current);
  useEffect(() => {
    if (!enabled) setOpen(false);
    return () => clearTimeout(timer.current);
  }, [enabled, setOpen]);
  return {
    cancel,
    enterTrigger(event: PointerEvent) {
      if (event.pointerType !== "mouse") return;
      cancel();
      timer.current = setTimeout(() => setOpen(true), 150);
    },
    enterContent(event: PointerEvent) {
      if (event.pointerType === "mouse") cancel();
    },
    leave(event: PointerEvent) {
      if (event.pointerType !== "mouse") return;
      cancel();
      timer.current = setTimeout(() => {
        if (!content.current?.contains(document.activeElement)) setOpen(false);
      }, 200);
    },
  };
}
