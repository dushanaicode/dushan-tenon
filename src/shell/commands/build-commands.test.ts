import { expect, it, vi } from "vitest";
import { testManifest } from "@/core/module-directory.test-support";
import { buildCommands } from "./build-commands";
import type { ShellCommand } from "./types";

const action: ShellCommand = {
  id: "test",
  label: "执行",
  group: "actions",
  keywords: [],
  run: vi.fn(),
};
const empty: Parameters<typeof buildCommands>[0] = {
  tree: { groups: [], footer: [] },
  sections: [],
  manifests: [],
  builtin: [],
  permissions: [],
  navigate: vi.fn(),
  t: (key) => key,
};
it("按树、footer、设置、模块与内置顺序合成，叶子包含父项和连续分类关键词", () => {
  const navigate = vi.fn();
  const result = buildCommands({
    ...empty,
    navigate,
    tree: {
      groups: [
        {
          id: "group",
          label: "分组",
          items: [
            {
              kind: "parent",
              id: "parent",
              label: "父项",
              iconId: "home",
              children: [
                {
                  kind: "leaf",
                  id: "first",
                  path: "/first",
                  label: "一",
                  iconId: "home",
                  sectionLabel: "分类",
                  shortcut: "$mod+l",
                },
                {
                  kind: "leaf",
                  id: "second",
                  path: "/second",
                  label: "二",
                  iconId: "files",
                },
              ],
            },
          ],
        },
      ],
      footer: [
        {
          kind: "leaf",
          id: "settings",
          path: "/settings",
          label: "设置",
          iconId: "settings",
        },
      ],
    },
    manifests: [
      testManifest({
        commands: [
          {
            id: "module",
            label: "模块",
            run: ({ navigate }) => navigate("/module"),
          },
          {
            id: "secret",
            label: "受限",
            permission: "devtools.job.read",
            run: vi.fn(),
          },
        ],
      }),
    ],
    builtin: [action],
  });
  expect(result.map(({ id }) => id)).toEqual([
    "nav:first",
    "nav:second",
    "nav:settings",
    "module",
    "test",
  ]);
  expect(result[1].keywords).toEqual(["分组", "父项", "分类"]);
  expect(result[0].shortcut).toBe("$mod+l");
  result[1].run();
  result[3].run();
  expect(navigate.mock.calls).toEqual([["/second"], ["/module"]]);
});
it.each(["test", "TEST"])("ID %s 忽略大小写查重", (id) => {
  expect(() =>
    buildCommands({ ...empty, builtin: [action, { ...action, id }] }),
  ).toThrow("Duplicate command id");
});
it("快捷键忽略大小写查重", () => {
  expect(() =>
    buildCommands({
      ...empty,
      builtin: [
        { ...action, shortcut: "$mod+Shift+F" },
        { ...action, id: "other", shortcut: "$MOD+shift+f" },
      ],
    }),
  ).toThrow("Duplicate shortcut");
});
it("空贡献得到空目录", () => expect(buildCommands(empty)).toEqual([]));
