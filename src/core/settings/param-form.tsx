import { useQuery, useQueryClient } from "@tanstack/react-query";
import { RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "react-router";
import { authKey, useAuthStatus } from "@/core/auth";
import { useDeveloperMode } from "@/core/developer-mode";
import { appModulesQuery } from "@/core/enabled-modules";
import { IpcErrorMessage } from "@/core/ipc-error";
import {
  Button,
  ConfirmDialog,
  type FormFieldControlProps,
  Icon,
  Input,
  NumberInput,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SettingGroup,
  SettingRow,
  Switch,
} from "@/kit";
import type { IpcError } from "@/lib/generated/IpcError";
import type { ParamEntry } from "@/lib/generated/ParamEntry";
import type { ParamKind } from "@/lib/generated/ParamKind";
import { type ParamDraft, useParamDraft, useSettingsDrafts } from "./drafts";
import { sortParams, useParamChange, useParamList } from "./param-queries";

function validValue(kind: ParamKind, value: string): boolean {
  switch (kind.type) {
    case "integer":
      return (
        /^-?\d+$/.test(value) &&
        Number.isSafeInteger(Number(value)) &&
        Number(value) >= kind.min &&
        Number(value) <= kind.max
      );
    case "text":
      return (
        Array.from(value).length <= kind.maxChars && !/\p{Cc}/u.test(value)
      );
    case "boolean":
      return value === "true" || value === "false";
    case "choice":
      return kind.values.includes(value);
    case "secret":
      return value.length > 0 && Array.from(value).length <= 4096;
  }
}

type ControlProps = {
  entry: ParamEntry;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  control: FormFieldControlProps;
};

function IntegerControl({
  kind,
  value,
  onChange,
  disabled,
  control,
}: Omit<ControlProps, "entry"> & {
  kind: Extract<ParamKind, { type: "integer" }>;
}) {
  const [number, setNumber] = useState<number | null>(
    value.trim() !== "" && Number.isFinite(Number(value))
      ? Number(value)
      : null,
  );
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    const text = number === null ? "" : String(number);
    // 只在挂载时对齐恢复后的显示和草稿；当前输入仍保留半途文本。
    if (text !== value) onChange(text);
  }, [number, onChange, value]);
  useEffect(() => {
    if (value === "" || validValue(kind, value)) {
      setNumber(value === "" ? null : Number(value));
    }
  }, [kind, value]);
  return (
    <div
      onChangeCapture={(event) =>
        onChange((event.target as HTMLInputElement).value)
      }
      onBlurCapture={(event) => {
        // NumberInput 不回调未完成的数字；保留这类文本并禁止误存旧数值。
        if (!validValue(kind, (event.target as HTMLInputElement).value)) {
          event.stopPropagation();
        }
      }}
    >
      <NumberInput
        {...control}
        value={number}
        min={kind.min}
        max={kind.max}
        disabled={disabled}
        onValueChange={(next) => {
          setNumber(next);
          onChange(next === null ? "" : String(next));
        }}
      />
    </div>
  );
}

function ParamControl(props: ControlProps) {
  const { t } = useTranslation();
  const { entry, value, onChange, disabled, control } = props;
  switch (entry.kind.type) {
    case "text":
      return (
        <Input
          {...control}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        />
      );
    case "integer":
      return <IntegerControl {...props} kind={entry.kind} />;
    case "boolean":
      return (
        <Switch
          {...control}
          checked={value === "true"}
          disabled={disabled}
          onCheckedChange={(checked) => onChange(String(checked))}
        />
      );
    case "choice":
      return (
        <Select value={value} onValueChange={onChange} disabled={disabled}>
          <SelectTrigger {...control}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {entry.kind.values.map((option) => (
              <SelectItem key={option} value={option}>
                {t(`param.${entry.key}.choice.${option}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    case "secret":
      return (
        <Input
          {...control}
          type="password"
          autoComplete="new-password"
          value={value}
          disabled={disabled}
          placeholder={t("settings.secretPlaceholder")}
          onChange={(event) => onChange(event.target.value)}
        />
      );
  }
}

type RowProps = {
  entry: ParamEntry;
  userId: string;
  readOnlyReason: string | null;
  reload: () => Promise<boolean>;
  reloadError: IpcError | null;
};

function NonSecretRow(props: RowProps) {
  const draft = useParamDraft(props.entry);
  return <ParamRow {...props} editor={draft} />;
}

function SecretRow(props: RowProps) {
  const [draft, setDraft] = useState<ParamDraft | null>(null);
  return (
    <ParamRow
      {...props}
      editor={{
        draft: draft ?? { value: "", baseVersion: props.entry.rowVersion },
        dirty: draft !== null && draft.value !== "",
        setValue(value) {
          setDraft((current) => ({
            value,
            baseVersion: current ? current.baseVersion : props.entry.rowVersion,
          }));
        },
        accept: () => setDraft(null),
        discard: () => setDraft(null),
      }}
    />
  );
}

function ParamRow({
  entry,
  userId,
  readOnlyReason,
  reload,
  reloadError,
  editor,
}: RowProps & { editor: ReturnType<typeof useParamDraft> }) {
  const { t } = useTranslation();
  const change = useParamChange(
    userId,
    entry.key,
    entry.kind.type !== "secret",
  );
  const developer = useDeveloperMode();
  const { pathname } = useLocation();
  const drafts = useSettingsDrafts();
  const { unregister } = drafts;
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmReload, setConfirmReload] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [revision, setRevision] = useState(0);
  const { draft, dirty } = editor;
  const { value, baseVersion } = draft;
  const valid = validValue(entry.kind, value);
  const error = change.error ?? drafts.errors.get(entry.key);
  const conflict = error?.code === "app.data.version_conflict";
  const pending = change.pending || reloading;
  const disabled = readOnlyReason !== null || pending || drafts.applying;
  function accept(entry: ParamEntry) {
    editor.accept(entry);
    setRevision((current) => current + 1);
  }
  useEffect(() => {
    drafts.register(
      entry.key,
      dirty
        ? {
            sectionPath: pathname,
            valid: valid && !conflict && readOnlyReason === null,
            pending,
          }
        : null,
      {
        save: async () => {
          if (readOnlyReason !== null || !valid || conflict) return false;
          return change.save(value, baseVersion, accept);
        },
        discard: () => {
          editor.discard();
          change.reset();
          setRevision((current) => current + 1);
        },
      },
    );
  });
  useEffect(
    () => () => {
      if (entry.kind.type === "secret") unregister(entry.key);
    },
    [entry.key, entry.kind.type, unregister],
  );

  return (
    <form
      aria-label={t(`param.${entry.key}.name`)}
      className="min-w-0 space-y-2"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (!disabled && dirty && valid && !conflict) {
          void drafts.apply();
        }
      }}
    >
      <SettingRow
        source={entry.source}
        label={t(`param.${entry.key}.name`)}
        description={
          <>
            {t(`param.${entry.key}.description`)}
            {" · "}
            {t(`settings.effect.${entry.effect}`)}
            {readOnlyReason && (
              <span className="flex items-center gap-1">
                <Icon iconId="lock" />
                {readOnlyReason}
              </span>
            )}
          </>
        }
        error={dirty && !valid ? t("settings.invalidValue") : undefined}
        hint={
          developer
            ? t("settings.parameterSource", {
                source: t(`settings.source.${entry.source}`),
              })
            : undefined
        }
        actions={
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t("settings.reset")}
            disabled={disabled || entry.rowVersion === null || conflict}
            onClick={() => setConfirmReset(true)}
          >
            <RotateCcw aria-hidden="true" className="size-4" />
          </Button>
        }
      >
        {(control) => (
          <ParamControl
            key={revision}
            entry={entry}
            value={value}
            control={control}
            disabled={disabled}
            onChange={(next) => {
              editor.setValue(next);
            }}
          />
        )}
      </SettingRow>
      {conflict && <p role="alert">{t("settings.conflict")}</p>}
      {error && <IpcErrorMessage error={error} />}
      <div className="flex flex-wrap items-center gap-stack">
        {error && (
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() => setConfirmReload(true)}
          >
            {t("settings.reload")}
          </Button>
        )}
      </div>
      <ConfirmDialog
        open={confirmReset}
        onOpenChange={setConfirmReset}
        title={t("settings.reset")}
        description={t("settings.actions.resetConfirm")}
        confirmLabel={t("settings.reset")}
        pending={pending}
        onConfirm={() => {
          change.resetValue(baseVersion, accept);
          setConfirmReset(false);
        }}
      />
      <ConfirmDialog
        open={confirmReload}
        onOpenChange={setConfirmReload}
        title={t("settings.discard")}
        description={
          <>
            {t("settings.discardConfirm")}
            {reloadError && (
              <span role="alert" className="block">
                {t(`errors.${reloadError.code}`, reloadError.params)}
                <span className="block">
                  {t("error.traceId", { traceId: reloadError.traceId })}
                </span>
              </span>
            )}
          </>
        }
        confirmLabel={t("settings.reload")}
        pending={reloading}
        onConfirm={async () => {
          setReloading(true);
          if (await reload()) {
            editor.discard();
            setRevision((current) => current + 1);
            change.reset();
            setConfirmReload(false);
          }
          setReloading(false);
        }}
      />
    </form>
  );
}

function ParamEditor({
  userId,
  permissions,
  includeDisabled,
  group: selectedGroup,
}: {
  userId: string;
  permissions: string[];
  includeDisabled: boolean;
  group?: string;
}) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const query = useParamList(userId, includeDisabled);
  const modules = useQuery(appModulesQuery);
  useEffect(() => {
    client.setQueriesData<ParamEntry[]>(
      { queryKey: ["app", "setting", userId] },
      (entries) =>
        entries?.filter(
          (entry) =>
            entry.readPermission === null ||
            permissions.includes(entry.readPermission),
        ),
    );
  }, [client, userId, permissions]);

  if (!query.data || !modules.data) {
    const error = query.error ?? modules.error;
    return error ? (
      <IpcErrorMessage error={error} />
    ) : (
      <p>{t("settings.parametersLoading")}</p>
    );
  }
  const enabled = new Set(
    modules.data.modules.filter((module) => module.enabled).map(({ id }) => id),
  );
  const groups = new Map<string, ParamEntry[]>();
  const entries = sortParams(query.data);
  for (const entry of entries) {
    if (
      (!includeDisabled && !enabled.has(entry.moduleId)) ||
      (selectedGroup !== undefined && entry.group !== selectedGroup) ||
      (entry.readPermission !== null &&
        !permissions.includes(entry.readPermission))
    ) {
      continue;
    }
    const group = groups.get(entry.group);
    if (group) group.push(entry);
    else groups.set(entry.group, [entry]);
  }
  return (
    <div className="flex flex-col gap-stack">
      {query.error && <IpcErrorMessage error={query.error} />}
      {modules.error && <IpcErrorMessage error={modules.error} />}
      {groups.size === 0 && <p>{t("settings.parametersEmpty")}</p>}
      {[...groups].map(([group, items]) => {
        const rows = items.map((entry) => {
          const Row = entry.kind.type === "secret" ? SecretRow : NonSecretRow;
          return (
            <Row
              key={entry.key}
              entry={entry}
              userId={userId}
              reloadError={query.error}
              readOnlyReason={
                !enabled.has(entry.moduleId)
                  ? t("settings.moduleDisabled")
                  : entry.writePermission !== null &&
                      !permissions.includes(entry.writePermission)
                    ? t("settings.readOnlyPermission", {
                        permission: t(`permissions.${entry.writePermission}`),
                      })
                    : null
              }
              reload={async () => {
                const result = await query.refetch();
                if (
                  result.isSuccess &&
                  entry.key === "account.idle_lock_minutes"
                ) {
                  await client.invalidateQueries({ queryKey: authKey });
                }
                return result.isSuccess;
              }}
            />
          );
        });
        return (
          <SettingGroup
            key={group}
            title={
              selectedGroup === undefined
                ? t(`param.group.${group}`)
                : undefined
            }
          >
            {rows}
          </SettingGroup>
        );
      })}
    </div>
  );
}

export function ParamForm({
  includeDisabled,
  group,
}: {
  includeDisabled: boolean;
  group?: string;
}) {
  const { t } = useTranslation();
  const auth = useAuthStatus();
  if (auth.data?.state !== "active" || auth.data.user === null) return null;
  const { user, permissions } = auth.data;
  return (
    <section aria-labelledby="module-settings-title" className="space-y-4">
      <h2 id="module-settings-title" className="text-xl font-semibold">
        {group
          ? t(`param.group.${group}`)
          : t("settings.sections.moduleSettings")}
      </h2>
      <ParamEditor
        key={`${user.id}:${permissions.join(",")}:${includeDisabled}`}
        userId={user.id}
        permissions={permissions}
        includeDisabled={includeDisabled}
        group={group}
      />
    </section>
  );
}
