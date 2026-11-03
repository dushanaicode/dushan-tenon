import { useTranslation } from "react-i18next";
import { Button, Icon } from "@/kit";
import { cn } from "@/lib/utils";
import { useWindowChrome } from "./window-chrome";

export interface WindowControlsProps {
  maximized: boolean;
  focused: boolean;
  pending: boolean;
  onMinimize: () => void;
  onToggleMaximize: () => void;
  onClose: () => void;
}

export function WindowControls({
  maximized,
  focused,
  pending,
  onMinimize,
  onToggleMaximize,
  onClose,
}: WindowControlsProps) {
  const { t } = useTranslation();
  return (
    // biome-ignore lint/a11y/useSemanticElements: Window actions are an ARIA group, not form fields.
    <div
      role="group"
      aria-label={t("shell.window.controls")}
      data-shell="window-controls"
      data-window-focused={focused}
      data-window-maximized={maximized}
      className="flex h-full shrink-0 self-stretch data-[window-focused=false]:[&_svg]:opacity-60"
    >
      {(
        [
          ["minimize", "minimize", "window-minimize", onMinimize],
          [
            "maximize",
            maximized ? "restore" : "maximize",
            maximized ? "window-restore" : "window-maximize",
            onToggleMaximize,
          ],
          ["close", "close", "close", onClose],
        ] as const
      ).map(([control, label, iconId, onClick]) => (
        <Button
          key={control}
          type="button"
          variant="ghost"
          data-window-control={control}
          aria-label={t(`shell.window.${label}`)}
          disabled={pending}
          onClick={onClick}
          className={cn(
            "h-full w-[46px] shrink-0 rounded-none bg-transparent p-0 text-foreground",
            "focus-visible:ring-0 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-ring focus-visible:-outline-offset-4!",
            control === "close"
              ? "hover:bg-destructive hover:text-destructive-foreground active:bg-destructive/85 active:text-destructive-foreground dark:hover:text-foreground dark:active:text-foreground"
              : "hover:bg-foreground/8 hover:text-foreground active:bg-foreground/14",
          )}
        >
          <Icon iconId={iconId} className="scale-75" />
        </Button>
      ))}
    </div>
  );
}

export function ConnectedWindowControls() {
  const chrome = useWindowChrome();
  if (chrome.titlebar !== "hidden" || chrome.platform === "macos") return null;
  return (
    <WindowControls
      maximized={chrome.maximized}
      focused={chrome.focused}
      pending={chrome.pending}
      onMinimize={chrome.minimize}
      onToggleMaximize={chrome.toggleMaximize}
      onClose={chrome.close}
    />
  );
}
