// Adapted from shadcn/ui's MIT-licensed new-york-v4 Table (shadcn-ui/ui d2fba50); semantic kit tokens.
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

// The accessible scroll region belongs to DataTable.
export function Table({ className, ...props }: ComponentProps<"table">) {
  return (
    <table
      data-slot="table"
      className={cn(
        "w-full border-separate border-spacing-0 overflow-clip rounded-[inherit] text-body",
        className,
      )}
      {...props}
    />
  );
}

export function TableHeader({ className, ...props }: ComponentProps<"thead">) {
  return (
    <thead
      data-slot="table-header"
      className={cn("bg-muted text-muted-foreground", className)}
      {...props}
    />
  );
}

export function TableBody({ className, ...props }: ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      className={cn("[&_tr>*]:border-t [&_tr>*]:border-border", className)}
      {...props}
    />
  );
}

export function TableRow({ className, ...props }: ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        "h-row hover:bg-muted data-[state=selected]:bg-muted",
        className,
      )}
      {...props}
    />
  );
}

export function TableHead({ className, ...props }: ComponentProps<"th">) {
  return (
    <th
      data-slot="table-head"
      scope="col"
      className={cn(
        "h-row px-panel py-2 text-start align-middle font-medium",
        className,
      )}
      {...props}
    />
  );
}

export function TableCell({ className, ...props }: ComponentProps<"td">) {
  return (
    <td
      data-slot="table-cell"
      className={cn("h-row px-panel py-2 align-middle", className)}
      {...props}
    />
  );
}

export function TableCaption({
  className,
  ...props
}: ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("text-body text-muted-foreground", className)}
      {...props}
    />
  );
}
