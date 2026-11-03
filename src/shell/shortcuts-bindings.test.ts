import { expect, it, vi } from "vitest";
import type { ShellCommand } from "./commands/types";
import {
  ariaShortcut,
  recordShortcut,
  resolveCommandShortcuts,
  shortcutsCollide,
  validRecordedShortcut,
} from "./shortcuts-bindings";

it.each([
  ["Win32", { ctrlKey: true }, "$mod+KeyK"],
  ["Linux x86_64", { ctrlKey: true, shiftKey: true }, "$mod+Shift+KeyK"],
  ["MacIntel", { metaKey: true }, "$mod+KeyK"],
  ["MacIntel", { ctrlKey: true }, "Control+KeyK"],
  ["MacIntel", { altKey: true, shiftKey: true }, "Alt+Shift+KeyK"],
])("%s records one portable chord", (platform, modifiers, keys) => {
  expect(
    recordShortcut(
      new KeyboardEvent("keydown", { key: "k", code: "KeyK", ...modifiers }),
      platform,
    ),
  ).toEqual({ kind: "captured", keys });
});

it("ignores composition and modifier-only events, cancels with Escape, and refuses OS/editing chords", () => {
  expect(
    recordShortcut(
      new KeyboardEvent("keydown", {
        key: "k",
        code: "KeyK",
        ctrlKey: true,
        isComposing: true,
      }),
    ),
  ).toEqual({ kind: "ignore" });
  expect(
    recordShortcut(
      new KeyboardEvent("keydown", {
        key: "Control",
        code: "ControlLeft",
        ctrlKey: true,
      }),
    ),
  ).toEqual({ kind: "ignore" });
  expect(
    recordShortcut(
      new KeyboardEvent("keydown", { key: "Escape", code: "Escape" }),
    ),
  ).toEqual({ kind: "cancel" });
  for (const keys of [
    "KeyK",
    "Shift+KeyK",
    "$mod+KeyC",
    "$mod+Shift+KeyZ",
    "Alt+F4",
    "$mod+Control+KeyK",
    "Shift+Alt+KeyK",
    "$mod+KeyK $mod+KeyF",
    "$mod+(.*)",
  ])
    expect(validRecordedShortcut(keys), keys).toBe(false);
  expect(
    recordShortcut(
      new KeyboardEvent("keydown", { key: "k", code: "KeyK", metaKey: true }),
      "Win32",
    ),
  ).toEqual({ kind: "invalid" });
});

it("finds physical-code / letter conflicts on either desktop platform", () => {
  expect(shortcutsCollide("$mod+KeyK", "$mod+k")).toBe(true);
  expect(shortcutsCollide("Control+KeyK", "$mod+k")).toBe(true);
  expect(shortcutsCollide("Alt+Shift+Digit2", "Shift+Alt+2")).toBe(true);
  expect(shortcutsCollide("$mod+Shift+KeyK", "$mod+k")).toBe(false);
  expect(ariaShortcut("$mod+Shift+KeyK")).toBe("Control+Shift+K Meta+Shift+K");
});

it("overrides only real commands, keeps unknown-module preferences dormant, and disables duplicate shortcuts", () => {
  const commands: ShellCommand[] = [
    {
      id: "app.palette",
      label: "Palette",
      group: "actions",
      keywords: [],
      shortcut: "$mod+k",
      run: vi.fn(),
    },
    {
      id: "module.save",
      label: "Save",
      group: "actions",
      keywords: [],
      shortcut: "$mod+s",
      run: vi.fn(),
    },
  ];
  const custom = resolveCommandShortcuts(commands, [
    { commandId: "app.palette", keys: "$mod+Shift+KeyK" },
    { commandId: "missing.action", keys: "$mod+KeyD" },
  ]);
  expect(custom.commands.map((item) => item.shortcut)).toEqual([
    "$mod+Shift+KeyK",
    "$mod+s",
  ]);
  expect(custom.conflicts.size).toBe(0);
  expect(
    resolveCommandShortcuts(commands, [
      { commandId: "app.palette", keys: null },
    ]).commands[0].shortcut,
  ).toBeUndefined();
  expect(
    resolveCommandShortcuts(commands, [
      { commandId: "module.save", keys: "Control+KeyK" },
    ]).conflicts,
  ).toEqual(new Set(["app.palette", "module.save"]));
  expect(commands[0].shortcut).toBe("$mod+k");
});
