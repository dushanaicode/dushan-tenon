import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { useIncomingFile } from "@/core/file-ingress";
import {
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/kit";
import type { FilePurposeInfo } from "@/lib/generated/FilePurposeInfo";
import type { FilePurposes } from "@/lib/generated/FilePurposes";

export function FileToolbar({
  purpose,
  keyword,
  purposes,
  selected,
  incoming,
  pending,
  writable,
  onFilter,
  onAdd,
  onReclaim,
}: {
  purpose: string;
  keyword: string;
  purposes: FilePurposes | undefined;
  selected: FilePurposeInfo | undefined;
  incoming: ReturnType<typeof useIncomingFile>;
  pending: boolean;
  writable: boolean;
  onFilter: (patch: { purpose?: string; keyword?: string }) => void;
  onAdd: () => void;
  onReclaim: () => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(keyword);
  return (
    <>
      <form
        noValidate
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          onFilter({ keyword: draft });
        }}
      >
        <label htmlFor="file-purpose" className="space-y-2">
          <span className="block">{t("files.purpose")}</span>
          <Select
            value={purpose || "__all__"}
            onValueChange={(value) => {
              onFilter({ purpose: value === "__all__" ? "" : value });
            }}
          >
            <SelectTrigger id="file-purpose" aria-label={t("files.purpose")}>
              <SelectValue placeholder={t("files.all")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">{t("files.all")}</SelectItem>
              {purposes?.items.map((item) => (
                <SelectItem key={item.code} value={item.code}>
                  {t(`file.purpose.${item.code}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <label htmlFor="file-keyword" className="space-y-2">
          <span className="block">{t("files.keyword")}</span>
          <Input
            id="file-keyword"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
        </label>
        <Button type="submit">{t("files.search")}</Button>
        {writable && (
          <>
            <Button
              type="button"
              disabled={
                pending ||
                !selected ||
                (incoming !== null &&
                  !selected.extensions.includes(
                    incoming.file.fileName
                      .slice(incoming.file.fileName.lastIndexOf(".") + 1)
                      .toLowerCase(),
                  ))
              }
              onClick={onAdd}
            >
              {t("files.add")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={pending}
              onClick={onReclaim}
            >
              {t("files.reclaim")}
            </Button>
          </>
        )}
      </form>
      {incoming && (
        <div
          role="status"
          className="flex flex-wrap items-center gap-2 rounded-md border border-border p-3"
        >
          <span>
            {t("fileIngress.selected", { name: incoming.file.fileName })}
          </span>
          <Button variant="ghost" disabled={pending} onClick={incoming.clear}>
            {t("fileIngress.dismiss")}
          </Button>
        </div>
      )}
      {writable && !selected && (
        <p className="text-sm text-muted-foreground">
          {t("files.choosePurpose")}
        </p>
      )}
    </>
  );
}
