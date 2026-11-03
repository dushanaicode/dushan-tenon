import { Fragment } from "react";
import { useTranslation } from "react-i18next";
import { NavLink, useNavigate } from "react-router";
import type { SettingSection } from "@/core/contracts/settings";
import { useSettingsDrafts } from "@/core/settings/drafts";
import {
  NavGroupLabel,
  ScrollArea,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/kit";

export function SectionNavigation({
  sections,
  selected,
}: {
  sections: readonly SettingSection[];
  selected: SettingSection;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const drafts = useSettingsDrafts();
  const dirty = new Set([
    ...[...drafts.drafts.values()].map((draft) => draft.sectionPath),
    ...[...drafts.items.values()].map((item) => item.sectionPath),
  ]);
  const firstParam = sections.findIndex((section) => section.kind === "params");
  const marker = (path: string) =>
    dirty.has(path) ? (
      <span
        role="img"
        aria-label={t("settings.actions.dirty")}
        className="ml-auto size-1.5 shrink-0 rounded-full bg-primary"
      />
    ) : null;
  return (
    <>
      <ScrollArea
        role="navigation"
        aria-label={t("nav.settings")}
        data-shell="auxiliary"
        className="sticky top-4 hidden max-h-[calc(100dvh-8rem)] w-52 shrink-0 self-start space-y-1 @medium/content:block"
      >
        {sections.map((section, index) => (
          <Fragment key={section.id}>
            {index === firstParam && (
              <NavGroupLabel>
                {t("settings.sections.moduleSettings")}
              </NavGroupLabel>
            )}
            <NavLink
              to={section.path}
              data-shell="nav-item"
              className="flex h-control w-full items-center rounded-lg px-3 text-body text-muted-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-[current=page]:bg-accent aria-[current=page]:font-semibold aria-[current=page]:text-foreground"
            >
              {t(section.labelKey)}
              {marker(section.path)}
            </NavLink>
          </Fragment>
        ))}
      </ScrollArea>
      <div className="@medium/content:hidden">
        <Select
          value={selected.path}
          onValueChange={(path) => void navigate(path)}
        >
          <SelectTrigger aria-label={t("nav.settings")} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {sections.map((section) => (
              <SelectItem key={section.id} value={section.path}>
                {t(section.labelKey)}
                {marker(section.path)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </>
  );
}
