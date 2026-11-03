// showcase-example
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Badge,
  Button,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Icon,
} from "@/kit";

export function RowActions({ name, count }: { name: string; count: number }) {
  const { t } = useTranslation();
  const [marked, setMarked] = useState(false);
  const actions = [
    {
      id: "mark",
      label: t("showcase.tables.mark"),
      disabled: marked,
      run: () => setMarked(true),
    },
    {
      id: "clear",
      label: t("showcase.tables.unmark"),
      disabled: !marked,
      run: () => setMarked(false),
    },
  ];
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 py-2">
          <div className="min-w-0 flex-1 space-y-1">
            <p className="whitespace-normal break-words font-medium">{name}</p>
            <p className="text-sm text-muted-foreground">
              {t("showcase.tables.recordCount", { count })}
            </p>
            <Badge tone={marked ? "success" : "neutral"}>
              {t(
                marked ? "showcase.tables.marked" : "showcase.tables.unmarked",
              )}
            </Badge>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                aria-label={t("showcase.tables.moreFor", { name })}
              >
                <Icon iconId="menu" />
                {t("showcase.tables.more")}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              aria-label={t("showcase.tables.actionsFor", { name })}
            >
              {actions.map((action) => (
                <DropdownMenuItem
                  key={action.id}
                  disabled={action.disabled}
                  onSelect={action.run}
                >
                  {action.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent
        aria-label={t("showcase.tables.actionsFor", { name })}
      >
        {actions.map((action) => (
          <ContextMenuItem
            key={action.id}
            disabled={action.disabled}
            onSelect={action.run}
          >
            {action.label}
          </ContextMenuItem>
        ))}
      </ContextMenuContent>
    </ContextMenu>
  );
}

export function RowActionsExample() {
  const { t } = useTranslation();
  return (
    <div className="rounded-lg border p-3">
      <RowActions name={t("showcase.tables.sampleA")} count={3} />
    </div>
  );
}
