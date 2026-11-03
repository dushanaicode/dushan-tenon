import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { usePermission } from "@/core/auth";
import { Button, ButtonFace } from "@/kit";
import type { PermissionKey } from "@/lib/generated/permissions";

export function RequirePermission({
  permission,
  children,
}: {
  permission: PermissionKey;
  children: ReactNode;
}) {
  const allowed = usePermission(permission);
  const { t } = useTranslation();
  if (allowed) return children;
  return (
    <section className="mx-auto flex max-w-3xl flex-col items-start gap-5 py-20">
      <p className="text-sm font-medium text-primary">403</p>
      <h1 className="text-3xl font-semibold">{t("forbidden.title")}</h1>
      <p className="text-muted-foreground">{t("forbidden.description")}</p>
      <Button asChild>
        <Link to="/">
          <ButtonFace>{t("notFound.home")}</ButtonFace>
        </Link>
      </Button>
    </section>
  );
}
