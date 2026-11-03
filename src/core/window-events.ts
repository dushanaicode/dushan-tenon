import type { WindowEvent } from "@/lib/generated/WindowEvent";

type Payloads = {
  "tenon:edit-close": Extract<WindowEvent, { type: "close_edit" }>;
  "tenon:window-moved": Extract<WindowEvent, { type: "moved" }>;
  "tenon:files-changed": Extract<WindowEvent, { type: "files_changed" }>;
};

declare global {
  interface WindowEventMap {
    "tenon:edit-close": CustomEvent<Payloads["tenon:edit-close"]>;
    "tenon:window-moved": CustomEvent<Payloads["tenon:window-moved"]>;
    "tenon:files-changed": CustomEvent<Payloads["tenon:files-changed"]>;
  }
}

/** Returns true when a listener synchronously claims the event with preventDefault. */
export function emitWindowEvent<K extends keyof Payloads>(
  type: K,
  detail: Payloads[K],
) {
  return !window.dispatchEvent(
    new CustomEvent(type, { detail, cancelable: true }),
  );
}

export function onWindowEvent<K extends keyof Payloads>(
  type: K,
  listener: (event: WindowEventMap[K]) => void,
) {
  window.addEventListener(type, listener);
  return () => window.removeEventListener(type, listener);
}
