// 套件自写；复用 FormField 的控件关联与错误语义。
import { type ReactNode, useId } from "react";
import { cn } from "@/lib/utils";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "./collapsible";
import { FormField, type FormFieldProps } from "./form-field";

export type SettingGroupProps = {
  title?: ReactNode;
  description?: ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
  children: ReactNode;
  className?: string;
};

export function SettingGroup({
  title,
  description,
  collapsible = false,
  defaultOpen = true,
  children,
  className,
}: SettingGroupProps) {
  const titleId = useId();
  const descriptionId = useId();
  const heading = (
    <>
      <span id={titleId} className="text-body font-semibold">
        {title}
      </span>
      {description != null && (
        <span
          id={descriptionId}
          className="block text-sm text-muted-foreground"
        >
          {description}
        </span>
      )}
    </>
  );
  const rows = (
    <div data-part="setting-rows" className="kit-edge-stack">
      {children}
    </div>
  );
  return (
    <fieldset
      data-kit="setting-group"
      aria-labelledby={title != null ? titleId : undefined}
      aria-describedby={description != null ? descriptionId : undefined}
      className={cn(
        "kit-edge-stack @container/settings min-w-0 rounded-lg border bg-card text-card-foreground",
        className,
      )}
    >
      {collapsible ? (
        <Collapsible className="kit-edge-stack" defaultOpen={defaultOpen}>
          <CollapsibleTrigger className="flex w-full flex-col items-start p-4 text-left">
            {heading}
          </CollapsibleTrigger>
          <CollapsibleContent className="kit-edge-stack">
            {rows}
          </CollapsibleContent>
        </Collapsible>
      ) : (
        <>
          {(title != null || description != null) && (
            <div className="px-4 pt-4 pb-2">{heading}</div>
          )}
          {rows}
        </>
      )}
    </fieldset>
  );
}

export type SettingRowProps = Omit<FormFieldProps, "orientation"> & {
  hint?: ReactNode;
  source?: string;
  actions?: ReactNode;
};

export function SettingRow({
  children,
  description,
  hint,
  source,
  actions,
  className,
  ...props
}: SettingRowProps) {
  return (
    <div data-kit="setting-row" data-source={source}>
      <FormField
        {...props}
        className={cn("kit-setting-row", className)}
        description={
          description != null || hint != null ? (
            <>
              {description != null && (
                <span data-part="setting-description">{description}</span>
              )}
              {hint != null && (
                <span
                  data-part="setting-hint"
                  className={cn(
                    "block self-start text-right text-xs",
                    "text-muted-foreground",
                  )}
                >
                  {hint}
                </span>
              )}
            </>
          ) : undefined
        }
      >
        {(control) => (
          <div data-part="setting-control">
            {children(control)}
            {actions}
          </div>
        )}
      </FormField>
    </div>
  );
}
