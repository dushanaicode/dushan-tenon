import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Badge, DataTable, type DataTableColumn } from "@/kit";
import catalog from "../catalog/selects.json";
import { ComboboxExample } from "../examples/combobox";
import { MultiSelectExample } from "../examples/multi-select";
import { SelectExample } from "../examples/select";
import { ShowcasePage } from "../showcase-page";

export const selectsExamples = [
  {
    file: catalog[0].exampleFile,
    load: import.meta.env.DEV
      ? () => import("../examples/select.tsx?raw")
      : undefined,
  },
  {
    file: catalog[1].exampleFile,
    load: import.meta.env.DEV
      ? () => import("../examples/combobox.tsx?raw")
      : undefined,
  },
  {
    file: catalog[2].exampleFile,
    load: import.meta.env.DEV
      ? () => import("../examples/multi-select.tsx?raw")
      : undefined,
  },
];

const kinds = ["Select", "Combobox", "Multi-select"] as const;
type Kind = (typeof kinds)[number];
type State = "empty" | "selected" | "disabled" | "error" | "long" | "list";
const stateKeys = {
  empty: "showcase.selects.emptyState",
  selected: "showcase.selects.selectedState",
  disabled: "showcase.selects.disabledState",
  error: "showcase.selects.errorState",
  long: "showcase.selects.longState",
  list: "showcase.selects.listState",
};
const rowId = (kind: Kind) => kind;
function SelectCell({ kind, state }: { kind: Kind; state: State }) {
  const props = { disabled: state === "disabled", invalid: state === "error" };
  const selected =
    state === "long" ? "long" : state === "selected" ? "one" : "";
  if (kind === "Select")
    return (
      <SelectExample
        {...props}
        initialValue={selected}
        longList={state === "list"}
      />
    );
  if (kind === "Combobox")
    return (
      <ComboboxExample
        {...props}
        initialValue={selected === "" ? null : selected}
      />
    );
  return (
    <MultiSelectExample
      {...props}
      initialValue={selected === "" ? [] : [selected]}
    />
  );
}
function SelectMatrix() {
  const { t } = useTranslation();
  const columns = useMemo<DataTableColumn<Kind>[]>(
    () => [
      {
        id: "kind",
        header: t("showcase.selects.component"),
        rowHeader: true,
        cell: (kind) => <code>{kind}</code>,
      },
      ...(
        ["empty", "selected", "disabled", "error", "long", "list"] as const
      ).map((state) => ({
        id: state,
        header: t(stateKeys[state]),
        cell: (kind: Kind) => <SelectCell kind={kind} state={state} />,
        className: "min-w-64 max-w-72 whitespace-normal",
      })),
    ],
    [t],
  );
  return (
    <DataTable
      caption={t("showcase.selects.matrixCaption")}
      columns={columns}
      rows={kinds}
      getRowId={rowId}
    />
  );
}
export function SelectsPage() {
  const { t } = useTranslation();
  return (
    <ShowcasePage
      id="selects"
      entries={catalog}
      examples={selectsExamples}
      matrix={<SelectMatrix />}
      preview={
        <div className="grid min-w-0 gap-6 @3xl:grid-cols-2">
          <section className="min-w-0 space-y-3">
            <h3 className="flex flex-wrap items-center gap-2 font-semibold">
              {t("showcase.selects.selectLabel")}{" "}
              <Badge>{t("showcase.common.existing")}</Badge>
            </h3>
            <SelectExample />
          </section>
          <section className="min-w-0 space-y-3">
            <h3 className="flex flex-wrap items-center gap-2 font-semibold">
              {t("showcase.selects.comboLabel")}{" "}
              <Badge>{t("showcase.common.existing")}</Badge>
            </h3>
            <ComboboxExample />
          </section>
          <section className="min-w-0 space-y-3 @3xl:col-span-2">
            <h3 className="flex flex-wrap items-center gap-2 font-semibold">
              {t("showcase.selects.multiLabel")}{" "}
              <Badge>{t("showcase.common.new")}</Badge>
            </h3>
            <MultiSelectExample />
          </section>
        </div>
      }
    />
  );
}
