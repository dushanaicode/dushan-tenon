import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { IpcErrorMessage } from "@/core/ipc-error";
import { useKeyboardSettings } from "@/core/keyboard-settings";
import {
  Button,
  Combobox,
  Input,
  Kbd,
  Label,
  Loading,
  SettingGroup,
} from "@/kit";
import type { KeyboardBinding } from "@/lib/generated/KeyboardBinding";
import { useCommandPalette } from "@/shell/command-palette";
import { formatShortcut } from "@/shell/shortcuts";
import {
  PALETTE_COMMAND_ID,
  recordShortcut,
  resolveCommandShortcuts,
} from "@/shell/shortcuts-bindings";

export function KeyboardSection() {
  const { t } = useTranslation();
  const { keyboardCommands, shortcutConflicts } = useCommandPalette();
  const { query, update, canEdit } = useKeyboardSettings();
  const [selectedId, setSelectedId] = useState(PALETTE_COMMAND_ID);
  const [recording, setRecording] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [saved, setSaved] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const prefix = useId();
  useEffect(() => {
    if (recording) input.current?.focus();
  }, [recording]);

  if (query.isPending)
    return <Loading label={t("settings.keyboard.loading")} />;
  if (query.isError)
    return (
      <SettingGroup title={t("settings.keyboard.title")}>
        <div className="space-y-3 p-4">
          <IpcErrorMessage error={query.error} />
          <Button variant="outline" onClick={() => void query.refetch()}>
            {t("settings.retry")}
          </Button>
        </div>
      </SettingGroup>
    );
  const snapshot = query.data.snapshot;
  const command =
    keyboardCommands.find((item) => item.id === selectedId) ??
    keyboardCommands[0];
  const binding = snapshot.bindings.find(
    (item) => item.commandId === command.id,
  );
  const current = binding ? binding.keys : command.shortcut;
  const candidate =
    draft === null
      ? snapshot.bindings
      : [
          ...snapshot.bindings.filter((item) => item.commandId !== command.id),
          { commandId: command.id, keys: draft },
        ];
  const candidateConflicts = resolveCommandShortcuts(
    keyboardCommands,
    candidate,
  ).conflicts;
  const conflictNames = keyboardCommands
    .filter((item) => candidateConflicts.has(item.id))
    .map((item) => item.label)
    .join("、");
  const disabled = !canEdit || update.isPending;

  function save(bindings: KeyboardBinding[]) {
    setSaved(false);
    update.mutate(
      { expectedRevision: snapshot.revision, bindings },
      {
        onSuccess: () => {
          setDraft(null);
          setRecording(false);
          setInvalid(false);
          setSaved(true);
        },
      },
    );
  }

  return (
    <SettingGroup
      title={t("settings.keyboard.title")}
      description={t("settings.keyboard.description")}
    >
      <div className="space-y-4 p-4">
        <div className="space-y-2">
          <Label htmlFor={`${prefix}-command`}>
            {t("settings.keyboard.command")}
          </Label>
          <Combobox
            id={`${prefix}-command`}
            options={keyboardCommands.map((item) => ({
              value: item.id,
              label: item.label,
            }))}
            value={command.id}
            onValueChange={(id) => {
              if (id !== null) {
                setSelectedId(id);
                setRecording(false);
                setDraft(null);
                setInvalid(false);
                setSaved(false);
                update.reset();
              }
            }}
            placeholder={t("settings.keyboard.command")}
            searchPlaceholder={t("settings.keyboard.search")}
            emptyText={t("shell.palette.empty")}
            disabled={update.isPending}
          />
        </div>
        <p className="flex flex-wrap items-center gap-2 text-body">
          <span>{t("settings.keyboard.current")}</span>
          {current ? (
            <Kbd>{formatShortcut(current)}</Kbd>
          ) : (
            <span>{t("settings.keyboard.unbound")}</span>
          )}
          <span className="text-sm text-muted-foreground">
            {t(
              binding
                ? binding.keys === null
                  ? "settings.keyboard.disabled"
                  : "settings.keyboard.custom"
                : "settings.keyboard.default",
            )}
          </span>
        </p>
        <div className="space-y-2">
          <Label htmlFor={`${prefix}-record`}>
            {t("settings.keyboard.newBinding")}
          </Label>
          <div className="flex flex-wrap gap-2">
            <Input
              ref={input}
              id={`${prefix}-record`}
              className="min-w-48 flex-1"
              readOnly
              value={draft ? formatShortcut(draft) : ""}
              aria-describedby={`${prefix}-hint`}
              placeholder={t(
                recording
                  ? "settings.keyboard.listening"
                  : "settings.keyboard.recordHint",
              )}
              disabled={disabled}
              onKeyDownCapture={(event) => {
                if (!recording) return;
                event.stopPropagation();
                const captured = recordShortcut(event.nativeEvent);
                if (captured.kind === "ignore") return;
                event.preventDefault();
                if (captured.kind === "cancel") {
                  setRecording(false);
                  return;
                }
                if (captured.kind === "invalid") {
                  setInvalid(true);
                  return;
                }
                setDraft(captured.keys);
                setInvalid(false);
                setRecording(false);
                setSaved(false);
                update.reset();
              }}
            />
            <Button
              variant="outline"
              disabled={disabled}
              onClick={() => {
                setRecording((value) => !value);
                setInvalid(false);
                setSaved(false);
              }}
            >
              {t(
                recording
                  ? "settings.keyboard.cancelRecording"
                  : "settings.keyboard.record",
              )}
            </Button>
            <Button
              disabled={
                disabled ||
                draft === null ||
                candidateConflicts.size > 0 ||
                recording
              }
              onClick={() => save(candidate)}
            >
              {t("settings.keyboard.save")}
            </Button>
          </div>
          <p id={`${prefix}-hint`} className="text-sm text-muted-foreground">
            {t("settings.keyboard.recordHelp")}
          </p>
        </div>
        {invalid && (
          <p role="alert" className="text-sm text-destructive">
            {t("settings.keyboard.invalid")}
          </p>
        )}
        {candidateConflicts.size > 0 && (
          <p role="alert" className="text-sm text-destructive">
            {t("settings.keyboard.conflict", { commands: conflictNames })}
          </p>
        )}
        {shortcutConflicts.size > 0 && draft === null && (
          <p role="status" className="text-sm text-muted-foreground">
            {t("settings.keyboard.conflictInactive")}
          </p>
        )}
        {update.isError && <IpcErrorMessage error={update.error} />}
        {saved && (
          <p role="status" className="text-sm text-muted-foreground">
            {t("settings.keyboard.saved")}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={disabled || current == null}
            onClick={() =>
              save([
                ...snapshot.bindings.filter(
                  (item) => item.commandId !== command.id,
                ),
                { commandId: command.id, keys: null },
              ])
            }
          >
            {t("settings.keyboard.disable")}
          </Button>
          <Button
            variant="outline"
            disabled={disabled || !binding}
            onClick={() =>
              save(
                snapshot.bindings.filter(
                  (item) => item.commandId !== command.id,
                ),
              )
            }
          >
            {t("settings.keyboard.reset")}
          </Button>
          <Button
            variant="ghost"
            disabled={disabled || snapshot.bindings.length === 0}
            onClick={() => save([])}
          >
            {t("settings.keyboard.resetAll")}
          </Button>
        </div>
      </div>
    </SettingGroup>
  );
}
