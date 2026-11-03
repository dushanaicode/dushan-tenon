// showcase-example
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { FilterBar, FormField, Input } from "@/kit";

export const tableRows = [
  { id: "a", titleKey: "showcase.tables.sampleA", count: 3 },
  { id: "b", titleKey: "showcase.tables.sampleB", count: 1 },
  { id: "c", titleKey: "showcase.tables.sampleC", count: 8 },
  { id: "d", titleKey: "showcase.tables.sampleD", count: 5 },
] as const;

export function FilterBarExample() {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const matches = tableRows.filter((row) => t(row.titleKey).includes(query));
  return (
    <div className="space-y-3">
      <FilterBar
        label={t("showcase.tables.filterExample")}
        onSubmit={(values) => setQuery((values.get("name") as string).trim())}
        onReset={() => setQuery("")}
      >
        <FormField label={t("showcase.tables.query")}>
          {(control) => <Input {...control} name="name" />}
        </FormField>
      </FilterBar>
      <p role="status" className="break-words text-sm text-muted-foreground">
        {t("showcase.tables.matches", { count: matches.length })}
      </p>
      <ul className="space-y-1 text-sm">
        {matches.map((row) => (
          <li key={row.id} className="break-words">
            {t(row.titleKey)}
          </li>
        ))}
      </ul>
    </div>
  );
}
