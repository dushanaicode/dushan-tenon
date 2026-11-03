import { expect, test } from "vitest";
import { i18n } from "@/core/i18n";
import "@/core/core.test-support";
import pages from "./pages.json";
import rules from "./rules.json";
import type { CatalogEntry } from "./selection-hint";

const entries = Object.values(
  import.meta.glob<{ default: CatalogEntry[] }>("./catalog/*.json", {
    eager: true,
  }),
).flatMap((module) => module.default);
test.each(["zh-CN", "en-US"])(
  "declarative pages, catalog and rules resolve in %s",
  async (language) => {
    await i18n.changeLanguage(language);
    const keys = [
      ...pages.flatMap((page) => [
        `showcase.${page.id}.title`,
        `showcase.${page.id}.scene`,
      ]),
      ...entries.flatMap((entry) => [
        entry.titleKey,
        entry.whenToUseKey,
        entry.notForKey,
      ]),
      ...rules.map((rule) => rule.textKey),
    ];
    for (const key of keys) {
      expect(i18n.exists(key), key).toBe(true);
      expect(i18n.t(key).trim(), key).not.toBe("");
    }
  },
);
