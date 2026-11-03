import { expect, test } from "vitest";
import type { ModuleSetting } from "@/core/contracts/module";
import { activeAuth, paramEntries } from "@/core/core.test-support";
import { testManifest } from "@/core/module-directory.test-support";
import type { VisibilityAuth } from "@/core/visibility";
import { buildCommands } from "@/shell/commands";
import { buildSections } from "./sections";

const auth: VisibilityAuth = {
  authenticated: true,
  developerMode: false,
  mode: "none",
  permissions: activeAuth.permissions,
};
const setting: ModuleSetting = {
  id: "notify",
  labelKey: "notify.settings.title",
  order: 30,
  Component: async () => ({ default: () => null }),
  paramGroups: ["notify.preferences"],
};
const manifest = testManifest({ id: "notify", settings: [setting] });
const input = {
  manifests: [manifest],
  enabled: new Set(["account", "notify", "demo"]),
  auth,
  params: paramEntries,
};

test("内置、模块和未认领参数组按 order 与 id 合并，输入顺序不影响目录", () => {
  const table = buildSections(input);
  expect(table.visible.map((section) => section.id)).toEqual([
    "general",
    "appearance",
    "notify",
    "network",
    "param.account.security",
    "param.demo.work",
    "data",
    "advanced",
    "about",
  ]);
  expect(table.access.has("param.notify.preferences")).toBe(false);
  const extension = testManifest({
    settings: ["a.z", "a-z"].map((id) => ({
      ...setting,
      id,
      paramGroups: [],
      order: 75,
    })),
  });
  const options = { ...input, manifests: [manifest, extension] };
  const result = buildSections(options);
  expect(
    buildSections({
      ...options,
      manifests: [...options.manifests].reverse(),
      params: [...paramEntries].reverse(),
    }),
  ).toEqual(result);
  expect(
    result.all
      .filter((section) => section.order === 75)
      .map((section) => section.id),
  ).toEqual(["a-z", "a.z"]);
});

test.each(["general", "param.account.security", "duplicate"])(
  "全局分节 id 不允许重复：%s",
  (id) => {
    const duplicate = testManifest({
      settings: [
        { ...setting, id, paramGroups: [] },
        ...(id === "duplicate" ? [{ ...setting, id, paramGroups: [] }] : []),
      ],
    });
    expect(() => buildSections({ ...input, manifests: [duplicate] })).toThrow(
      `Duplicate setting section id: ${id}`,
    );
  },
);

test.each([
  [["missing.group"], "Unknown parameter group"],
  [["account.security"], "another module"],
  [["notify.preferences", "notify.preferences"], "already claimed"],
] as const)(
  "参数组必须已知、归属本模块且仅认领一次：%s",
  (paramGroups, message) => {
    expect(() =>
      buildSections({
        ...input,
        manifests: [{ ...manifest, settings: [{ ...setting, paramGroups }] }],
      }),
    ).toThrow(message);
  },
);

test("跨分节重复认领与返回的错误组归属均拒绝", () => {
  expect(() =>
    buildSections({
      ...input,
      manifests: [
        { ...manifest, settings: [setting, { ...setting, id: "other" }] },
      ],
    }),
  ).toThrow("already claimed");
  expect(() =>
    buildSections({
      ...input,
      params: [{ ...paramEntries[0], group: "missing.group" }],
    }),
  ).toThrow("Unknown parameter group");
  expect(() =>
    buildSections({
      ...input,
      params: [{ ...paramEntries[0], moduleId: "notify" }],
    }),
  ).toThrow("another module");
});

test("禁用和开发者隐藏返回 notFound，缺权限与不可读参数返回 forbidden", () => {
  expect(
    buildSections({ ...input, enabled: new Set(["account"]) }).access.get(
      "notify",
    ),
  ).toBe("notFound");
  const secured = {
    ...manifest,
    settings: [
      {
        ...setting,
        permission: "demo.settings.manage" as const,
        paramGroups: [],
      },
    ],
  };
  expect(
    buildSections({
      ...input,
      manifests: [secured],
      auth: { ...auth, permissions: [] },
    }).access.get("notify"),
  ).toBe("forbidden");
  expect(buildSections({ ...input, params: [] }).access.get("notify")).toBe(
    "forbidden",
  );
  expect(
    buildSections({
      ...input,
      manifests: [
        { ...manifest, settings: [{ ...setting, developerOnly: true }] },
      ],
      params: [],
    }).access.get("notify"),
  ).toBe("notFound");
  expect(
    buildSections({ ...input, auth: { ...auth, permissions: [] } }).access.get(
      "param.demo.work",
    ),
  ).toBe("forbidden");
});

test("设置导航和命令目录消费相同的可见结果", () => {
  const table = buildSections({
    ...input,
    enabled: new Set(["account"]),
    auth: { ...auth, permissions: [] },
  });
  const destinations: string[] = [];
  const commands = buildCommands({
    tree: { groups: [], footer: [] },
    sections: table.visible,
    manifests: [],
    builtin: [],
    t: (key) => key,
    permissions: [],
    navigate: (path) => {
      destinations.push(path);
    },
  });
  expect(commands.map((command) => command.label)).toEqual(
    table.visible.map((section) => section.labelKey),
  );
  for (const command of commands) command.run();
  expect(destinations).toEqual(table.visible.map((section) => section.path));
  expect(
    table.visible.every(
      (section) => table.access.get(section.id) === "visible",
    ),
  ).toBe(true);
});
