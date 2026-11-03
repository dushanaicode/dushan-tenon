import { expect, it } from "vitest";
import { testManifest } from "@/core/module-directory.test-support";
import { buildNavTree, findActiveItem, navLeaves } from "./nav-tree";

const auth = {
  authenticated: true,
  developerMode: true,
  mode: "none" as const,
  permissions: ["devtools.job.read"],
};
const Component = async () => ({ default: () => null });
const modules = [
  testManifest({
    nav: [
      {
        kind: "parent",
        id: "jobs",
        label: "任务",
        iconId: "jobs",
        children: [
          {
            kind: "leaf",
            id: "read",
            path: "/jobs",
            label: "读取",
            iconId: "jobs",
            permission: "devtools.job.read",
            shortcut: "$mod+j",
            badge: { kind: "count", value: 2 },
          },
        ],
      },
    ],
    devNavParents: [
      { id: "tools", labelKey: "工具", iconId: "modules", order: 1 },
    ],
    devPages: [
      {
        path: "/devtools/detail",
        Component,
        nav: {
          id: "detail",
          labelKey: "详情",
          iconId: "jobs",
          parentId: "tools",
          order: 1,
        },
      },
    ],
  }),
];
it("最多两级，父项无路径；保留徽标、快捷键与独立 footer", () => {
  const tree = buildNavTree(modules, new Set(["devtools"]), auth);
  expect(tree.groups[0].items[1]).toMatchObject({
    kind: "parent",
    children: [{ shortcut: "$mod+j", badge: { kind: "count", value: 2 } }],
  });
  expect(tree.groups[0].items[1].path).toBeUndefined();
  expect(tree.footer.map(({ id }) => id)).toEqual(["settings"]);
});
it.each([
  { ...auth, permissions: [] },
  { ...auth, authenticated: false },
])("过滤权限叶子并移除空父项", (visibility) => {
  expect(
    buildNavTree(
      modules,
      new Set(["devtools"]),
      visibility,
    ).groups[0].items.map(({ id }) => id),
  ).toEqual(["home"]);
});
it("模块未就绪、停用和开发者门控不泄露导航", () => {
  for (const enabled of [undefined, new Set<string>()])
    expect(
      navLeaves(buildNavTree(modules, enabled, auth)).map(
        ({ item }) => item.id,
      ),
    ).toEqual(["home", "settings"]);
  expect(
    buildNavTree(modules, new Set(["devtools"]), {
      ...auth,
      developerMode: false,
    }).groups,
  ).toHaveLength(1);
});
it("活动页采用最长完整路径前缀，保留父项", () => {
  const tree = buildNavTree(modules, new Set(["devtools"]), auth);
  expect(findActiveItem(tree, "/jobs/123")?.parent?.id).toBe("jobs");
  expect(findActiveItem(tree, "/jobs-extra")).toBeUndefined();
  expect(findActiveItem(tree, "/")?.item.id).toBe("home");
});
