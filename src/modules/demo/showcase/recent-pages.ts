import { useSyncExternalStore } from "react";
import pages from "./pages.json";

const pageIds = new Map(pages.map((page) => [page.path, page.id]));
let recent: readonly string[] = [];
const listeners = new Set<() => void>();
const snapshot = () => recent;
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export function recordRecentPage(pathname: string) {
  const id = pageIds.get(pathname);
  if (id === undefined || recent[0] === id) return;
  recent = [id, ...recent.filter((page) => page !== id)].slice(0, 5);
  for (const listener of listeners) listener();
}

export function useRecentPages() {
  return useSyncExternalStore(subscribe, snapshot);
}
