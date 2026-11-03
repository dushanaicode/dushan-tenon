import { useTranslation } from "react-i18next";
import rules from "./rules.json";
import type { CatalogEntry } from "./selection-hint";

const ruleKeys = Object.fromEntries(
  rules.map((rule) => [rule.id, rule.textKey]),
);

export function AiQuickCard({ entries }: { entries: readonly CatalogEntry[] }) {
  const { t } = useTranslation();
  return (
    <section
      data-showcase-block="rules"
      className="space-y-4 rounded-lg border bg-card p-4"
    >
      <h2 className="text-lg font-semibold">{t("showcase.common.ai")}</h2>
      {entries.map((entry) => (
        <dl
          key={entry.id}
          id={entry.id}
          className="grid min-w-0 gap-2 text-sm @2xl:grid-cols-[8rem_minmax(0,1fr)]"
        >
          <dt className="text-muted-foreground">
            {t("showcase.common.component")}
          </dt>
          <dd>{t(entry.titleKey)}</dd>
          <dt className="text-muted-foreground">
            {t("showcase.common.import")}
          </dt>
          <dd>
            <code>{entry.importPath}</code>
          </dd>
          <dt className="text-muted-foreground">
            {t("showcase.common.example")}
          </dt>
          <dd className="break-all">
            <code>{entry.exampleFile}</code>
          </dd>
          <dt className="text-muted-foreground">
            {t("showcase.common.catalogId")}
          </dt>
          <dd>
            <code>{entry.id}</code>
          </dd>
          <dt className="text-muted-foreground">{t("showcase.common.rule")}</dt>
          <dd>
            {entry.rule} · {t(ruleKeys[entry.rule])}
          </dd>
        </dl>
      ))}
      <details>
        <summary className="cursor-pointer text-sm font-medium">
          {t("showcase.common.allRules")}
        </summary>
        <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
          {rules.map((rule) => (
            <li key={rule.id}>
              {rule.id} · {t(rule.textKey)}
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
