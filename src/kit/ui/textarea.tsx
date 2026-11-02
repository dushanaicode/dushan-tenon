// Adapted from shadcn/ui's MIT-licensed new-york-v4 Textarea (shadcn-ui/ui d2fba50); semantic kit tokens.
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export type TextareaProps = ComponentProps<"textarea">;

export function Textarea({ className, ...props }: TextareaProps) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-16 w-full rounded-md border",
        "border-input bg-transparent px-3 py-2 text-body text-foreground",
        "placeholder:text-muted-foreground",
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
