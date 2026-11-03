import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { useCanOpen } from "@/core/enabled-modules";
import { Card, CardContent, PageHeader } from "@/kit";
import { DemoIndexPage } from "../../index-page";
import { useRecordRecentPage } from "../../navigation";
import pages from "../pages.json";
import { useRecentPages } from "../recent-pages";

const sections = [
  ["start", "demo.showcase.start"],
  ["navigation", "demo.showcase.navigation"],
  ["controls", "demo.showcase.controls"],
  ["overlays", "demo.showcase.overlays"],
  ["data", "demo.showcase.data"],
  ["templates", "demo.showcase.templates"],
  ["samples", "demo.showcase.samples"],
  ["appearance", "demo.showcase.appearance"],
] as const;
const orderedPages = [...pages].sort((a, b) => a.order - b.order);
const pageById = Object.fromEntries(pages.map((page) => [page.id, page]));

function PageCard({ page }: { page: (typeof pages)[number] }) {
  const { t } = useTranslation();
  const canOpen = useCanOpen(page.path);
  if (!canOpen) return null;
  return (
    <Card className="min-w-0" data-showcase-card={page.id}>
      <CardContent className="flex h-full min-w-0 flex-col items-start gap-3">
        <h3 className="break-words font-semibold">
          <Link
            className="text-brand underline-offset-4 hover:underline"
            to={page.path}
          >
            {t(`showcase.${page.id}.title`)}
          </Link>
        </h3>
        <p className="text-sm text-muted-foreground">
          {t(`showcase.${page.id}.scene`)}
        </p>
      </CardContent>
    </Card>
  );
}

function RecentPage({ id }: { id: string }) {
  const { t } = useTranslation();
  const page = pageById[id];
  const canOpen = useCanOpen(page.path);
  return canOpen ? (
    <li>
      <Link
        className="text-brand underline-offset-4 hover:underline"
        to={page.path}
      >
        {t(`showcase.${id}.title`)}
      </Link>
    </li>
  ) : null;
}

export function OverviewPage() {
  useRecordRecentPage();
  const { t } = useTranslation();
  const recent = useRecentPages();
  return (
    <div className="@container flex min-w-0 flex-col gap-6 pb-8">
      <PageHeader
        title={t("demo.showcase.title")}
        description={t("showcase.overview.introduction")}
      />

      <section
        aria-label={t("showcase.overview.directory")}
        className="space-y-6"
      >
        {sections.map(([id, labelKey]) => (
          <section
            key={id}
            aria-labelledby={`showcase-section-${id}`}
            className="space-y-3"
          >
            <h2 id={`showcase-section-${id}`} className="text-lg font-semibold">
              {t(labelKey)}
            </h2>
            <div className="grid min-w-0 gap-4 @2xl:grid-cols-2 @5xl:grid-cols-3">
              {orderedPages
                .filter((page) => page.section === id)
                .map((page) => (
                  <PageCard key={page.id} page={page} />
                ))}
              <p className="hidden text-sm text-muted-foreground only:block">
                {t("showcase.overview.emptySection")}
              </p>
            </div>
          </section>
        ))}
      </section>
      <section
        aria-labelledby="showcase-recent"
        className="space-y-3 rounded-lg border bg-card p-panel"
      >
        <h2 id="showcase-recent" className="text-lg font-semibold">
          {t("showcase.overview.recent")}
        </h2>
        <p className="text-sm text-muted-foreground">
          {t("showcase.overview.recentHint")}
        </p>
        <ol className="flex flex-wrap gap-4 text-sm">
          {recent.map((id) => (
            <RecentPage key={id} id={id} />
          ))}
          <li className="hidden text-muted-foreground only:block">
            {t("showcase.overview.emptyRecent")}
          </li>
        </ol>
      </section>
      <section
        aria-labelledby="showcase-business"
        className="min-w-0 space-y-3"
      >
        <h2 id="showcase-business" className="text-lg font-semibold">
          {t("showcase.overview.business")}
        </h2>
        <DemoIndexPage />
      </section>
    </div>
  );
}
