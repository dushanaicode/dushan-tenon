// 套件自写；许可见项目根 LICENSE。
import { Check, ChevronsUpDown } from "lucide-react";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Button } from "./button";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "./command";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";

export type ComboboxOption = {
  value: string;
  label: string;
  keywords?: readonly string[];
  disabled?: boolean;
};

export type ComboboxProps = {
  options: readonly ComboboxOption[];
  value: string | null;
  onValueChange: (value: string | null) => void;
  placeholder: string;
  searchPlaceholder: string;
  emptyText: string;
  clearable?: boolean;
  disabled?: boolean;
  id?: string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
  className?: string;
};

export function Combobox({
  options,
  value,
  onValueChange,
  placeholder,
  searchPlaceholder,
  emptyText,
  clearable = false,
  disabled,
  className,
  ...props
}: ComboboxProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const clearId = useId();
  const selected = options.find((option) => option.value === value);

  function select(next: string | null) {
    onValueChange(next);
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          data-slot="combobox"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-haspopup="listbox"
          disabled={disabled}
          className={cn("w-full justify-between", className)}
          {...props}
        >
          <span
            className={cn("truncate", !selected && "text-muted-foreground")}
          >
            {selected ? selected.label : placeholder}
          </span>
          <ChevronsUpDown
            aria-hidden="true"
            className="text-muted-foreground"
          />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) p-0">
        <Command label={searchPlaceholder}>
          <CommandInput
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
          />
          <CommandList label={placeholder}>
            <CommandEmpty>{emptyText}</CommandEmpty>
            {clearable && (
              <CommandItem
                value={clearId}
                keywords={[t("kit.combobox.clear")]}
                onSelect={() => select(null)}
              >
                <span aria-hidden="true" className="size-4 shrink-0" />
                {t("kit.combobox.clear")}
              </CommandItem>
            )}
            {options.map((option) => (
              <CommandItem
                key={option.value}
                value={option.value}
                keywords={[option.label, ...(option.keywords ?? [])]}
                disabled={option.disabled}
                onSelect={() => select(option.value)}
              >
                <span aria-hidden="true" className="size-4 shrink-0">
                  {option.value === value && (
                    <Check data-slot="combobox-check" />
                  )}
                </span>
                {option.label}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
