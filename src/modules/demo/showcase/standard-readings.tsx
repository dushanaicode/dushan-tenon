import { useMemo, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { useAppearanceSnapshot } from "@/core/appearance-bridge";
import { Badge, DataTable, type DataTableColumn } from "@/kit";
import { composite, contrastRatio, toRgba } from "./contrast";

export const colorTokens = [
  "background",
  "foreground",
  "card",
  "card-foreground",
  "popover",
  "popover-foreground",
  "secondary",
  "secondary-foreground",
  "muted",
  "muted-foreground",
  "accent",
  "accent-foreground",
  "border",
  "input",
  "chrome",
  "sidebar",
  "sidebar-foreground",
  "sidebar-accent",
  "sidebar-accent-foreground",
  "sidebar-border",
  "sidebar-primary",
  "scrim",
  "primary",
  "primary-foreground",
  "primary-hover",
  "primary-active",
  "brand",
  "ring",
  "selection",
  "selection-foreground",
  "destructive",
  "destructive-foreground",
  "destructive-soft",
  "destructive-hover",
  "success",
  "success-foreground",
  "success-soft",
  "warning",
  "warning-foreground",
  "warning-soft",
  "info",
  "info-foreground",
  "info-soft",
];
export const contrastPairs: readonly [string, string, number][] = [
  ["foreground", "background", 4.5],
  ["card-foreground", "card", 4.5],
  ["popover-foreground", "popover", 4.5],
  ["secondary-foreground", "secondary", 4.5],
  ["muted-foreground", "muted", 4.5],
  ["accent-foreground", "accent", 4.5],
  ["sidebar-foreground", "sidebar", 4.5],
  ["primary-foreground", "primary", 4.5],
  ["primary-foreground", "primary-hover", 4.5],
  ["primary-foreground", "primary-active", 4.5],
  ["selection-foreground", "selection", 4.5],
  ["brand", "background", 4.5],
  ["ring", "background", 3],
  ["input", "background", 3],
  ...["destructive", "success", "warning", "info"].flatMap(
    (name): [string, string, number][] => [
      [`${name}-foreground`, name, 4.5],
      [name, `${name}-soft`, 4.5],
    ],
  ),
];

export function useMediaReading(query: string) {
  const media = useMemo(() => matchMedia(query), [query]);
  return useSyncExternalStore(
    (listener) => {
      media.addEventListener("change", listener);
      return () => media.removeEventListener("change", listener);
    },
    () => media.matches,
  );
}

function useTokenValues(tokens: readonly string[]) {
  useAppearanceSnapshot();
  useMediaReading("(forced-colors: active)");
  const style = getComputedStyle(document.documentElement);
  return Object.fromEntries(
    tokens.map((token) => [token, style.getPropertyValue(`--${token}`).trim()]),
  );
}

export function ColorReadings() {
  const { t } = useTranslation();
  const values = useTokenValues(colorTokens);
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {colorTokens.map((name) => (
        <figure key={name} className="overflow-hidden rounded-lg border">
          <div
            className="h-12 border-b"
            aria-hidden="true"
            style={{ backgroundColor: `var(--${name})` }}
          />
          <figcaption className="break-all p-3 text-xs">
            <code>--{name}</code>
            <p>{values[name] || t("showcase.readings.unavailable")}</p>
          </figcaption>
        </figure>
      ))}
    </div>
  );
}

type ContrastRow = {
  id: string;
  foreground: string;
  background: string;
  minimum: number;
  ratio: number | null;
};
export function ContrastReadings() {
  const { t } = useTranslation();
  const values = useTokenValues(colorTokens);
  const rows: ContrastRow[] = contrastPairs.map(
    ([foreground, background, minimum]) => {
      const back = values[background];
      const front = values[foreground];
      return {
        id: `${foreground}/${background}`,
        foreground,
        background,
        minimum,
        ratio:
          back && front
            ? contrastRatio(
                composite(toRgba(front), toRgba(back)),
                toRgba(back),
              )
            : null,
      };
    },
  );
  const columns = useMemo<DataTableColumn<ContrastRow>[]>(
    () => [
      {
        id: "foreground",
        header: t("styleguide.colors.foreground"),
        rowHeader: true,
        cell: (row) => <code>--{row.foreground}</code>,
      },
      {
        id: "background",
        header: t("styleguide.colors.background"),
        cell: (row) => <code>--{row.background}</code>,
      },
      {
        id: "ratio",
        header: t("styleguide.colors.ratio"),
        cell: (row) =>
          row.ratio === null
            ? t("showcase.readings.unavailable")
            : `${row.ratio.toFixed(2)}:1`,
      },
      {
        id: "minimum",
        header: t("styleguide.colors.minimum"),
        cell: (row) => `${row.minimum}:1`,
      },
      {
        id: "result",
        header: t("styleguide.colors.result"),
        cell: (row) =>
          row.ratio === null ? (
            "—"
          ) : (
            <Badge tone={row.ratio >= row.minimum ? "success" : "danger"}>
              {t(
                row.ratio >= row.minimum
                  ? "styleguide.colors.pass"
                  : "styleguide.colors.fail",
              )}
            </Badge>
          ),
      },
    ],
    [t],
  );
  return (
    <DataTable
      caption={t("styleguide.colors.contrast")}
      columns={columns}
      rows={rows}
      getRowId={(row) => row.id}
    />
  );
}

const geometryTokens = [
  "r-sm",
  "r-md",
  "r-lg",
  "r-xl",
  "r-control",
  "r-pill",
  "control-h",
  "row-h",
  "page-padding",
  "stack-gap",
];
export function GeometryReadings() {
  const { t } = useTranslation();
  const values = useTokenValues(geometryTokens);
  return (
    <section className="space-y-3">
      <h3 className="font-semibold">{t("showcase.readings.geometry")}</h3>
      <dl className="grid grid-cols-2 gap-3">
        {geometryTokens.map((name) => (
          <div key={name}>
            <dt>
              <code>--{name}</code>
            </dt>
            <dd>{values[name] || t("showcase.readings.unavailable")}</dd>
          </div>
        ))}
      </dl>
      <div className="flex flex-wrap gap-4">
        {["rounded-sm", "rounded-md", "rounded-lg", "rounded-xl"].map(
          (radius) => (
            <div key={radius} className={`border bg-card p-panel ${radius}`}>
              {radius}
            </div>
          ),
        )}
      </div>
    </section>
  );
}

export function AccessibilityReadings() {
  const { t } = useTranslation();
  const reduced = useMediaReading("(prefers-reduced-motion: reduce)");
  const forced = useMediaReading("(forced-colors: active)");
  return (
    <div className="space-y-3">
      <dl className="space-y-2">
        <div>
          <dt>prefers-reduced-motion</dt>
          <dd role="status">{reduced ? "reduce" : "no-preference"}</dd>
        </div>
        <div>
          <dt>forced-colors</dt>
          <dd role="status">{forced ? "active" : "none"}</dd>
        </div>
      </dl>
      <p className="text-sm text-muted-foreground">
        {t("showcase.readings.systemHint")}
      </p>
    </div>
  );
}
