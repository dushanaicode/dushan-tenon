import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useRef,
} from "react";

type TitleFocus = {
  register: (element: HTMLHeadingElement) => () => void;
  focusTitle: () => void;
};
const Context = createContext<TitleFocus | null>(null);

export function PageTitleFocusProvider({ children }: { children: ReactNode }) {
  const title = useRef<HTMLHeadingElement | null>(null);
  const requested = useRef(false);
  const value = useMemo<TitleFocus>(
    () => ({
      register(element) {
        const previousTabIndex = element.getAttribute("tabindex");
        element.tabIndex = -1;
        title.current = element;
        if (requested.current) {
          requested.current = false;
          element.focus();
        }
        return () => {
          if (title.current === element) title.current = null;
          if (previousTabIndex === null) element.removeAttribute("tabindex");
          else element.setAttribute("tabindex", previousTabIndex);
        };
      },
      focusTitle() {
        requested.current = title.current === null;
        title.current?.focus();
      },
    }),
    [],
  );
  return <Context value={value}>{children}</Context>;
}

/** Optional registration: standalone headers keep their usual behavior. */
export function usePageTitleRef(enabled = true) {
  const context = useContext(Context);
  return useCallback(
    (element: HTMLHeadingElement | null) => {
      if (element && enabled) return context?.register(element);
    },
    [context, enabled],
  );
}

export function usePageTitleFocus() {
  const context = useContext(Context);
  if (!context) throw new Error("PageTitleFocusProvider is required");
  return context.focusTitle;
}
