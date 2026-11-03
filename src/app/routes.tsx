import { useTranslation } from "react-i18next";
import { Route, Routes } from "react-router";
import type { SectionDirectory } from "@/core/contracts/settings";
import { moduleRoutes } from "@/core/module-directory";
import { PageHeader } from "@/kit";
import { ModuleGate } from "./module-gate";
import { manifests } from "./module-registry";
import { NotFound } from "./not-found";
import { Settings } from "./settings";

function Home() {
  const { t } = useTranslation();
  return (
    <section className="mx-auto flex w-full max-w-3xl flex-col gap-5 py-20">
      <p className="text-sm font-medium tracking-widest text-primary">
        {t("home.eyebrow")}
      </p>
      <PageHeader title={t("app.name")} />
      <p className="max-w-xl text-base leading-8 text-muted-foreground">
        {t("home.description")}
      </p>
    </section>
  );
}

export function AppRoutes({ directory }: { directory: SectionDirectory }) {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route
        path="/settings/:section?"
        caseSensitive
        element={<Settings directory={directory} />}
      />
      {manifests.flatMap((manifest) =>
        moduleRoutes(manifest).map((route) => (
          <Route
            key={route.path}
            path={route.path}
            caseSensitive
            element={<ModuleGate moduleId={manifest.id} route={route} />}
          />
        )),
      )}
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
