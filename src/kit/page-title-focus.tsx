import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";

type TitleFocus = {
  register: (element: HTMLHeadingElement, text: string | null) => () => void;
  focusTitle: () => void;
};
const Context = createContext<TitleFocus | null>(null);
const TitleTextContext = createContext<string | null>(null);

export function PageTitleFocusProvider({ children }: { children: ReactNode }) {
  const title = useRef<HTMLHeadingElement | null>(null);
  const requested = useRef(false);
  const [text, setText] = useState<string | null>(null);
  const value = useMemo<TitleFocus>(
    () => ({
      register(element, text) {
        const previousTabIndex = element.getAttribute("tabindex");
        element.tabIndex = -1;
        element.setAttribute("data-page-title", "");
        title.current = element;
        setText(text);
        if (requested.current) {
          requested.current = false;
          element.focus();
        }
        return () => {
          if (title.current === element) {
            title.current = null;
            setText(null);
          }
          element.removeAttribute("data-page-title");
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
  return (
    <Context value={value}>
      <TitleTextContext value={text}>{children}</TitleTextContext>
    </Context>
  );
}

/** Optional registration: standalone headers keep their usual behavior. */
export function usePageTitleRef(title: ReactNode, enabled = true) {
  const context = useContext(Context);
  return useCallback(
    (element: HTMLHeadingElement | null) => {
      if (element && enabled)
        return context?.register(
          element,
          typeof title === "string" ? title : element.textContent,
        );
    },
    [context, title, enabled],
  );
}

export function usePageTitleText() {
  return useContext(TitleTextContext);
}

export function usePageTitleFocus() {
  const context = useContext(Context);
  if (!context) throw new Error("PageTitleFocusProvider is required");
  return context.focusTitle;
}
