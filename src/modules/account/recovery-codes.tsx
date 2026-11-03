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
    <section aria-labelledby="recovery-title" className="space-y-5">
      <h2 id="recovery-title" className="text-xl font-semibold">
        {t("account.auth.recoveryTitle")}
      </h2>
      <p className="text-muted-foreground">{t("account.auth.recoveryHint")}</p>
      <ul className="grid gap-3 font-mono sm:grid-cols-2">
        {codes.map((code) => (
          <li key={code} className="rounded-md border border-border p-3">
            {code}
          </li>
        ))}
      </ul>
      <div className="flex gap-3">
        <Button
          variant="ghost"
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
        <Button onClick={onSaved}>{t("account.auth.codesSaved")}</Button>
      </div>
      {copyState !== "ready" && (
        <p role="status">{t(`account.auth.copy.${copyState}`)}</p>
      )}
    </section>
  );
}
