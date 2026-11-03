import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  isOverridden,
  useAppSettings,
  useSettingsPending,
  useSettingsUpdate,
} from "@/core/app-settings";
import { IpcErrorMessage } from "@/core/ipc-error";
import { ParamForm } from "@/core/settings/param-form";
import { SettingSource } from "@/core/settings/setting-source";
import { Button, SettingGroup, SettingRow, Spinner, Switch } from "@/kit";
import { notifyTestSend } from "@/lib/generated/commands";
import type { IpcError } from "@/lib/generated/IpcError";
import type { NotifyTestResult } from "@/lib/generated/NotifyTestResult";
import { useNotifications } from "./notifications";

export function NotifySettingsSection() {
  const { key, active } = useNotifications();
  return active ? <ActiveSettingsSection key={key[2]} /> : null;
}

function ActiveSettingsSection() {
  const { t } = useTranslation();
  const settings = useAppSettings();
  const update = useSettingsUpdate();
  const pending = useSettingsPending();
  const client = useQueryClient();
  const { key } = useNotifications();
  const test = useMutation<NotifyTestResult, IpcError>({
    mutationFn: notifyTestSend,
    onSuccess: () => client.invalidateQueries({ queryKey: key }),
  });
  if (!settings.data) return null;
  const { desktopNotifications } = settings.data;
  return (
    <section aria-labelledby="notify-settings-title" className="space-y-4">
      <h2 id="notify-settings-title" className="text-xl font-semibold">
        {t("notify.settings.title")}
      </h2>
      <SettingGroup>
        <SettingRow
          label={t("settings.desktopNotifications")}
          source={desktopNotifications.source}
          hint={<SettingSource source={desktopNotifications.source} />}
        >
          {(control) => (
            <Switch
              {...control}
              checked={desktopNotifications.value}
              disabled={pending || isOverridden(desktopNotifications.source)}
              onCheckedChange={(desktopNotifications) =>
                update.mutate({ desktopNotifications })
              }
            />
          )}
        </SettingRow>
        <SettingRow label={t("notify.settings.test")}>
          {(control) => (
            <div {...control} className="space-y-2">
              <Button
                variant="outline"
                disabled={test.isPending}
                onClick={() => test.mutate()}
              >
                {test.isPending && <Spinner aria-hidden="true" />}
                {t("notify.settings.test")}
              </Button>
              {test.data && (
                <p role="status" className="text-body text-muted-foreground">
                  {t(`notify.settings.testResult.${test.data.desktop}`)}
                </p>
              )}
              {test.isError && <IpcErrorMessage error={test.error} />}
            </div>
          )}
        </SettingRow>
      </SettingGroup>
      {update.isError && <IpcErrorMessage error={update.error} />}
      <ParamForm group="notify.preferences" includeDisabled={false} />
    </section>
  );
}
