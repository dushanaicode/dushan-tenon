import { useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Badge,
  Checkbox,
  DataTable,
  type DataTableColumn,
  FormField,
  Label,
  RadioGroup,
  RadioGroupItem,
  Switch,
  ToggleGroup,
  ToggleGroupItem,
} from "@/kit";
import catalog from "../catalog/choices.json";
import { CheckboxFormExample } from "../examples/checkbox-form";
import { RadioGroupExample } from "../examples/radio-group";
import { SwitchExample } from "../examples/switch";
import { ToggleGroupExample } from "../examples/toggle-group";
import { ShowcasePage } from "../showcase-page";

export const choicesExamples = [
  {
    file: catalog[0].exampleFile,
    load: import.meta.env.DEV
      ? () => import("../examples/switch.tsx?raw")
      : undefined,
  },
  {
    file: catalog[1].exampleFile,
    load: import.meta.env.DEV
      ? () => import("../examples/checkbox-form.tsx?raw")
      : undefined,
  },
  {
    file: catalog[2].exampleFile,
    load: import.meta.env.DEV
      ? () => import("../examples/radio-group.tsx?raw")
      : undefined,
  },
  {
    file: catalog[3].exampleFile,
    load: import.meta.env.DEV
      ? () => import("../examples/toggle-group.tsx?raw")
      : undefined,
  },
];

const kinds = ["Switch", "Checkbox", "RadioGroup", "ToggleGroup"] as const;
type Kind = (typeof kinds)[number];
type State = "off" | "on" | "indeterminate" | "disabled";
const stateKeys = {
  off: "showcase.choices.unchecked",
  on: "showcase.choices.checked",
  indeterminate: "showcase.choices.indeterminate",
  disabled: "showcase.choices.disabled",
};
const rowId = (kind: Kind) => kind;

function ChoiceCell({ kind, state }: { kind: Kind; state: State }) {
  const { t } = useTranslation();
  const id = useId();
  const [checked, setChecked] = useState<boolean | "indeterminate">(
    state === "indeterminate" ? "indeterminate" : state !== "off",
  );
  const [value, setValue] = useState(state === "off" ? "" : "one");
  const label = `${kind} · ${t(stateKeys[state])}`;
  if (state === "indeterminate" && kind !== "Checkbox")
    return <span>{t("showcase.choices.notApplicable")}</span>;
  if (kind === "Switch")
    return (
      <FormField label={label} orientation="horizontal">
        {(control) => (
          <Switch
            {...control}
            checked={checked === true}
            onCheckedChange={setChecked}
            disabled={state === "disabled"}
          />
        )}
      </FormField>
    );
  if (kind === "Checkbox")
    return (
      <FormField label={label} orientation="horizontal">
        {(control) => (
          <Checkbox
            {...control}
            checked={checked}
            onCheckedChange={setChecked}
            disabled={state === "disabled"}
          />
        )}
      </FormField>
    );
  if (kind === "RadioGroup")
    return (
      <RadioGroup
        value={value}
        onValueChange={setValue}
        aria-label={label}
        disabled={state === "disabled"}
      >
        <div className="flex items-center gap-2">
          <RadioGroupItem value="one" id={id} />
          <Label htmlFor={id}>{label}</Label>
        </div>
      </RadioGroup>
    );
  return (
    <ToggleGroup
      type="single"
      value={value}
      onValueChange={setValue}
      aria-label={label}
      disabled={state === "disabled"}
    >
      <ToggleGroupItem value="one">{label}</ToggleGroupItem>
    </ToggleGroup>
  );
}

function ChoiceMatrix() {
  const { t } = useTranslation();
  const columns = useMemo<DataTableColumn<Kind>[]>(
    () => [
      {
        id: "kind",
        header: t("showcase.choices.component"),
        rowHeader: true,
        cell: (kind) => <code>{kind}</code>,
      },
      ...(["off", "on", "indeterminate", "disabled"] as const).map((state) => ({
        id: state,
        header: t(stateKeys[state]),
        cell: (kind: Kind) => <ChoiceCell kind={kind} state={state} />,
        className: "min-w-44 whitespace-normal",
      })),
    ],
    [t],
  );
  return (
    <DataTable
      caption={t("showcase.choices.matrixCaption")}
      columns={columns}
      rows={kinds}
      getRowId={rowId}
    />
  );
}
export function ChoicesPage() {
  const { t } = useTranslation();
  return (
    <ShowcasePage
      id="choices"
      entries={catalog}
      examples={choicesExamples}
      matrix={<ChoiceMatrix />}
      preview={
        <div className="grid min-w-0 gap-6 @3xl:grid-cols-2">
          <section className="min-w-0 space-y-3 rounded-lg border p-3">
            <h3 className="flex flex-wrap items-center gap-2 font-semibold">
              {t("showcase.choices.immediate")}{" "}
              <Badge>{t("showcase.common.existing")}</Badge>
            </h3>
            <SwitchExample />
          </section>
          <section className="min-w-0 space-y-3 rounded-lg border p-3">
            <h3 className="flex flex-wrap items-center gap-2 font-semibold">
              {t("showcase.choices.deferred")}{" "}
              <Badge>{t("showcase.common.existing")}</Badge>
            </h3>
            <CheckboxFormExample />
          </section>
          <section className="min-w-0 space-y-3">
            <h3 className="font-semibold">
              {t("showcase.choices.radioPreview")}
            </h3>
            <RadioGroupExample />
          </section>
          <section className="min-w-0 space-y-3">
            <h3 className="flex flex-wrap items-center gap-2 font-semibold">
              {t("showcase.choices.toggleHeading")}{" "}
              <Badge>{t("showcase.common.new")}</Badge>
            </h3>
            <ToggleGroupExample />
          </section>
        </div>
      }
    />
  );
}
