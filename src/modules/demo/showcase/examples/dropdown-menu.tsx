// showcase-example
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Avatar,
  AvatarFallback,
  Button,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  Icon,
} from "@/kit";

export function DropdownMenuExample() {
  const { t } = useTranslation();
  const [grid, setGrid] = useState(true);
  const [density, setDensity] = useState("comfortable");
  const [action, setAction] = useState("showcase.menus.idle");
  return (
    <section
      aria-label={t("showcase.menus.dropdown")}
      className="space-y-3"
      onKeyDown={(event) => {
        if (
          event.altKey &&
          event.code === "KeyS" &&
          !event.nativeEvent.isComposing
        ) {
          event.preventDefault();
          setAction("showcase.menus.saved");
        }
      }}
    >
      <div className="flex flex-wrap items-center gap-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline">{t("showcase.menus.openActions")}</Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent aria-label={t("showcase.menus.openActions")}>
            <DropdownMenuLabel>
              {t("showcase.menus.fictional")}
            </DropdownMenuLabel>
            <DropdownMenuItem
              onSelect={() => setAction("showcase.menus.saved")}
            >
              {t("showcase.menus.save")}
              <DropdownMenuShortcut>Alt S</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem disabled>
              {t("showcase.menus.unavailable")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem
              checked={grid}
              onCheckedChange={(value) => setGrid(value === true)}
              onSelect={(event) => event.preventDefault()}
            >
              {t("showcase.menus.grid")}
            </DropdownMenuCheckboxItem>
            <DropdownMenuRadioGroup value={density} onValueChange={setDensity}>
              <DropdownMenuRadioItem
                value="comfortable"
                onSelect={(event) => event.preventDefault()}
              >
                {t("showcase.menus.comfortable")}
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem
                value="compact"
                onSelect={(event) => event.preventDefault()}
              >
                {t("showcase.menus.compact")}
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                {t("showcase.menus.export")}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent aria-label={t("showcase.menus.export")}>
                <DropdownMenuItem
                  onSelect={() => setAction("showcase.menus.exported")}
                >
                  {t("showcase.menus.text")}
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </DropdownMenuContent>
        </DropdownMenu>
        <div
          role="toolbar"
          aria-label={t("showcase.menus.toolbar")}
          className="flex items-center gap-1"
        >
          <Button onClick={() => setAction("showcase.menus.saved")}>
            {t("showcase.menus.save")}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label={t("showcase.menus.moreTools")}
              >
                <Icon iconId="menu" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent aria-label={t("showcase.menus.moreTools")}>
              <DropdownMenuItem
                onSelect={() => setAction("showcase.menus.duplicated")}
              >
                {t("showcase.menus.duplicate")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label={t("showcase.menus.userMenu")}
            >
              <Avatar>
                <AvatarFallback>
                  <Icon iconId="profile" />
                </AvatarFallback>
              </Avatar>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent aria-label={t("showcase.menus.userMenu")}>
            <DropdownMenuLabel>{t("showcase.menus.visitor")}</DropdownMenuLabel>
            <DropdownMenuItem
              onSelect={() => setAction("showcase.menus.helpOpened")}
            >
              {t("showcase.menus.help")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <p role="status">{t(action)}</p>
      <p>
        {grid ? t("showcase.menus.gridOn") : t("showcase.menus.gridOff")} ·{" "}
        {density === "comfortable"
          ? t("showcase.menus.comfortable")
          : t("showcase.menus.compact")}
      </p>
      {grid && (
        <div
          aria-hidden="true"
          className={
            density === "comfortable"
              ? "grid grid-cols-3 gap-3"
              : "grid grid-cols-3 gap-1"
          }
        >
          {[1, 2, 3].map((id) => (
            <div key={id} className="h-8 rounded-md border bg-muted" />
          ))}
        </div>
      )}
      <p className="text-sm text-muted-foreground">
        {t("showcase.menus.shortcutHelp")}
      </p>
    </section>
  );
}
