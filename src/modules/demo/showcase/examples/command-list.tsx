// showcase-example
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
  Icon,
} from "@/kit";

export function CommandListExample() {
  const { t } = useTranslation();
  const [action, setAction] = useState("showcase.menus.idle");
  return (
    <div className="space-y-3">
      <Command
        label={t("showcase.menus.searchCommands")}
        className="h-auto border"
      >
        <CommandInput
          aria-label={t("showcase.menus.searchCommands")}
          placeholder={t("showcase.menus.searchCommands")}
        />
        <CommandList label={t("showcase.menus.commands")}>
          <CommandEmpty>{t("showcase.menus.noCommands")}</CommandEmpty>
          <CommandItem
            value="save"
            keywords={[t("showcase.menus.save")]}
            onSelect={() => setAction("showcase.menus.saved")}
          >
            <Icon iconId="files" />
            {t("showcase.menus.save")}
          </CommandItem>
          <CommandItem
            value="duplicate"
            keywords={[t("showcase.menus.duplicate")]}
            onSelect={() => setAction("showcase.menus.duplicated")}
          >
            <Icon iconId="files" />
            {t("showcase.menus.duplicate")}
          </CommandItem>
          <CommandItem value="publish" disabled>
            {t("showcase.menus.unavailable")}
          </CommandItem>
        </CommandList>
      </Command>
      <p role="status">{t(action)}</p>
      <p className="text-sm text-muted-foreground">
        {t("showcase.menus.commandHelp")}
      </p>
    </div>
  );
}
