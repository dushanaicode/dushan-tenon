import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { readAssemblyFiles, scanAssembly } from "./check-assembly.mjs";

const assemblyPath = "src/lib/generated/assembly.ts";
const indexPath = "src/app/module-registry.ts";
const manifestPath = "src/modules/addon/manifest.ts";
const builtinSectionsPath = "src/app/settings/builtin-sections.ts";
const builtinSectionsSource = `
export const builtinSections: readonly ModuleSetting[] = [
  { id: "general" },
  { id: "appearance" },
  { id: "network" },
  { id: "advanced" },
  { id: "data" },
  { id: "about" },
];
`;

test("partial demo removal is rejected by the real catalog", async () => {
  const files = await readAssemblyFiles(resolve("."));
  assert.deepEqual(scanAssembly(files), []);
  const missingFiles = new Map(
    [...files].filter(([path]) => !path.startsWith("src/modules/demo/")),
  );
  assert.ok(scanAssembly(missingFiles).some(({ rule }) => rule === "A1"));
  const missingRegistration = new Map(files);
  missingRegistration.set(
    indexPath,
    files.get(indexPath).replace("  demoManifest,\n", ""),
  );
  assert.ok(
    scanAssembly(missingRegistration).some(({ rule }) => rule === "A1"),
  );
});

test("real demo manifest participates in assembly validation", async () => {
  const files = await readAssemblyFiles(resolve("."));
  assert.deepEqual(scanAssembly(files), []);
  const demo = files.get("src/modules/demo/manifest.ts");
  assert.match(demo, /basePath: "\/demo"/);
  assert.match(demo, /paramGroups: \["demo.work"\]/);
  assert.match(demo, /developerOnly: true/);
});

async function fixture(t) {
  const temporary = resolve("Temp/test/check-assembly");
  await mkdir(temporary, { recursive: true });
  const parent = await realpath(temporary);
  assert.equal(parent, temporary);
  const directory = await realpath(
    await mkdtemp(join(parent, "assembly-test-")),
  );
  assert.equal(dirname(directory), parent);
  t.after(async () => {
    assert.equal(dirname(await realpath(directory)), parent);
    await rm(directory, { recursive: true });
  });
  const files = new Map([
    [builtinSectionsPath, builtinSectionsSource],
    [
      assemblyPath,
      `
export const MODULE_CATALOG = [
  { id: "account", core: true, dependencies: [] },
  { id: "addon", core: false, dependencies: ["account"] },
] as const;
export const PRESET_CATALOG = [
  { name: "sample", enabledModules: ["account", "addon"] },
];
`,
    ],
    [
      "src/lib/generated/permissions.ts",
      `
export const PERMISSION_KEYS = ["addon.view.read"] as const;
`,
    ],
    [
      indexPath,
      `
import { accountManifest } from "@/modules/account/manifest";
import { addonManifest } from "@/modules/addon/manifest";
export const manifests = [accountManifest, addonManifest];
`,
    ],
    [
      "src/modules/account/manifest.ts",
      `
export const accountManifest: ModuleManifest = {
  id: "account", basePath: "/account", nav: [], routes: [], devPages: [],
  settings: [], headerWidgets: [], workbenchObjects: [], workbenchPanels: [], fileTargets: [],
};
`,
    ],
    [
      manifestPath,
      `
export const addonManifest: ModuleManifest = {
  id: "addon",
  basePath: "/addon",
  nav: [],
  routes: [{ path: "/addon", Component: () => import("./page") }],
  devPages: [{
    path: "/addon/tools", permission: "addon.view.read",
    nav: { id: "addon.tools", labelKey: "addon.tools", order: 1, iconId: "home" },
    Component: () => import("./page").then((m) => ({ default: m.Page })),
  }],
  settings: [{
    id: "addon", labelKey: "addon.title", order: 50,
    anyPermissions: ["addon.view.read"], authMode: "login",
    Component: () => import("./page"),
  }],
  headerWidgets: [{ id: "addon.widget", order: 1, Component: () => import("./page") }],
  workbenchObjects: [], workbenchPanels: [], fileTargets: [],
};
`,
    ],
    // This is deliberately invalid code: only its existence may be inspected.
    ["src/modules/addon/page.tsx", "DO NOT PARSE OR IMPORT THIS PAGE"],
    ...["zh-CN", "en-US"].map((language) => [
      `src/core/i18n/${language}.json`,
      JSON.stringify({ "addon.title": "Addon", "addon.tools": "Tools" }),
    ]),
  ]);
  for (const [path, source] of files) {
    await mkdir(dirname(join(directory, path)), { recursive: true });
    await writeFile(join(directory, path), source, "utf8");
  }
  const loaded = await readAssemblyFiles(directory);
  assert.deepEqual(scanAssembly(loaded), []);
  return loaded;
}

function replace(files, path, before, after) {
  const source = files.get(path);
  assert.equal(typeof source, "string");
  assert.ok(source.includes(before), `Fixture does not contain ${before}`);
  files.set(path, source.replace(before, after));
}

function rejects(files, rule, message) {
  const violations = scanAssembly(files);
  assert.ok(
    violations.some(
      (violation) => violation.rule === rule && message.test(violation.message),
    ),
    JSON.stringify(violations, null, 2),
  );
  assert.ok(
    violations.every((violation) => violation.path && violation.line > 0),
  );
  // Input map insertion order must not affect the diagnostics.
  assert.deepEqual(scanAssembly(new Map([...files].reverse())), violations);
}

test("fileTargets require a declared static route and bounded explicit file purposes", async (t) => {
  const base = await fixture(t);
  const valid =
    '[{ id: "addon.import", labelKey: "addon.title", path: "/addon", purpose: "import", extensions: ["csv"], permission: "addon.view.read" }]';
  const files = new Map(base);
  replace(files, manifestPath, "fileTargets: []", `fileTargets: ${valid}`);
  assert.deepEqual(scanAssembly(files), []);
  for (const [before, after, rule, message] of [
    ['path: "/addon"', 'path: "/unknown"', "A4", /文件处理入口/],
    ['purpose: "import"', 'purpose: "backupRestore"', "A2", /用途/],
    ['extensions: ["csv"]', "extensions: []", "A2", /扩展名/],
  ]) {
    const invalid = new Map(base);
    replace(
      invalid,
      manifestPath,
      "fileTargets: []",
      `fileTargets: ${valid.replace(before, after)}`,
    );
    rejects(invalid, rule, message);
  }
});

test("A7 契约 SC-C07 接受两级 nav、开发者父项、分类与两种徽标", async (t) => {
  const files = await fixture(t);
  replace(
    files,
    manifestPath,
    "nav: [],",
    `nav: [{ kind: "parent", id: "addon.app", label: "addon.title", iconId: "home", badge: { kind: "count", value: 2 }, children: [{ kind: "leaf", id: "addon.index", path: "/addon", label: "addon.title", iconId: "home", permission: "addon.view.read", badge: { kind: "new", labelKey: "addon.tools" }, shortcut: "Alt+A" }] }],`,
  );
  replace(
    files,
    manifestPath,
    "devPages: [{",
    `devNavParents: [{ id: "addon.dev", labelKey: "addon.title", iconId: "home", order: 1 }], devPages: [{`,
  );
  replace(
    files,
    manifestPath,
    'id: "addon.tools", labelKey:',
    'id: "addon.tools", parentId: "addon.dev", sectionLabelKey: "addon.tools", labelKey:',
  );
  assert.deepEqual(scanAssembly(files), []);
});

test("A7 契约 SC-C07 导航结构错误含 id、期望、实际和源码位置", async (t) => {
  const cases = [
    ["缺少 id", 'id: "addon.tools", ', "", /非空导航 id/],
    ["保留 id", 'id: "addon.tools"', 'id: "home"', /唯一 id/],
    [
      "未知父项",
      'id: "addon.tools"',
      'id: "addon.tools", parentId: "missing"',
      /同一清单/,
    ],
    [
      "空开发者父项",
      "nav: [],",
      'nav: [], devNavParents: [{ id: "addon.empty", labelKey: "addon.title", iconId: "home", order: 1 }],',
      /0 个子页面/,
    ],
    [
      "父项带 path",
      "nav: [],",
      'nav: [{ kind: "parent", id: "addon.parent", label: "addon.title", iconId: "home", path: "/addon", children: [] }],',
      /父项无 path/,
    ],
    [
      "空 children",
      "nav: [],",
      'nav: [{ kind: "parent", id: "addon.parent", label: "addon.title", iconId: "home", children: [] }],',
      /非空 children/,
    ],
    [
      "三级",
      "nav: [],",
      'nav: [{ kind: "parent", id: "addon.parent", label: "addon.title", iconId: "home", children: [{ kind: "parent", id: "addon.nested", label: "addon.title", iconId: "home", children: [] }] }],',
      /最多两级/,
    ],
    [
      "叶子带 children",
      "nav: [],",
      'nav: [{ kind: "leaf", id: "addon.index", path: "/addon", label: "addon.title", iconId: "home", children: [] }],',
      /无 children/,
    ],
    [
      "开发者叶子带 children",
      'id: "addon.tools"',
      'id: "addon.tools", children: []',
      /开发者叶子无 children/,
    ],
    [
      "重复跨种类 ID",
      "nav: [],",
      'nav: [{ kind: "leaf", id: "ADDON.TOOLS", path: "/addon", label: "addon.title", iconId: "home" }],',
      /唯一 id/,
    ],
    [
      "重复叶子路径",
      "nav: [],",
      'nav: [{ kind: "leaf", id: "addon.index", path: "/addon/tools", label: "addon.title", iconId: "home" }],',
      /唯一叶子路径/,
    ],
    [
      "动态导航路径",
      "nav: [],",
      'nav: [{ kind: "leaf", id: "addon.index", path: "/addon/:id", label: "addon.title", iconId: "home" }],',
      /静态叶子路径/,
    ],
  ];
  for (const [name, before, after, expected] of cases)
    await t.test(name, async (t) => {
      const files = await fixture(t);
      replace(files, manifestPath, before, after);
      rejects(files, "A7", expected);
      for (const violation of scanAssembly(files).filter(
        ({ rule }) => rule === "A7",
      )) {
        assert.match(violation.message, /契约 SC-C07 .+：期望 .+；实际 .+/);
        assert.equal(violation.path, manifestPath);
        assert.ok(violation.line > 1);
      }
    });
});

test("A7 父引用不跨模块，导航 id 在整个仓库查重", async (t) => {
  const files = await fixture(t);
  replace(
    files,
    "src/modules/account/manifest.ts",
    "nav: [],",
    'nav: [{ kind: "parent", id: "addon.tools", label: "addon.title", iconId: "home", children: [{ kind: "leaf", id: "account.index", path: "/account", label: "addon.title", iconId: "home" }] }], devNavParents: [{ id: "account.parent", labelKey: "addon.title", iconId: "home", order: 1 }],',
  );
  replace(
    files,
    manifestPath,
    'id: "addon.tools"',
    'id: "addon.tools", parentId: "account.parent"',
  );
  rejects(files, "A7", /同一清单/);
  rejects(files, "A7", /唯一 id/);
});

test("assembly accepts the real repository", async () => {
  assert.deepEqual(scanAssembly(await readAssemblyFiles()), []);
});

test("assembly derives reserved ids from builtinSections", async (t) => {
  const files = await fixture(t);
  replace(files, builtinSectionsPath, 'id: "data"', 'id: "addon"');
  rejects(files, "A4", /设置分节 addon 使用了保留 ID/);
});

test("assembly rejects missing or invalid builtinSections", async (t) => {
  for (const [source, message] of [
    [null, /缺少受检文件/],
    ["export const builtinSections = [", /无法解析源码/],
    ["export const builtinSections = []", /无法解析内置分节/],
    ["export const builtinSections = sections", /无法解析内置分节/],
    [
      "export const builtinSections = [{ id: 1 }]",
      /内置分节 id 必须是字符串字面量/,
    ],
  ]) {
    await t.test(source ?? "missing file", async (t) => {
      const files = await fixture(t);
      if (source === null) files.delete(builtinSectionsPath);
      else files.set(builtinSectionsPath, source);
      rejects(files, "A4", message);
    });
  }
});

test("assembly validates object contributions and their route ownership", async (t) => {
  const object = `{ kind: "job", route: "/addon/tools",
    resolve: (ref) => import("./page").then((m) => m.resolve(ref)),
    Component: () => import("./page") }`;
  const cases = [
    [`[${object}]`, null, null],
    ["objects", "A2", /字面量数组/],
    [
      `[${object.replace('resolve: (ref) => import("./page").then((m) => m.resolve(ref)),', "")}]`,
      "A2",
      /缺少 resolve/,
    ],
    [
      `[${object.replace('import("./page").then((m) => m.resolve(ref))', "resolve(ref)")}]`,
      "A2",
      /resolve 必须/,
    ],
    [
      `[${object.replace('"/addon/tools"', '"/account"')}]`,
      "A4",
      /本模块已登记路由/,
    ],
    [`[${object}, ${object}]`, "A4", /对象种类 job 重复/],
  ];
  for (const [value, rule, message] of cases) {
    const files = await fixture(t);
    replace(
      files,
      manifestPath,
      "workbenchObjects: []",
      `workbenchObjects: ${value}`,
    );
    if (rule) rejects(files, rule, message);
    else assert.deepEqual(scanAssembly(files), []);
  }
});

test("assembly accepts literal string arrays in paramGroups", async (t) => {
  for (const groups of [
    "[]",
    '["addon.service"]',
    '["addon.service", "addon.other"]',
  ]) {
    await t.test(`accepts ${groups}`, async (t) => {
      const files = await fixture(t);
      replace(
        files,
        manifestPath,
        'anyPermissions: ["addon.view.read"],',
        `paramGroups: ${groups}, anyPermissions: ["addon.view.read"],`,
      );
      assert.deepEqual(scanAssembly(files), []);
    });
  }
});

test("assembly validates panel metadata, factories, IDs and empty contributions", async (t) => {
  const panel = `{ id: "job-inspector", order: 10, labelKey: "addon.title", iconId: "jobs",
    objectKind: "job", Component: () => import("./page") }`;
  for (const [value, rule, message] of [
    ["panels", "A2", /字面量数组/],
    [`[${panel.replace('objectKind: "job",', "")}]`, "A2", /缺少 objectKind/],
    [
      `[${panel.replace('() => import("./page")', "Page")}]`,
      "A2",
      /Component 必须/,
    ],
    [
      `[${panel.replace('"job-inspector"', '"Upper.Case"')}]`,
      "A2",
      /辅助面板 ID/,
    ],
    [`[${panel}, ${panel}]`, "A4", /辅助面板 job-inspector 重复/],
  ]) {
    const files = await fixture(t);
    replace(
      files,
      manifestPath,
      "workbenchPanels: []",
      `workbenchPanels: ${value}`,
    );
    rejects(files, rule, message);
  }
});

test("assembly rejects non literal string arrays in paramGroups", async (t) => {
  for (const groups of [
    "groups",
    "[group]",
    "[...groups]",
    '["addon." + "service"]',
    "[1]",
    "[true]",
    "[null]",
    "[{}]",
    '"addon.service"',
  ]) {
    await t.test(`rejects ${groups}`, async (t) => {
      const files = await fixture(t);
      replace(
        files,
        manifestPath,
        'anyPermissions: ["addon.view.read"],',
        `paramGroups: ${groups}, anyPermissions: ["addon.view.read"],`,
      );
      rejects(files, "A2", /字面量/);
    });
  }
});

test("assembly rejects an id that does not match the directory", async (t) => {
  const files = await fixture(t);
  replace(files, manifestPath, 'id: "addon"', 'id: "other"');
  rejects(files, "A1", /id 必须等于目录 addon/);
});

test("assembly rejects a module missing from the index", async (t) => {
  const files = await fixture(t);
  replace(
    files,
    indexPath,
    "[accountManifest, addonManifest]",
    "[accountManifest]",
  );
  rejects(files, "A1", /addon\/manifest.ts 必须恰好登记一次/);
});

test("assembly rejects a catalog module without a manifest", async (t) => {
  const files = await fixture(t);
  files.delete(manifestPath);
  rejects(files, "A1", /目录模块 addon 必须恰有一份清单/);
});

test("A1 rejects an unregistered module directory even when empty", async (t) => {
  const files = await fixture(t);
  files.set("src/modules/unregistered/", "");
  rejects(files, "A1", /模块目录 unregistered 缺少清单/);
});

test("A2 anyPermissions and keywords are literal string arrays", async (t) => {
  const base = await fixture(t);
  replace(
    base,
    manifestPath,
    "workbenchObjects: []",
    'commands: [{ id: "addon.open", label: "addon.title", keywords: ["open"], run: () => {} }], workbenchObjects: []',
  );
  for (const field of ["anyPermissions", "keywords"]) {
    for (const value of [
      "[]",
      field === "keywords" ? '["open"]' : '["addon.view.read"]',
    ]) {
      const files = new Map(base);
      replace(
        files,
        manifestPath,
        field === "keywords"
          ? 'keywords: ["open"]'
          : 'anyPermissions: ["addon.view.read"]',
        `${field}: ${value}`,
      );
      assert.deepEqual(scanAssembly(files), []);
    }
    for (const value of [
      "values",
      "[value]",
      "[...values]",
      '["a" + "b"]',
      "[1]",
      "[null]",
      "[{}]",
      '"value"',
    ]) {
      const files = new Map(base);
      replace(
        files,
        manifestPath,
        field === "keywords"
          ? 'keywords: ["open"]'
          : 'anyPermissions: ["addon.view.read"]',
        `${field}: ${value}`,
      );
      rejects(files, "A2", /字面量/);
    }
  }
});

test("assembly rejects duplicate or indirect index registrations", async (t) => {
  for (const entry of ["addonManifest, addonManifest", "...extra", "alias"]) {
    await t.test(entry, async (t) => {
      const files = await fixture(t);
      replace(
        files,
        indexPath,
        "[accountManifest, addonManifest]",
        `[accountManifest, ${entry}]`,
      );
      rejects(files, "A1", /登记/);
    });
  }
});

test("assembly rejects spread and non literal metadata", async (t) => {
  for (const [before, after] of [
    ['id: "addon",', '...extra, id: "addon",'],
    ["order: 50,", "order: priority,"],
    ['labelKey: "addon.title",', '[labelField]: "addon.title",'],
    ["nav: [],", "nav: navigation,"],
    ["routes: [{", "routes: [...routes, {"],
    ["settings: [{", "settings: [setting, {"],
    ['iconId: "home"', "iconId: Home"],
  ]) {
    await t.test(after, async (t) => {
      const files = await fixture(t);
      replace(files, manifestPath, before, after);
      rejects(files, "A2", /字面量|计算属性/);
    });
  }
});

test("assembly rejects the removed component icon contract", async (t) => {
  for (const icon of ["Icon: Home", 'Icon: "home", iconId: "home"']) {
    await t.test(icon, async (t) => {
      const files = await fixture(t);
      replace(files, manifestPath, 'iconId: "home"', icon);
      rejects(files, "A2", /清单图标只接受 iconId/);
    });
  }
});

test("assembly rejects a dynamic import that is not a literal or points nowhere", async (t) => {
  for (const factory of [
    "() => import(target)",
    '() => import("./missing")',
    "pageFactory",
    "() => loadPage()",
    '() => { return import("./page"); }',
  ]) {
    await t.test(factory, async (t) => {
      const files = await fixture(t);
      replace(files, manifestPath, '() => import("./page")', factory);
      rejects(files, "A2", /Component 必须|动态导入/);
    });
  }
});

test("assembly resolves TypeScript files and directory indexes", async (t) => {
  for (const path of ["page.ts", "page/index.ts", "page/index.tsx"]) {
    await t.test(path, async (t) => {
      const files = await fixture(t);
      files.delete("src/modules/addon/page.tsx");
      files.set(`src/modules/addon/${path}`, "");
      assert.deepEqual(scanAssembly(files), []);
    });
  }
});

test("assembly rejects an unknown permission", async (t) => {
  for (const field of [
    'permission: "addon.view.read"',
    'anyPermissions: ["addon.view.read"]',
  ]) {
    await t.test(field, async (t) => {
      const files = await fixture(t);
      replace(
        files,
        manifestPath,
        field,
        field.replace("addon.view.read", "addon.unknown.read"),
      );
      rejects(files, "A3", /未知权限键 addon.unknown.read/);
    });
  }
});

test("assembly rejects duplicate section and widget ids", async (t) => {
  for (const id of [
    "general",
    "appearance",
    "network",
    "advanced",
    "data",
    "about",
    "param.custom",
  ]) {
    await t.test(id, async (t) => {
      const files = await fixture(t);
      replace(
        files,
        manifestPath,
        'id: "addon", labelKey:',
        `id: "${id}", labelKey:`,
      );
      rejects(files, "A4", /使用了保留 ID/);
    });
  }
  for (const [collection, entry, message] of [
    [
      "settings",
      '{ id: "addon", labelKey: "addon.title", order: 1, Component: () => import("../addon/page") }',
      /设置分节 addon 重复/,
    ],
    [
      "headerWidgets",
      '{ id: "addon.widget", order: 1, Component: () => import("../addon/page") }',
      /顶栏部件 addon.widget 重复/,
    ],
  ]) {
    await t.test(collection, async (t) => {
      const files = await fixture(t);
      replace(
        files,
        "src/modules/account/manifest.ts",
        `${collection}: []`,
        `${collection}: [${entry}]`,
      );
      rejects(files, "A4", message);
    });
  }
});

test("assembly rejects a route outside the base path", async (t) => {
  for (const path of ["/other", "/addon-other"]) {
    await t.test(path, async (t) => {
      const files = await fixture(t);
      replace(files, manifestPath, 'path: "/addon"', `path: "${path}"`);
      rejects(files, "A4", /不属于 basePath/);
    });
  }
});

test("assembly rejects invalid base paths and duplicate routes", async (t) => {
  for (const base of ["addon", "/", "/addon/"]) {
    await t.test(base, async (t) => {
      const files = await fixture(t);
      replace(files, manifestPath, 'basePath: "/addon"', `basePath: "${base}"`);
      rejects(files, "A4", /basePath 必须/);
    });
  }
  await t.test("route and developer page collision", async (t) => {
    const files = await fixture(t);
    replace(files, manifestPath, 'path: "/addon/tools"', 'path: "/addon"');
    rejects(files, "A4", /路由路径 \/addon 重复/);
  });
});

test("assembly rejects a missing translation key in either language", async (t) => {
  for (const language of ["zh-CN", "en-US"]) {
    for (const key of ["addon.title", "addon.tools"]) {
      await t.test(`${language} ${key}`, async (t) => {
        const files = await fixture(t);
        const path = `src/core/i18n/${language}.json`;
        const messages = JSON.parse(files.get(path));
        delete messages[key];
        files.set(path, JSON.stringify(messages));
        rejects(files, "A5", new RegExp(`${language} 缺少翻译键`));
      });
    }
  }
});

test("assembly rejects a preset with an unmet dependency or without account", async (t) => {
  for (const [before, after, message] of [
    [
      'dependencies: ["account"]',
      'dependencies: ["missing"]',
      /缺少依赖 missing/,
    ],
    [
      'enabledModules: ["account", "addon"]',
      'enabledModules: ["addon"]',
      /必须启用 account/,
    ],
    [
      'enabledModules: ["account", "addon"]',
      'enabledModules: ["account", "unknown"]',
      /启用了未知模块 unknown/,
    ],
  ]) {
    await t.test(after, async (t) => {
      const files = await fixture(t);
      replace(files, assemblyPath, before, after);
      rejects(files, "A6", message);
    });
  }
});
