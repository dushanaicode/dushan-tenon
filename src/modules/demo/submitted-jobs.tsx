import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { useEnabledModules } from "@/core/enabled-modules";
import { submittedJobsQuery } from "./queries";

export function DemoJobs({ userId }: { userId: string }) {
  const { t } = useTranslation();
  const { enabled } = useEnabledModules();
  const jobs = useQuery(submittedJobsQuery(userId));
  return (
    <section
      aria-label={t("demo.sessionJobs")}
      className="flex flex-col gap-2 text-body"
    >
      <h2 className="font-semibold">{t("demo.sessionJobs")}</h2>
      <p className="text-muted-foreground">{t("demo.sessionJobsHint")}</p>
      {jobs.data.map((id) => (
        <Link
          key={id}
          className="break-all text-brand underline"
          to={`/demo/jobs/${id}`}
        >
          {id}
        </Link>
      ))}
      {enabled && !enabled.has("notify") && (
        <p>{t("demo.notificationDisabled")}</p>
      )}
    </section>
  );
}
