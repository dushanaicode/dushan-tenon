import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  isOverridden,
  useAppSettings,
  useSettingsPending,
  useSettingsUpdate,
} from "@/core/app-settings";
import { IpcErrorMessage } from "@/core/ipc-error";
import { SettingSelect } from "@/core/settings/setting-select";
import { SettingSource } from "@/core/settings/setting-source";
import {
  Button,
  ConfirmDialog,
  Loading,
  SettingGroup,
  SettingRow,
  Switch,
} from "@/kit";
import { useWorkbench } from "@/shell";

export function AdvancedSection() {
  const { t } = useTranslation();
  const settings = useAppSettings();
  const update = useSettingsUpdate();
  const pending = useSettingsPending();
  if (settings.isPending) return <Loading label={t("kit.loading")} />;
  if (settings.isError) return <IpcErrorMessage error={settings.error} />;
  const { developerMode, logLevel } = settings.data;
  return (
    <section aria-labelledby="advanced-title" className="space-y-4">
      <h2 id="advanced-title" className="text-xl font-semibold">
        {t("settings.sections.advanced")}
      </h2>
      <SettingGroup>
        <SettingSelect
          label={t("settings.logLevel")}
          value={logLevel.value}
          source={logLevel.source}
          options={(["error", "warn", "info", "debug", "trace"] as const).map(
            (value) => ({ value, label: t(`logging.${value}`) }),
          )}
          disabled={pending || isOverridden(logLevel.source)}
          onValueChange={(logLevel) => update.mutate({ logLevel })}
        />
        <SettingRow
          label={t("settings.developerMode")}
          description={t("settings.developerModeDescription")}
          source={developerMode.source}
          hint={<SettingSource source={developerMode.source} />}
        >
          {(control) => (
            <Switch
              {...control}
              checked={developerMode.value}
              disabled={pending || isOverridden(developerMode.source)}
              onCheckedChange={(developerMode) =>
                update.mutate({ developerMode })
              }
            />
          )}
        </SettingRow>
        {update.isError && <IpcErrorMessage error={update.error} />}
      </SettingGroup>
      <WorkbenchReset />
    </section>
  );
}

function WorkbenchReset() {
  const { t } = useTranslation();
  const workbench = useWorkbench();
  const [confirm, setConfirm] = useState(false);
  const [done, setDone] = useState(false);
  const conflict = workbench.error?.code === "app.workbench.conflict";
  const failure = workbench.error && (
    <IpcErrorMessage error={workbench.error} />
  );
  const confirmation = {
    open: confirm,
    onOpenChange: setConfirm,
    title: t("settings.workbench.reset"),
    pending: workbench.pending,
    description: (
      <>
        <span>{t("settings.workbench.resetDescription")}</span>
        {workbench.error && (
          <span className="block" role="alert">
            {t(`errors.${workbench.error.code}`, workbench.error.params)}
            <span className="block">
              {t("error.traceId", { traceId: workbench.error.traceId })}
            </span>
          </span>
        )}
      </>
    ),
  };
  return (
    <SettingGroup title={t("settings.workbench.title")}>
      <p className="text-body">{t("settings.workbench.resetDescription")}</p>
      <Button
        variant="outline"
        disabled={workbench.pending || conflict}
        onClick={() => {
          setDone(false);
          setConfirm(true);
        }}
      >
        {t("settings.workbench.reset")}
      </Button>
      {!confirm && failure}
      {conflict && (
        <Button
          variant="outline"
          disabled={workbench.pending}
          onClick={workbench.reload}
        >
          {t("settings.workbench.reload")}
        </Button>
      )}
      {done && <p role="status">{t("settings.workbench.resetDone")}</p>}
      {conflict ? (
        <ConfirmDialog
          {...confirmation}
          confirmLabel={t("settings.workbench.reload")}
          onConfirm={workbench.reload}
        />
      ) : (
        <ConfirmDialog
          {...confirmation}
          confirmLabel={t("settings.workbench.reset")}
          onConfirm={async () => {
            if (await workbench.resetLayout()) {
              setDone(true);
              setConfirm(false);
            }
          }}
        />
      )}
    </SettingGroup>
  );
}
