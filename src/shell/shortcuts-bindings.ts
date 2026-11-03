import type { KeyboardBinding } from "@/lib/generated/KeyboardBinding";
import type { ShellCommand } from "./commands/types";
import { parseKeybinding } from "./shortcuts";

export const PALETTE_COMMAND_ID = "app.palette";
const KEY_CODE =
  /^(?:Key[A-Z]|Digit[0-9]|F(?:[1-9]|1[0-2])|Arrow(?:Up|Down|Left|Right)|Home|End|PageUp|PageDown|Enter|Space|Comma|Period|Slash|Backslash|Semicolon|Quote|BracketLeft|BracketRight|Minus|Equal|Backquote)$/;

/** A bounded subset for recording; tinykeys continues to own event matching. */
export function validRecordedShortcut(keys: string) {
  const parts = keys.split("+");
  const key = parts.pop();
  const modifiers = ["$mod", "Control", "Alt", "Shift"].filter((part) =>
    parts.includes(part),
  );
  if (
    !key ||
    !KEY_CODE.test(key) ||
    parts.join("+") !== modifiers.join("+") ||
    (!parts.includes("$mod") &&
      !parts.includes("Control") &&
      !parts.includes("Alt")) ||
    (parts.includes("$mod") && parts.includes("Control"))
  )
    return false;
  const primary = parts.includes("$mod") || parts.includes("Control");
  const alt = parts.includes("Alt");
  if (
    primary &&
    !alt &&
    [
      "KeyA",
      "KeyC",
      "KeyV",
      "KeyX",
      "KeyY",
      "KeyZ",
      "KeyQ",
      "KeyW",
      "KeyR",
    ].includes(key)
  )
    return false;
  if (alt && !primary && key === "F4") return false;
  return !(primary && !alt && !parts.includes("Shift") && key === "Space");
}

export type RecordedShortcut =
  | { kind: "ignore" }
  | { kind: "cancel" }
  | { kind: "invalid" }
  | { kind: "captured"; keys: string };

export function recordShortcut(
  event: KeyboardEvent,
  platform = navigator.platform,
): RecordedShortcut {
  const mac = /Mac/i.test(platform);
  if (
    event.isComposing ||
    event.keyCode === 229 ||
    event.repeat ||
    (!mac &&
      event.ctrlKey &&
      event.altKey &&
      event.getModifierState("AltGraph"))
  )
    return { kind: "ignore" };
  if (event.key === "Escape") return { kind: "cancel" };
  if (["Control", "Meta", "Alt", "Shift"].includes(event.key))
    return { kind: "ignore" };
  if ((!mac && event.metaKey) || (mac && event.metaKey && event.ctrlKey))
    return { kind: "invalid" };
  const modifiers = [
    (mac ? event.metaKey : event.ctrlKey) && "$mod",
    mac && event.ctrlKey && "Control",
    event.altKey && "Alt",
    event.shiftKey && "Shift",
  ].filter(Boolean);
  const keys = [...modifiers, event.code].join("+");
  return validRecordedShortcut(keys)
    ? { kind: "captured", keys }
    : { kind: "invalid" };
}

function normalizedKey(key: string | RegExp) {
  if (typeof key !== "string") return key.source;
  return key
    .replace(/^Key(?=[A-Z]$)/i, "")
    .replace(/^Digit(?=[0-9]$)/i, "")
    .toLowerCase();
}

export function shortcutsCollide(a: string, b: string) {
  if (a.toLowerCase() === b.toLowerCase()) return true;
  return ["Control", "Meta"].some((primary) => {
    const left = parseKeybinding(a.replace(/\$mod/gi, primary));
    const right = parseKeybinding(b.replace(/\$mod/gi, primary));
    if (left.length !== 1 || right.length !== 1) return false;
    return (
      normalizedKey(left[0][2]) === normalizedKey(right[0][2]) &&
      left[0][0]
        .map((key) => key.toLowerCase())
        .sort()
        .join("+") ===
        right[0][0]
          .map((key) => key.toLowerCase())
          .sort()
          .join("+")
    );
  });
}

export function resolveCommandShortcuts(
  commands: readonly ShellCommand[],
  bindings: readonly KeyboardBinding[],
) {
  const overrides = new Map(
    bindings.map((binding) => [binding.commandId, binding.keys]),
  );
  const resolved = commands.map((command) =>
    overrides.has(command.id)
      ? { ...command, shortcut: overrides.get(command.id) ?? undefined }
      : command,
  );
  const conflicts = new Set<string>();
  for (const [index, command] of resolved.entries()) {
    if (!command.shortcut || command.disabledReason) continue;
    for (const other of resolved.slice(index + 1)) {
      if (
        other.shortcut &&
        !other.disabledReason &&
        shortcutsCollide(command.shortcut, other.shortcut)
      ) {
        conflicts.add(command.id);
        conflicts.add(other.id);
      }
    }
  }
  return { commands: resolved, conflicts };
}

export function ariaShortcut(keys: string) {
  return [
    ...new Set(
      ["Control", "Meta"].map((primary) =>
        keys
          .replaceAll("$mod", primary)
          .split("+")
          .map((part) =>
            (part.length === 1 ? part.toUpperCase() : part)
              .replace(/^Key(?=[A-Z]$)/i, "")
              .replace(/^Digit(?=[0-9]$)/i, "")
              .replace(/^Space$/, "Space"),
          )
          .join("+"),
      ),
    ),
  ].join(" ");
}
