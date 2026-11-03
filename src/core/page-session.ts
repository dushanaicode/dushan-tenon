import { useQueryClient } from "@tanstack/react-query";
import {
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { authKey } from "@/core/auth";
import type { AuthStatus } from "@/lib/generated/AuthStatus";

type ViewValue = string | number | boolean | null;
type PageSession<T> = { view: T; scrollTop: number };

/** View state only: callers opt in with a fixed page ID and scalar filters, never record bodies. */
export function usePageSession<T extends Record<string, ViewValue>>(
  actorId: string,
  pageId: string,
  initial: T,
  scrollRef: RefObject<HTMLElement | null>,
) {
  const client = useQueryClient();
  const key = useMemo(
    () => ["page-session", actorId, pageId] as const,
    [actorId, pageId],
  );
  const [restored] = useState(
    () =>
      client.getQueryData<PageSession<T>>(key) ?? {
        view: initial,
        scrollTop: 0,
      },
  );
  const [view, setView] = useState(restored.view);
  const currentView = useRef(view);
  const scroll = useRef(restored.scrollTop);
  const scroller = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    client.setQueryDefaults(["page-session"], { gcTime: Infinity });
    if (!client.getQueryState(key))
      client.setQueryData(key, {
        view: currentView.current,
        scrollTop: scroll.current,
      });
  }, [client, key]);
  const update = useCallback(
    (patch: Partial<T>, resetScroll = false) => {
      // Identity cleanup can remove the session before an old callback completes.
      if (!client.getQueryState(key)) return;
      if (resetScroll) {
        scroll.current = 0;
        scroller.current?.scrollTo({ top: 0, behavior: "instant" });
      }
      currentView.current = { ...currentView.current, ...patch };
      setView(currentView.current);
      client.setQueryData<PageSession<T>>(key, {
        view: currentView.current,
        scrollTop: scroll.current,
      });
    },
    [client, key],
  );
  const restoreScroll = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return;
    scroller.current = element;
    const capture = () => {
      scroll.current = element.scrollTop;
    };
    // Finish the first layout after loaded rows commit before restoring once.
    // Otherwise browser scroll anchoring can shift the early offset.
    const frame = requestAnimationFrame(() => {
      element.scrollTo({ top: scroll.current, behavior: "instant" });
      scroll.current = element.scrollTop;
      element.addEventListener("scroll", capture, { passive: true });
    });
    return () => {
      cancelAnimationFrame(frame);
      element.removeEventListener("scroll", capture);
      scroller.current = null;
      // Auth cleanup may already have removed the cache; never recreate another actor's session.
      client.setQueryData<PageSession<T>>(
        key,
        (current) => current && { ...current, scrollTop: scroll.current },
      );
    };
  }, [client, key, scrollRef]);
  return { view, update, restoreScroll };
}

/** ActiveShell owns this lifetime. StrictMode replay is not an identity change. */
export function usePageSessionScope(actorId: string) {
  const client = useQueryClient();
  useEffect(
    () => () => {
      const auth = client.getQueryData<AuthStatus>(authKey);
      if (auth?.state !== "active" || auth.user?.id !== actorId)
        client.removeQueries({ queryKey: ["page-session", actorId] });
    },
    [actorId, client],
  );
}
