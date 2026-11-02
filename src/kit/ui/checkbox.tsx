// Adapted from shadcn/ui's MIT-licensed new-york-v4 Checkbox (shadcn-ui/ui d2fba50); semantic kit tokens.
import { CheckIcon, MinusIcon } from "lucide-react";
import { Checkbox as CheckboxPrimitive } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export type CheckboxProps = ComponentProps<typeof CheckboxPrimitive.Root>;

export function Checkbox({ className, ...props }: CheckboxProps) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "peer relative size-4 shrink-0 rounded-[4px] border border-input",
        "bg-transparent after:absolute after:-inset-2 after:content-['']",
        "focus-visible:outline-none",
        "focus-visible:ring-2 focus-visible:ring-ring",
        "focus-visible:border-ring aria-invalid:border-destructive",
        "aria-invalid:focus-visible:ring-destructive",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "data-[state=checked]:border-primary data-[state=checked]:bg-primary",
        "data-[state=checked]:text-primary-foreground",
        "data-[state=indeterminate]:border-primary",
        "data-[state=indeterminate]:bg-primary",
        "data-[state=indeterminate]:text-primary-foreground",
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="group/indicator grid place-content-center text-current"
      >
        <CheckIcon className="size-3.5 group-data-[state=indeterminate]/indicator:hidden" />
        <MinusIcon
          className={cn(
            "hidden size-3.5",
            "group-data-[state=indeterminate]/indicator:block",
          )}
        />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}
