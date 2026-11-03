import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Badge,
  Button,
  DataTable,
  type DataTableColumn,
  Icon,
  Spinner,
  ToggleGroup,
  ToggleGroupItem,
} from "@/kit";
import catalog from "../catalog/buttons.json";
import { ButtonExample } from "../examples/button";
import { SplitButtonExample } from "../examples/split-button";
import { ShowcasePage } from "../showcase-page";

export const buttonExamples = [
  {
    file: catalog[0].exampleFile,
    load: import.meta.env.DEV
      ? () => import("../examples/button.tsx?raw")
      : undefined,
  },
  {
    file: catalog[1].exampleFile,
    load: import.meta.env.DEV
      ? () => import("../examples/split-button.tsx?raw")
      : undefined,
  },
];

const variants = [
  "default",
  "secondary",
  "outline",
  "ghost",
  "destructive",
  "link",
] as const;
const variantKeys = {
  default: "showcase.buttons.default",
  secondary: "showcase.buttons.secondary",
  outline: "showcase.buttons.outline",
  ghost: "showcase.buttons.ghost",
  destructive: "showcase.buttons.destructive",
  link: "showcase.buttons.link",
};

function LoadingAction() {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!busy) return;
    const timeout = setTimeout(() => setBusy(false), 1200);
    return () => clearTimeout(timeout);
  }, [busy]);
  return (
    <Button disabled={busy} aria-busy={busy} onClick={() => setBusy(true)}>
      {busy && <Spinner />}
      {t(busy ? "showcase.buttons.loading" : "showcase.buttons.submit")}
    </Button>
  );
}

function ButtonMatrix() {
  const { t } = useTranslation();
  const [count, setCount] = useState(0);
  const columns = useMemo<DataTableColumn<(typeof variants)[number]>[]>(
    () => [
      {
        id: "variant",
        header: t("showcase.buttons.variant"),
        rowHeader: true,
        cell: (variant) => <code>{variant}</code>,
      },
      {
        id: "default",
        header: t("showcase.buttons.defaultState"),
        cell: (variant) => (
          <Button
            variant={variant}
            onClick={() => setCount((value) => value + 1)}
          >
            {t("showcase.buttons.execute")}
          </Button>
        ),
      },
      {
        id: "disabled",
        header: t("showcase.buttons.disabled"),
        cell: (variant) => (
          <Button variant={variant} disabled>
            {t("showcase.buttons.disabled")}
          </Button>
        ),
      },
      {
        id: "loading",
        header: t("showcase.buttons.loading"),
        cell: (variant) => (
          <Button variant={variant} disabled aria-busy="true">
            <Spinner />
            {t("showcase.buttons.loading")}
          </Button>
        ),
      },
      {
        id: "icon",
        header: t("showcase.buttons.iconOnly"),
        cell: (variant) => (
          <Button
            variant={variant}
            size="icon"
            aria-label={t("showcase.buttons.confirm")}
            onClick={() => setCount((value) => value + 1)}
          >
            <Icon iconId="selected" />
          </Button>
        ),
      },
    ],
    [t],
  );
  return (
    <>
      <div className="min-w-[40rem]">
        <DataTable
          caption={t("showcase.buttons.matrixCaption")}
          columns={columns}
          rows={variants}
          getRowId={(variant) => variant}
        />
      </div>
      <p role="status" className="mt-3 text-sm text-muted-foreground">
        {t("showcase.buttons.executed", { count })}
      </p>
    </>
  );
}

export function ButtonsPage() {
  const { t } = useTranslation();
  const [count, setCount] = useState(0);
  const [mode, setMode] = useState("list");
  return (
    <ShowcasePage
      id="buttons"
      entries={catalog}
      examples={buttonExamples}
      matrix={<ButtonMatrix />}
      preview={
        <div className="grid gap-6 @3xl:grid-cols-2">
          <div className="space-y-4">
            <h3 className="font-semibold">{t("showcase.buttons.variants")}</h3>
            <div className="flex flex-wrap gap-3">
              {variants.map((variant) => (
                <Button
                  key={variant}
                  variant={variant}
                  onClick={() => setCount(count + 1)}
                >
                  {t(variantKeys[variant])}
                </Button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button
                size="icon"
                aria-label={t("showcase.buttons.confirm")}
                onClick={() => setCount(count + 1)}
              >
                <Icon iconId="selected" />
              </Button>
              <Button disabled>{t("showcase.buttons.disabled")}</Button>
              <LoadingAction />
            </div>
            <p role="status" className="text-sm text-muted-foreground">
              {t("showcase.buttons.executed", { count })}
            </p>
            <ButtonExample />
          </div>
          <div className="space-y-4">
            <h3 className="flex flex-wrap items-center gap-2 font-semibold">
              {t("showcase.buttons.combinations")}
              <Badge>{t("showcase.buttons.newPattern")}</Badge>
            </h3>
            <SplitButtonExample />
            <div className="space-y-2">
              <p className="text-sm font-medium">
                {t("showcase.buttons.group")}
              </p>
              <ToggleGroup
                type="single"
                value={mode}
                onValueChange={setMode}
                aria-label={t("showcase.buttons.group")}
              >
                <ToggleGroupItem value="list">
                  {t("showcase.buttons.list")}
                </ToggleGroupItem>
                <ToggleGroupItem value="cards">
                  {t("showcase.buttons.cards")}
                </ToggleGroupItem>
              </ToggleGroup>
            </div>
          </div>
        </div>
      }
    />
  );
}
