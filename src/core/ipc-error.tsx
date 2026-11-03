import { useTranslation } from "react-i18next";
import type { IpcError } from "@/lib/generated/IpcError";

export function IpcErrorMessage({
  error,
  message,
}: {
  error: IpcError;
  message?: string;
}) {
  const { t } = useTranslation();
  return (
    <div role="alert" className="space-y-2 rounded-lg border border-border p-4">
      <p>{message ?? t(`errors.${error.code}`, error.params)}</p>
      <p className="break-all text-sm text-muted-foreground">
        {t("error.traceId", { traceId: error.traceId })}
      </p>
    </div>
  );
}
