import { useTranslation } from "react-i18next";

export type CatalogEntry = {
  id: string;
  titleKey: string;
  kind: string;
  importPath: string;
  exampleFile: string;
  page: string;
  variants: string[];
  whenToUseKey: string;
  notForKey: string;
  related: string[];
  rule: string;
};

export function SelectionHint({
  entries,
}: {
  entries: readonly CatalogEntry[];
}) {
  const { t } = useTranslation();
  return (
    <section data-showcase-block="selection" className="@container space-y-3">
      <h2 className="text-lg font-semibold">
        {t("showcase.common.selection")}
      </h2>
      {entries.map((entry) => (
        <article
          key={entry.id}
          className="space-y-3 rounded-lg border bg-card p-4"
        >
          <h3 className="font-semibold">{t(entry.titleKey)}</h3>
          <div className="grid gap-4 @2xl:grid-cols-2">
            <div>
              <h4 className="mb-1 text-sm font-medium">
                {t("showcase.common.useFor")}
              </h4>
              <p className="text-sm text-muted-foreground">
                {t(entry.whenToUseKey)}
              </p>
            </div>
            <div>
              <h4 className="mb-1 text-sm font-medium">
                {t("showcase.common.notFor")}
              </h4>
              <p className="text-sm text-muted-foreground">
                {t(entry.notForKey)}
              </p>
            </div>
          </div>
        </article>
      ))}
    </section>
  );
}
