import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router";
import { Button, ButtonFace, PageHeader } from "@/kit";

export function NotFound() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  return (
    <section className="mx-auto flex max-w-3xl flex-col items-start gap-5 py-20">
      <p className="text-sm font-medium text-primary">404</p>
      <PageHeader title={t("notFound.title")} />
      <p className="break-all text-muted-foreground">
        {t("notFound.description", { path: pathname })}
      </p>
      <Button asChild>
        <Link to="/">
          <ButtonFace>{t("notFound.home")}</ButtonFace>
        </Link>
      </Button>
    </section>
  );
}
