import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useRef,
} from "react";

type Region =
  | "primary"
  | "primaryTrigger"
  | "auxiliary"
  | "auxiliaryTrigger"
  | "content"
  | "zenExit";
function useFocusRegions() {
  const primary = useRef<HTMLDivElement>(null);
  const primaryTrigger = useRef<HTMLButtonElement>(null);
  const auxiliary = useRef<HTMLElement>(null);
  const auxiliaryTrigger = useRef<HTMLButtonElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const zenExit = useRef<HTMLButtonElement>(null);
  const frame = useRef<number | null>(null);
  const requested = useRef<Region | null>(null);
  const deferred = useRef(false);
  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    [],
  );
  return useMemo(() => {
    const refs = {
      primary,
      primaryTrigger,
      auxiliary,
      auxiliaryTrigger,
      content,
      zenExit,
    };
    const flush = () => {
      if (!requested.current) return false;
      const target = refs[requested.current].current;
      (target ?? content.current)?.focus();
      requested.current = null;
      return true;
    };
    return {
      ...refs,
      flush,
      defer(value: boolean) {
        deferred.current = value;
      },
      focus(region: Region) {
        requested.current = region;
        if (frame.current !== null) cancelAnimationFrame(frame.current);
        if (!deferred.current) frame.current = requestAnimationFrame(flush);
      },
    };
  }, []);
}
const Context = createContext<ReturnType<typeof useFocusRegions> | null>(null);
export function ShellFocusProvider({ children }: { children: ReactNode }) {
  const value = useFocusRegions();
  return <Context value={value}>{children}</Context>;
}
export function useShellFocus() {
  const value = useContext(Context);
  if (!value) throw new Error("ShellFocusProvider is required");
  return value;
}
