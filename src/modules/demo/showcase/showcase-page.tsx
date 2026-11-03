import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { useCanOpen } from "@/core/enabled-modules";
import { PageHeader, PageHeadingLevelProvider } from "@/kit";
import { useRecordRecentPage } from "../navigation";
import { AiQuickCard } from "./ai-quick-card";
import pages from "./pages.json";
import { type CatalogEntry, SelectionHint } from "./selection-hint";
import { StateMatrix } from "./state-matrix";
import { type UsageExample, UsagePanel } from "./usage-panel";

const pageById = Object.fromEntries(pages.map((page) => [page.id, page]));

function RelatedPage({ id }: { id: string }) {
  const { t } = useTranslation();
  const page = pageById[id];
  const canOpen = useCanOpen(page.path);
  return canOpen ? (
    <Link
      to={page.path}
      className="text-sm text-brand underline-offset-4 hover:underline"
    >
      {t(`showcase.${page.id}.title`)}
    </Link>
  ) : null;
}

export function ShowcasePage({
  id,
  preview,
  matrix,
  entries,
  examples,
}: {
  id: string;
  preview: ReactNode;
  matrix: ReactNode;
  entries: readonly CatalogEntry[];
  examples: readonly UsageExample[];
}) {
  const { t } = useTranslation();
  useRecordRecentPage();
  return (
    <div className="@container mx-auto flex w-full min-w-0 max-w-6xl flex-col gap-6 pb-8">
      <div data-showcase-block="header" className="space-y-3 rounded-lg p-4">
        <PageHeader
          title={t(`showcase.${id}.title`)}
          description={t(`showcase.${id}.scene`)}
        />
        <nav
          aria-label={t("showcase.common.related")}
          className="flex flex-wrap items-center gap-3"
        >
          {pageById[id].related.map((related) => (
            <RelatedPage key={related} id={related} />
          ))}
        </nav>
      </div>
      <section
        data-showcase-block="preview"
        className="min-w-0 space-y-5 rounded-lg border bg-card p-4"
      >
        <h2 className="text-lg font-semibold">
          {t("showcase.common.preview")}
        </h2>
        <PageHeadingLevelProvider level={3}>{preview}</PageHeadingLevelProvider>
        <p className="text-sm text-muted-foreground">
          {t("showcase.common.localOnly")}
        </p>
      </section>
      <StateMatrix>
        <PageHeadingLevelProvider level={3}>{matrix}</PageHeadingLevelProvider>
      </StateMatrix>
      {import.meta.env.DEV && <UsagePanel examples={examples} />}
      <SelectionHint entries={entries} />
      <AiQuickCard entries={entries} />
    </div>
  );
}
