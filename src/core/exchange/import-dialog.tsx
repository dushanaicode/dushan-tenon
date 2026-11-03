import { type ReactNode, useEffect, useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { DictSelect } from "@/core/dict/dict-select";
import { IpcErrorMessage } from "@/core/ipc-error";
import {
  Button,
  DataTable,
  type DataTableColumn,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/kit";
import { appFilePick } from "@/lib/generated/commands";
import type { ExchangeFormat } from "@/lib/generated/ExchangeFormat";
import type { FilePicked } from "@/lib/generated/FilePicked";
import type { ImportMode } from "@/lib/generated/ImportMode";
import type { ImportReport } from "@/lib/generated/ImportReport";
import type { IpcError } from "@/lib/generated/IpcError";
import type { JobSubmitted } from "@/lib/generated/JobSubmitted";
import { ExchangeJob, useExchangeJob } from "./job";

type ImportDialogProps = {
  pickedFile?: FilePicked | null;
  onPickedConsumed?: () => void;
  modes: readonly ImportMode[];
  suggestedName: string;
  children?: ReactNode;
  validate?: (data: FormData) => string | null;
  onTemplate?: (format: ExchangeFormat, fileToken: string) => Promise<null>;
  columnLabel: (column: string) => string;
  onSubmit: (
    fileToken: string,
    mode: ImportMode,
    data: FormData,
  ) => Promise<JobSubmitted>;
  onComplete: () => void;
};

type TemplateState = {
  format: ExchangeFormat;
  setFormat: (format: ExchangeFormat) => void;
  saved: boolean;
  setSaved: (saved: boolean) => void;
  save: NonNullable<ImportDialogProps["onTemplate"]>;
};

function TemplateImportDialog({
  onTemplate,
  ...props
}: ImportDialogProps & {
  onTemplate: NonNullable<ImportDialogProps["onTemplate"]>;
}) {
  const [format, setFormat] = useState<ExchangeFormat>("xlsx");
  const [saved, setSaved] = useState(false);
  return (
    <ImportContent
      {...props}
      template={{ format, setFormat, saved, setSaved, save: onTemplate }}
    />
  );
}

export function ImportDialog({ onTemplate, ...props }: ImportDialogProps) {
  return onTemplate ? (
    <TemplateImportDialog {...props} onTemplate={onTemplate} />
  ) : (
    <ImportContent {...props} />
  );
}

function ImportContent({
  pickedFile,
  onPickedConsumed,
  modes,
  suggestedName,
  children,
  validate,
  columnLabel,
  onSubmit,
  onComplete,
  template,
}: Omit<ImportDialogProps, "onTemplate"> & { template?: TemplateState }) {
  const { t } = useTranslation();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<ImportMode>(modes[0]);
  const [file, setFile] = useState<FilePicked | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<IpcError>();
  const [validation, setValidation] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string>();
  useEffect(() => {
    if (pickedFile) {
      setFile(pickedFile);
      setOpen(true);
      setValidation(null);
    }
  }, [pickedFile]);
  const job = useExchangeJob(jobId, onComplete);
  const report = job.detail?.result as ImportReport | null | undefined;
  const disabled = pending || job.active;
  const columns = useMemo<DataTableColumn<ImportReport["errors"][number]>[]>(
    () => [
      {
        id: "row",
        header: t("exchange.row"),
        cell: (error) => error.row,
      },
      {
        id: "column",
        header: t("exchange.column"),
        cell: (error) => (error.column ? columnLabel(error.column) : "—"),
      },
      {
        id: "reason",
        header: t("exchange.reason"),
        cell: (error) => t(`errors.${error.code}`, error.params),
      },
    ],
    [t, columnLabel],
  );
  async function select(templateRequest?: TemplateState) {
    setPending(true);
    setError(undefined);
    template?.setSaved(false);
    try {
      if (templateRequest) {
        const target = await appFilePick({
          purpose: "export",
          format: templateRequest.format,
          suggestedName: `${suggestedName}.${templateRequest.format}`,
        });
        if (target) {
          await templateRequest.save(templateRequest.format, target.token);
          templateRequest.setSaved(true);
        }
      } else {
        const selected = await appFilePick({ purpose: "import" });
        if (selected) {
          setFile(selected);
          setValidation(null);
        }
      }
    } catch (error) {
      setError(error as IpcError);
    } finally {
      setPending(false);
    }
  }
  return (
    <>
      <Button type="button" onClick={() => setOpen(true)}>
        {t("exchange.import")}
      </Button>
      {open && (
        <section
          role="dialog"
          aria-labelledby={`${id}-title`}
          className="space-y-4 rounded-lg border border-border p-5"
        >
          <div className="flex items-center justify-between gap-3">
            <h2 id={`${id}-title`} className="text-lg font-semibold">
              {t("exchange.import")}
            </h2>
            <Button
              type="button"
              variant="ghost"
              disabled={disabled}
              onClick={() => {
                setOpen(false);
                onPickedConsumed?.();
              }}
            >
              {t("exchange.close")}
            </Button>
          </div>
          {template && (
            <div className="flex flex-wrap items-end gap-2">
              <label htmlFor={`${id}-format`} className="space-y-1">
                <span className="block">{t("exchange.templateFormat")}</span>
                <DictSelect
                  id={`${id}-format`}
                  code="framework.exchange_format"
                  value={template.format}
                  disabled={disabled}
                  onValueChange={template.setFormat}
                />
              </label>
              <Button
                type="button"
                variant="ghost"
                disabled={disabled}
                onClick={() => void select(template)}
              >
                {t("exchange.template")}
              </Button>
            </div>
          )}
          {template?.saved && (
            <p role="status">{t("exchange.templateSaved")}</p>
          )}
          <form
            noValidate
            className="space-y-4"
            onSubmit={async (event) => {
              event.preventDefault();
              const form = event.currentTarget;
              const data = new FormData(form);
              const invalid = !file
                ? "exchange.fileRequired"
                : validate?.(data);
              if (invalid) {
                setValidation(invalid);
                return;
              }
              if (!file) return;
              setValidation(null);
              setPending(true);
              setError(undefined);
              try {
                setJobId((await onSubmit(file.token, mode, data)).jobId);
                form.reset();
              } catch (error) {
                setError(error as IpcError);
              } finally {
                setFile(null);
                onPickedConsumed?.();
                setPending(false);
              }
            }}
          >
            <fieldset disabled={disabled} className="space-y-4">
              <div className="flex items-center gap-3">
                <Button type="button" onClick={() => void select()}>
                  {t("exchange.chooseFile")}
                </Button>
                <span>{file?.fileName}</span>
              </div>
              <label htmlFor={`${id}-mode`} className="block space-y-1">
                <span className="block">{t("exchange.mode")}</span>
                <Select
                  value={mode}
                  disabled={disabled}
                  onValueChange={(value) => {
                    const next = modes.find((mode) => mode === value);
                    if (next === undefined) {
                      throw new Error(`Invalid import mode: ${value}`);
                    }
                    setMode(next);
                  }}
                >
                  <SelectTrigger id={`${id}-mode`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {modes.map((mode) => (
                      <SelectItem key={mode} value={mode}>
                        {t(`exchange.modes.${mode}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
              {children}
              <Button type="submit">{t("exchange.startImport")}</Button>
            </fieldset>
          </form>
          {validation && <p role="alert">{t(validation)}</p>}
          {error && <IpcErrorMessage error={error} />}
          {jobId && <ExchangeJob job={job} />}
          {report && (
            <section aria-label={t("exchange.report")} className="space-y-3">
              <h3 className="font-semibold">{t("exchange.report")}</h3>
              <dl className="flex flex-wrap gap-4">
                {(["total", "created", "updated", "skipped"] as const).map(
                  (key) => (
                    <div key={key}>
                      <dt>{t(`exchange.${key}`)}</dt>
                      <dd>{report[key]}</dd>
                    </div>
                  ),
                )}
              </dl>
              {report.errors.length > 0 && (
                <DataTable
                  caption={t("exchange.rowErrors")}
                  columns={columns}
                  rows={report.errors}
                  getRowId={(error) =>
                    `${error.row}-${error.column}-${error.code}`
                  }
                />
              )}
              {report.errorsTruncated && (
                <p role="status">{t("exchange.truncated")}</p>
              )}
            </section>
          )}
        </section>
      )}
    </>
  );
}
