import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppSettings } from "@/core/app-settings";
import { useAuthStatus } from "@/core/auth";
import { DictTag } from "@/core/dict/dict-tag";
import { appModulesQuery } from "@/core/enabled-modules";
import { IpcErrorMessage } from "@/core/ipc-error";
import { Button, SettingGroup, SettingRow, Spinner, Textarea } from "@/kit";
import type { AppAbout } from "@/lib/generated/AppAbout";
import {
  appAboutGet,
  appDiagnosticsExport,
  appFilePick,
  appOpenKnownTarget,
} from "@/lib/generated/commands";
import type { IpcError } from "@/lib/generated/IpcError";
import type { OpenKnownTargetInput } from "@/lib/generated/OpenKnownTargetInput";
import { buildDiagnosticText } from "./diagnostics";
import { UpdatePanel } from "./update-panel";

export function AboutSection() {
  const { t } = useTranslation();
  const modules = useQuery(appModulesQuery);
  const settings = useAppSettings();
  const auth = useAuthStatus();
  const [exportState, setExportState] = useState<
    | { status: "idle" | "selecting" | "exporting" | "saved" }
    | { status: "failed"; error: IpcError }
  >({ status: "idle" });
  const exporting =
    exportState.status === "selecting" || exportState.status === "exporting";
  const opening = useMutation<null, IpcError, OpenKnownTargetInput>({
    mutationFn: appOpenKnownTarget,
  });
  const [copyResult, setCopyResult] = useState<{
    status: "pending" | "copied" | "failed";
    text: string;
  } | null>(null);
  const about = useQuery<AppAbout, IpcError>({
    queryKey: ["app", "about"],
    queryFn: appAboutGet,
    retry: false,
    enabled: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const { refetch } = about;
  useEffect(() => {
    // Only entering this section and explicit refresh may probe the cache.
    void refetch();
  }, [refetch]);

  const diagnosticText =
    about.isSuccess && modules.isSuccess && settings.isSuccess
      ? buildDiagnosticText(about.data, modules.data, settings.data)
      : null;

  async function copyDiagnostics() {
    if (diagnosticText === null) return;
    const text = diagnosticText;
    setCopyResult({ status: "pending", text });
    if (!navigator.clipboard) {
      setCopyResult({ status: "failed", text });
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      setCopyResult({ status: "copied", text });
    } catch {
      setCopyResult({ status: "failed", text });
    }
  }

  async function exportDiagnostics() {
    setExportState({ status: "selecting" });
    try {
      const picked = await appFilePick({
        purpose: "diagnosticsexport",
      });
      if (picked === null) {
        setExportState({ status: "idle" });
        return;
      }
      setExportState({ status: "exporting" });
      await appDiagnosticsExport({ fileToken: picked.token });
      setExportState({ status: "saved" });
    } catch (error) {
      setExportState({ status: "failed", error: error as IpcError });
    }
  }

  return (
    <section aria-labelledby="about-title" className="space-y-4">
      <h2 id="about-title" className="text-xl font-semibold">
        {t("settings.sections.about")}
      </h2>
      <Button
        variant="outline"
        disabled={about.isFetching}
        onClick={() => void refetch()}
      >
        {t("settings.diagnostics.refresh")}
      </Button>
      {about.isPending ? (
        <p role="status">{t("settings.loading")}</p>
      ) : about.isError ? (
        <IpcErrorMessage error={about.error} />
      ) : (
        <SettingGroup>
          <SettingRow label={t("settings.version")}>
            {(control) => <div {...control}>{about.data.version}</div>}
          </SettingRow>
          <SettingRow label={t("settings.stateRoot")}>
            {(control) => (
              <div {...control} className="space-y-2 break-all">
                <p>{about.data.stateRoot}</p>
                <Button
                  variant="outline"
                  disabled={opening.isPending}
                  onClick={() => opening.mutate({ target: "stateDirectory" })}
                >
                  {t("settings.open.state")}
                </Button>
              </div>
            )}
          </SettingRow>
          <SettingRow label={t("settings.configFile")}>
            {(control) => (
              <div {...control} className="break-all">
                {about.data.configFile}
                <span className="ml-2 text-muted-foreground">
                  {t(
                    about.data.configFileExists
                      ? "settings.configExists"
                      : "settings.configMissing",
                  )}
                </span>
                <div className="mt-2">
                  <Button
                    variant="outline"
                    disabled={opening.isPending}
                    onClick={() =>
                      opening.mutate({ target: "configDirectory" })
                    }
                  >
                    {t("settings.open.config")}
                  </Button>
                </div>
              </div>
            )}
          </SettingRow>
          <SettingRow label={t("settings.logDirectory")}>
            {(control) => (
              <div {...control} className="space-y-2 break-all">
                <p>{about.data.logDirectory}</p>
                <Button
                  variant="outline"
                  disabled={opening.isPending}
                  onClick={() => opening.mutate({ target: "logDirectory" })}
                >
                  {t("settings.open.logs")}
                </Button>
              </div>
            )}
          </SettingRow>
          <SettingRow label={t("settings.databaseKind")}>
            {(control) => (
              <div {...control}>{t(`database.${about.data.databaseKind}`)}</div>
            )}
          </SettingRow>
          <SettingRow label={t("settings.databaseLocation")}>
            {(control) => (
              <div {...control} className="break-all">
                {about.data.databaseLocation}
              </div>
            )}
          </SettingRow>
          <SettingRow label={t("settings.appliedMigrations")}>
            {(control) => (
              <div {...control}>{about.data.appliedMigrations}</div>
            )}
          </SettingRow>
          <SettingRow label={t("settings.cacheProvider")}>
            {(control) => (
              <div {...control}>{t(`cache.${about.data.cacheProvider}`)}</div>
            )}
          </SettingRow>
          <SettingRow label={t("settings.cacheLocation")}>
            {(control) => (
              <div {...control} className="break-all">
                {about.data.cacheLocation ?? t("cache.localLocation")}
              </div>
            )}
          </SettingRow>
          <SettingRow label={t("settings.cacheStatus")}>
            {(control) => (
              <div {...control}>
                <DictTag
                  code="framework.cache_status"
                  value={about.data.cacheStatus.status}
                />
                {about.data.cacheStatus.status === "error" && (
                  <p>{t(`errors.${about.data.cacheStatus.code}`)}</p>
                )}
              </div>
            )}
          </SettingRow>
        </SettingGroup>
      )}
      {opening.isError && <IpcErrorMessage error={opening.error} />}
      <div className="space-y-3">
        <p className="text-body text-muted-foreground">
          {t("settings.diagnostics.description")}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={
              diagnosticText === null || copyResult?.status === "pending"
            }
            onClick={copyDiagnostics}
          >
            {t("settings.diagnostics.copy")}
          </Button>
          <Button
            variant="outline"
            disabled={
              diagnosticText === null ||
              auth.data?.state !== "active" ||
              exporting
            }
            onClick={exportDiagnostics}
          >
            {exporting && <Spinner />}
            {t("settings.diagnostics.export")}
          </Button>
        </div>
        <p className="text-body text-muted-foreground">
          {t("settings.diagnostics.logsExcluded")}
        </p>
        {exportState.status === "saved" && (
          <p role="status" className="text-body">
            {t("settings.diagnostics.exported")}
          </p>
        )}
        {exportState.status === "failed" && (
          <>
            <IpcErrorMessage error={exportState.error} />
            {exportState.error.code === "app.diagnostics.needs_probe" && (
              <p className="text-body">
                {t("settings.diagnostics.needsProbe")}
              </p>
            )}
          </>
        )}
        {copyResult?.status === "copied" && (
          <p role="status" className="text-body">
            {t("settings.diagnostics.copied")}
          </p>
        )}
        {copyResult?.status === "failed" && (
          <>
            <p role="alert" className="text-body text-destructive">
              {t("settings.diagnostics.copyFailed")}
            </p>
            <p
              id="diagnostics-redacted"
              className="text-body text-muted-foreground"
            >
              {t("settings.diagnostics.redacted")}
            </p>
            <Textarea
              aria-label={t("settings.diagnostics.manualCopy")}
              aria-describedby="diagnostics-redacted"
              readOnly
              value={copyResult.text}
              className="font-mono"
            />
          </>
        )}
      </div>
      <UpdatePanel />
    </section>
  );
}
