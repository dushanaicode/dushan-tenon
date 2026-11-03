import { useTranslation } from "react-i18next";
import { useAppearanceSnapshot } from "@/core/appearance-bridge";
import catalog from "../catalog/appearance.json";
import { ThemeTokensExample } from "../examples/theme-tokens";
import { ShowcasePage } from "../showcase-page";
import {
  ColorReadings,
  ContrastReadings,
  GeometryReadings,
} from "../standard-readings";

export const appearanceExamples = [
  {
    file: catalog[0].exampleFile,
    load: import.meta.env.DEV
      ? () => import("../examples/theme-tokens.tsx?raw")
      : undefined,
  },
];

export function AppearancePage() {
  const { t } = useTranslation();
  const appearance = useAppearanceSnapshot();
  return (
    <ShowcasePage
      id="appearance"
      entries={catalog}
      examples={appearanceExamples}
      matrix={<ContrastReadings />}
      preview={
        <>
          <p>
            {t("showcase.readings.currentMode", {
              mode: t(`settings.appearance.theme.${appearance.mode}`),
              resolved: t(
                `settings.appearance.theme.${appearance.dark ? "dark" : "light"}`,
              ),
            })}
          </p>
          <ThemeTokensExample />
          <ColorReadings />
          <GeometryReadings />
        </>
      }
    />
  );
}
