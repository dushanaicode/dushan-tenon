import { useMutation, useQuery } from "@tanstack/react-query";
import { Fragment, type ReactNode, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppSettings } from "@/core/app-settings";
import { useAuthStatus } from "@/core/auth";
import { DictTag } from "@/core/dict/dict-tag";
import { appModulesQuery } from "@/core/enabled-modules";
import { IpcErrorMessage } from "@/core/ipc-error";
import { Badge, Button, SettingGroup, Spinner, Textarea } from "@/kit";
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
        <AboutDetails
          about={about.data}
          opening={opening.isPending}
          onOpen={(target) => opening.mutate({ target })}
        />
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

function AboutRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid min-w-0 gap-2 p-4 @medium/settings:grid-cols-[10rem_minmax(0,1fr)] @medium/settings:items-center">
      <dt className="text-body font-medium">{label}</dt>
      <dd className="min-w-0 text-body">{children}</dd>
    </div>
  );
}

function AboutPath({ path }: { path: string }) {
  return (
    <code className="block min-w-0 select-text font-mono text-sm whitespace-pre-wrap [overflow-wrap:anywhere]">
      {Array.from(path.matchAll(/[^\\/]*[\\/]|[^\\/]+$/g), (part) => (
        <Fragment key={part.index}>
          {part[0]}
          <wbr />
        </Fragment>
      ))}
    </code>
  );
}

function AboutDetails({
  about,
  opening,
  onOpen,
}: {
  about: AppAbout;
  opening: boolean;
  onOpen: (target: OpenKnownTargetInput["target"]) => void;
}) {
  const { t } = useTranslation();
  const directories = [
    {
      label: "settings.stateRoot",
      path: about.stateRoot,
      target: "stateDirectory",
      action: "settings.open.state",
    },
    {
      label: "settings.configFile",
      path: about.configFile,
      target: "configDirectory",
      action: "settings.open.config",
    },
    {
      label: "settings.logDirectory",
      path: about.logDirectory,
      target: "logDirectory",
      action: "settings.open.logs",
    },
  ] as const;
  return (
    <SettingGroup>
      <dl className="divide-y divide-border" style={{ padding: 0 }}>
        <AboutRow label={t("settings.version")}>{about.version}</AboutRow>
        {about.copyright !== null && (
          <AboutRow label={t("settings.copyright")}>{about.copyright}</AboutRow>
        )}
        {directories.map(({ label, path, target, action }) => (
          <AboutRow key={target} label={t(label)}>
            <div className="flex min-w-0 flex-col items-start gap-3 @medium/settings:flex-row @medium/settings:items-center">
              <div className="min-w-0 flex-1 space-y-2">
                <AboutPath path={path} />
                {target === "configDirectory" && (
                  <Badge
                    tone={about.configFileExists ? "success" : "neutral"}
                    className="whitespace-nowrap"
                    title={
                      about.configFileExists
                        ? undefined
                        : t("settings.configMissingHint")
                    }
                  >
                    {t(
                      about.configFileExists
                        ? "settings.configExists"
                        : "settings.configMissing",
                    )}
                  </Badge>
                )}
              </div>
              <Button
                variant="outline"
                className="shrink-0"
                aria-label={t(action)}
                disabled={opening}
                onClick={() => onOpen(target)}
              >
                {t("settings.open.directory")}
              </Button>
            </div>
          </AboutRow>
        ))}
        <AboutRow label={t("settings.databaseKind")}>
          {t(`database.${about.databaseKind}`)}
        </AboutRow>
        <AboutRow label={t("settings.databaseLocation")}>
          <AboutPath path={about.databaseLocation} />
        </AboutRow>
        <AboutRow label={t("settings.appliedMigrations")}>
          {about.appliedMigrations}
        </AboutRow>
        <AboutRow label={t("settings.cacheProvider")}>
          {t(`cache.${about.cacheProvider}`)}
        </AboutRow>
        <AboutRow label={t("settings.cacheLocation")}>
          {about.cacheLocation === null ? (
            t("cache.localLocation")
          ) : (
            <AboutPath path={about.cacheLocation} />
          )}
        </AboutRow>
        <AboutRow label={t("settings.cacheStatus")}>
          <DictTag
            code="framework.cache_status"
            value={about.cacheStatus.status}
          />
          {about.cacheStatus.status === "error" && (
            <p>{t(`errors.${about.cacheStatus.code}`)}</p>
          )}
        </AboutRow>
      </dl>
    </SettingGroup>
  );
}
