import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { DataTable, type DataTableColumn } from "@/kit";
import catalog from "../catalog/overlays.json";
import { ConfirmDialogExample } from "../examples/confirm-dialog";
import { DialogExample } from "../examples/dialog";
import { PopoverExample } from "../examples/popover";
import { SheetExample } from "../examples/sheet";
import { TooltipExample } from "../examples/tooltip";
import { ShowcasePage } from "../showcase-page";

export const overlaysExamples = [
  {
    file: catalog[0].exampleFile,
    load: import.meta.env.DEV
      ? () => import("../examples/dialog.tsx?raw")
      : undefined,
  },
  {
    file: catalog[1].exampleFile,
    load: import.meta.env.DEV
      ? () => import("../examples/confirm-dialog.tsx?raw")
      : undefined,
  },
  {
    file: catalog[2].exampleFile,
    load: import.meta.env.DEV
      ? () => import("../examples/sheet.tsx?raw")
      : undefined,
  },
  {
    file: catalog[3].exampleFile,
    load: import.meta.env.DEV
      ? () => import("../examples/popover.tsx?raw")
      : undefined,
  },
  {
    file: catalog[4].exampleFile,
    load: import.meta.env.DEV
      ? () => import("../examples/tooltip.tsx?raw")
      : undefined,
  },
];
const overlayRows = [
  {
    id: "Dialog",
    block: "showcase.overlays.modal",
    trap: "showcase.overlays.yes",
    escape: "showcase.overlays.closes",
    outside: "showcase.overlays.closes",
    focus: "showcase.overlays.trigger",
  },
  {
    id: "ConfirmDialog",
    block: "showcase.overlays.modal",
    trap: "showcase.overlays.cancelFirst",
    escape: "showcase.overlays.unlessPending",
    outside: "showcase.overlays.stays",
    focus: "showcase.overlays.previous",
  },
  {
    id: "Sheet",
    block: "showcase.overlays.modalContext",
    trap: "showcase.overlays.yes",
    escape: "showcase.overlays.closes",
    outside: "showcase.overlays.closes",
    focus: "showcase.overlays.trigger",
  },
  {
    id: "Popover",
    block: "showcase.overlays.nonmodal",
    trap: "showcase.overlays.no",
    escape: "showcase.overlays.closes",
    outside: "showcase.overlays.closes",
    focus: "showcase.overlays.popoverFocus",
  },
  {
    id: "Tooltip",
    block: "showcase.overlays.hintOnly",
    trap: "showcase.overlays.no",
    escape: "showcase.overlays.closes",
    outside: "showcase.overlays.leaves",
    focus: "showcase.overlays.focusUnchanged",
  },
];
const columnKeys = {
  block: "showcase.overlays.block",
  trap: "showcase.overlays.trap",
  escape: "showcase.overlays.escape",
  outside: "showcase.overlays.outside",
  focus: "showcase.overlays.focus",
} as const;

export function OverlaysPage() {
  const { t } = useTranslation();
  const columns = useMemo<DataTableColumn<(typeof overlayRows)[number]>[]>(
    () => [
      {
        id: "type",
        header: t("showcase.overlays.type"),
        rowHeader: true,
        cell: (row) => row.id,
      },
      ...(Object.keys(columnKeys) as (keyof typeof columnKeys)[]).map(
        (key) => ({
          id: key,
          header: t(columnKeys[key]),
          cell: (row: (typeof overlayRows)[number]) => t(row[key]),
          className: "whitespace-normal min-w-32",
        }),
      ),
    ],
    [t],
  );
  return (
    <ShowcasePage
      id="overlays"
      entries={catalog}
      examples={overlaysExamples}
      matrix={
        <DataTable
          caption={t("showcase.overlays.matrixCaption")}
          rows={overlayRows}
          columns={columns}
          getRowId={(row) => row.id}
        />
      }
      preview={
        <>
          <p className="text-sm text-muted-foreground">
            {t("showcase.overlays.choiceGuide")}
          </p>
          <div className="grid min-w-0 gap-6 @3xl:grid-cols-2">
            <section className="min-w-0 space-y-3">
              <h3 className="font-semibold">
                {t("showcase.overlays.dialogHeading")}
              </h3>
              <DialogExample />
              <ConfirmDialogExample />
            </section>
            <section className="min-w-0 space-y-3">
              <h3 className="font-semibold">
                {t("showcase.overlays.contextHeading")}
              </h3>
              <SheetExample />
              <PopoverExample />
              <TooltipExample />
            </section>
          </div>
        </>
      }
    />
  );
}
