import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  DataTable,
  type DataTableColumn,
  FormField,
  Input,
  NumberInput,
  RangeSlider,
  Slider,
  Textarea,
} from "@/kit";
import catalog from "../catalog/inputs.json";
import { FormFieldExample } from "../examples/form-field";
import { NumberInputExample } from "../examples/number-input";
import { RangeSliderExample } from "../examples/range-slider";
import { SliderExample } from "../examples/slider";
import { ShowcasePage } from "../showcase-page";

export const inputsExamples = [
  {
    file: catalog[0].exampleFile,
    load: import.meta.env.DEV
      ? () => import("../examples/form-field.tsx?raw")
      : undefined,
  },
  {
    file: catalog[1].exampleFile,
    load: import.meta.env.DEV
      ? () => import("../examples/slider.tsx?raw")
      : undefined,
  },
  {
    file: catalog[2].exampleFile,
    load: import.meta.env.DEV
      ? () => import("../examples/range-slider.tsx?raw")
      : undefined,
  },
  {
    file: catalog[3].exampleFile,
    load: import.meta.env.DEV
      ? () => import("../examples/number-input.tsx?raw")
      : undefined,
  },
];

const kinds = [
  "Input",
  "Textarea",
  "NumberInput",
  "Slider",
  "RangeSlider",
] as const;
type Kind = (typeof kinds)[number];
type State = "empty" | "filled" | "disabled" | "error" | "readonly";
const stateKeys = {
  empty: "showcase.inputs.defaultState",
  filled: "showcase.inputs.filledState",
  disabled: "showcase.inputs.disabledState",
  error: "showcase.inputs.errorState",
  readonly: "showcase.inputs.readonlyState",
};
const rowId = (kind: Kind) => kind;

function InputCell({ kind, state }: { kind: Kind; state: State }) {
  const { t } = useTranslation();
  const [text, setText] = useState(
    state === "empty" || state === "error"
      ? ""
      : t("showcase.inputs.sampleText"),
  );
  const [number, setNumber] = useState<number | null>(
    state === "empty" ? null : state === "error" ? -1 : 1.5,
  );
  const [single, setSingle] = useState(state === "empty" ? 0 : 40);
  const [range, setRange] = useState<[number, number]>(
    state === "empty" ? [0, 100] : [20, 80],
  );
  const label = `${kind} · ${t(stateKeys[state])}`;
  const unsupported =
    (state === "readonly" &&
      (kind === "NumberInput" ||
        kind === "Slider" ||
        kind === "RangeSlider")) ||
    (state === "error" && (kind === "Slider" || kind === "RangeSlider"));
  if (unsupported)
    return (
      <p className="text-sm text-muted-foreground">
        {t("showcase.inputs.notSupported")}
      </p>
    );
  if (kind === "RangeSlider")
    return (
      <div>
        <p>{label}</p>
        <RangeSlider
          value={range}
          onValueChange={setRange}
          disabled={state === "disabled"}
          thumbLabels={[
            `${label} · ${t("showcase.inputs.lower")}`,
            `${label} · ${t("showcase.inputs.upper")}`,
          ]}
        />
        <p>
          {range[0]} – {range[1]}
        </p>
      </div>
    );
  if (kind === "Slider")
    return (
      <FormField label={`${label} · ${single}`}>
        {(control) => (
          <Slider
            {...control}
            value={single}
            onChange={(event) => setSingle(event.target.valueAsNumber)}
            disabled={state === "disabled"}
          />
        )}
      </FormField>
    );
  const error =
    state === "error"
      ? kind === "NumberInput"
        ? number !== null && number < 0
          ? t("showcase.inputs.boundsError")
          : undefined
        : text.trim() === ""
          ? t("showcase.inputs.requiredError")
          : undefined
      : undefined;
  return (
    <FormField label={label} error={error}>
      {(control) =>
        kind === "NumberInput" ? (
          <NumberInput
            {...control}
            value={number}
            onValueChange={setNumber}
            min={0}
            max={3}
            step={0.1}
            disabled={state === "disabled"}
          />
        ) : kind === "Input" ? (
          <Input
            {...control}
            value={text}
            onChange={(event) => setText(event.target.value)}
            disabled={state === "disabled"}
            readOnly={state === "readonly"}
          />
        ) : (
          <Textarea
            {...control}
            value={text}
            onChange={(event) => setText(event.target.value)}
            disabled={state === "disabled"}
            readOnly={state === "readonly"}
          />
        )
      }
    </FormField>
  );
}
function InputMatrix() {
  const { t } = useTranslation();
  const columns = useMemo<DataTableColumn<Kind>[]>(
    () => [
      {
        id: "kind",
        header: t("showcase.inputs.component"),
        rowHeader: true,
        cell: (kind) => <code>{kind}</code>,
      },
      ...(["empty", "filled", "disabled", "error", "readonly"] as const).map(
        (state) => ({
          id: state,
          header: t(stateKeys[state]),
          cell: (kind: Kind) => <InputCell kind={kind} state={state} />,
          className: "min-w-52 whitespace-normal",
        }),
      ),
    ],
    [t],
  );
  return (
    <DataTable
      caption={t("showcase.inputs.matrixCaption")}
      columns={columns}
      rows={kinds}
      getRowId={rowId}
    />
  );
}
export function InputsPage() {
  const { t } = useTranslation();
  return (
    <ShowcasePage
      id="inputs"
      entries={catalog}
      examples={inputsExamples}
      matrix={<InputMatrix />}
      preview={
        <div className="grid min-w-0 gap-6 @3xl:grid-cols-2">
          <section className="min-w-0 space-y-3">
            <h3 className="font-semibold">{t("showcase.inputs.formTitle")}</h3>
            <FormFieldExample />
          </section>
          <section className="min-w-0 space-y-3">
            <h3 className="font-semibold">
              {t("showcase.inputs.numberHeading")}
            </h3>
            <NumberInputExample />
          </section>
          <section className="min-w-0 space-y-3">
            <h3 className="font-semibold">
              {t("showcase.inputs.sliderHeading")}
            </h3>
            <SliderExample />
          </section>
          <section className="min-w-0 space-y-3">
            <h3 className="font-semibold">{t("showcase.inputs.range")}</h3>
            <RangeSliderExample />
          </section>
        </div>
      }
    />
  );
}
