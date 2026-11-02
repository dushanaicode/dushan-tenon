// Sonner 2.0.8 (MIT) wrapper, adapted from shadcn/ui's Sonner (shadcn-ui/ui d2fba50); semantic kit tokens.
import { CircleCheck, Info, OctagonX, TriangleAlert } from "lucide-react";
import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { Toaster as Sonner, type ToasterProps } from "sonner";
import { cn } from "@/lib/utils";
import { APPEARANCE_LAYER_ORDER } from "../styles/layer-order";
import { Spinner } from "./spinner";

// Sonner 运行时注入与静态 CSS 同归 components；已有层（含前置注释）不重复包装。
for (const style of document.head.querySelectorAll("style")) {
  const css = style.textContent;
  if (
    css.includes("data-sonner-toaster") &&
    !/^(?:\s|\/\*[\s\S]*?\*\/)*@layer\b/.test(css)
  ) {
    style.textContent = `${APPEARANCE_LAYER_ORDER}\n@layer components{${css}}`;
  }
}

export type { ToasterProps } from "sonner";

export function Toaster({
  icons,
  style,
  toastOptions,
  ...props
}: ToasterProps) {
  const { t } = useTranslation();
  return (
    <Sonner
      theme="light"
      position="bottom-right"
      visibleToasts={3}
      containerAriaLabel={t("kit.toast.region")}
      customAriaLabel={props.containerAriaLabel ?? t("kit.toast.region")}
      {...props}
      icons={{
        success: <CircleCheck className="size-4 text-success" />,
        info: <Info className="size-4 text-info" />,
        warning: <TriangleAlert className="size-4 text-warning" />,
        error: <OctagonX className="size-4 text-destructive" />,
        loading: <Spinner />,
        ...icons,
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--r-md)",
          ...style,
        } as CSSProperties
      }
      toastOptions={{
        closeButtonAriaLabel: t("kit.toast.close"),
        ...toastOptions,
        classNames: {
          ...toastOptions?.classNames,
          toast: cn(
            "font-sans text-body shadow-popover focus-visible:outline-none",
            "focus-visible:ring-2 focus-visible:ring-ring",
            toastOptions?.classNames?.toast,
          ),
          description: cn(
            "text-body text-muted-foreground",
            toastOptions?.classNames?.description,
          ),
          closeButton: cn(
            "size-control rounded-md hover:border-border hover:bg-accent",
            "focus-visible:outline-none",
            "focus-visible:ring-2 focus-visible:ring-ring",
            toastOptions?.classNames?.closeButton,
          ),
          actionButton: cn(
            "h-control rounded-md text-body focus-visible:outline-none",
            "focus-visible:ring-2 focus-visible:ring-ring",
            toastOptions?.classNames?.actionButton,
          ),
          cancelButton: cn(
            "h-control rounded-md bg-secondary text-body",
            "text-secondary-foreground focus-visible:outline-none",
            "focus-visible:ring-2 focus-visible:ring-ring",
            toastOptions?.classNames?.cancelButton,
          ),
        },
      }}
    />
  );
}
