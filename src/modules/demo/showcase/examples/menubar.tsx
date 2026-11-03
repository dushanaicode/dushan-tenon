// showcase-example
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Menubar,
  MenubarCheckboxItem,
  MenubarContent,
  MenubarItem,
  MenubarMenu,
  MenubarTrigger,
} from "@/kit";

export function MenubarExample() {
  const { t } = useTranslation();
  const [count, setCount] = useState(0);
  const [guides, setGuides] = useState(true);
  return (
    <div className="space-y-3">
      <Menubar
        aria-label={t("showcase.menus.editor")}
        className="w-fit max-w-full flex-wrap"
      >
        <MenubarMenu>
          <MenubarTrigger>{t("showcase.menus.file")}</MenubarTrigger>
          <MenubarContent aria-label={t("showcase.menus.file")}>
            <MenubarItem onSelect={() => setCount(count + 1)}>
              {t("showcase.menus.create")}
            </MenubarItem>
          </MenubarContent>
        </MenubarMenu>
        <MenubarMenu>
          <MenubarTrigger>{t("showcase.menus.edit")}</MenubarTrigger>
          <MenubarContent aria-label={t("showcase.menus.edit")}>
            <MenubarItem
              disabled={count === 0}
              onSelect={() => setCount(count - 1)}
            >
              {t("showcase.menus.undo")}
            </MenubarItem>
          </MenubarContent>
        </MenubarMenu>
        <MenubarMenu>
          <MenubarTrigger>{t("showcase.menus.view")}</MenubarTrigger>
          <MenubarContent aria-label={t("showcase.menus.view")}>
            <MenubarCheckboxItem
              checked={guides}
              onCheckedChange={(next) => setGuides(next === true)}
              onSelect={(event) => event.preventDefault()}
            >
              {t("showcase.menus.guides")}
            </MenubarCheckboxItem>
          </MenubarContent>
        </MenubarMenu>
      </Menubar>
      <p role="status">
        {t("showcase.menus.fragments", { count })} ·{" "}
        {guides ? t("showcase.menus.guidesOn") : t("showcase.menus.guidesOff")}
      </p>
      <p className="text-sm text-muted-foreground">
        {t("showcase.menus.menubarHelp")}
      </p>
    </div>
  );
}
