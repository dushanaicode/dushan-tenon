// Layout adapted from shadcn/ui's Field (MIT, new-york-v4, shadcn-ui/ui d2fba50); semantic kit tokens.
import { type ReactNode, useId } from "react";
import { cn } from "@/lib/utils";
import { Label } from "./label";

export type FormFieldControlProps = {
  id: string;
  "aria-describedby"?: string;
  "aria-invalid"?: true;
  "aria-required"?: true;
};

export type FormFieldProps = {
  label: ReactNode;
  children: (control: FormFieldControlProps) => ReactNode;
  description?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  orientation?: "vertical" | "horizontal";
  className?: string;
};

export function FormField({
  label,
  children,
  description,
  error,
  required,
  orientation = "vertical",
  className,
}: FormFieldProps) {
  const id = useId();
  const descriptionId = useId();
  const errorId = useId();
  const invalid = error != null;
  const describedBy = [description != null && descriptionId, invalid && errorId]
    .filter(Boolean)
    .join(" ");
  const control = children({
    id,
    "aria-describedby": describedBy || undefined,
    "aria-invalid": invalid || undefined,
    "aria-required": required || undefined,
  });
  const fieldLabel = (
    <Label data-slot="field-label" htmlFor={id}>
      {label}
      {required && <span aria-hidden="true">*</span>}
    </Label>
  );

  return (
    <div
      data-slot="form-field"
      data-invalid={invalid}
      data-orientation={orientation}
      className={cn("flex min-w-0 flex-col gap-2 text-body", className)}
    >
      {orientation === "horizontal" ? (
        <div data-slot="field-content" className="flex items-center gap-stack">
          {control}
          {fieldLabel}
        </div>
      ) : (
        <>
          {fieldLabel}
          {control}
        </>
      )}
      {description != null && (
        <p
          id={descriptionId}
          data-slot="field-description"
          className="text-body text-muted-foreground"
        >
          {description}
        </p>
      )}
      {invalid && (
        <div
          id={errorId}
          data-slot="field-error"
          role="alert"
          className="text-body text-destructive"
        >
          {error}
        </div>
      )}
    </div>
  );
}
