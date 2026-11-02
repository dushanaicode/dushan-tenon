// 套件自写；许可见项目根 LICENSE。
import { ChevronDown, ChevronUp } from "lucide-react";
import { type ComponentProps, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Input } from "./input";

export type NumberInputProps = {
  value: number | null;
  onValueChange: (value: number | null) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  placeholder?: string;
  id?: string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
  className?: string;
};

function StepButton(props: ComponentProps<"button">) {
  return (
    <button
      type="button"
      tabIndex={-1}
      className={cn(
        "kit-icon-control flex h-1/2 w-full items-center justify-center rounded-sm",
        "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-3",
      )}
      {...props}
    />
  );
}

function decimalPlaces(value: number) {
  const [coefficient, exponent = "0"] = String(value).split("e");
  const fraction = coefficient.split(".")[1] ?? "";
  return Math.max(0, fraction.length - Number(exponent));
}

export function NumberInput({
  value,
  onValueChange,
  min,
  max,
  step = 1,
  disabled,
  className,
  ...props
}: NumberInputProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(value === null ? "" : String(value));
  const emitted = useRef(value);

  useEffect(() => {
    // 本次输入的受控回写保留草稿格式；外部更新替换草稿。
    if (value !== emitted.current) {
      setDraft(value === null ? "" : String(value));
    }
    emitted.current = value;
  }, [value]);

  function clamp(next: number) {
    return Math.min(max ?? Infinity, Math.max(min ?? -Infinity, next));
  }

  function commit(next: number | null) {
    emitted.current = next;
    onValueChange(next);
  }

  function move(direction: number) {
    const base = value ?? min ?? 0;
    const precision = Math.max(decimalPlaces(base), decimalPlaces(step));
    const next = clamp(Number((base + direction * step).toFixed(precision)));
    setDraft(String(next));
    commit(next);
  }

  return (
    <div data-slot="number-input" className={cn("relative", className)}>
      <Input
        {...props}
        type="text"
        inputMode="decimal"
        value={draft}
        disabled={disabled}
        className="pr-10"
        onChange={(event) => {
          const next = event.target.value;
          setDraft(next);
          if (next.trim() === "") commit(null);
          else if (
            !next.trimEnd().endsWith(".") &&
            Number.isFinite(Number(next))
          )
            commit(Number(next));
        }}
        onBlur={() => {
          const next = value === null ? null : clamp(value);
          setDraft(next === null ? "" : String(next));
          if (next !== value) commit(next);
        }}
        onKeyDown={(event) => {
          if (
            !disabled &&
            (event.key === "ArrowUp" || event.key === "ArrowDown")
          ) {
            event.preventDefault();
            move(event.key === "ArrowUp" ? 1 : -1);
          }
        }}
      />
      <div className="absolute inset-y-1 right-1 flex w-6 flex-col">
        <StepButton
          aria-label={t("kit.numberInput.increase")}
          disabled={
            disabled || (max !== undefined && value !== null && value >= max)
          }
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => move(1)}
        >
          <ChevronUp aria-hidden="true" />
        </StepButton>
        <StepButton
          aria-label={t("kit.numberInput.decrease")}
          disabled={
            disabled || (min !== undefined && value !== null && value <= min)
          }
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => move(-1)}
        >
          <ChevronDown aria-hidden="true" />
        </StepButton>
      </div>
    </div>
  );
}
