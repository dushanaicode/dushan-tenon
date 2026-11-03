import { expect, test } from "vitest";
import type { AppAbout } from "@/lib/generated/AppAbout";
import type { AppModules } from "@/lib/generated/AppModules";
import type { AppSettings } from "@/lib/generated/AppSettings";
import { buildDiagnosticText } from "./diagnostics";
import { about, defaultSettings } from "./settings.test-support";

const sensitive = {
  stateRoot: "E:\\secret-user\\state",
  configFile: "E:\\private-config\\config.toml",
  logDirectory: "E:\\private-logs\\logs",
  databaseLocation: "postgres://secret-user:secret-password@private-host/db",
  cacheLocation: "redis://private-cache-user:private-cache-password@cache/2",
  displayName: "private-display-name",
  ip: "192.0.2.123",
  instanceId: "private-instance-id",
  config: "private-config-content",
  environment: "private-environment-value",
  paramEntry: "private-parameter-value",
  commandInput: "private-command-input",
  log: "private-log-content",
  secret: "private-secret-value",
};

const diagnosticAbout: AppAbout = {
  ...about,
  ...sensitive,
  databaseKind: "postgres",
  cacheProvider: "redis",
};
const diagnosticSettings: AppSettings = {
  ...defaultSettings,
  ...sensitive,
  language: { value: "en-US", source: "file" },
  theme: { value: "system", source: "file" },
};
const modules: AppModules = {
  modules: [
    {
      id: "notify",
      version: "0.2.0",
      enabled: false,
      core: false,
      appliedMigrations: 99,
      ...sensitive,
    },
    {
      id: "account",
      version: "0.1.0",
      enabled: true,
      core: true,
      appliedMigrations: 42,
      ...sensitive,
    },
    {
      id: "Z_test",
      version: "1.0.0",
      enabled: true,
      core: false,
      appliedMigrations: 0,
      ...sensitive,
    },
  ],
};

test("diagnostic_text_preserves_whitelist and excludes sensitive sentinels", () => {
  const originalModules = structuredClone(modules);
  const text = buildDiagnosticText(
    diagnosticAbout,
    modules,
    diagnosticSettings,
  );
  for (const sentinel of Object.values(sensitive)) {
    expect(text).not.toContain(sentinel);
  }
  expect(text.split("\n")).toEqual([
    "Tenon diagnostics v1",
    "version: 0.1.0-test",
    "database.kind: postgres",
    "database.appliedMigrations: 3",
    "cache.provider: redis",
    "cache.status: connected",
    "ui.language: en-US",
    "ui.theme: system",
    "modules:",
    "  Z_test 1.0.0 enabled optional",
    "  account 0.1.0 enabled core",
    "  notify 0.2.0 disabled optional",
    "paths: [redacted]",
    "endpoints: [redacted]",
  ]);
  expect(text.endsWith("\n")).toBe(false);
  expect(modules).toEqual(originalModules);
});

test("diagnostic text handles cache errors", () => {
  const cacheStatus = {
    status: "error" as const,
    code: "app.cache.unavailable",
    source: "private-cache-error-source",
    message: "private-cache-error-message",
  };
  const text = buildDiagnosticText(
    { ...diagnosticAbout, cacheStatus },
    { modules: [] },
    diagnosticSettings,
  );
  expect(text.split("\n")).toEqual([
    "Tenon diagnostics v1",
    "version: 0.1.0-test",
    "database.kind: postgres",
    "database.appliedMigrations: 3",
    "cache.provider: redis",
    "cache.status: error",
    "cache.errorCode: app.cache.unavailable",
    "ui.language: en-US",
    "ui.theme: system",
    "modules:",
    "paths: [redacted]",
    "endpoints: [redacted]",
  ]);
  for (const sentinel of [
    ...Object.values(sensitive),
    cacheStatus.source,
    cacheStatus.message,
  ]) {
    expect(text).not.toContain(sentinel);
  }
});
