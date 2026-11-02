// Layout adapted from shadcn/ui's Field (MIT, new-york-v4, shadcn-ui/ui d2fba50); semantic kit tokens.
import { type ReactNode, useId } from "react";
import { cn } from "@/lib/utils";

export type FormSectionProps = {
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
};

export function FormSection({
  title,
  description,
  children,
  className,
}: FormSectionProps) {
  const descriptionId = useId();
  return (
    <fieldset
      data-slot="field-set"
      aria-describedby={description != null ? descriptionId : undefined}
      className={cn("flex min-w-0 flex-col gap-stack p-panel", className)}
    >
      <legend
        data-slot="field-legend"
        className="float-left w-full text-body font-semibold"
      >
        {title}
      </legend>
      {description != null && (
        <p
          id={descriptionId}
          data-slot="field-description"
          className="text-body text-muted-foreground"
        >
          {description}
        </p>
      )}
      <div data-slot="field-group" className="flex flex-col gap-stack">
        {children}
      </div>
    </fieldset>
  );
}
