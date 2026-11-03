// showcase-example
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Badge,
  Button,
  Checkbox,
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
  FormField,
  Icon,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/kit";

export function MultiSelectExample({
  disabled = false,
  invalid = false,
  initialValue = [],
}: {
  disabled?: boolean;
  invalid?: boolean;
  initialValue?: string[];
}) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<string[]>(initialValue);
  const options = [
    { value: "one", label: t("showcase.selects.one") },
    { value: "long", label: t("showcase.selects.long") },
    ...Array.from({ length: 24 }, (_, i) => ({
      value: `archive-${i}`,
      label: t("showcase.selects.option", { number: i + 1 }),
    })),
  ];
  return (
    <div className="min-w-0 space-y-3">
      <FormField
        label={t("showcase.selects.multiLabel")}
        description={t("showcase.selects.multiHelp")}
        error={
          invalid && selected.length === 0
            ? t("showcase.selects.error")
            : undefined
        }
      >
        {(control) => (
          <Popover>
            <PopoverTrigger asChild>
              <Button
                {...control}
                type="button"
                disabled={disabled}
                variant="outline"
                className="w-full justify-between"
              >
                {t("showcase.selects.selectedCount", {
                  count: selected.length,
                })}
                <Icon iconId="expand" />
              </Button>
            </PopoverTrigger>
            <PopoverContent
              aria-label={t("showcase.selects.multiLabel")}
              className="w-(--radix-popover-trigger-width) p-0"
            >
              <Command label={t("showcase.selects.search")} className="h-auto">
                <CommandInput
                  placeholder={t("showcase.selects.search")}
                  aria-label={t("showcase.selects.search")}
                />
                <CommandList label={t("showcase.selects.multiLabel")}>
                  <CommandEmpty>{t("showcase.selects.empty")}</CommandEmpty>
                  {options.map((option) => (
                    <CommandItem
                      key={option.value}
                      value={option.value}
                      keywords={[option.label]}
                      aria-label={t(
                        selected.includes(option.value)
                          ? "showcase.selects.removeOption"
                          : "showcase.selects.addOption",
                        { name: option.label },
                      )}
                      onSelect={() =>
                        setSelected((current) =>
                          current.includes(option.value)
                            ? current.filter((item) => item !== option.value)
                            : [...current, option.value],
                        )
                      }
                    >
                      <Checkbox
                        checked={selected.includes(option.value)}
                        tabIndex={-1}
                        aria-hidden="true"
                        className="pointer-events-none shrink-0"
                      />
                      <span className="min-w-0 whitespace-normal break-words">
                        {option.label}
                      </span>
                    </CommandItem>
                  ))}
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        )}
      </FormField>
      <div className="flex min-w-0 flex-wrap gap-2" aria-live="polite">
        {options
          .filter((option) => selected.includes(option.value))
          .map((option) => (
            <Badge
              key={option.value}
              className="max-w-full whitespace-normal break-words"
            >
              {option.label}
            </Badge>
          ))}
      </div>
      <Button
        type="button"
        variant="ghost"
        disabled={disabled || selected.length === 0}
        onClick={() => setSelected([])}
      >
        {t("showcase.selects.clear")}
      </Button>
    </div>
  );
}
