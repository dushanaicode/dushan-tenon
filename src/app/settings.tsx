import { useTranslation } from "react-i18next";
import { Navigate, useParams } from "react-router";
import type { SectionDirectory } from "@/core/contracts/settings";
import { IpcErrorMessage } from "@/core/ipc-error";
import { LazyContent, LoadingContent } from "@/core/lazy-content";
import { ParamForm } from "@/core/settings/param-form";
import { SettingsActionBar } from "@/core/settings/settings-action-bar";
import { PageHeader } from "@/kit";
import { SectionNavigation } from "./settings/section-navigation";

export function Settings({ directory }: { directory: SectionDirectory }) {
  const { t } = useTranslation();
  const { section: id } = useParams();
  if (directory.status === "pending") return <LoadingContent />;
  if (directory.status === "error")
    return <IpcErrorMessage error={directory.error} />;
  const { table } = directory;
  if (id === undefined) {
    const first = table.visible[0];
    return first ? (
      <Navigate to={first.path} replace />
    ) : (
      <Unavailable forbidden />
    );
  }
  const section = table.visible.find((item) => item.id === id);
  if (!section)
    return <Unavailable forbidden={table.access.get(id) === "forbidden"} />;
  return (
    <section className="@container/content mx-auto w-full space-y-4 py-6">
      <PageHeader title={t("nav.settings")} />
      <div className="flex flex-col gap-stack @medium/content:flex-row">
        <SectionNavigation sections={table.visible} selected={section} />
        <div className="min-w-0 max-w-4xl flex-1">
          <section
            id={`settings-content-${id}`}
            aria-label={`${t("nav.settings")} · ${t(section.labelKey)}`}
            className="pb-6"
          >
            {section.kind === "component" ? (
              <LazyContent key={id} factory={section.Component} />
            ) : (
              <ParamForm
                key={id}
                includeDisabled={false}
                group={section.group}
              />
            )}
          </section>
          <SettingsActionBar />
        </div>
      </div>
    </section>
  );
}

function Unavailable({ forbidden }: { forbidden: boolean }) {
  const { t } = useTranslation();
  return (
    <section className="space-y-4 py-6">
      <p>{forbidden ? "403" : "404"}</p>
      <PageHeader title={t(forbidden ? "forbidden.title" : "notFound.title")} />
      <p>{t(forbidden ? "forbidden.description" : "notFound.description")}</p>
    </section>
  );
}
