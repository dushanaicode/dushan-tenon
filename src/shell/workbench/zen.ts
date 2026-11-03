import { useRef, useState } from "react";
import { useShellFocus } from "../shell-focus";

export type OpenSheet = "primary" | "auxiliary" | null;
type ChromeState = { sheet: OpenSheet };

export function useZen() {
  const [before, setBefore] = useState<ChromeState | null>(null);
  const previous = useRef<HTMLElement | null>(null);
  const focus = useShellFocus();
  return {
    before,
    enter(state: ChromeState) {
      previous.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      setBefore(state);
    },
    exit() {
      setBefore(null);
      requestAnimationFrame(() => {
        if (previous.current?.isConnected) previous.current.focus();
        else focus.focus("content");
      });
      return before;
    },
  };
}
