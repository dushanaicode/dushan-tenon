import {
  useIsMutating,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { isOverridden } from "@/core/app-settings";
import { useAuthStatus } from "@/core/auth";
import { IpcErrorMessage } from "@/core/ipc-error";
import { SettingSource } from "@/core/settings/setting-source";
import {
  Button,
  Input,
  Kbd,
  Loading,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SettingGroup,
  SettingRow,
  Switch,
} from "@/kit";
import type { CloseAction } from "@/lib/generated/CloseAction";
import {
  appNativeSettingsGet,
  appNativeSettingsUpdate,
  appUpdateStatus,
  appWindowStateReset,
} from "@/lib/generated/commands";
import type { IpcError } from "@/lib/generated/IpcError";
import type { NativeSettings as NativeSettingsDto } from "@/lib/generated/NativeSettings";
import type { NativeSettingsChange } from "@/lib/generated/NativeSettingsChange";
import type { UpdateState } from "@/lib/generated/UpdateState";
import { useWindowChrome } from "@/shell";

const mutationKey = ["app", "native-settings"];

export function NativeSettings() {
  const { t } = useTranslation();
  const { platform } = useWindowChrome();
  const auth = useAuthStatus();
  const client = useQueryClient();
  const [binding, setBinding] = useState<string | null>(null);
  const queryKey = ["app", "native-settings", auth.data?.user?.id];
  const settings = useQuery<NativeSettingsDto, IpcError>({
    queryKey,
    queryFn: appNativeSettingsGet,
    enabled: auth.data?.state === "active",
    retry: false,
    staleTime: Infinity,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const update = useMutation<
    NativeSettingsDto,
    IpcError,
    NativeSettingsChange | { type: "reset" }
  >({
    mutationKey,
    scope: { id: "native-settings" },
    mutationFn: (input) =>
      input.type === "reset"
        ? appWindowStateReset()
        : appNativeSettingsUpdate(input),
    onSuccess: (saved, input) => {
      client.setQueryData(queryKey, saved);
      if (input.type === "shortcut") setBinding(null);
    },
    onError: async () => {
      await settings.refetch();
    },
  });
  const status = useQuery<UpdateState, IpcError>({
    queryKey: ["app", "update", auth.data?.user?.id],
    queryFn: appUpdateStatus,
    enabled: auth.data?.state === "active",
    retry: false,
    staleTime: Infinity,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const pending = useIsMutating({ mutationKey }) > 0;
  if (settings.isError) {
    return (
      <div className="space-y-4">
        <IpcErrorMessage error={settings.error} />
        <Button
          variant="outline"
          disabled={settings.isFetching}
          onClick={() => void settings.refetch()}
        >
          {t("settings.native.refresh")}
        </Button>
      </div>
    );
  }
  if (!settings.data) return <Loading label={t("kit.loading")} />;
  const { canEdit, updater } = settings.data;
  const configured = status.isSuccess && status.data.status !== "unconfigured";
  return (
    <div className="space-y-4">
      <WindowSettings
        saved={settings.data}
        pending={pending}
        change={update.mutate}
        onReset={() => update.mutate({ type: "reset" })}
      />
      <SettingGroup title={t("settings.groups.startup")}>
        <div className="p-4">
          <AutostartSettings
            saved={settings.data}
            pending={pending}
            change={update.mutate}
            platform={platform}
          />
        </div>
        <SettingRow
          label={t("settings.update.checkOnStart")}
          description={
            configured
              ? t("settings.update.checkOnStartDescription")
              : undefined
          }
          source={updater.checkOnStart.source}
          hint={
            <SettingSource
              source={updater.checkOnStart.source}
              locked={!canEdit || !configured}
              reason={
                !configured
                  ? t("settings.update.unconfigured")
                  : !canEdit
                    ? t("settings.native.ownerOnly")
                    : undefined
              }
            />
          }
        >
          {(control) => (
            <Switch
              {...control}
              checked={configured && updater.checkOnStart.value}
              disabled={
                !canEdit ||
                pending ||
                !configured ||
                isOverridden(updater.checkOnStart.source)
              }
              onCheckedChange={(checkOnStart) =>
                update.mutate({ type: "updater", checkOnStart })
              }
            />
          )}
        </SettingRow>
      </SettingGroup>
      <SettingGroup title={t("settings.groups.globalShortcut")}>
        <div className="p-4">
          <GlobalShortcut
            saved={settings.data}
            pending={pending}
            change={update.mutate}
            platform={platform}
            binding={binding}
            setBinding={setBinding}
          />
        </div>
      </SettingGroup>
      {status.isError && <IpcErrorMessage error={status.error} />}
      {update.isError && <IpcErrorMessage error={update.error} />}
      <Button
        variant="outline"
        disabled={pending || settings.isFetching}
        onClick={() => void Promise.all([settings.refetch(), status.refetch()])}
      >
        {t("settings.native.refresh")}
      </Button>
    </div>
  );
}

type NativeControls = {
  saved: NativeSettingsDto;
  pending: boolean;
  change: (input: NativeSettingsChange) => void;
};
type Platform = "windows" | "macos" | "linux";

function WindowSettings({
  saved,
  pending,
  change,
  onReset,
}: NativeControls & {
  onReset: () => void;
}) {
  const { t } = useTranslation();
  const { canEdit, window: geometry, tray } = saved;
  const trayReadOnly =
    !canEdit ||
    pending ||
    isOverridden(tray.enabled.source) ||
    isOverridden(tray.closeAction.source) ||
    tray.error?.code === "app.native.unsupported_scope";
  return (
    <>
      <SettingGroup title={t("settings.groups.window")}>
        <SettingRow
          source={geometry.restoreState.source}
          label={t("settings.window.restore")}
          description={
            <>
              {t("settings.window.restoreDescription")}
              <span className="block">
                {t(`settings.window.state.${geometry.state}`)}
              </span>
            </>
          }
          hint={
            <SettingSource
              source={geometry.restoreState.source}
              locked={!canEdit}
              reason={!canEdit ? t("settings.native.ownerOnly") : undefined}
            />
          }
        >
          {(control) => (
            <Switch
              {...control}
              checked={geometry.restoreState.value}
              disabled={
                !canEdit ||
                pending ||
                isOverridden(geometry.restoreState.source)
              }
              onCheckedChange={(restoreState) =>
                change({ type: "window", restoreState })
              }
            />
          )}
        </SettingRow>
        <div className="space-y-3 p-4">
          {geometry.error && <IpcErrorMessage error={geometry.error} />}
          <Button
            variant="outline"
            disabled={!canEdit || pending || !geometry.restoreState.value}
            onClick={onReset}
          >
            {t("settings.window.reset")}
          </Button>
        </div>
      </SettingGroup>
      <SettingGroup title={t("settings.groups.tray")}>
        <SettingRow
          label={t("settings.tray.enabled")}
          description={t("settings.tray.description")}
          source={tray.enabled.source}
          hint={
            <SettingSource
              source={
                isOverridden(tray.closeAction.source)
                  ? tray.closeAction.source
                  : tray.enabled.source
              }
              locked={!canEdit}
              reason={!canEdit ? t("settings.native.ownerOnly") : undefined}
            />
          }
        >
          {(control) => (
            <Switch
              {...control}
              checked={tray.enabled.value}
              disabled={trayReadOnly}
              onCheckedChange={(enabled) =>
                change({
                  type: "tray",
                  enabled,
                  closeAction:
                    !enabled && tray.closeAction.value === "tray"
                      ? "exit"
                      : tray.closeAction.value,
                })
              }
            />
          )}
        </SettingRow>
        <SettingRow
          label={t("settings.window.closeAction")}
          description={t("settings.tray.closeDescription")}
          source={tray.closeAction.source}
          hint={
            <SettingSource
              source={
                isOverridden(tray.enabled.source)
                  ? tray.enabled.source
                  : tray.closeAction.source
              }
              locked={!canEdit}
              reason={!canEdit ? t("settings.native.ownerOnly") : undefined}
            />
          }
        >
          {(control) => (
            <Select
              value={tray.closeAction.value}
              disabled={trayReadOnly}
              onValueChange={(closeAction) =>
                change({
                  type: "tray",
                  enabled: tray.enabled.value,
                  closeAction: closeAction as CloseAction,
                })
              }
            >
              <SelectTrigger {...control}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(["ask", "tray", "exit"] as const).map((action) => (
                  <SelectItem
                    key={action}
                    value={action}
                    disabled={
                      action === "tray" &&
                      (!tray.enabled.value || tray.state !== "ready")
                    }
                  >
                    {t(`settings.window.close.${action}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </SettingRow>
        <div className="space-y-3 p-4">
          <p className="text-body text-muted-foreground">
            {t(`settings.tray.state.${tray.state}`)}
          </p>
          {tray.error && <IpcErrorMessage error={tray.error} />}
          {tray.enabled.value && tray.state === "unavailable" && (
            <Button
              variant="outline"
              disabled={trayReadOnly}
              onClick={() =>
                change({
                  type: "tray",
                  enabled: true,
                  closeAction: tray.closeAction.value,
                })
              }
            >
              {t("settings.tray.retry")}
            </Button>
          )}
        </div>
      </SettingGroup>
    </>
  );
}

function AutostartSettings({
  saved,
  pending,
  change,
  platform,
}: NativeControls & { platform: Platform }) {
  const { t } = useTranslation();
  const { canEdit, autostart } = saved;
  const macos = platform === "macos";
  return (
    <div className="space-y-3">
      <h4 className="text-body font-medium">
        {t("settings.autostart.enabled")}
      </h4>
      <p className="text-body text-muted-foreground">
        {t("settings.native.desiredState")}:{" "}
        {t(
          autostart.desired.value
            ? "settings.native.enabled"
            : "settings.native.disabled",
        )}
        <SettingSource
          source={autostart.desired.source}
          locked={!canEdit}
          reason={!canEdit ? t("settings.native.ownerOnly") : undefined}
        />
      </p>
      {autostart.registered.status === "unsupported" ? (
        <p className="text-body text-muted-foreground">
          {t(`settings.autostart.unsupported.${autostart.registered.reason}`)}
        </p>
      ) : autostart.registered.status === "unknown" ? (
        <>
          <p className="text-body">
            {t("settings.native.systemState")}: {t("settings.native.unknown")}
          </p>
          <IpcErrorMessage error={autostart.registered.error} />
        </>
      ) : (
        <SettingRow label={t("settings.autostart.registered")}>
          {(control) => (
            <Switch
              {...control}
              checked={
                autostart.registered.status === "known" &&
                autostart.registered.value
              }
              disabled={
                !canEdit || pending || isOverridden(autostart.desired.source)
              }
              onCheckedChange={(enabled) =>
                change({ type: "autostart", enabled })
              }
            />
          )}
        </SettingRow>
      )}
      <p className="text-body">
        {t(
          macos
            ? "settings.autostart.approvalMac"
            : platform === "linux"
              ? "settings.autostart.approvalLinux"
              : "settings.autostart.approval",
        )}
        {": "}
        {t(
          `${macos || platform === "linux" ? "settings.autostart.nativeApproval" : "settings.autostart.approval"}.${autostart.approval}`,
        )}
      </p>
      {autostart.approvalError && (
        <IpcErrorMessage error={autostart.approvalError} />
      )}
      <p className="text-body">
        {t("settings.autostart.effective")}
        {": "}
        {t(`settings.autostart.effective.${autostart.effectiveStartup}`)}
      </p>
      <p className="text-body text-muted-foreground">
        {t(
          macos
            ? "settings.autostart.policyDescriptionMac"
            : platform === "linux"
              ? "settings.autostart.policyDescriptionLinux"
              : "settings.autostart.policyDescription",
        )}
      </p>
      {autostart.state === "degraded" && (
        <p role="status" className="text-body">
          {t("settings.autostart.degraded")}
        </p>
      )}
      {autostart.error && <IpcErrorMessage error={autostart.error} />}
    </div>
  );
}

function GlobalShortcut({
  saved,
  pending,
  change,
  platform,
  binding,
  setBinding,
}: NativeControls & {
  platform: Platform;
  binding: string | null;
  setBinding: (value: string) => void;
}) {
  const { t } = useTranslation();
  const { canEdit, shortcut } = saved;
  const macos = platform === "macos";
  const exampleShortcut = macos ? "Cmd+Shift+K" : "Ctrl+Alt+D";
  const shortcutReadOnly =
    !canEdit ||
    pending ||
    isOverridden(shortcut.desired.source) ||
    shortcut.state === "unsupported";
  return (
    <div className="space-y-3">
      <SettingRow
        label={t("settings.shortcut.label")}
        description={
          <>
            {t(
              macos
                ? "settings.shortcut.descriptionMac"
                : "settings.shortcut.description",
            )}{" "}
            <Kbd>{exampleShortcut}</Kbd>
          </>
        }
        source={shortcut.desired.source}
        hint={
          <SettingSource
            source={shortcut.desired.source}
            locked={!canEdit}
            reason={!canEdit ? t("settings.native.ownerOnly") : undefined}
          />
        }
      >
        {(control) => (
          <Input
            {...control}
            value={binding ?? shortcut.desired.value}
            disabled={shortcutReadOnly}
            maxLength={128}
            placeholder={exampleShortcut}
            onChange={(event) => setBinding(event.target.value)}
          />
        )}
      </SettingRow>
      <p className="text-body">
        {t("settings.native.desiredState")}:{" "}
        <Kbd>{shortcut.desired.value || t("settings.shortcut.unbound")}</Kbd>
      </p>
      <p className="text-body">
        {t("settings.shortcut.active")}:{" "}
        <Kbd>{shortcut.active ?? t("settings.shortcut.unbound")}</Kbd>
      </p>
      <p className="text-body">
        {t("settings.shortcut.registered")}:{" "}
        {shortcut.registered.length === 0
          ? t("settings.shortcut.unbound")
          : shortcut.registered.map((key) => <Kbd key={key}>{key}</Kbd>)}
      </p>
      {shortcut.state === "unsupported" && (
        <p role="status" className="text-body">
          {t("settings.shortcut.unsupported")}
        </p>
      )}
      {shortcut.state === "unavailable" && (
        <p role="status" className="text-body">
          {t("settings.shortcut.unavailable")}
        </p>
      )}
      {shortcut.state === "degraded" && (
        <p role="status" className="text-body">
          {t("settings.shortcut.degraded")}
        </p>
      )}
      {shortcut.error && <IpcErrorMessage error={shortcut.error} />}
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={
            shortcutReadOnly ||
            binding === null ||
            binding === shortcut.desired.value
          }
          onClick={() =>
            change({
              type: "shortcut",
              binding: binding ?? shortcut.desired.value,
            })
          }
        >
          {t("settings.shortcut.save")}
        </Button>
        {(shortcut.state === "unavailable" ||
          shortcut.state === "degraded") && (
          <Button
            variant="outline"
            disabled={shortcutReadOnly}
            onClick={() =>
              change({
                type: "shortcut",
                binding: shortcut.desired.value,
              })
            }
          >
            {t("settings.native.retry")}
          </Button>
        )}
      </div>
    </div>
  );
}
