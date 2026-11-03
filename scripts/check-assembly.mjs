import { readdir, readFile } from "node:fs/promises";
import { dirname, join, posix, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseAst } from "vite";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const assemblyPath = "src/lib/generated/assembly.ts";
const permissionsPath = "src/lib/generated/permissions.ts";
const indexPath = "src/app/module-registry.ts";
const builtinSectionsPath = "src/app/settings/builtin-sections.ts";
const languages = ["zh-CN", "en-US"];
const collections = [
  "nav",
  "routes",
  "devPages",
  "settings",
  "headerWidgets",
  "workbenchObjects",
  "workbenchPanels",
  "fileTargets",
];

function unwrap(node) {
  while (["TSAsExpression", "TSSatisfiesExpression"].includes(node?.type)) {
    node = node.expression;
  }
  return node;
}

function declarations(ast) {
  return ast.body.flatMap((statement) =>
    statement.type === "ExportNamedDeclaration" &&
    statement.declaration?.type === "VariableDeclaration"
      ? statement.declaration.declarations
      : [],
  );
}

function keyOf(property) {
  return property.key.type === "Identifier"
    ? property.key.name
    : property.key.value;
}

function resolveSource(path, specifier, files) {
  const target = specifier.startsWith("@/")
    ? `src/${specifier.slice(2)}`
    : posix.join(posix.dirname(path), specifier);
  return [
    target,
    `${target}.ts`,
    `${target}.tsx`,
    `${target}/index.ts`,
    `${target}/index.tsx`,
  ].find((candidate) => files.has(candidate));
}

function assemblyReader(files, violations) {
  function report(rule, path, node, message) {
    violations.push({
      rule,
      path,
      line: node ? files.get(path).slice(0, node.start).split("\n").length : 1,
      message,
    });
  }
  function parse(path, rule) {
    if (!files.has(path)) {
      report(rule, path, null, "缺少受检文件");
      return null;
    }
    try {
      return parseAst(files.get(path), { lang: "ts" });
    } catch (error) {
      report(rule, path, null, `无法解析源码：${error.message}`);
      return null;
    }
  }
  function properties(path, node, rule) {
    const result = new Map();
    if (node?.type !== "ObjectExpression") {
      report(rule, path, node, "必须直接声明对象字面量");
      return result;
    }
    for (const property of node.properties) {
      if (
        property.type !== "Property" ||
        property.computed ||
        property.method ||
        property.kind !== "init"
      ) {
        report(rule, path, property, "不允许展开、计算属性或方法");
        continue;
      }
      const key = keyOf(property);
      if (result.has(key)) report(rule, path, property, `重复属性 ${key}`);
      result.set(key, property.value);
    }
    return result;
  }
  function literal(path, node, rule) {
    node = unwrap(node);
    if (node?.type === "Literal" && !node.regex && node.bigint === undefined) {
      return node.value;
    }
    if (node?.type === "ArrayExpression") {
      return node.elements.map((element) => literal(path, element, rule));
    }
    if (node?.type === "ObjectExpression") {
      return Object.fromEntries(
        [...properties(path, node, rule)].map(([key, value]) => [
          key,
          literal(path, value, rule),
        ]),
      );
    }
    report(rule, path, node, "元数据必须是字面量，不能引用变量或计算值");
    return undefined;
  }
  function constant(path, ast, name, rule) {
    const declaration = declarations(ast).find((item) => item.id.name === name);
    if (!declaration) report(rule, path, ast, `缺少显式常量 ${name}`);
    return unwrap(declaration?.init);
  }
  function unique(seen, value, path, node, label) {
    if (typeof value !== "string") return;
    if (seen.has(value)) {
      report(
        "A4",
        path,
        node,
        `${label} ${value} 重复，首次位于 ${seen.get(value)}`,
      );
    } else {
      seen.set(value, path);
    }
  }
  return { files, report, parse, properties, literal, constant, unique };
}

function readContracts(reader) {
  const { files, report, parse, properties, literal, constant } = reader;
  const builtinIds = new Set();
  const builtinAst = parse(builtinSectionsPath, "A4");
  if (builtinAst) {
    const node = constant(
      builtinSectionsPath,
      builtinAst,
      "builtinSections",
      "A4",
    );
    if (node?.type === "ArrayExpression") {
      for (const section of node.elements) {
        const idNode = properties(
          builtinSectionsPath,
          unwrap(section),
          "A4",
        ).get("id");
        const id = literal(builtinSectionsPath, idNode, "A4");
        if (typeof id === "string") builtinIds.add(id);
        else
          report(
            "A4",
            builtinSectionsPath,
            idNode,
            "内置分节 id 必须是字符串字面量",
          );
      }
    }
    if (builtinIds.size === 0)
      report(
        "A4",
        builtinSectionsPath,
        node,
        "无法解析内置分节：builtinSections 必须包含 id 字符串",
      );
  }
  const assembly = parse(assemblyPath, "A6");
  const permissionAst = parse(permissionsPath, "A3");
  const catalogNode = assembly
    ? constant(assemblyPath, assembly, "MODULE_CATALOG", "A6")
    : undefined;
  const presetNode = assembly
    ? constant(assemblyPath, assembly, "PRESET_CATALOG", "A6")
    : undefined;
  const catalog = literal(assemblyPath, catalogNode, "A6");
  const presets = literal(assemblyPath, presetNode, "A6");
  const permissionKeys = permissionAst
    ? literal(
        permissionsPath,
        constant(permissionsPath, permissionAst, "PERMISSION_KEYS", "A3"),
        "A3",
      )
    : undefined;
  const permissions = new Set();
  if (
    Array.isArray(permissionKeys) &&
    permissionKeys.every((key) => typeof key === "string")
  ) {
    for (const key of permissionKeys) permissions.add(key);
  } else {
    report("A3", permissionsPath, null, "PERMISSION_KEYS 必须是字符串数组");
  }
  const modules = new Map();
  if (Array.isArray(catalog)) {
    for (const [index, module] of catalog.entries()) {
      const node = catalogNode.elements[index];
      if (
        !module ||
        typeof module.id !== "string" ||
        !Array.isArray(module.dependencies) ||
        !module.dependencies.every((id) => typeof id === "string")
      ) {
        report(
          "A6",
          assemblyPath,
          node,
          "MODULE_CATALOG 必须声明字面量 id 与 dependencies",
        );
        continue;
      }
      if (modules.has(module.id)) {
        report("A1", assemblyPath, node, `目录重复模块 ${module.id}`);
      }
      modules.set(module.id, module);
    }
  } else {
    report("A6", assemblyPath, null, "MODULE_CATALOG 必须是数组");
  }
  const translations = new Map();
  for (const language of languages) {
    const path = `src/core/i18n/${language}.json`;
    try {
      translations.set(language, JSON.parse(files.get(path)));
    } catch (error) {
      report("A5", path, null, `无法读取翻译：${error.message}`);
    }
  }
  return {
    builtinIds,
    catalogNode,
    presetNode,
    presets,
    modules,
    permissions,
    translations,
  };
}

function manifestReader(path, base, context) {
  const {
    report,
    properties,
    literal,
    unique,
    files,
    permissions,
    translations,
    builtinIds,
    sectionIds,
    widgetIds,
    routePaths,
    objectKinds,
    panelIds,
    fileTargetIds,
  } = context;
  function checkPermission(path, node, key) {
    if (!permissions.has(key)) report("A3", path, node, `未知权限键 ${key}`);
  }
  function checkComponent(path, node, fieldName) {
    let body = node?.type === "ArrowFunctionExpression" ? node.body : null;
    if (
      body?.type === "CallExpression" &&
      body.callee.type === "MemberExpression" &&
      !body.callee.computed &&
      body.callee.property.name === "then"
    ) {
      body = body.callee.object;
    }
    if (
      body?.type !== "ImportExpression" ||
      body.source.type !== "Literal" ||
      typeof body.source.value !== "string"
    ) {
      report(
        "A2",
        path,
        node,
        `${fieldName} 必须是动态 import("字面量") 工厂，可接 .then(...)`,
      );
      return;
    }
    const specifier = body.source.value;
    if (
      !(specifier.startsWith("./") || specifier.startsWith("../")) ||
      !resolveSource(path, specifier, files)
    ) {
      report(
        "A2",
        path,
        body.source,
        `动态导入必须指向存在的相对路径：${specifier}`,
      );
    }
  }
  const navNodes = new WeakMap();
  function metadata(node, kind) {
    node = unwrap(node);
    const props = properties(path, node, "A2");
    const value = {};
    navNodes.set(value, node);
    for (const [key, field] of props) {
      if (
        key === "Component" ||
        (key === "resolve" && kind === "workbenchObjects")
      ) {
        checkComponent(path, field, key);
      } else if (key === "Icon") {
        report("A2", path, field, "清单图标只接受 iconId");
      } else if (key === "run" && kind === "commands") {
      } else if (key === "nav" && kind === "devPages") {
        value[key] = metadata(field, "devNav");
      } else if (key === "badge") {
        value[key] = metadata(field, "badge");
      } else if (
        collections.includes(key) ||
        ["commands", "devNavParents", "children"].includes(key)
      ) {
        if (field.type !== "ArrayExpression") {
          report("A2", path, field, `${key} 必须是对象字面量数组`);
        } else {
          value[key] = field.elements.map((entry) => metadata(entry, key));
        }
      } else {
        value[key] = literal(path, field, "A2");
        const scalarType =
          key === "order" || (kind === "badge" && key === "value")
            ? "number"
            : key === "developerOnly"
              ? "boolean"
              : "string";
        if (
          !["anyPermissions", "keywords", "paramGroups", "extensions"].includes(
            key,
          ) &&
          typeof value[key] !== scalarType
        ) {
          report("A2", path, field, `${key} 必须是 ${scalarType} 字面量`);
        }
        if (
          ["anyPermissions", "keywords", "paramGroups", "extensions"].includes(
            key,
          )
        ) {
          if (
            !Array.isArray(value[key]) ||
            !value[key].every((entry) => typeof entry === "string")
          ) {
            report("A2", path, field, `${key} 必须是字符串字面量数组`);
          } else if (key === "anyPermissions") {
            for (const permission of value[key]) {
              checkPermission(path, field, permission);
            }
          }
        }
        if (key === "permission" && typeof value[key] === "string") {
          checkPermission(path, field, value[key]);
        }
        if (
          ["labelKey", "label", "sectionLabelKey"].includes(key) &&
          typeof value[key] === "string"
        ) {
          for (const [language, messages] of translations) {
            if (
              typeof messages[value[key]] !== "string" ||
              !messages[value[key]].trim()
            ) {
              report("A5", path, field, `${language} 缺少翻译键 ${value[key]}`);
            }
          }
        }
      }
    }
    const required =
      kind === "manifest"
        ? ["id", "basePath", ...collections]
        : kind === "settings"
          ? ["id", "labelKey", "order", "Component"]
          : kind === "headerWidgets"
            ? ["id", "order", "Component"]
            : kind === "workbenchObjects"
              ? ["kind", "route", "resolve", "Component"]
              : kind === "workbenchPanels"
                ? [
                    "id",
                    "order",
                    "labelKey",
                    "iconId",
                    "objectKind",
                    "Component",
                  ]
                : kind === "fileTargets"
                  ? ["id", "labelKey", "path", "purpose", "extensions"]
                  : kind === "routes" || kind === "devPages"
                    ? ["path", "Component"]
                    : kind === "devNav"
                      ? ["labelKey", "order", "iconId"]
                      : kind === "devNavParents"
                        ? ["labelKey", "order", "iconId"]
                        : kind === "nav" || kind === "children"
                          ? ["iconId"]
                          : [];
    for (const key of required) {
      if (!props.has(key)) report("A2", path, node, `${kind} 缺少 ${key}`);
    }
    if (kind === "settings") {
      unique(sectionIds, value.id, path, props.get("id"), "设置分节");
      if (
        typeof value.id === "string" &&
        (builtinIds.has(value.id) || value.id.startsWith("param."))
      ) {
        report(
          "A4",
          path,
          props.get("id"),
          `设置分节 ${value.id} 使用了保留 ID`,
        );
      }
    }
    if (kind === "headerWidgets") {
      unique(widgetIds, value.id, path, props.get("id"), "顶栏部件");
    }
    if (kind === "workbenchObjects") {
      unique(objectKinds, value.kind, path, props.get("kind"), "对象种类");
    }
    if (kind === "workbenchPanels") {
      unique(panelIds, value.id, path, props.get("id"), "辅助面板");
      if (typeof value.id === "string" && !/^[a-z0-9-]{1,32}$/.test(value.id))
        report(
          "A2",
          path,
          props.get("id"),
          "辅助面板 ID 必须是 1–32 位小写字母、数字或短横线",
        );
    }
    if (kind === "fileTargets") {
      unique(fileTargetIds, value.id, path, props.get("id"), "文件处理入口");
      if (!["import", "store"].includes(value.purpose))
        report("A2", path, props.get("purpose"), "文件用途必须为 import/store");
      if (
        !Array.isArray(value.extensions) ||
        value.extensions.length === 0 ||
        value.extensions.some(
          (extension) =>
            typeof extension !== "string" ||
            !/^[a-z0-9]{1,16}$/.test(extension),
        )
      )
        report(
          "A2",
          path,
          props.get("extensions"),
          "扩展名必须为非空的小写字母数字列表",
        );
    }
    if (kind === "routes" || kind === "devPages") {
      unique(routePaths, value.path, path, props.get("path"), "路由路径");
      if (
        typeof value.path === "string" &&
        typeof base === "string" &&
        value.path !== base &&
        !value.path.startsWith(`${base}/`)
      ) {
        report(
          "A4",
          path,
          props.get("path"),
          `路由 ${value.path} 不属于 basePath ${base}`,
        );
      }
    }
    return value;
  }
  return { metadata, navNodes };
}

function checkNavigation(manifest, path, navNodes, context) {
  const { report, navIds, navPaths } = context;
  function navError(entry, expected, actual) {
    report(
      "A7",
      path,
      navNodes.get(entry),
      `契约 SC-C07 ${entry.id ?? "<缺少 id>"}：期望 ${expected}；实际 ${actual}`,
    );
  }
  function navId(entry) {
    if (typeof entry.id !== "string" || !entry.id.trim()) {
      navError(entry, "非空导航 id", JSON.stringify(entry.id));
    } else if (navIds.has(entry.id.toLowerCase())) {
      navError(
        entry,
        "全树唯一 id（与命令一样忽略大小写）",
        `${entry.id} 已用于 ${navIds.get(entry.id.toLowerCase())}`,
      );
    } else navIds.set(entry.id.toLowerCase(), path);
  }
  function navPath(entry, route) {
    if (
      typeof route !== "string" ||
      !route.startsWith("/") ||
      route.includes(":")
    ) {
      navError(entry, "绝对的静态叶子路径", JSON.stringify(route));
    } else if (navPaths.has(route)) {
      navError(entry, "唯一叶子路径", `${route} 已用于 ${navPaths.get(route)}`);
    } else navPaths.set(route, path);
  }
  function navLeaf(entry) {
    navId(entry);
    navPath(entry, entry.path);
    if (entry.kind !== "leaf" || "children" in entry)
      navError(
        entry,
        "kind=leaf 且无 children（最多两级）",
        JSON.stringify(entry),
      );
  }
  for (const item of manifest.nav ?? []) {
    if (item.kind === "parent") {
      navId(item);
      if ("path" in item)
        navError(item, "父项无 path", JSON.stringify(item.path));
      if (!Array.isArray(item.children) || item.children.length === 0)
        navError(item, "非空 children 叶子数组", JSON.stringify(item.children));
      else for (const leaf of item.children) navLeaf(leaf);
    } else navLeaf(item);
  }
  const parents = new Map();
  for (const parent of manifest.devNavParents ?? []) {
    navId(parent);
    parents.set(parent.id, parent);
    if (["path", "parentId", "children"].some((key) => key in parent))
      navError(
        parent,
        "开发者父项只声明元数据，无 path/parentId/children",
        JSON.stringify(parent),
      );
  }
  const usedParents = new Set();
  for (const page of manifest.devPages ?? []) {
    if (!page.nav) continue;
    navId(page.nav);
    navPath(page.nav, page.path);
    if ("children" in page.nav)
      navError(
        page.nav,
        "开发者叶子无 children（最多两级）",
        JSON.stringify(page.nav.children),
      );
    if (page.nav.parentId !== undefined) {
      if (!parents.has(page.nav.parentId))
        navError(
          page.nav,
          "同一清单 devNavParents 中声明的 parentId",
          JSON.stringify(page.nav.parentId),
        );
      else usedParents.add(page.nav.parentId);
    }
  }
  for (const parent of parents.values()) {
    if (!usedParents.has(parent.id))
      navError(parent, "至少一个 devPages[].nav.parentId 子页面", "0 个子页面");
  }
}

function checkManifest(path, context) {
  const { parse, report, modules, routePaths, manifestExports, ids } = context;
  const ast = parse(path, "A2");
  if (!ast) return;
  const exported = declarations(ast);
  if (exported.length !== 1) {
    report("A2", path, ast, "清单必须显式导出一个对象常量");
    return;
  }
  const [declaration] = exported;
  manifestExports.set(path, declaration.id.name);
  const node = unwrap(declaration.init);
  const baseNode =
    node?.type === "ObjectExpression"
      ? node.properties.find(
          (property) =>
            property.type === "Property" &&
            !property.computed &&
            keyOf(property) === "basePath",
        )?.value
      : undefined;
  const base = unwrap(baseNode)?.value;

  const { metadata, navNodes } = manifestReader(path, base, context);
  const manifest = metadata(node, "manifest");
  for (const target of manifest.fileTargets ?? []) {
    if (
      typeof target.path !== "string" ||
      target.path.includes(":") ||
      routePaths.get(target.path) !== path
    )
      report(
        "A4",
        path,
        navNodes.get(target),
        "文件处理入口必须引用本模块已登记的静态页面",
      );
  }
  checkNavigation(manifest, path, navNodes, context);
  if (Array.isArray(manifest.workbenchObjects)) {
    for (const object of manifest.workbenchObjects) {
      if (
        typeof object.route === "string" &&
        routePaths.get(object.route) !== path
      )
        report(
          "A4",
          path,
          node,
          `对象路由 ${object.route} 必须引用本模块已登记路由`,
        );
    }
  }
  const directory = posix.basename(posix.dirname(path));
  if (
    typeof manifest.id !== "string" ||
    manifest.id !== directory ||
    !modules.has(manifest.id)
  ) {
    report(
      "A1",
      path,
      node,
      `id 必须等于目录 ${directory}，且属于 MODULE_CATALOG`,
    );
  }
  ids.push(manifest.id);
  if (typeof base !== "string" || !base.startsWith("/") || base.endsWith("/")) {
    report("A4", path, baseNode, "basePath 必须以 / 开头且不以 / 结尾");
  }
}

// Parse metadata without importing or executing product files.
export function scanAssembly(files) {
  const violations = [];
  const reader = assemblyReader(files, violations);
  const { report, parse, constant } = reader;
  const contracts = readContracts(reader);
  const { modules, catalogNode, presets, presetNode } = contracts;
  const sectionIds = new Map();
  const widgetIds = new Map();
  const routePaths = new Map();
  const objectKinds = new Map();
  const panelIds = new Map();
  const fileTargetIds = new Map();
  const navIds = new Map([
    ["home", "宿主保留 ID"],
    ["settings", "宿主保留 ID"],
  ]);
  const navPaths = new Map([
    ["/", "宿主首页"],
    ["/settings", "宿主设置"],
  ]);
  const manifestExports = new Map();
  const ids = [];
  const context = {
    ...reader,
    ...contracts,
    sectionIds,
    widgetIds,
    routePaths,
    objectKinds,
    panelIds,
    fileTargetIds,
    navIds,
    navPaths,
    manifestExports,
    ids,
  };
  const manifestPaths = [...files.keys()]
    .filter((path) => /^src\/modules\/[^/]+\/manifest\.ts$/.test(path))
    .sort();
  const directories = new Set(
    [...files.keys()].flatMap((path) => {
      const match = path.match(/^src\/modules\/([^/]+)\//);
      return match ? [match[1]] : [];
    }),
  );
  for (const id of [...directories].sort()) {
    const path = `src/modules/${id}/manifest.ts`;
    if (!files.has(path)) report("A1", path, null, `模块目录 ${id} 缺少清单`);
  }
  for (const path of manifestPaths) checkManifest(path, context);
  for (const id of modules.keys()) {
    if (ids.filter((value) => value === id).length !== 1) {
      report(
        "A1",
        assemblyPath,
        catalogNode,
        `目录模块 ${id} 必须恰有一份清单`,
      );
    }
  }
  const index = parse(indexPath, "A1");
  if (index) {
    const imports = new Map();
    for (const node of index.body.filter(
      (node) => node.type === "ImportDeclaration" && node.importKind !== "type",
    )) {
      const path = resolveSource(indexPath, node.source.value, files);
      for (const specifier of node.specifiers) {
        if (
          specifier.type === "ImportSpecifier" &&
          specifier.importKind !== "type" &&
          specifier.imported.name === manifestExports.get(path)
        ) {
          imports.set(specifier.local.name, path);
        }
      }
    }
    const registered = constant(indexPath, index, "manifests", "A1");
    const counts = new Map();
    if (registered?.type !== "ArrayExpression") {
      report("A1", indexPath, registered, "manifests 必须是显式登记数组");
    } else {
      for (const entry of registered.elements) {
        const path =
          entry?.type === "Identifier" ? imports.get(entry.name) : undefined;
        if (!path) {
          report(
            "A1",
            indexPath,
            entry,
            "登记项必须直接引用清单的静态命名 import",
          );
        } else {
          counts.set(path, (counts.get(path) ?? 0) + 1);
        }
      }
    }
    for (const path of manifestExports.keys()) {
      if (counts.get(path) !== 1) {
        report("A1", indexPath, registered, `${path} 必须恰好登记一次`);
      }
    }
  }
  if (Array.isArray(presets)) {
    for (const [index, preset] of presets.entries()) {
      const node = presetNode.elements[index];
      if (
        !preset ||
        typeof preset.name !== "string" ||
        !Array.isArray(preset.enabledModules)
      ) {
        report(
          "A6",
          assemblyPath,
          node,
          "PRESET_CATALOG 必须声明 name 与 enabledModules",
        );
        continue;
      }
      const enabled = new Set(preset.enabledModules);
      if (!enabled.has("account")) {
        report(
          "A6",
          assemblyPath,
          node,
          `预设 ${preset.name} 必须启用 account`,
        );
      }
      for (const id of enabled) {
        const module = modules.get(id);
        if (!module) {
          report(
            "A6",
            assemblyPath,
            node,
            `预设 ${preset.name} 启用了未知模块 ${id}`,
          );
          continue;
        }
        for (const dependency of module.dependencies) {
          if (!enabled.has(dependency)) {
            report(
              "A6",
              assemblyPath,
              node,
              `预设 ${preset.name} 的 ${id} 缺少依赖 ${dependency}`,
            );
          }
        }
      }
    }
  } else {
    report("A6", assemblyPath, null, "PRESET_CATALOG 必须是数组");
  }
  return violations.sort((a, b) => {
    for (const key of ["rule", "path", "line", "message"]) {
      if (a[key] !== b[key]) return a[key] < b[key] ? -1 : 1;
    }
    return 0;
  });
}

export async function readAssemblyFiles(root = repositoryRoot) {
  const files = new Map();
  async function walk(directory) {
    const entries = await readdir(join(root, directory), {
      withFileTypes: true,
    });
    for (const entry of entries) {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) {
        if (directory === "src/modules") files.set(`${path}/`, "");
        await walk(path);
      } else if (entry.isFile()) files.set(path, "");
    }
  }
  await walk("src");
  const sources = [
    assemblyPath,
    permissionsPath,
    indexPath,
    builtinSectionsPath,
    ...languages.map((language) => `src/core/i18n/${language}.json`),
    ...[...files.keys()].filter((path) =>
      /^src\/modules\/[^/]+\/manifest\.ts$/.test(path),
    ),
  ];
  await Promise.all(
    sources.map(async (path) => {
      files.set(path, await readFile(join(root, path), "utf8"));
    }),
  );
  return files;
}

export async function checkAssembly(_env) {
  console.log("\n[装配一致性]");
  const violations = scanAssembly(await readAssemblyFiles());
  for (const { rule, path, line, message } of violations) {
    console.error(`${rule} ${path}:${line} ${message}`);
  }
  if (violations.length > 0) {
    throw new Error(`装配检查失败：${violations.length} 项违规`);
  }
  console.log("A1–A7 装配检查通过（A7：契约 SC-C07）");
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    await checkAssembly(process.env);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
