import type { AppAbout } from "@/lib/generated/AppAbout";
import type { AppModules } from "@/lib/generated/AppModules";
import type { AppSettings } from "@/lib/generated/AppSettings";

export function buildDiagnosticText(
  about: AppAbout,
  modules: AppModules,
  settings: AppSettings,
): string {
  return [
    "Tenon diagnostics v1",
    `version: ${about.version}`,
    `database.kind: ${about.databaseKind}`,
    `database.appliedMigrations: ${about.appliedMigrations}`,
    `cache.provider: ${about.cacheProvider}`,
    `cache.status: ${about.cacheStatus.status}`,
    ...(about.cacheStatus.status === "error"
      ? [`cache.errorCode: ${about.cacheStatus.code}`]
      : []),
    `ui.language: ${settings.language.value}`,
    `ui.theme: ${settings.theme.value}`,
    "modules:",
    ...[...modules.modules]
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map(
        (module) =>
          `  ${module.id} ${module.version} ${module.enabled ? "enabled" : "disabled"} ${module.core ? "core" : "optional"}`,
      ),
    "paths: [redacted]",
    "endpoints: [redacted]",
  ].join("\n");
}
