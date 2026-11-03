import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, ScrollArea, Textarea } from "@/kit";

export type UsageExample = {
  file: string;
  load: (() => Promise<{ default: string }>) | undefined;
};

function ExampleSource({
  file,
  load,
}: {
  file: string;
  load: NonNullable<UsageExample["load"]>;
}) {
  const { t } = useTranslation();
  const [source, setSource] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [copy, setCopy] = useState<"idle" | "copied" | "failed">("idle");
  useEffect(() => {
    let active = true;
    void load().then(
      ({ default: text }) => {
        if (active) setSource(text);
      },
      () => {
        if (active) setFailed(true);
      },
    );
    return () => {
      active = false;
    };
  }, [load]);
  async function copySource(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopy("copied");
    } catch {
      setCopy("failed");
    }
  }
  return (
    <div className="min-w-0 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <code className="break-all text-xs">{file}</code>
        {source !== null && (
          <Button variant="outline" onClick={() => void copySource(source)}>
            {t("showcase.common.copy")}
          </Button>
        )}
      </div>
      {source === null && (
        <p role={failed ? "alert" : "status"}>
          {t(
            failed
              ? "showcase.common.sourceFailed"
              : "showcase.common.sourceLoading",
          )}
        </p>
      )}
      {source !== null && (
        <>
          <ScrollArea axis="both" className="max-h-96 rounded-md bg-muted p-4">
            <pre className="whitespace-pre-wrap break-words text-xs leading-relaxed">
              <code>{source}</code>
            </pre>
          </ScrollArea>
          {copy === "copied" && (
            <p role="status">{t("showcase.common.copied")}</p>
          )}
          {copy === "failed" && (
            <div className="space-y-2">
              <p role="status">{t("showcase.common.copyFailed")}</p>
              <Textarea
                readOnly
                aria-label={t("showcase.common.sourceText")}
                value={source}
                onFocus={(event) => event.currentTarget.select()}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function UsagePanel({
  examples,
}: {
  examples: readonly UsageExample[];
}) {
  const { t } = useTranslation();
  if (!import.meta.env.DEV) return null;
  return (
    <section
      data-showcase-block="usage"
      className="min-w-0 space-y-5 rounded-lg border bg-card p-4"
    >
      <h2 className="text-lg font-semibold">{t("showcase.common.usage")}</h2>
      {examples.map((example) =>
        example.load ? (
          <ExampleSource
            key={example.file}
            file={example.file}
            load={example.load}
          />
        ) : null,
      )}
    </section>
  );
}
