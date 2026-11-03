import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { useCanOpen } from "@/core/enabled-modules";
import {
  Badge,
  Button,
  DataTable,
  type DataTableColumn,
  Input,
  Label,
  PageHeader,
  Textarea,
  ToggleGroup,
  ToggleGroupItem,
} from "@/kit";
import { useRecordRecentPage } from "../../navigation";
import pages from "../pages.json";
import rules from "../rules.json";
import type { CatalogEntry } from "../selection-hint";

const entries = Object.values(
  import.meta.glob<{ default: CatalogEntry[] }>("../catalog/*.json", {
    eager: true,
  }),
).flatMap((module) => module.default);
const pageByPath = Object.fromEntries(pages.map((page) => [page.path, page]));
const ruleKeys = Object.fromEntries(
  rules.map((rule) => [rule.id, rule.textKey]),
);
const kindKeys: Record<string, string> = {
  component: "showcase.catalog.component",
  pattern: "showcase.catalog.pattern",
  template: "showcase.catalog.template",
};
const rowId = (entry: CatalogEntry) => entry.id;

function ExamplePageLink({ entry }: { entry: CatalogEntry }) {
  const { t } = useTranslation();
  const canOpen = useCanOpen(entry.page);
  return canOpen ? (
    <Link
      className="text-brand underline-offset-4 hover:underline"
      to={`${entry.page}#${entry.id}`}
    >
      {t("showcase.catalog.tryPage", {
        page: t(`showcase.${pageByPath[entry.page].id}.title`),
      })}
    </Link>
  ) : (
    <span className="text-muted-foreground">
      {t("showcase.catalog.unavailable")}
    </span>
  );
}

function ExampleFile({ file }: { file: string }) {
  const { t } = useTranslation();
  const [copy, setCopy] = useState<"idle" | "copied" | "failed">("idle");
  async function copyPath() {
    try {
      await navigator.clipboard.writeText(file);
      setCopy("copied");
    } catch {
      setCopy("failed");
    }
  }
  return (
    <div className="space-y-2">
      <code className="block break-all text-xs">{file}</code>
      <Button
        variant="outline"
        onClick={() => void copyPath()}
        aria-label={t("showcase.catalog.copyNamed", { file })}
      >
        {t("showcase.catalog.copy")}
      </Button>
      {copy === "copied" && <p role="status">{t("showcase.catalog.copied")}</p>}
      {copy === "failed" && (
        <>
          <p role="status">{t("showcase.catalog.copyFailed")}</p>
          <Textarea
            readOnly
            aria-label={t("showcase.catalog.pathText", { file })}
            value={file}
            onFocus={(event) => event.currentTarget.select()}
          />
        </>
      )}
    </div>
  );
}

export function CatalogPage() {
  useRecordRecentPage();
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [kinds, setKinds] = useState<string[]>([]);
  const columns = useMemo<DataTableColumn<CatalogEntry>[]>(
    () => [
      {
        id: "scene",
        header: t("showcase.catalog.sceneColumn"),
        rowHeader: true,
        className: "min-w-48 max-w-64 whitespace-normal break-words align-top",
        cell: (entry) => t(entry.titleKey),
      },
      {
        id: "solution",
        header: t("showcase.catalog.solution"),
        className: "min-w-48 max-w-56 whitespace-normal break-words align-top",
        cell: (entry) => (
          <div className="space-y-2">
            <Badge>{t(kindKeys[entry.kind])}</Badge>
            <code className="block break-all text-xs">{entry.importPath}</code>
            <code className="block break-all text-xs">{entry.id}</code>
          </div>
        ),
      },
      {
        id: "why",
        header: t("showcase.catalog.why"),
        className: "min-w-56 max-w-72 whitespace-normal break-words align-top",
        cell: (entry) => t(entry.whenToUseKey),
      },
      {
        id: "notFor",
        header: t("showcase.catalog.notFor"),
        className: "min-w-56 max-w-72 whitespace-normal break-words align-top",
        cell: (entry) => t(entry.notForKey),
      },
      {
        id: "page",
        header: t("showcase.catalog.page"),
        className: "min-w-40 max-w-48 whitespace-normal break-words align-top",
        cell: (entry) => <ExamplePageLink entry={entry} />,
      },
      {
        id: "file",
        header: t("showcase.common.example"),
        className: "min-w-64 max-w-72 whitespace-normal align-top",
        cell: (entry) => <ExampleFile file={entry.exampleFile} />,
      },
      {
        id: "rule",
        header: t("showcase.common.rule"),
        className: "min-w-64 max-w-80 whitespace-normal break-words align-top",
        cell: (entry) => (
          <p>
            <code>{entry.rule}</code> · {t(ruleKeys[entry.rule])}
          </p>
        ),
      },
    ],
    [t],
  );
  const needle = search.trim().toLocaleLowerCase();
  const rows = useMemo(
    () =>
      entries.filter(
        (entry) =>
          (kinds.length === 0 || kinds.includes(entry.kind)) &&
          [
            t(entry.titleKey),
            t(kindKeys[entry.kind]),
            entry.kind,
            entry.id,
            entry.importPath,
            t(entry.whenToUseKey),
            entry.rule,
            t(ruleKeys[entry.rule]),
          ].some((value) => value.toLocaleLowerCase().includes(needle)),
      ),
    [kinds, needle, t],
  );
  function clearFilters() {
    setSearch("");
    setKinds([]);
  }
  const empty = (
    <div className="space-y-3 whitespace-normal py-6">
      <p role="status">{t("showcase.catalog.empty")}</p>
      <Button variant="outline" onClick={clearFilters}>
        {t("showcase.catalog.clear")}
      </Button>
    </div>
  );
  return (
    <div className="flex min-w-0 flex-col gap-6 pb-8">
      <PageHeader
        title={t("showcase.catalog.title")}
        description={t("showcase.catalog.scene")}
      />

      <div className="flex min-w-0 flex-col gap-4">
        <div className="space-y-2">
          <Label htmlFor="showcase-catalog-search">
            {t("showcase.catalog.search")}
          </Label>
          <Input
            id="showcase-catalog-search"
            type="search"
            value={search}
            placeholder={t("showcase.catalog.placeholder")}
            onChange={(event) => setSearch(event.currentTarget.value)}
          />
        </div>
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            {t("showcase.catalog.filterHint")}
          </p>
          <ToggleGroup
            type="multiple"
            aria-label={t("showcase.catalog.filter")}
            value={kinds}
            onValueChange={setKinds}
          >
            {Object.entries(kindKeys).map(([kind, key]) => (
              <ToggleGroupItem key={kind} value={kind}>
                {t(key)}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
      </div>
      <p role="status" className="text-sm text-muted-foreground">
        {t("showcase.catalog.count", { count: rows.length })}
      </p>
      <DataTable
        caption={t("showcase.catalog.title")}
        columns={columns}
        rows={rows}
        getRowId={rowId}
        className="min-w-0"
        emptyView={empty}
      />
    </div>
  );
}
