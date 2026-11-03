// showcase-example
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Button,
  Card,
  CardContent,
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

function Region({
  kind,
  label,
}: {
  kind: "row" | "card" | "canvas";
  label: string;
}) {
  const { t } = useTranslation();
  const more = useRef<HTMLButtonElement>(null);
  const [count, setCount] = useState(0);
  const duplicate = () => setCount((value) => value + 1);
  const contents = (
    <div
      className={
        kind === "canvas"
          ? "flex min-h-32 flex-wrap items-start justify-between gap-3 p-3"
          : "flex flex-wrap items-center justify-between gap-3 p-3"
      }
    >
      <span className="min-w-0 break-words">{label}</span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            ref={more}
            variant="outline"
            aria-label={t("showcase.menus.moreRegion", { name: label })}
          >
            <Icon iconId="menu" />
            {t("showcase.menus.more")}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent aria-label={label}>
          <DropdownMenuItem onSelect={duplicate}>
            {t("showcase.menus.duplicate")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
  return (
    <section aria-label={label} className="min-w-0 space-y-2">
      <ContextMenu>
        <ContextMenuTrigger asChild>
          {kind === "card" ? (
            <Card>
              <CardContent className="p-0">{contents}</CardContent>
            </Card>
          ) : (
            <div className="rounded-md border bg-muted/30">{contents}</div>
          )}
        </ContextMenuTrigger>
        <ContextMenuContent
          aria-label={label}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            more.current?.focus();
          }}
        >
          <ContextMenuItem onSelect={duplicate}>
            {t("showcase.menus.duplicate")}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      <p role="status" className="text-sm">
        {t("showcase.menus.copies", { count })}
      </p>
    </section>
  );
}

export function ContextMenuExample() {
  const { t } = useTranslation();
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        {t("showcase.menus.contextHelp")}
      </p>
      <Region kind="row" label={t("showcase.menus.row")} />
      <Region kind="card" label={t("showcase.menus.card")} />
      <Region kind="canvas" label={t("showcase.menus.canvas")} />
    </div>
  );
}
