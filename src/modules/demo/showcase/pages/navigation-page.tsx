import { useTranslation } from "react-i18next";
import catalog from "../catalog/navigation.json";
import { BreadcrumbExample } from "../examples/breadcrumb";
import { NavigationTreeExample } from "../examples/navigation-tree";
import { PaginationExample } from "../examples/pagination";
import { StepperExample } from "../examples/stepper";
import { TabsExample } from "../examples/tabs";
import { ShowcasePage } from "../showcase-page";

export const navigationExamples = [
  {
    file: catalog[0].exampleFile,
    load: import.meta.env.DEV
      ? () => import("../examples/navigation-tree.tsx?raw")
      : undefined,
  },
  {
    file: catalog[1].exampleFile,
    load: import.meta.env.DEV
      ? () => import("../examples/breadcrumb.tsx?raw")
      : undefined,
  },
  {
    file: catalog[2].exampleFile,
    load: import.meta.env.DEV
      ? () => import("../examples/tabs.tsx?raw")
      : undefined,
  },
  {
    file: catalog[3].exampleFile,
    load: import.meta.env.DEV
      ? () => import("../examples/pagination.tsx?raw")
      : undefined,
  },
  {
    file: catalog[4].exampleFile,
    load: import.meta.env.DEV
      ? () => import("../examples/stepper.tsx?raw")
      : undefined,
  },
];

export function NavigationPage() {
  const { t } = useTranslation();
  return (
    <ShowcasePage
      id="navigation"
      entries={catalog}
      examples={navigationExamples}
      matrix={<p>{t("showcase.navigation.statusNote")}</p>}
      preview={
        <div className="space-y-6">
          <NavigationTreeExample />
          <div className="grid min-w-0 gap-6 @3xl:grid-cols-2">
            <section className="space-y-3">
              <h3 className="font-semibold">
                {t("showcase.navigation.breadcrumb")}
              </h3>
              <BreadcrumbExample />
            </section>
            <section className="space-y-3">
              <h3 className="font-semibold">{t("showcase.navigation.tabs")}</h3>
              <TabsExample />
            </section>
            <section className="space-y-3">
              <h3 className="font-semibold">
                {t("showcase.navigation.pagination")}
              </h3>
              <PaginationExample />
            </section>
            <section className="space-y-3">
              <h3 className="font-semibold">
                {t("showcase.navigation.stepper")}
              </h3>
              <StepperExample />
            </section>
          </div>
        </div>
      }
    />
  );
}
