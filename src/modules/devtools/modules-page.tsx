import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { appModulesQuery } from "@/core/enabled-modules";
import { IpcErrorMessage } from "@/core/ipc-error";
import { Badge, DataTable, type DataTableColumn, PageHeader } from "@/kit";
import type { ModuleInfo } from "@/lib/generated/ModuleInfo";

export function ModulesPage() {
  const { t } = useTranslation();
  const modules = useQuery(appModulesQuery);
  const columns = useMemo<DataTableColumn<ModuleInfo>[]>(
    () => [
      {
        id: "id",
        header: t("modules.id"),
        cell: (row) => row.id,
        rowHeader: true,
      },
      {
        id: "version",
        header: t("modules.version"),
        cell: (row) => row.version,
      },
      {
        id: "status",
        header: t("modules.status"),
        cell: (row) => (
          <Badge tone={row.enabled ? "success" : "neutral"}>
            {t(row.enabled ? "modules.enabled" : "modules.disabled")}
          </Badge>
        ),
      },
      {
        id: "kind",
        header: t("modules.kind"),
        cell: (row) => t(row.core ? "modules.core" : "modules.optional"),
      },
      {
        id: "migrations",
        header: t("modules.migrations"),
        cell: (row) => row.appliedMigrations,
      },
    ],
    [t],
  );
  return (
    <section className="mx-auto w-full space-y-6 py-10">
      <PageHeader title={t("devtools.modules.title")} />
      <DataTable
        caption={t("devtools.modules.title")}
        columns={columns}
        rows={modules.data?.modules}
        getRowId={(row) => row.id}
        refreshing={modules.isFetching}
        errorView={
          modules.isError ? (
            <IpcErrorMessage error={modules.error} />
          ) : undefined
        }
      />
    </section>
  );
}
