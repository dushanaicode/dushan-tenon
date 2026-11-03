import { useEffect } from "react";
import { type KeybindingsMap, tinykeys } from "tinykeys";

export { parseKeybinding } from "tinykeys";

export const PALETTE_SHORTCUT = "$mod+k";
export type Shortcut = {
  keys: string;
  allowInEditable?: boolean;
  run: () => void;
};

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (
    target.closest(
      "input, textarea, select, [role=textbox], [role=combobox], " +
        "[role=searchbox]",
    )
  )
    return true;
  const editable = target.closest("[contenteditable]");
  return (
    editable !== null && editable.getAttribute("contenteditable") !== "false"
  );
}

export function useShortcuts(shortcuts: readonly Shortcut[]): void {
  useEffect(() => {
    const map: KeybindingsMap = {};
    for (const shortcut of shortcuts) {
      map[shortcut.keys] = (event) => {
        if (
          event.defaultPrevented ||
          event.isComposing ||
          event.keyCode === 229
        )
          return;
        if (!shortcut.allowInEditable && isEditableTarget(event.target)) return;
        event.preventDefault();
        shortcut.run();
      };
    }
    return tinykeys(window, map, { ignore: () => false });
  }, [shortcuts]);
}

export function formatShortcut(
  keys: string,
  platform = `${navigator.platform} ${navigator.userAgent}`,
): string {
  const mac = /Mac/i.test(platform);
  const modifiers: Record<string, string> = {
    $mod: mac ? "⌘" : "Ctrl",
    control: mac ? "⌃" : "Ctrl",
    meta: mac ? "⌘" : "Meta",
    shift: mac ? "⇧" : "Shift",
    alt: mac ? "⌥" : "Alt",
  };
  return keys
    .split(" ")
    .map((press) =>
      press
        .split("+")
        .map(
          (key) =>
            modifiers[key.toLowerCase()] ??
            (key.length === 1
              ? key.toUpperCase()
              : key
                  .replace(/^Key(?=[A-Z]$)/, "")
                  .replace(/^Digit(?=[0-9]$)/, "")),
        )
        .join(" "),
    )
    .join(" ");
}
