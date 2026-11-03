import { useDict } from "@/core/dict/use-dict";
import {
  Select,
  SelectContent,
  SelectItem,
  type SelectProps,
  SelectTrigger,
  type SelectTriggerProps,
  SelectValue,
} from "@/kit";
import { DICTIONARIES, type DictCode } from "@/lib/generated/dict-codes";

const emptyValue = "__dict_empty__";
type DictValue<Code extends DictCode> =
  (typeof DICTIONARIES)[Code][number]["value"];
type DictSelectProps<Code extends DictCode> = Omit<
  SelectTriggerProps,
  "children" | "value" | "defaultValue" | "onChange" | "name"
> &
  Pick<SelectProps, "name" | "form" | "required"> & {
    code: Code;
  } & (
    | {
        emptyLabel: string;
        value: DictValue<Code> | "";
        onValueChange: (value: DictValue<Code> | "") => void;
      }
    | {
        emptyLabel?: undefined;
        value: DictValue<Code>;
        onValueChange: (value: DictValue<Code>) => void;
      }
  );

export function DictSelect<Code extends DictCode>({
  code,
  emptyLabel,
  value,
  onValueChange,
  disabled,
  name,
  form,
  required,
  ...props
}: DictSelectProps<Code>) {
  const dict = useDict(code);
  const options = DICTIONARIES[code];
  return (
    <>
      {name !== undefined && (
        <input
          type="hidden"
          name={name}
          form={form}
          value={value}
          disabled={disabled}
        />
      )}
      <Select
        value={value === "" ? emptyValue : value}
        disabled={disabled}
        form={form}
        required={required}
        onValueChange={(next) => {
          if (emptyLabel !== undefined && next === emptyValue) {
            onValueChange("");
            return;
          }
          const option = options.find((option) => option.value === next);
          if (option === undefined) {
            throw new Error(`Invalid ${code} value: ${next}`);
          }
          onValueChange(option.value);
        }}
      >
        <SelectTrigger {...props}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {emptyLabel !== undefined && (
            <SelectItem value={emptyValue}>{emptyLabel}</SelectItem>
          )}
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {dict.label(option.value)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </>
  );
}
