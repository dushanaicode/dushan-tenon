import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useAuthStatus } from "@/core/auth";
import { appModulesQuery } from "@/core/enabled-modules";
import { IpcErrorMessage } from "@/core/ipc-error";
import { sortParams, useParamList } from "@/core/settings/param-queries";
import { Badge, DataTable, type DataTableColumn, PageHeader } from "@/kit";
import type { ParamEntry } from "@/lib/generated/ParamEntry";

export function SettingsPage() {
  const auth = useAuthStatus();
  if (auth.data?.state !== "active" || auth.data.user === null) return null;
  return (
    <Inspection
      userId={auth.data.user.id}
      permissions={auth.data.permissions}
    />
  );
}

function Inspection({
  userId,
  permissions,
}: {
  userId: string;
  permissions: readonly string[];
}) {
  const { t } = useTranslation();
  const params = useParamList(userId, true);
  const modules = useQuery(appModulesQuery);
  const columns = useMemo<DataTableColumn<ParamEntry>[]>(
    () => [
      {
        id: "key",
        header: t("devtools.settings.key"),
        cell: (row) => row.key,
        rowHeader: true,
      },
      {
        id: "module",
        header: t("devtools.settings.module"),
        className: "min-w-20 whitespace-nowrap",
        cell: (row) => row.moduleId,
      },
      {
        id: "group",
        header: t("devtools.settings.group"),
        className: "min-w-24 whitespace-nowrap",
        cell: (row) => row.group,
      },
      {
        id: "value",
        header: t("devtools.settings.value"),
        className: "min-w-24 whitespace-nowrap",
        cell: (row) =>
          row.kind.type === "secret"
            ? t(
                row.secretSet
                  ? "devtools.settings.secretSet"
                  : "devtools.settings.secretUnset",
              )
            : row.value,
      },
      {
        id: "default",
        header: t("devtools.settings.default"),
        className: "min-w-24 whitespace-nowrap",
        cell: (row) => (row.kind.type === "secret" ? "—" : row.default),
      },
      {
        id: "source",
        header: t("devtools.settings.source"),
        className: "min-w-28 whitespace-nowrap",
        cell: (row) => t(`settings.source.${row.source}`),
      },
      {
        id: "version",
        header: t("devtools.settings.version"),
        className: "min-w-20 whitespace-nowrap",
        cell: (row) => row.rowVersion ?? "—",
      },
      {
        id: "effect",
        header: t("devtools.settings.effect"),
        className: "min-w-48 whitespace-nowrap",
        cell: (row) => t(`settings.effect.${row.effect}`),
      },
      {
        id: "readPermission",
        header: t("devtools.settings.readPermission"),
        cell: (row) => row.readPermission ?? "—",
      },
      {
        id: "writePermission",
        header: t("devtools.settings.writePermission"),
        cell: (row) => row.writePermission ?? "—",
      },
      {
        id: "status",
        header: t("modules.status"),
        className: "min-w-24 whitespace-nowrap",
        cell: (row) => {
          const module = modules.data?.modules.find(
            (module) => module.id === row.moduleId,
          );
          if (!module) throw new Error(`缺少设置所属模块：${row.moduleId}`);
          return (
            <Badge tone={module.enabled ? "neutral" : "warning"}>
              {t(
                module.enabled
                  ? "devtools.settings.normal"
                  : "settings.moduleDisabled",
              )}
            </Badge>
          );
        },
      },
    ],
    [t, modules.data],
  );
  const rows = useMemo(
    () =>
      params.data && modules.isSuccess
        ? sortParams(
            params.data.filter(
              (row) =>
                row.readPermission === null ||
                permissions.includes(row.readPermission),
            ),
          )
        : undefined,
    [params.data, modules.isSuccess, permissions],
  );
  const error = params.error ?? modules.error;
  return (
    <section className="mx-auto w-full space-y-6 py-10">
      <PageHeader title={t("devtools.settings.title")} />
      <DataTable
        caption={t("devtools.settings.title")}
        columns={columns}
        rows={rows}
        getRowId={(row) => row.key}
        refreshing={params.isFetching || modules.isFetching}
        errorView={error ? <IpcErrorMessage error={error} /> : undefined}
      />
    </section>
  );
}
