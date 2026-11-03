import { useTranslation } from "react-i18next";
import { Link } from "react-router";

export function BrandLogo() {
  const { t } = useTranslation();
  return (
    <Link
      to="/"
      aria-label={t("app.name")}
      className="flex min-w-0 items-center gap-3 rounded-md focus-visible:outline-2 focus-visible:outline-ring"
    >
      <img src="/brand/logo.svg" alt="" width={32} height={32} />
      <span className="truncate font-semibold">{t("app.name")}</span>
    </Link>
  );
}
