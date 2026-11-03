import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { DataTable, type DataTableColumn } from "@/kit";
import catalog from "../catalog/menus.json";
import { CommandListExample } from "../examples/command-list";
import { ContextMenuExample } from "../examples/context-menu";
import { DropdownMenuExample } from "../examples/dropdown-menu";
import { HoverCardExample } from "../examples/hover-card";
import { MenubarExample } from "../examples/menubar";
import { ShowcasePage } from "../showcase-page";

export const menusExamples = [
  {
    file: catalog[0].exampleFile,
    load: import.meta.env.DEV
      ? () => import("../examples/dropdown-menu.tsx?raw")
      : undefined,
  },
  {
    file: catalog[1].exampleFile,
    load: import.meta.env.DEV
      ? () => import("../examples/context-menu.tsx?raw")
      : undefined,
  },
  {
    file: catalog[2].exampleFile,
    load: import.meta.env.DEV
      ? () => import("../examples/menubar.tsx?raw")
      : undefined,
  },
  {
    file: catalog[3].exampleFile,
    load: import.meta.env.DEV
      ? () => import("../examples/hover-card.tsx?raw")
      : undefined,
  },
  {
    file: catalog[4].exampleFile,
    load: import.meta.env.DEV
      ? () => import("../examples/command-list.tsx?raw")
      : undefined,
  },
];

const decisions = [
  {
    id: "navigation",
    scene: "showcase.menus.decision.navigation.scene",
    type: "showcase.menus.decision.navigation.type",
    why: "showcase.menus.decision.navigation.why",
  },
  {
    id: "collapsed",
    scene: "showcase.menus.decision.collapsed.scene",
    type: "showcase.menus.decision.collapsed.type",
    why: "showcase.menus.decision.collapsed.why",
  },
  {
    id: "button",
    scene: "showcase.menus.decision.button.scene",
    type: "showcase.menus.decision.button.type",
    why: "showcase.menus.decision.button.why",
  },
  {
    id: "record",
    scene: "showcase.menus.decision.record.scene",
    type: "showcase.menus.decision.record.type",
    why: "showcase.menus.decision.record.why",
  },
  {
    id: "editor",
    scene: "showcase.menus.decision.editor.scene",
    type: "showcase.menus.decision.editor.type",
    why: "showcase.menus.decision.editor.why",
  },
  {
    id: "summary",
    scene: "showcase.menus.decision.summary.scene",
    type: "showcase.menus.decision.summary.type",
    why: "showcase.menus.decision.summary.why",
  },
  {
    id: "search",
    scene: "showcase.menus.decision.search.scene",
    type: "showcase.menus.decision.search.type",
    why: "showcase.menus.decision.search.why",
  },
  {
    id: "overflow",
    scene: "showcase.menus.decision.overflow.scene",
    type: "showcase.menus.decision.overflow.type",
    why: "showcase.menus.decision.overflow.why",
  },
  {
    id: "user",
    scene: "showcase.menus.decision.user.scene",
    type: "showcase.menus.decision.user.type",
    why: "showcase.menus.decision.user.why",
  },
];
const menuTypes = [
  {
    id: "dropdown",
    name: "DropdownMenu",
    trigger: "showcase.menus.matrix.dropdown.trigger",
    keyboard: "showcase.menus.matrix.dropdown.keyboard",
    touch: "showcase.menus.matrix.dropdown.touch",
    scene: "showcase.menus.matrix.dropdown.scene",
  },
  {
    id: "context",
    name: "ContextMenu",
    trigger: "showcase.menus.matrix.context.trigger",
    keyboard: "showcase.menus.matrix.context.keyboard",
    touch: "showcase.menus.matrix.context.touch",
    scene: "showcase.menus.matrix.context.scene",
  },
  {
    id: "menubar",
    name: "Menubar",
    trigger: "showcase.menus.matrix.menubar.trigger",
    keyboard: "showcase.menus.matrix.menubar.keyboard",
    touch: "showcase.menus.matrix.menubar.touch",
    scene: "showcase.menus.matrix.menubar.scene",
  },
  {
    id: "hover",
    name: "HoverCard",
    trigger: "showcase.menus.matrix.hover.trigger",
    keyboard: "showcase.menus.matrix.hover.keyboard",
    touch: "showcase.menus.matrix.hover.touch",
    scene: "showcase.menus.matrix.hover.scene",
  },
  {
    id: "command",
    name: "Command",
    trigger: "showcase.menus.matrix.command.trigger",
    keyboard: "showcase.menus.matrix.command.keyboard",
    touch: "showcase.menus.matrix.command.touch",
    scene: "showcase.menus.matrix.command.scene",
  },
];
const rowId = (row: { id: string }) => row.id;

function DecisionTable() {
  const { t } = useTranslation();
  const columns = useMemo<DataTableColumn<(typeof decisions)[number]>[]>(
    () => [
      {
        id: "scene",
        header: t("showcase.menus.sceneColumn"),
        rowHeader: true,
        cell: (row) => t(row.scene),
        className: "w-1/4 whitespace-normal",
      },
      {
        id: "type",
        header: t("showcase.menus.typeColumn"),
        cell: (row) => t(row.type),
        className: "w-1/4 whitespace-normal",
      },
      {
        id: "why",
        header: t("showcase.menus.whyColumn"),
        cell: (row) => t(row.why),
        className: "whitespace-normal",
      },
    ],
    [t],
  );
  return (
    <DataTable
      caption={t("showcase.menus.decisionCaption")}
      columns={columns}
      rows={decisions}
      getRowId={rowId}
    />
  );
}
function MenuMatrix() {
  const { t } = useTranslation();
  const columns = useMemo<DataTableColumn<(typeof menuTypes)[number]>[]>(
    () => [
      {
        id: "name",
        header: t("showcase.menus.typeColumn"),
        rowHeader: true,
        cell: (row) => <code>{row.name}</code>,
      },
      {
        id: "trigger",
        header: t("showcase.menus.triggerColumn"),
        cell: (row) => t(row.trigger),
        className: "min-w-40 whitespace-normal",
      },
      {
        id: "keyboard",
        header: t("showcase.menus.keyboardColumn"),
        cell: (row) => t(row.keyboard),
        className: "min-w-64 whitespace-normal",
      },
      {
        id: "touch",
        header: t("showcase.menus.touchColumn"),
        cell: (row) => t(row.touch),
        className: "min-w-40 whitespace-normal",
      },
      {
        id: "scene",
        header: t("showcase.menus.sceneColumn"),
        cell: (row) => t(row.scene),
        className: "min-w-40 whitespace-normal",
      },
    ],
    [t],
  );
  return (
    <div className="space-y-3">
      <DataTable
        caption={t("showcase.menus.matrixCaption")}
        columns={columns}
        rows={menuTypes}
        getRowId={rowId}
      />
      <p className="text-sm text-muted-foreground">
        {t("showcase.menus.keyboardHelp")}
      </p>
    </div>
  );
}

export function MenusPage() {
  const { t } = useTranslation();
  return (
    <ShowcasePage
      id="menus"
      entries={catalog}
      examples={menusExamples}
      matrix={<MenuMatrix />}
      preview={
        <div className="space-y-6">
          <div className="grid min-w-0 gap-6 @3xl:grid-cols-2">
            <section className="min-w-0 space-y-3">
              <h3 className="font-semibold">{t("showcase.menus.dropdown")}</h3>
              <DropdownMenuExample />
            </section>
            <section className="min-w-0 space-y-3">
              <h3 className="font-semibold">
                {t("showcase.menus.contextHeading")}
              </h3>
              <ContextMenuExample />
            </section>
            <section className="min-w-0 space-y-3">
              <h3 className="font-semibold">{t("showcase.menus.editor")}</h3>
              <MenubarExample />
            </section>
            <section className="min-w-0 space-y-3">
              <h3 className="font-semibold">
                {t("showcase.menus.hoverHeading")}
              </h3>
              <HoverCardExample />
            </section>
            <section className="min-w-0 space-y-3 @3xl:col-span-2">
              <h3 className="font-semibold">{t("showcase.menus.commands")}</h3>
              <CommandListExample />
            </section>
          </div>
          <DecisionTable />
        </div>
      }
    />
  );
}
