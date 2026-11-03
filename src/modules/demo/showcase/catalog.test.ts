import { existsSync, readdirSync, readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { demoManifest } from "../manifest";
import pages from "./pages.json";
import rules from "./rules.json";
import type { CatalogEntry } from "./selection-hint";

const catalog: CatalogEntry[] = readdirSync(
  "src/modules/demo/showcase/catalog",
).flatMap((file) =>
  JSON.parse(readFileSync(`src/modules/demo/showcase/catalog/${file}`, "utf8")),
);

test("runtime page catalog and manifest describe the same navigation pages", () => {
  const routes = demoManifest.devPages.filter((page) => page.nav);
  expect(routes.map((route) => route.path).sort()).toEqual(
    pages.map((page) => page.path).sort(),
  );
  for (const page of pages) {
    expect(routes.find((route) => route.path === page.path)?.nav).toMatchObject(
      {
        id: `demo.${page.id}`,
        parentId: "demo.showcase",
        order: page.order,
        sectionLabelKey: `demo.showcase.${page.section}`,
      },
    );
    for (const related of page.related)
      expect(pages.some((candidate) => candidate.id === related)).toBe(true);
  }
  for (const entry of catalog) {
    expect(existsSync(entry.exampleFile), entry.exampleFile).toBe(true);
    expect(pages.some((page) => page.path === entry.page)).toBe(true);
    expect(rules.some((rule) => rule.id === entry.rule)).toBe(true);
    expect(entry.importPath).toBe("@/kit");
    for (const id of entry.related)
      expect(catalog.some((item) => item.id === id)).toBe(true);
  }
  expect(new Set(catalog.map((entry) => entry.id)).size).toBe(catalog.length);
  for (const page of pages.filter((page) => !page.noCatalog))
    expect(
      catalog.some((entry) => entry.page === page.path),
      page.path,
    ).toBe(true);
});
