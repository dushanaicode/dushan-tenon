// showcase-example
import { useTranslation } from "react-i18next";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/kit";

export function BreadcrumbExample() {
  const { t } = useTranslation();
  return (
    <Breadcrumb aria-label={t("showcase.navigation.breadcrumb")}>
      <BreadcrumbList>
        <BreadcrumbItem>
          <span>{t("showcase.navigation.library")}</span>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbPage>{t("showcase.navigation.drafts")}</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  );
}
