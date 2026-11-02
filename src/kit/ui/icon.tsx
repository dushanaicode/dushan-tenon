import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";
import { ICONS, type IconId } from "../icons";

export type IconProps = Omit<ComponentProps<"svg">, "children"> & {
  iconId: IconId;
};

export function Icon({ iconId, className, ...props }: IconProps) {
  const Component = ICONS[iconId];
  const named = props["aria-label"] || props["aria-labelledby"];
  return (
    <Component
      size={18}
      strokeWidth={2}
      role={named ? "img" : undefined}
      aria-hidden={named ? undefined : true}
      focusable="false"
      className={cn("kit-icon", className)}
      {...props}
    />
  );
}
