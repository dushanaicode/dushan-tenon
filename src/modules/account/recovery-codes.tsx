import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/kit";

export function RecoveryCodes({
  codes,
  onSaved,
}: {
  codes: string[];
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const [copyState, setCopyState] = useState<"ready" | "copied" | "failed">(
    "ready",
  );
  return (
    <div className="@container/recovery flex min-w-0 flex-col gap-stack">
      <ul className="grid gap-stack text-center font-mono text-xs @xs/recovery:grid-cols-2">
        {codes.map((code) => (
          <li key={code} className="rounded-md border border-border py-panel">
            {code}
          </li>
        ))}
      </ul>
      <Button onClick={onSaved}>{t("account.auth.codesSaved")}</Button>
      <Button
        variant="ghost"
        className="self-center"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(codes.join("\n"));
            setCopyState("copied");
          } catch {
            setCopyState("failed");
          }
        }}
      >
        {t("account.auth.copyCodes")}
      </Button>
      {copyState !== "ready" && (
        <p role="status" className="text-center text-sm text-muted-foreground">
          {t(`account.auth.copy.${copyState}`)}
        </p>
      )}
    </div>
  );
}
