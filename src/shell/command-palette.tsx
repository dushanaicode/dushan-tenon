import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import {
  Button,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Icon,
  toast,
  usePageTitleFocus,
} from "@/kit";
import type { KeyboardBinding } from "@/lib/generated/KeyboardBinding";
import { cn } from "@/lib/utils";
import type { CommandGroupId, ShellCommand } from "./commands";
import { validateCommands } from "./commands/build-commands";
import { useShellFocus } from "./shell-focus";
import {
  formatShortcut,
  PALETTE_SHORTCUT,
  type Shortcut,
  useShortcuts,
} from "./shortcuts";
import {
  ariaShortcut,
  PALETTE_COMMAND_ID,
  resolveCommandShortcuts,
} from "./shortcuts-bindings";

const groupOrder: CommandGroupId[] = [
  "pages",
  "actions",
  "appearance",
  "language",
  "account",
];
const PaletteContext = createContext<{
  open: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
  commands: ShellCommand[];
  keyboardCommands: readonly ShellCommand[];
  shortcutConflicts: ReadonlySet<string>;
  paletteShortcut: string | undefined;
  runCommand: (id: string) => Promise<void>;
} | null>(null);

export function CommandPaletteProvider({
  commands,
  bindings = [],
  shortcutsReady = true,
  children,
}: {
  commands: ShellCommand[];
  bindings?: readonly KeyboardBinding[];
  shortcutsReady?: boolean;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const toggle = useCallback(() => setOpen((value) => !value), []);
  const keyboardCommands = useMemo<ShellCommand[]>(
    () => [
      {
        id: PALETTE_COMMAND_ID,
        label: t("shell.palette.open"),
        group: "actions",
        keywords: [],
        shortcut: PALETTE_SHORTCUT,
        run: toggle,
      },
      ...commands,
    ],
    [commands, t, toggle],
  );
  const resolved = useMemo(() => {
    validateCommands(keyboardCommands);
    return resolveCommandShortcuts(keyboardCommands, bindings);
  }, [keyboardCommands, bindings]);
  const paletteShortcut =
    shortcutsReady && !resolved.conflicts.has(PALETTE_COMMAND_ID)
      ? resolved.commands[0].shortcut
      : undefined;
  const latestCommands = useRef(resolved.commands);
  useLayoutEffect(() => {
    latestCommands.current = resolved.commands;
  }, [resolved.commands]);
  const runCommand = useCallback(
    async (id: string) => {
      const command = latestCommands.current.find((item) => item.id === id);
      if (!command) {
        toast.error(t("shell.palette.unavailable"));
        return;
      }
      if (command.disabledReason) {
        toast.error(command.disabledReason);
        return;
      }
      try {
        await command.run();
      } catch {
        toast.error(t("shell.palette.failed"));
      }
    },
    [t],
  );
  const shortcuts = useMemo<Shortcut[]>(
    () =>
      shortcutsReady
        ? resolved.commands.flatMap((command) =>
            command.shortcut &&
            !command.disabledReason &&
            !resolved.conflicts.has(command.id)
              ? [
                  {
                    keys: command.shortcut,
                    allowInEditable: command.id === PALETTE_COMMAND_ID,
                    run: () => void runCommand(command.id),
                  },
                ]
              : [],
          )
        : [],
    [resolved, runCommand, shortcutsReady],
  );
  useShortcuts(shortcuts);
  return (
    <PaletteContext
      value={{
        open,
        setOpen,
        toggle,
        commands: resolved.commands.slice(1),
        keyboardCommands,
        shortcutConflicts: resolved.conflicts,
        paletteShortcut,
        runCommand,
      }}
    >
      {children}
    </PaletteContext>
  );
}

export function useCommandPalette() {
  const context = useContext(PaletteContext);
  if (!context)
    throw new Error("useCommandPalette requires CommandPaletteProvider");
  return context;
}

export function CommandPalette() {
  const { t } = useTranslation();
  const { open, setOpen, commands, runCommand } = useCommandPalette();
  const previousFocus = useRef<HTMLElement | null>(null);
  const selectedPage = useRef(false);
  const focus = useShellFocus();
  const focusTitle = usePageTitleFocus();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        data-command-dialog=""
        showCloseButton={false}
        className="gap-0 p-0"
        onOpenAutoFocus={() => {
          focus.defer(true);
          previousFocus.current =
            document.activeElement instanceof HTMLElement
              ? document.activeElement
              : null;
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          focus.defer(false);
          if (!focus.flush()) {
            if (selectedPage.current) focusTitle();
            else previousFocus.current?.focus();
          }
          selectedPage.current = false;
        }}
      >
        <DialogTitle className="sr-only">
          {t("shell.palette.title")}
        </DialogTitle>
        <DialogDescription className="sr-only">
          {t("shell.palette.description")}
        </DialogDescription>
        <Command>
          <CommandInput
            placeholder={t("shell.palette.placeholder")}
            aria-label={t("shell.palette.placeholder")}
          />
          <CommandList label={t("shell.palette.title")}>
            <CommandEmpty>{t("shell.palette.empty")}</CommandEmpty>
            {groupOrder.map((group) => {
              const items = commands.filter(
                (command) => command.group === group,
              );
              return (
                items.length > 0 && (
                  <CommandGroup
                    key={group}
                    heading={t(`shell.palette.group.${group}`)}
                  >
                    {items.map((command) => (
                      <CommandItem
                        key={command.id}
                        value={command.id}
                        keywords={[command.label, ...command.keywords]}
                        disabled={command.disabledReason !== undefined}
                        onSelect={() => {
                          selectedPage.current = command.group === "pages";
                          setOpen(false);
                          void runCommand(command.id);
                        }}
                      >
                        {command.Icon && <command.Icon aria-hidden="true" />}
                        <span>
                          {command.label}
                          {command.disabledReason && (
                            <span className="block text-xs text-muted-foreground">
                              {command.disabledReason}
                            </span>
                          )}
                        </span>
                        {command.shortcut && (
                          <CommandShortcut>
                            {formatShortcut(command.shortcut)}
                          </CommandShortcut>
                        )}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )
              );
            })}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}

export function CommandPaletteTrigger() {
  const { t } = useTranslation();
  const { setOpen, paletteShortcut } = useCommandPalette();
  return (
    <Button
      variant="outline"
      className="shrink-0 px-3"
      aria-label={t("shell.palette.open")}
      aria-keyshortcuts={
        paletteShortcut ? ariaShortcut(paletteShortcut) : undefined
      }
      onClick={() => setOpen(true)}
    >
      <Icon iconId="search" />
      <span className="hidden @expanded/shell:inline">
        {t("shell.palette.open")}
      </span>
      {paletteShortcut && (
        <kbd
          className={cn(
            "hidden rounded-sm border border-border bg-muted px-1.5",
            "font-mono text-xs text-muted-foreground @expanded/shell:inline",
          )}
        >
          {formatShortcut(paletteShortcut)}
        </kbd>
      )}
    </Button>
  );
}
