// showcase-example
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Icon } from "@/kit";

export function WindowControlsExample() {
  const { t } = useTranslation();
  const [maximized, setMaximized] = useState(false);
  const [action, setAction] = useState("shell.window.samples.default");
  return (
    <section className="space-y-3">
      <h3 className="font-semibold">{t("shell.window.samples.title")}</h3>
      <p className="text-sm text-muted-foreground">
        {t("showcase.readings.windowHint")}
      </p>
      {([false, true] as const).map((pending) => (
        <fieldset
          key={String(pending)}
          className="flex justify-end border bg-chrome"
          aria-label={t(
            pending
              ? "shell.window.samples.pending"
              : "shell.window.samples.default",
          )}
        >
          <Button
            size="icon"
            variant="ghost"
            className="rounded-none"
            disabled={pending}
            aria-label={t("shell.window.minimize")}
            onClick={() => setAction("shell.window.minimize")}
          >
            <Icon iconId="window-minimize" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="rounded-none"
            disabled={pending}
            aria-label={t(
              maximized ? "shell.window.restore" : "shell.window.maximize",
            )}
            onClick={() => {
              setMaximized(!maximized);
              setAction(
                maximized ? "shell.window.restore" : "shell.window.maximize",
              );
            }}
          >
            <Icon iconId={maximized ? "window-restore" : "window-maximize"} />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="rounded-none hover:bg-destructive hover:text-destructive-foreground"
            disabled={pending}
            aria-label={t("shell.window.close")}
            onClick={() => setAction("shell.window.close")}
          >
            <Icon iconId="close" />
          </Button>
        </fieldset>
      ))}
      <p role="status">{t(action)}</p>
    </section>
  );
}
