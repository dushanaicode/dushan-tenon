import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { DictSelect } from "@/core/dict/dict-select";
import { IpcErrorMessage } from "@/core/ipc-error";
import { Button } from "@/kit";
import { appFilePick } from "@/lib/generated/commands";
import type { ExchangeFormat } from "@/lib/generated/ExchangeFormat";
import type { IpcError } from "@/lib/generated/IpcError";
import type { JobSubmitted } from "@/lib/generated/JobSubmitted";
import { ExchangeJob, useExchangeJob } from "./job";

export function ExportButton({
  label,
  suggestedName,
  onSubmit,
  onComplete,
}: {
  label?: string;
  suggestedName: string;
  onSubmit: (
    format: ExchangeFormat,
    fileToken: string,
  ) => Promise<JobSubmitted>;
  onComplete: () => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [format, setFormat] = useState<ExchangeFormat>("xlsx");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<IpcError>();
  const [jobId, setJobId] = useState<string>();
  const job = useExchangeJob(jobId, onComplete);
  const result =
    job.detail?.status === "succeeded"
      ? (job.detail.result as { rows: number; fileName: string })
      : undefined;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <label htmlFor={id} className="space-y-1">
          <span className="block text-sm">{t("exchange.format")}</span>
          <DictSelect
            id={id}
            code="framework.exchange_format"
            value={format}
            disabled={pending || job.active}
            onValueChange={setFormat}
          />
        </label>
        <Button
          type="button"
          disabled={pending || job.active}
          onClick={async () => {
            setError(undefined);
            setPending(true);
            try {
              const file = await appFilePick({
                purpose: "export",
                format,
                suggestedName: `${suggestedName}.${format}`,
              });
              if (file) setJobId((await onSubmit(format, file.token)).jobId);
            } catch (error) {
              setError(error as IpcError);
            } finally {
              setPending(false);
            }
          }}
        >
          {label ?? t("exchange.export")}
        </Button>
      </div>
      {error && <IpcErrorMessage error={error} />}
      {jobId && <ExchangeJob job={job} />}
      {result && <p role="status">{t("exchange.exported", result)}</p>}
    </div>
  );
}
