import { expect, test } from "vitest";
import { canOpenPath } from "@/core/enabled-modules";
import { evaluateVisibility } from "@/core/visibility";
import { PERMISSION_KEYS } from "@/lib/generated/permissions";
import { demoManifest } from "./manifest";
import pages from "./showcase/pages.json";

const auth = {
  authenticated: true,
  developerMode: true,
  mode: "none" as const,
  permissions: PERMISSION_KEYS,
};

test("developer navigation follows the retained page order and every lazy page resolves", async () => {
  expect(demoManifest.devNavParents).toEqual([
    {
      id: "demo.showcase",
      labelKey: "demo.showcase.title",
      iconId: "modules",
      order: 60,
    },
  ]);
  const leaves = demoManifest.devPages.filter((page) => page.nav);
  expect(leaves.map((page) => page.path)).toEqual(
    pages.map((page) => page.path),
  );
  expect(leaves.map((page) => page.nav?.order)).toEqual(
    Array.from({ length: 17 }, (_, index) => (index + 1) * 10),
  );
  expect(demoManifest.devPages).toHaveLength(19);
  expect(demoManifest.headerWidgets).toEqual([]);
  for (const page of demoManifest.devPages) {
    expect(page.developerOnly).toBe(true);
    expect(evaluateVisibility(page, auth)).toBe("visible");
    expect(evaluateVisibility(page, { ...auth, developerMode: false })).toBe(
      "notFound",
    );
    expect(typeof (await page.Component()).default).toBe("function");
    const path = page.path.replace(
      ":id",
      "01999000-1234-7000-8000-123456789abd",
    );
    expect(canOpenPath([demoManifest], new Set(), auth, path)).toBe(false);
    expect(
      canOpenPath([demoManifest], new Set(["demo"]), undefined, path),
    ).toBe(false);
    expect(
      canOpenPath(
        [demoManifest],
        new Set(["demo"]),
        { ...auth, authenticated: false },
        path,
      ),
    ).toBe(false);
    expect(
      canOpenPath(
        [demoManifest],
        new Set(["demo"]),
        { ...auth, developerMode: false },
        path,
      ),
    ).toBe(false);
    expect(
      canOpenPath(
        [demoManifest],
        new Set(["demo"]),
        { ...auth, permissions: [] },
        path,
      ),
    ).toBe(page.permission === undefined);
  }
  expect(
    canOpenPath([demoManifest], new Set(["demo"]), auth, "/demo/conversation"),
  ).toBe(false);
  expect(
    canOpenPath([demoManifest], new Set(["demo"]), auth, "/styleguide"),
  ).toBe(false);
});

test("business routes, settings and file ingress retain their permission boundaries", () => {
  const find = (path: string) =>
    demoManifest.devPages.find((page) => page.path === path);
  for (const path of [
    "/demo",
    "/demo/samples",
    "/demo/samples/:id",
    "/demo/measure",
    "/demo/jobs/:id",
  ]) {
    const page = find(path);
    expect(page?.permission).toBe("demo.sample.read");
    expect(evaluateVisibility(page ?? {}, { ...auth, permissions: [] })).toBe(
      "forbidden",
    );
  }
  expect(find("/demo/measure")?.anyPermissions).toEqual(["demo.sample.run"]);
  expect(
    evaluateVisibility(find("/demo/measure") ?? {}, {
      ...auth,
      permissions: ["demo.sample.read"],
    }),
  ).toBe("forbidden");
  expect(find("/demo/conversation")).toBeUndefined();
  expect(find("/demo/samples/:id")?.nav).toBeUndefined();
  expect(find("/demo/jobs/:id")?.nav).toBeUndefined();
  expect(demoManifest.settings).toMatchObject([
    {
      id: "demo",
      labelKey: "demo.settings",
      order: 85,
      developerOnly: true,
      permission: "demo.settings.manage",
      paramGroups: ["demo.work"],
    },
  ]);
  expect(demoManifest.fileTargets).toEqual([
    {
      id: "demo.sample-import",
      labelKey: "demo.sampleList",
      path: "/demo/samples",
      purpose: "import",
      extensions: ["csv", "xlsx", "json"],
      developerOnly: true,
      permission: "demo.sample.write",
      anyPermissions: ["demo.sample.import"],
    },
  ]);
  expect(
    evaluateVisibility(demoManifest.fileTargets[0], {
      ...auth,
      permissions: ["demo.sample.write"],
    }),
  ).toBe("forbidden");
});
