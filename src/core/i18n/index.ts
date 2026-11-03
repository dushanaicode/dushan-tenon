import { createInstance } from "i18next";
import { initReactI18next } from "react-i18next";
import enUS from "./en-US.json";
import zhCN from "./zh-CN.json";

export const i18n = createInstance();

await i18n.use(initReactI18next).init({
  resources: {
    "zh-CN": { translation: zhCN },
    "en-US": { translation: enUS },
  },
  lng: "zh-CN",
  supportedLngs: ["zh-CN", "en-US"],
  fallbackLng: false,
  keySeparator: false,
  interpolation: { escapeValue: false },
});
