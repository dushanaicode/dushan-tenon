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
        "focus-visible:ring-2 focus-visible:ring-ring",
        "focus-visible:border-ring aria-invalid:border-destructive",
        "aria-invalid:focus-visible:ring-destructive",
        className,
      )}
      {...props}
    />
  );
}
