import { useId } from "react";
import { isOverridden } from "@/core/app-settings";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SettingRow,
} from "@/kit";
import type { ConfigSource } from "@/lib/generated/ConfigSource";
import { SettingSource } from "./setting-source";

export function SettingSelect<Value extends string | number>({
  label,
  value,
  source,
  options,
  disabled,
  reason,
  description,
  readOnly,
  locked,
  onValueChange,
}: {
  label: string;
  value: Value;
  source: ConfigSource;
  options: readonly {
    value: Value;
    label: string;
    description?: string;
    disabled?: boolean;
  }[];
  disabled: boolean;
  reason?: string;
  description?: string;
  readOnly?: boolean;
  locked?: boolean;
  onValueChange: (value: Value) => void;
}) {
  const id = useId();
  return (
    <SettingRow
      label={label}
      source={source}
      description={description ?? (!locked && !readOnly ? reason : undefined)}
      hint={
        <SettingSource
          source={source}
          locked={locked || readOnly}
          reason={reason}
        />
      }
    >
      {(control) =>
        readOnly ? (
          <p {...control} className="text-body">
            {options.find((option) => option.value === value)?.label}
          </p>
        ) : (
          <Select
            value={String(value)}
            disabled={disabled || locked || isOverridden(source)}
            onValueChange={(next) => {
              const option = options.find(
                (option) => String(option.value) === next,
              );
              if (!option) throw new Error(`Invalid option: ${next}`);
              onValueChange(option.value);
            }}
          >
            <SelectTrigger {...control} className="w-full">
              <SelectValue>
                {options.find((option) => option.value === value)?.label}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {options.map((option) => (
                <SelectItem
                  key={option.value}
                  value={String(option.value)}
                  disabled={option.disabled}
                  aria-labelledby={`${id}-${option.value}-label`}
                  aria-describedby={
                    option.description
                      ? `${id}-${option.value}-hint`
                      : undefined
                  }
                >
                  <span id={`${id}-${option.value}-label`}>{option.label}</span>
                  {option.description && (
                    <span
                      id={`${id}-${option.value}-hint`}
                      className="ml-2 max-w-[min(18rem,50vw)] whitespace-normal text-xs text-muted-foreground"
                    >
                      {option.description}
                    </span>
                  )}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )
      }
    </SettingRow>
  );
}
