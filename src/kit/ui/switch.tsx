// Adapted from shadcn/ui's MIT-licensed new-york-v4 Switch (shadcn-ui/ui d2fba50); semantic kit tokens.
import { Switch as SwitchPrimitive } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export type SwitchProps = ComponentProps<typeof SwitchPrimitive.Root>;

export function Switch({ className, ...props }: SwitchProps) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "peer relative inline-flex h-5 w-9 shrink-0 items-center",
        "rounded-full border border-transparent p-px",
        "after:absolute after:-inset-x-1 after:-inset-y-1.5 after:content-['']",
        "focus-visible:outline-none",
        "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
        "aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "data-[state=checked]:bg-primary data-[state=unchecked]:bg-input",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        data-motion-item
        className={cn(
          "pointer-events-none block size-4 rounded-full bg-background",
          "motion-transform data-[state=checked]:bg-primary-foreground",
          "data-[state=checked]:translate-x-full",
          "data-[state=unchecked]:translate-x-0",
        )}
      />
    </SwitchPrimitive.Root>
  );
}
