// showcase-example
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  FormField,
  NavGroupLabel,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Switch,
} from "@/kit";

export function NavigationTreeExample() {
  const { t } = useTranslation();
  const [active, setActive] = useState("drafts");
  const [collapsed, setCollapsed] = useState(false);
  const [open, setOpen] = useState(true);
  const leaves = (
    <div className="flex flex-col gap-2">
      {(["drafts", "archive"] as const).map((id) => (
        <Button
          key={id}
          variant={active === id ? "secondary" : "ghost"}
          aria-current={active === id ? "page" : undefined}
          onClick={() => setActive(id)}
        >
          {t(`showcase.navigation.${id}`)}
        </Button>
      ))}
    </div>
  );
  return (
    <section
      aria-label={t("showcase.navigation.tree")}
      className="space-y-3 rounded-lg border p-3"
    >
      <FormField
        label={t("showcase.navigation.collapse")}
        orientation="horizontal"
      >
        {(control) => (
          <Switch
            {...control}
            checked={collapsed}
            onCheckedChange={setCollapsed}
          />
        )}
      </FormField>
      <nav
        aria-label={t("showcase.navigation.sampleNav")}
        className="space-y-2"
      >
        {!collapsed && (
          <NavGroupLabel>{t("showcase.navigation.tree")}</NavGroupLabel>
        )}
        <Button
          variant="ghost"
          aria-current={active === "desk" ? "page" : undefined}
          onClick={() => setActive("desk")}
        >
          {t("showcase.navigation.desk")}
        </Button>
        {collapsed ? (
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline">
                {t("showcase.navigation.library")}
              </Button>
            </PopoverTrigger>
            <PopoverContent>{leaves}</PopoverContent>
          </Popover>
        ) : (
          <Collapsible open={open} onOpenChange={setOpen}>
            <CollapsibleTrigger asChild>
              <Button variant="outline">
                {t("showcase.navigation.library")}
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>{leaves}</CollapsibleContent>
          </Collapsible>
        )}
      </nav>
      <Button
        variant="outline"
        onClick={() => setActive(active === "drafts" ? "archive" : "drafts")}
      >
        {t("showcase.navigation.changeLeaf")}
      </Button>
      <p role="status">{t(`showcase.navigation.${active}`)}</p>
    </section>
  );
}
