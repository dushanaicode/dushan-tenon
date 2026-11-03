import { readdir, readFile } from "node:fs/promises";
import { dirname, join, posix, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseAst } from "vite";
import { root, runBin, task } from "./common.mjs";

const base = "src/modules/demo/showcase";
const manifestPath = "src/modules/demo/manifest.ts";
const pagesPath = `${base}/pages.json`;
const rulesPath = `${base}/rules.json`;
const sections = [
  "start",
  "navigation",
  "controls",
  "overlays",
  "data",
  "templates",
  "samples",
  "appearance",
];
const kinds = ["component", "pattern", "template"];
const fields = [
  "id",
  "titleKey",
  "kind",
  "importPath",
  "exampleFile",
  "page",
  "variants",
  "whenToUseKey",
  "notForKey",
  "related",
  "rule",
];
const ruleIds = Array.from(
  { length: 12 },
  (_, i) => `SC-R${String(i + 1).padStart(2, "0")}`,
);

function walk(node, visit, ancestors = []) {
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit, ancestors);
  } else if (node && typeof node === "object") {
    if (node.type) visit(node, ancestors);
    for (const [key, child] of Object.entries(node)) {
      if (!["start", "end", "loc", "range"].includes(key))
        walk(child, visit, [...ancestors, node]);
    }
  }
}

function props(node) {
  return new Map(
    (node?.properties ?? [])
      .filter((p) => p.type === "Property")
      .map((p) => [p.key.name ?? p.key.value, p.value]),
  );
}
function untyped(node) {
  while (["TSAsExpression", "TSSatisfiesExpression"].includes(node?.type))
    node = node.expression;
  return node;
}
function target(path, source) {
  return source.startsWith("@/")
    ? `src/${source.slice(2)}`
    : posix.normalize(posix.join(posix.dirname(path), source));
}
function sourceFile(files, path, source) {
  const resolved = target(path, source);
  return [resolved, `${resolved}.tsx`, `${resolved}.ts`].find((name) =>
    files.has(name),
  );
}
const text = (value) => typeof value === "string" && value.trim().length > 0;
const strings = (value) => Array.isArray(value) && value.every(text);

function showcaseReader(files, violations) {
  function report(rule, path, identity, expected, actual, node) {
    const source = files.get(path) ?? "";
    const offset =
      node?.start ?? Math.max(0, source.indexOf(JSON.stringify(identity)));
    violations.push({
      rule,
      path,
      line: source.slice(0, offset).split("\n").length,
      message: `${identity}: 期望 ${expected}；实际 ${actual}`,
    });
  }
  function json(path, rule, array = true) {
    try {
      const value = JSON.parse(files.get(path));
      if (array && !Array.isArray(value)) throw new Error("根节点不是数组");
      if (
        !array &&
        (value === null || typeof value !== "object" || Array.isArray(value))
      )
        throw new Error("根节点不是翻译对象");
      return value;
    } catch (error) {
      report(
        rule,
        path,
        path,
        array ? "存在且为 JSON 数组" : "存在且为翻译对象",
        files.has(path) ? error.message : "文件缺失",
      );
      return array ? [] : {};
    }
  }
  const parsed = new Map();
  function ast(path, rule, identity) {
    if (parsed.has(path)) return parsed.get(path);
    try {
      if (!files.has(path)) throw new Error("文件缺失");
      const value = parseAst(files.get(path), {
        lang: path.endsWith(".tsx") ? "tsx" : "ts",
      });
      parsed.set(path, value);
      return value;
    } catch (error) {
      report(rule, path, identity, "可解析的 TS/TSX 文件", error.message);
      return null;
    }
  }
  const translations = ["zh-CN", "en-US"].map((language) => [
    language,
    json(`src/core/i18n/${language}.json`, "C01", false),
  ]);
  function translated(path, identity, key, prefix, rule = "C01") {
    for (const [language, messages] of translations) {
      if (!text(key) || !key.startsWith(prefix) || !text(messages[key]))
        report(
          rule,
          path,
          identity,
          `${language} 非空翻译键 ${prefix}*`,
          String(key),
        );
    }
  }
  return { files, report, json, ast, translated };
}

function readRulesAndPages(reader) {
  const { report, json, translated } = reader;
  const rules = json(rulesPath, "C06");
  const knownRules = new Set();
  for (const rule of rules) {
    if (
      !rule ||
      Object.keys(rule).sort().join() !== "id,textKey" ||
      !ruleIds.includes(rule.id) ||
      knownRules.has(rule.id)
    ) {
      report(
        "C06",
        rulesPath,
        rule?.id,
        "完整十二条 SC-R01–SC-R12，id 唯一，字段 id/textKey",
        JSON.stringify(rule),
      );
      continue;
    }
    knownRules.add(rule.id);
    translated(
      rulesPath,
      rule.id,
      rule.textKey,
      "showcase.common.rules.",
      "C06",
    );
  }
  for (const id of ruleIds)
    if (!knownRules.has(id)) report("C06", rulesPath, id, "规则存在", "缺失");

  const pages = json(pagesPath, "C02");
  const byId = new Map();
  const byPath = new Map();
  for (const page of pages) {
    if (
      !page ||
      !text(page.id) ||
      !text(page.path) ||
      !sections.includes(page.section) ||
      !Number.isInteger(page.order) ||
      page.order <= 0 ||
      !strings(page.related) ||
      Object.keys(page).some(
        (key) =>
          !["id", "path", "section", "order", "related", "noCatalog"].includes(
            key,
          ),
      )
    ) {
      report(
        "C02",
        pagesPath,
        page?.id,
        "完整的页面机器字段",
        JSON.stringify(page),
      );
      continue;
    }
    if (byId.has(page.id) || byPath.has(page.path))
      report("C02", pagesPath, page.id, "唯一页面 id/path", page.path);
    if (
      page.noCatalog !== undefined &&
      !["overview", "catalog", "business"].includes(page.noCatalog)
    )
      report(
        "C02",
        pagesPath,
        page.id,
        "noCatalog = overview/catalog/business",
        page.noCatalog,
      );
    byId.set(page.id, page);
    byPath.set(page.path, page);
    translated(
      pagesPath,
      page.id,
      `showcase.${page.id}.title`,
      `showcase.${page.id}.`,
      "C02",
    );
    translated(
      pagesPath,
      page.id,
      `showcase.${page.id}.scene`,
      `showcase.${page.id}.`,
      "C02",
    );
  }
  for (const page of byId.values())
    for (const related of page.related)
      if (!byId.has(related))
        report("C02", pagesPath, page.id, "related 指向已登记页面", related);

  return { knownRules, byId, byPath };
}

function checkPageRegistry(reader, byId, byPath) {
  const { report, ast } = reader;
  const manifest = ast(manifestPath, "C02", "demo");
  const declaration = manifest?.body.find(
    (node) =>
      node.type === "ExportNamedDeclaration" &&
      node.declaration?.type === "VariableDeclaration",
  );
  const manifestProps = props(
    untyped(declaration?.declaration.declarations[0].init),
  );
  const devPages = manifestProps.get("devPages");
  const registered = new Map();
  if (devPages?.type !== "ArrayExpression")
    report("C02", manifestPath, "demo", "devPages 字面量数组", devPages?.type);
  for (const node of devPages?.elements ?? []) {
    const route = props(node);
    if (!route.has("nav")) continue; // Detail routes have no showcase navigation entry.
    const path = route.get("path")?.value;
    const nav = props(route.get("nav"));
    const page = byPath.get(path);
    if (registered.has(path))
      report("C02", manifestPath, path, "唯一导航页路径", "重复", node);
    registered.set(path, { route, node });
    if (!page) {
      report(
        "C02",
        manifestPath,
        path,
        "pages.json 登记该导航页",
        "缺失",
        node,
      );
      continue;
    }
    for (const [key, expected] of [
      ["id", `demo.${page.id}`],
      ["parentId", "demo.showcase"],
      ["order", page.order],
      ["sectionLabelKey", `demo.showcase.${page.section}`],
    ]) {
      if (nav.get(key)?.value !== expected)
        report(
          "C02",
          manifestPath,
          page.id,
          `${key}=${expected}`,
          nav.get(key)?.value,
          node,
        );
    }
    if (route.get("developerOnly")?.value !== true)
      report(
        "C02",
        manifestPath,
        page.id,
        "developerOnly=true",
        route.get("developerOnly")?.value,
        node,
      );
    if (
      !page.noCatalog &&
      (route.has("permission") || route.has("anyPermissions"))
    )
      report(
        "C02",
        manifestPath,
        page.id,
        "UI 演示页无业务权限",
        "permission/anyPermissions",
        node,
      );
    if (
      page.noCatalog === "business"
        ? !route.has("permission")
        : page.noCatalog && page.noCatalog !== page.id
    )
      report(
        "C02",
        pagesPath,
        page.id,
        "无目录声明对应总览/选型表或真实业务页",
        page.noCatalog,
      );
  }
  for (const page of byId.values())
    if (!registered.has(page.path))
      report("C02", pagesPath, page.id, "demo.devPages 导航登记", page.path);

  return registered;
}

function readCatalog(reader, knownRules, byId, byPath, registered) {
  const { files, report, json, translated } = reader;
  const catalog = new Map();
  const catalogs = [...files.keys()].filter(
    (path) => path.startsWith(`${base}/catalog/`) && path.endsWith(".json"),
  );
  for (const path of catalogs) {
    const entries = json(path, "C01");
    const pageId = posix.basename(path, ".json");
    if (!byId.has(pageId) || entries.length === 0)
      report(
        "C02",
        path,
        pageId,
        "已登记页面的非空目录文件",
        `${entries.length} 条目`,
      );
    for (const entry of entries) {
      if (
        !entry ||
        Object.keys(entry).sort().join() !== [...fields].sort().join() ||
        fields
          .filter((key) => !["variants", "related"].includes(key))
          .some((key) => !text(entry[key])) ||
        !strings(entry.variants) ||
        !strings(entry.related) ||
        !kinds.includes(entry.kind) ||
        !new RegExp(`^${entry.kind}\\.[a-z][a-z0-9-]*$`).test(entry.id) ||
        entry.importPath !== "@/kit"
      ) {
        report(
          "C01",
          path,
          entry?.id,
          "完整目录 schema、闭合 kind、@/kit 公共导入",
          JSON.stringify(entry),
        );
        continue;
      }
      if (catalog.has(entry.id))
        report("C01", path, entry.id, "全局唯一 id", "重复");
      catalog.set(entry.id, { entry, path });
      const page = byPath.get(entry.page);
      if (
        !page ||
        !registered.has(entry.page) ||
        path !== `${base}/catalog/${page.id}.json`
      )
        report(
          "C02",
          path,
          entry.id,
          "对应页面的目录文件与已登记路径",
          entry.page,
        );
      for (const field of ["titleKey", "whenToUseKey", "notForKey"])
        translated(path, entry.id, entry[field], "");
      if (!knownRules.has(entry.rule)) {
        report("C01", path, entry.id, "rule 属于 rules.json", entry.rule);
        report("C06", path, entry.id, "已声明规则", entry.rule);
      }
    }
  }
  for (const { entry, path } of catalog.values())
    for (const related of entry.related)
      if (!catalog.has(related))
        report("C01", path, entry.id, "related 指向已登记目录条目", related);

  return catalog;
}

function checkPageExamples(reader, byId, registered, catalog) {
  const { files, report, ast } = reader;
  const renderedByPage = new Map();
  for (const page of byId.values()) {
    const entries = [...catalog.values()].filter(
      ({ entry }) => entry.page === page.path,
    );
    if (page.noCatalog) {
      if (entries.length)
        report(
          "C02",
          pagesPath,
          page.id,
          "无目录声明与目录条目互斥",
          entries.length,
        );
      continue;
    }
    if (!entries.length)
      report(
        "C02",
        pagesPath,
        page.id,
        "至少一个目录条目或 noCatalog 声明",
        "无覆盖",
      );
    const registration = registered.get(page.path);
    if (!registration) continue;
    const imports = [];
    walk(registration.route.get("Component"), (node) => {
      if (
        node.type === "ImportExpression" &&
        typeof node.source.value === "string"
      )
        imports.push(node.source.value);
    });
    const pageFile =
      imports.length === 1
        ? sourceFile(files, manifestPath, imports[0])
        : undefined;
    if (!pageFile) {
      report(
        "C02",
        manifestPath,
        page.id,
        "显式动态 import 一个存在的页面",
        imports.join(),
        registration.node,
      );
      continue;
    }
    const pageAst = ast(pageFile, "C03", page.id);
    if (!pageAst) continue;
    const jsxNames = new Set();
    const entryBindings = new Set();
    const exampleBindings = new Set();
    walk(pageAst, (node) => {
      if (node.type === "JSXOpeningElement") {
        jsxNames.add(node.name.name);
        if (node.name.name === "ShowcasePage") {
          const id = node.attributes.find(
            (attribute) => attribute.name?.name === "id",
          )?.value?.value;
          if (id !== page.id)
            report(
              "C02",
              pageFile,
              page.id,
              `ShowcasePage id=${page.id}`,
              id,
              node,
            );
          const entryProp = node.attributes.find(
            (a) => a.name?.name === "entries",
          );
          entryBindings.add(entryProp?.value?.expression?.name);
          const examplesProp = node.attributes.find(
            (a) => a.name?.name === "examples",
          );
          exampleBindings.add(examplesProp?.value?.expression?.name);
        }
      }
    });
    const live = new Map();
    let directoryConnected = false;
    for (const node of pageAst.body.filter(
      (node) => node.type === "ImportDeclaration",
    )) {
      const resolved = sourceFile(files, pageFile, node.source.value);
      if (
        resolved === `${base}/catalog/${page.id}.json` &&
        node.specifiers.some((s) => entryBindings.has(s.local.name))
      )
        directoryConnected = true;
      if (!resolved?.startsWith(`${base}/examples/`)) continue;
      const used = node.specifiers
        .filter(
          (s) => s.type === "ImportSpecifier" && jsxNames.has(s.local.name),
        )
        .map((s) => s.imported.name);
      if (used.length) live.set(resolved, used);
    }
    if (!directoryConnected)
      report(
        "C02",
        pageFile,
        page.id,
        "同页目录 import 传给 ShowcasePage.entries",
        "未连接目录",
      );
    renderedByPage.set(page.path, live);
    checkRawExamples(reader, {
      page,
      pageFile,
      pageAst,
      entries,
      live,
      entryBindings,
      exampleBindings,
    });
    const expected = new Set(entries.map(({ entry }) => entry.exampleFile));
    for (const file of live.keys())
      if (!expected.has(file))
        report("C03", pageFile, page.id, "渲染示例在同页目录登记", file);
  }

  return renderedByPage;
}

function checkRawExamples(reader, pageData) {
  const { files, report } = reader;
  const {
    page,
    pageFile,
    pageAst,
    entries,
    live,
    entryBindings,
    exampleBindings,
  } = pageData;
  const itemFiles = new Map();
  walk(pageAst, (node) => {
    if (
      node.type !== "VariableDeclarator" ||
      !exampleBindings.has(node.id.name)
    )
      return;
    const list = untyped(node.init);
    if (list?.type !== "ArrayExpression") return;
    for (const item of list.elements) {
      const file = props(item).get("file");
      let value;
      if (file?.type === "Literal") value = file.value;
      else if (
        file?.type === "MemberExpression" &&
        !file.computed &&
        file.property.name === "exampleFile" &&
        file.object.type === "MemberExpression" &&
        file.object.computed &&
        file.object.object.type === "Identifier" &&
        entryBindings.has(file.object.object.name) &&
        file.object.property.type === "Literal" &&
        Number.isInteger(file.object.property.value)
      )
        value = entries[file.object.property.value]?.entry.exampleFile;
      itemFiles.set(item, value);
    }
  });
  const expected = new Set(entries.map(({ entry }) => entry.exampleFile));
  const raw = new Set();
  walk(pageAst, (node, ancestors) => {
    const source =
      node.type === "ImportExpression" || node.type === "ImportDeclaration"
        ? node.source?.value
        : undefined;
    if (typeof source !== "string" || !source.endsWith("?raw")) return;
    const file = target(pageFile, source.slice(0, -4));
    const item = ancestors.findLast(
      (ancestor) => ancestor.type === "ObjectExpression",
    );
    const arrow = ancestors.at(-1);
    const conditional = ancestors.at(-2);
    const guarded =
      node.type === "ImportExpression" &&
      arrow?.type === "ArrowFunctionExpression" &&
      arrow.params.length === 0 &&
      arrow.body === node &&
      conditional?.type === "ConditionalExpression" &&
      conditional.consequent === arrow &&
      conditional.alternate.type === "Identifier" &&
      conditional.alternate.name === "undefined" &&
      files
        .get(pageFile)
        .slice(conditional.test.start, conditional.test.end)
        .replace(/\s/g, "") === "import.meta.env.DEV";
    if (
      !guarded ||
      !expected.has(file) ||
      !live.has(file) ||
      itemFiles.get(item) !== file
    )
      report(
        "C05",
        pageFile,
        page.id,
        "examples 列表 file 与 DEV ? () => import(同页实际渲染示例.tsx?raw) : undefined 一致",
        source,
        node,
      );
    raw.add(file);
  });
  for (const file of expected)
    if (!raw.has(file))
      report("C05", pageFile, page.id, `DEV 守卫的 ${file}?raw`, "缺失");
}

function checkExamples(reader, catalog, renderedByPage) {
  const { files, report, ast } = reader;
  const exampleFiles = [...files.keys()].filter(
    (path) =>
      path.startsWith(`${base}/examples/`) &&
      /\.tsx?$/.test(path) &&
      !path.includes(".test."),
  );
  for (const { entry, path } of catalog.values()) {
    if (
      !entry.exampleFile.startsWith(`${base}/examples/`) ||
      posix.normalize(entry.exampleFile) !== entry.exampleFile ||
      !entry.exampleFile.endsWith(".tsx") ||
      !files.has(entry.exampleFile)
    ) {
      report(
        "C03",
        path,
        entry.id,
        "examples/ 下存在的 .tsx 文件",
        entry.exampleFile,
      );
      continue;
    }
    const example = ast(entry.exampleFile, "C03", entry.id);
    const exports = new Set();
    for (const node of example?.body ?? []) {
      if (node.type !== "ExportNamedDeclaration") continue;
      if (node.declaration?.id) exports.add(node.declaration.id.name);
      for (const d of node.declaration?.declarations ?? [])
        exports.add(d.id.name);
      for (const specifier of node.specifiers)
        exports.add(specifier.exported.name);
    }
    const used = renderedByPage.get(entry.page)?.get(entry.exampleFile) ?? [];
    let hasJsx = false;
    walk(example, (node) => {
      if (node.type === "JSXElement") hasJsx = true;
    });
    if (!hasJsx || !used.some((name) => exports.has(name)))
      report(
        "C03",
        entry.exampleFile,
        entry.id,
        "同页正常 import 并渲染命名导出的真实组件",
        `exports=${[...exports]} rendered=${used}`,
      );
  }
  for (const path of exampleFiles) {
    if (![...catalog.values()].some(({ entry }) => entry.exampleFile === path))
      report("C03", path, path, "示例被目录覆盖", "未登记");
    const source = files.get(path);
    if (source.split(/\r?\n/)[0] !== "// showcase-example")
      report(
        "C04",
        path,
        path,
        "首行 // showcase-example",
        source.split(/\r?\n/)[0],
      );
    const commentSource = source.split("");
    walk(ast(path, "C04", path), (node) => {
      if (["Literal", "TemplateElement", "JSXText"].includes(node.type))
        commentSource.fill(" ", node.start, node.end);
      if (
        ["Identifier", "JSXIdentifier"].includes(node.type) &&
        node.name.startsWith("UNSAFE_")
      )
        report("C04", path, path, "无 UNSAFE_* 标识符", node.name, node);
      if (
        node.type === "TSAsExpression" &&
        ["TSNeverKeyword", "TSAnyKeyword"].includes(node.typeAnnotation.type)
      )
        report(
          "C04",
          path,
          path,
          "无 as never / as any 类型断言",
          source.slice(node.start, node.end),
          node,
        );
      if (
        [
          "ImportDeclaration",
          "ImportExpression",
          "ExportNamedDeclaration",
          "ExportAllDeclaration",
        ].includes(node.type) &&
        node.source
      ) {
        const specifier = node.source.value;
        const resolved =
          typeof specifier === "string" ? target(path, specifier) : "";
        if (
          typeof specifier !== "string" ||
          /^(radix-ui|@radix-ui\/|@tauri-apps\/|@\/lib\/ipc(?:\/|$))/.test(
            specifier,
          ) ||
          ((resolved === "src/kit" || resolved.startsWith("src/kit/")) &&
            specifier !== "@/kit") ||
          resolved === "src/lib/ipc" ||
          resolved.startsWith("src/lib/ipc/")
        )
          report(
            "C04",
            path,
            path,
            "@/kit 公共出口且不导入 IPC/Radix",
            specifier,
            node,
          );
      }
      if (node.type === "JSXAttribute" && node.name.name === "style")
        report(
          "C04",
          path,
          path,
          "Tailwind 类名，无 style 属性",
          "style=",
          node,
        );
      const value =
        node.type === "TemplateElement" ? node.value.cooked : node.value;
      if (
        ["JSXText", "Literal", "TemplateElement"].includes(node.type) &&
        typeof value === "string" &&
        /[←-⇿▲△▶▷▼▽◀◁★☆✓✔✕✖✗✘☰…]|\p{Extended_Pictographic}/u.test(value)
      )
        report("C04", path, path, "Icon 组件，无字符图标", value, node);
      if (
        node.type === "JSXElement" &&
        node.openingElement.attributes.some(
          (a) => a.name?.name === "size" && a.value?.value === "icon",
        ) &&
        node.children.some(
          (c) =>
            (c.type === "JSXText" && c.value.trim()) ||
            (c.type === "JSXExpressionContainer" &&
              ((c.expression.type === "Literal" && text(c.expression.value)) ||
                (c.expression.type === "TemplateLiteral" &&
                  c.expression.quasis.some((q) => text(q.value.cooked))))),
        )
      )
        report(
          "C04",
          path,
          path,
          "仅图标按钮使用 Icon",
          "文本字符充当图标",
          node,
        );
    });
    for (const comment of commentSource
      .join("")
      .matchAll(/\/\/[^\r\n]*|\/\*[\s\S]*?\*\//g)) {
      for (const directive of comment[0].matchAll(
        /@ts-(?:ignore|expect-error|nocheck)\b/g,
      ))
        report("C04", path, path, "无 TypeScript 检查抑制注释", directive[0], {
          start: comment.index + directive.index,
        });
    }
  }
}

// Read data and TS/TSX without importing or executing product code.
export function scanShowcase(files) {
  const violations = [];
  const reader = showcaseReader(files, violations);
  const { knownRules, byId, byPath } = readRulesAndPages(reader);
  const registered = checkPageRegistry(reader, byId, byPath);
  const catalog = readCatalog(reader, knownRules, byId, byPath, registered);
  const rendered = checkPageExamples(reader, byId, registered, catalog);
  checkExamples(reader, catalog, rendered);
  return violations;
}

async function readTree(directory, prefix, files, include) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = `${prefix}/${entry.name}`;
    if (entry.isDirectory())
      await readTree(join(directory, entry.name), path, files, include);
    else if (include(path))
      files.set(path, await readFile(join(directory, entry.name), "utf8"));
  }
}

export async function readShowcaseFiles(directory = root) {
  const files = new Map();
  // Missing files remain missing in the map and are reported; only ENOENT is handled.
  try {
    await readTree(
      join(directory, "src/modules/demo"),
      "src/modules/demo",
      files,
      (path) => /\.(tsx?|json)$/.test(path) && !path.includes(".test."),
    );
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  for (const language of ["zh-CN", "en-US"]) {
    const path = `src/core/i18n/${language}.json`;
    try {
      files.set(path, await readFile(join(directory, path), "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  return files;
}

export function scanReleaseChunks(files) {
  const chunks = [...files].filter(([path]) => path.endsWith(".js"));
  if (chunks.length === 0)
    return [
      {
        rule: "C08",
        path: "release",
        line: 1,
        message: "release: 期望至少一个 JS chunk；实际 0",
      },
    ];
  return chunks.flatMap(([path, source]) => {
    const at = source.indexOf("// showcase-example");
    return at < 0
      ? []
      : [
          {
            rule: "C08",
            path,
            line: source.slice(0, at).split("\n").length,
            message:
              "release: 期望示例原文标记 0；实际包含 // showcase-example",
          },
        ];
  });
}

export async function readReleaseChunks(directory) {
  const files = new Map();
  await readTree(directory, "release", files, (path) => path.endsWith(".js"));
  return files;
}

function assertClean(violations) {
  for (const { rule, path, line, message } of violations)
    console.error(`${rule} ${path}:${line} ${message}`);
  if (violations.length)
    throw new Error(`演示中心检查失败：${violations.length} 项违规`);
}

export async function checkShowcase(env) {
  console.log("\n[演示中心一致性]");
  assertClean(scanShowcase(await readShowcaseFiles()));
  const outDir = resolve(root, "Temp/check/showcase-release");
  if (dirname(outDir) !== resolve(root, "Temp/check"))
    throw new Error("发布扫描输出必须位于本仓 Temp/check 的明确子目录");
  await runBin(
    "演示中心生产构建",
    "vite",
    "vite",
    ["build", "--configLoader", "native", "--outDir", outDir],
    env,
  );
  assertClean(scanReleaseChunks(await readReleaseChunks(outDir)));
  console.log("C01–C06、C08 演示中心检查通过（C07 由 check-assembly A7 覆盖）");
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  await task("check", checkShowcase);
}
