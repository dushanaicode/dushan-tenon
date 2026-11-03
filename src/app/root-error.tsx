import { type ComponentProps, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, ErrorView, ScrollArea, Textarea } from "@/kit";
import {
  ConnectedWindowControls,
  dragRegion,
  WindowChromeProvider,
} from "@/shell";

export function RootError({
  titlebar,
  platform,
}: Pick<ComponentProps<typeof WindowChromeProvider>, "titlebar" | "platform">) {
  const { t } = useTranslation();
  const [traceId] = useState(() => crypto.randomUUID());
  const [showText, setShowText] = useState(false);
  const report = `Tenon UI recovery v1\ncode=app.ui.failed\ntraceId=${traceId}`;
  async function copy() {
    try {
      await navigator.clipboard.writeText(report);
    } catch {
      setShowText(true);
    }
  }
  return (
    <WindowChromeProvider titlebar={titlebar} platform={platform}>
      <div className="flex h-dvh flex-col">
        {titlebar === "hidden" && (
          <header
            {...dragRegion(titlebar)}
            className="flex h-13 shrink-0 justify-end border-b border-border"
          >
            <ConnectedWindowControls />
          </header>
        )}
        <ScrollArea
          region="content"
          className="flex-1"
          plateClassName="flex flex-col"
        >
          <main className="mx-auto my-auto flex w-full max-w-2xl shrink-0 flex-col gap-4 p-6">
            <ErrorView
              title={t("recovery.title")}
              message={t("recovery.description")}
              detail={t("error.traceId", { traceId })}
              retryLabel={t("recovery.reload")}
              onRetry={() => window.location.reload()}
            />
            <Button variant="outline" onClick={() => void copy()}>
              {t("recovery.copy")}
            </Button>
            {showText && (
              <Textarea
                readOnly
                value={report}
                aria-label={t("recovery.copy")}
              />
            )}
          </main>
        </ScrollArea>
      </div>
    </WindowChromeProvider>
  );
}
