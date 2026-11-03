// showcase-example
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { type DataTableColumn, FormField, Input, ListPage } from "@/kit";

const records = [
  { id: "paper", nameKey: "showcase.templates.planName" },
  { id: "sand", nameKey: "showcase.templates.otherPlan" },
];
const recordId = (row: (typeof records)[number]) => row.id;
export function TemplateListExample() {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const rows = records.filter((row) => t(row.nameKey).includes(query));
  const columns = useMemo<DataTableColumn<(typeof records)[number]>[]>(
    () => [
      {
        id: "name",
        header: t("showcase.templates.name"),
        cell: (row) => (
          <span className="whitespace-normal break-words">
            {t(row.nameKey)}
          </span>
        ),
      },
    ],
    [t],
  );
  return (
    <ListPage
      title={t("showcase.templates.listTitle")}
      description={t("showcase.templates.fictional")}
      filters={{
        label: t("showcase.templates.filterLabel"),
        onSubmit: (values) => {
          setQuery((values.get("name") as string).trim());
          setPage(1);
        },
        onReset: () => {
          setQuery("");
          setPage(1);
        },
        children: (
          <FormField label={t("showcase.templates.name")}>
            {(control) => <Input {...control} name="name" />}
          </FormField>
        ),
      }}
      table={{
        caption: t("showcase.templates.listCaption"),
        columns,
        rows: rows.slice(page - 1, page),
        getRowId: recordId,
        filtered: query !== "",
      }}
      pagination={{
        page,
        pageSize: 1,
        total: rows.length,
        onPageChange: setPage,
      }}
    />
  );
}
