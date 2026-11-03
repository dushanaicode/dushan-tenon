import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { usePermission } from "@/core/auth";
import { useCanOpen } from "@/core/enabled-modules";
import { Badge } from "@/kit";
import { useRecordRecentPage } from "../../navigation";
import pages from "../pages.json";

const guides = {
  samples: {
    description: "showcase.samples.guide",
    chips: [
      "showcase.samples.list",
      "showcase.samples.form",
      "showcase.samples.exchange",
      "showcase.samples.detail",
    ],
  },
  measure: {
    description: "showcase.measure.guide",
    chips: [
      "showcase.measure.wizard",
      "showcase.measure.progress",
      "showcase.measure.settings",
    ],
  },
};
const pageById = Object.fromEntries(pages.map((page) => [page.id, page]));
const steps = [
  "showcase.measure.select",
  "showcase.measure.start",
  "showcase.measure.watch",
  "showcase.measure.notify",
  "showcase.measure.configure",
];

function RelatedPage({ id }: { id: string }) {
  const { t } = useTranslation();
  const page = pageById[id];
  const canOpen = useCanOpen(page.path);
  return canOpen ? (
    <Link
      className="text-brand underline-offset-4 hover:underline"
      to={page.path}
    >
      {t(`showcase.${id}.title`)}
    </Link>
  ) : null;
}

function MeasureFlow() {
  const { t } = useTranslation();
  // The enclosing business route already requires an active identity, demo and developer mode.
  // Settings sections use their own permission contract, not useCanOpen's module-route lookup.
  const canManage = usePermission("demo.settings.manage");
  return (
    <div className="space-y-2">
      <h3 className="font-medium">{t("showcase.measure.flow")}</h3>
      <ol className="list-inside list-decimal space-y-1 text-sm text-muted-foreground">
        {steps.map((key) => (
          <li key={key}>{t(key)}</li>
        ))}
      </ol>
      {canManage && (
        <Link
          className="text-sm text-brand underline-offset-4 hover:underline"
          to="/settings/demo"
        >
          {t("showcase.measure.openSettings")}
        </Link>
      )}
    </div>
  );
}

export function ShowcaseGuide({ id }: { id: keyof typeof guides }) {
  const { t } = useTranslation();
  useRecordRecentPage();
  const guide = guides[id];
  return (
    <div className="min-w-0 shrink-0 space-y-4" data-showcase-guide={id}>
      <section
        aria-label={t("showcase.samples.guideTitle")}
        className="space-y-3 rounded-lg border bg-card p-panel"
      >
        <h2 className="font-semibold">{t("showcase.samples.guideTitle")}</h2>
        <p className="text-body">{t(`showcase.${id}.scene`)}</p>
        <p className="text-sm text-muted-foreground">{t(guide.description)}</p>
        <ul
          aria-label={t("showcase.samples.components")}
          className="flex flex-wrap gap-2"
        >
          {guide.chips.map((key) => (
            <li key={key}>
              <Badge className="whitespace-normal break-words">{t(key)}</Badge>
            </li>
          ))}
        </ul>
        {id === "measure" && <MeasureFlow />}
        <nav
          aria-label={t("showcase.common.related")}
          className="flex flex-wrap gap-3 text-sm"
        >
          {pageById[id].related.map((related) => (
            <RelatedPage key={related} id={related} />
          ))}
        </nav>
      </section>
    </div>
  );
}
