import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { useAppSettings } from "@/core/app-settings";
import { useAuthStatus } from "@/core/auth";
import type { ModuleRoute } from "@/core/contracts/module";
import { useEnabledModules } from "@/core/enabled-modules";
import { IpcErrorMessage } from "@/core/ipc-error";
import { LazyContent, LoadingContent } from "@/core/lazy-content";
import { evaluateVisibility } from "@/core/visibility";
import { Button, ButtonFace, PageHeader } from "@/kit";
import { NotFound } from "./not-found";

export function ModuleGate({
  moduleId,
  route,
}: {
  moduleId: string;
  route: ModuleRoute;
}) {
  const modules = useEnabledModules();
  const auth = useAuthStatus();
  const settings = useAppSettings();
  if (modules.isPending) return <LoadingContent />;
  if (modules.error) return <IpcErrorMessage error={modules.error} />;
  if (!modules.enabled?.has(moduleId)) return <NotFound />;
  if (auth.isPending) return <LoadingContent />;
  if (auth.isError) return <IpcErrorMessage error={auth.error} />;
  if (route.developerOnly) {
    if (settings.isPending) return <LoadingContent />;
    if (settings.isError) return <IpcErrorMessage error={settings.error} />;
  }
  const visibility = evaluateVisibility(route, {
    authenticated: auth.data.state === "active",
    developerMode: settings.data?.developerMode.value === true,
    mode: auth.data.mode,
    permissions: auth.data.permissions,
  });
  if (visibility === "notFound") return <NotFound />;
  if (visibility === "forbidden") return <Forbidden />;
  return <LazyContent factory={route.Component} />;
}

function Forbidden() {
  const { t } = useTranslation();
  return (
    <section className="mx-auto flex max-w-3xl flex-col items-start gap-5 py-20">
      <p className="text-sm font-medium text-primary">403</p>
      <PageHeader title={t("forbidden.title")} />
      <p className="text-muted-foreground">{t("forbidden.description")}</p>
      <Button asChild>
        <Link to="/">
          <ButtonFace>{t("notFound.home")}</ButtonFace>
        </Link>
      </Button>
    </section>
  );
}
