import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardFooter, CardHeader } from "@/kit";

export function AuthLayout({
  title,
  description,
  actions,
  children,
}: {
  title?: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <Card className="w-full min-w-0 max-w-sm">
      <CardHeader className="flex flex-col items-center gap-stack text-center">
        <img src="/brand/logo.svg" alt="" width={48} height={48} />
        <p className="text-body font-semibold">{t("app.name")}</p>
        {title && <h1 className="text-2xl font-semibold">{title}</h1>}
        {description && (
          <p className="text-sm text-muted-foreground">{description}</p>
        )}
      </CardHeader>
      <CardContent className="flex min-w-0 flex-col gap-stack">
        {children}
      </CardContent>
      {actions && (
        <CardFooter className="flex-col gap-stack text-center">
          {actions}
        </CardFooter>
      )}
    </Card>
  );
}
