// Adapted from shadcn/ui's MIT-licensed new-york-v4 Input (shadcn-ui/ui d2fba50); semantic kit tokens.
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export type InputProps = ComponentProps<"input">;

export function Input({ className, type, ...props }: InputProps) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-control w-full min-w-0 rounded-control border border-input",
        "bg-transparent px-3 py-1 text-body text-foreground",
        "selection:bg-primary selection:text-primary-foreground",
        "file:inline-flex file:h-full file:border-0 file:bg-transparent",
        "file:text-body file:font-medium file:text-foreground",
        "placeholder:text-muted-foreground disabled:pointer-events-none",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "focus-visible:outline-none",
        "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
        "aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40",
        className,
      )}
      {...props}
    />
  );
}
