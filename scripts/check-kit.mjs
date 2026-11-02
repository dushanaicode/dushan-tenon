import { readdir, readFile } from "node:fs/promises";
import { dirname, join, posix, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseAst } from "vite";

const here = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(here, "..");
const rules = [
  "native-table",
  "native-dialog",
  "native-select",
  "kit-internal-import",
  "engine-import",
  "native-message-box",
  "confirm-label",
  "dialog-title",
  "raw-scroll",
  "viewport-breakpoint",
];
const descriptions = {
  "native-table": "使用 @/kit 的 DataTable",
  "native-dialog": "使用 @/kit 的 Dialog 或 ConfirmDialog",
  "native-select": "使用 @/kit 的 Select",
  "kit-internal-import": "从 @/kit 公共出口导入",
  "engine-import": "底层引擎与原语仅由 kit 封装",
  "native-message-box": "使用 @/kit 浮层，不调用浏览器 alert/confirm/prompt",
  "confirm-label": "ConfirmDialog 必须显式提供 confirmLabel 动作文案",
  "dialog-title": "DialogContent/SheetContent 必须包含对应的 Title",
  "raw-scroll":
    "滚动容器使用 kit ScrollArea，不写散装 overflow、scrollbar 或 kit-no-scrollbar",
  "viewport-breakpoint": "外壳与页面模板使用具名容器查询，不使用视口断点",
};

function hasViewportBreakpoint(classes) {
  for (const token of classes.split(/\s+/)) {
    let depth = 0;
    let start = 0;
    for (let index = 0; index < token.length; index++) {
      if (token[index] === "[") depth++;
      else if (token[index] === "]") depth--;
      else if (token[index] === ":" && depth === 0) {
        const variant = token.slice(start, index).replace(/^!/, "");
        if (
          /^(?:(?:min-|max-)?(?:sm|md|lg|xl|2xl)|(?:min|max)-\[.+\])$/.test(
            variant,
          )
        )
          return true;
        start = index + 1;
      }
    }
  }
  return false;
}

function walkAst(node, visit) {
  if (Array.isArray(node)) {
    for (const child of node) walkAst(child, visit);
    return;
  }
  if (node === null || typeof node !== "object") return;
  visit(node);
  for (const [key, child] of Object.entries(node)) {
    if (!["start", "end", "loc", "range"].includes(key)) walkAst(child, visit);
  }
}

function kitImport(path, name) {
  const target = name.startsWith("@/")
    ? `src/${name.slice(2)}`
    : name.startsWith(".")
      ? posix.normalize(posix.join(posix.dirname(path), name))
      : name;
  return {
    publicKit: ["src/kit", "src/kit/index", "src/kit/index.ts"].includes(
      target,
    ),
    internalKit: target.startsWith("src/kit/"),
    composition:
      /^(?:src\/kit\/ui\/)(?:dialog|sheet|confirm-dialog)(?:\.tsx)?$/.test(
        target,
      ),
  };
}

function isKitEngine(name) {
  return (
    name.startsWith("@radix-ui/") ||
    [
      "radix-ui",
      "cmdk",
      "sonner",
      "@tanstack/react-table",
      "@tanstack/table-core",
      "@tanstack/react-virtual",
      "@tanstack/virtual-core",
      "react-resizable-panels",
      "streamdown",
      "@streamdown/cjk",
      "use-stick-to-bottom",
    ].some((engine) => name === engine || name.startsWith(`${engine}/`))
  );
}

function analyzeSource(path, text) {
  const sourcePath = posix.normalize(path.replaceAll("\\", "/"));
  const inKit = sourcePath.startsWith("src/kit/");
  const source = parseAst(text, {
    lang: sourcePath.endsWith(".tsx") ? "tsx" : "ts",
  });
  const violations = [];
  const manualReviews = [];
  const rawScrollLocations = new Set();
  const viewportLocations = new Set();
  const components = new Map();
  const namespaces = new Set();
  const boundGlobals = new Set();
  function bind(pattern) {
    if (!pattern) return;
    if (pattern.type === "Identifier") {
      if (["window", "globalThis"].includes(pattern.name)) {
        boundGlobals.add(pattern.name);
      }
    } else if (pattern.type === "ObjectPattern") {
      for (const property of pattern.properties) {
        bind(
          property.type === "RestElement" ? property.argument : property.value,
        );
      }
    } else if (pattern.type === "ArrayPattern") {
      for (const element of pattern.elements) bind(element);
    } else if (pattern.type === "AssignmentPattern") {
      bind(pattern.left);
    } else if (pattern.type === "RestElement") {
      bind(pattern.argument);
    }
  }
  walkAst(source, (node) => {
    if (node.type === "VariableDeclarator") bind(node.id);
    if (
      [
        "FunctionDeclaration",
        "FunctionExpression",
        "ArrowFunctionExpression",
      ].includes(node.type)
    ) {
      bind(node.id);
      for (const param of node.params) bind(param);
    }
    if (node.type === "CatchClause") bind(node.param);
    if (node.type === "ClassDeclaration" || node.type === "ClassExpression") {
      bind(node.id);
    }
    if (node.type !== "ImportDeclaration") return;
    const name = node.source.value;
    const imported = kitImport(sourcePath, name);
    for (const specifier of node.specifiers) {
      bind(specifier.local);
      if (
        !(imported.publicKit || (inKit && imported.composition)) ||
        node.importKind === "type" ||
        specifier.importKind === "type"
      ) {
        continue;
      }
      if (specifier.type === "ImportSpecifier") {
        components.set(specifier.local.name, specifier.imported.name);
      } else if (specifier.type === "ImportNamespaceSpecifier") {
        namespaces.add(specifier.local.name);
      }
    }
  });
  function kitComponent(name) {
    if (name.type === "JSXIdentifier") return components.get(name.name);
    if (
      name.type === "JSXMemberExpression" &&
      name.object.type === "JSXIdentifier" &&
      namespaces.has(name.object.name)
    ) {
      return name.property.name;
    }
    return undefined;
  }
  function titleState(node, title) {
    if (node.type === "JSXElement") {
      const name = node.openingElement.name;
      const component = kitComponent(name);
      if (component === title) return "present";
      if (["DialogContent", "SheetContent"].includes(component))
        return "missing";
      if (
        !(name.type === "JSXIdentifier" && /^[a-z]/.test(name.name)) &&
        ![
          "DialogHeader",
          "DialogFooter",
          "SheetHeader",
          "SheetFooter",
        ].includes(component)
      ) {
        return "unknown";
      }
    }
    if (node.type === "JSXElement" || node.type === "JSXFragment") {
      return childrenTitleState(node, title);
    }
    if (node.type === "JSXExpressionContainer") {
      return ["Literal", "JSXEmptyExpression"].includes(node.expression.type)
        ? "missing"
        : "unknown";
    }
    return node.type === "JSXText" ? "missing" : "unknown";
  }
  function childrenTitleState(node, title) {
    const states = node.children.map((child) => titleState(child, title));
    if (states.includes("present")) return "present";
    if (
      states.includes("unknown") ||
      node.openingElement?.attributes.some(
        (attribute) =>
          attribute.type === "JSXSpreadAttribute" ||
          attribute.name.name === "children",
      )
    ) {
      return "unknown";
    }
    return "missing";
  }
  function report(rule, node, destination = violations) {
    destination.push({
      rule,
      path: sourcePath,
      line: text.slice(0, node.start).split("\n").length,
    });
  }
  walkAst(source, (node) => {
    if (
      sourcePath.startsWith("src/") &&
      sourcePath.endsWith(".tsx") &&
      sourcePath !== "src/kit/ui/scroll-area.tsx" &&
      ((node.type === "JSXAttribute" && node.name.name === "className") ||
        (node.type === "CallExpression" &&
          node.callee.type === "Identifier" &&
          ["cn", "clsx"].includes(node.callee.name)))
    ) {
      walkAst(
        node.type === "JSXAttribute" ? node.value : node.arguments,
        (value) => {
          const classes =
            value.type === "Literal" && typeof value.value === "string"
              ? value.value
              : value.type === "TemplateElement"
                ? value.value.raw
                : "";
          if (
            /(?:^|[\s:!])(?:overflow-(?:[xy]-)?(?:auto|scroll)|kit-no-scrollbar)(?:$|[\s!])|\[(?:scrollbar-[^\]]*|overflow:[^\]]*)\]/.test(
              classes,
            ) &&
            !rawScrollLocations.has(value.start)
          ) {
            rawScrollLocations.add(value.start);
            report("raw-scroll", value);
          }
          if (
            (sourcePath.startsWith("src/shell/") ||
              sourcePath.startsWith("src/kit/templates/")) &&
            hasViewportBreakpoint(classes) &&
            !viewportLocations.has(value.start)
          ) {
            viewportLocations.add(value.start);
            report("viewport-breakpoint", value);
          }
        },
      );
    }
    // 测试/生成物不承担消费合同；kit 的组合仍须检查标题与动作标签。
    if (
      sourcePath.startsWith("src/lib/generated/") ||
      /\.test(?:-support)?\.tsx?$/.test(sourcePath)
    )
      return;
    if (node.type === "JSXElement") {
      const opening = node.openingElement;
      const component = kitComponent(opening.name);
      if (component === "ConfirmDialog") {
        const label = opening.attributes.find(
          (attribute) =>
            attribute.type === "JSXAttribute" &&
            attribute.name.name === "confirmLabel",
        );
        const value =
          label?.value?.type === "JSXExpressionContainer"
            ? label.value.expression
            : label?.value;
        if (
          !value ||
          (value.type === "Literal" &&
            (typeof value.value !== "string" || value.value.trim() === "")) ||
          (value.type === "Identifier" && value.name === "undefined")
        ) {
          report("confirm-label", opening);
        } else if (
          value.type !== "Literal" ||
          opening.attributes
            .slice(opening.attributes.indexOf(label) + 1)
            .some((attribute) => attribute.type === "JSXSpreadAttribute")
        ) {
          report("confirm-label", opening, manualReviews);
        }
      }
      if (component === "DialogContent" || component === "SheetContent") {
        const state = childrenTitleState(
          node,
          component.replace("Content", "Title"),
        );
        if (state !== "present") {
          report(
            "dialog-title",
            opening,
            state === "missing" ? violations : manualReviews,
          );
        }
      }
    }
    if (
      node.type === "CallExpression" &&
      node.callee.type === "MemberExpression"
    ) {
      const { object, property, computed } = node.callee;
      const method = computed ? property.value : property.name;
      if (
        object.type === "Identifier" &&
        ["window", "globalThis"].includes(object.name) &&
        !boundGlobals.has(object.name) &&
        ["alert", "confirm", "prompt"].includes(method)
      ) {
        report("native-message-box", node);
      }
    }
    if (
      !inKit &&
      node.type === "JSXElement" &&
      node.openingElement.name.type === "JSXIdentifier"
    ) {
      const name = node.openingElement.name.name;
      if (name === "table" || name === "dialog" || name === "select") {
        report(`native-${name}`, node);
      }
    }
    if (
      [
        "ImportDeclaration",
        "ExportNamedDeclaration",
        "ExportAllDeclaration",
        "ImportExpression",
        "TSImportType",
      ].includes(node.type) &&
      node.source?.type === "Literal" &&
      typeof node.source.value === "string"
    ) {
      const name = node.source.value;
      const imported = kitImport(sourcePath, name);
      if (
        inKit
          ? imported.publicKit || name.startsWith("@/kit/")
          : imported.internalKit && !imported.publicKit
      ) {
        report("kit-internal-import", node);
      }
      if (!inKit && isKitEngine(name)) {
        report("engine-import", node);
      }
    }
  });
  return { violations, manualReviews };
}

// path is repository-relative, as returned by scan; no filesystem access here.
export function scanSource(path, text) {
  return analyzeSource(path, text).violations;
}

export async function scan(root = repositoryRoot) {
  const violations = [];
  const manualReviews = [];
  async function walk(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const absolute = join(directory, entry.name);
      const path = relative(root, absolute).replaceAll("\\", "/");
      if (entry.isDirectory()) {
        await walk(absolute);
      } else if (
        entry.isFile() &&
        (path.endsWith(".ts") || path.endsWith(".tsx")) &&
        (!path.startsWith("src/lib/generated/") || path.endsWith(".tsx")) &&
        !path.endsWith(".test.ts")
      ) {
        const result = analyzeSource(path, await readFile(absolute, "utf8"));
        violations.push(...result.violations);
        manualReviews.push(...result.manualReviews);
      }
    }
  }
  await walk(join(root, "src"));
  const counts = Object.fromEntries(rules.map((rule) => [rule, 0]));
  for (const violation of violations) counts[violation.rule] += 1;
  return { counts, violations, manualReviews };
}

export async function checkKit(_env, root = repositoryRoot) {
  console.log("\n[Kit 约束]");
  const { counts, violations, manualReviews } = await scan(root);
  for (const rule of rules) {
    console.log(`${rule}: ${counts[rule]}`);
    if (counts[rule] > 0) {
      for (const violation of violations.filter((item) => item.rule === rule)) {
        console.log(
          `  ${violation.path}:${violation.line} ${descriptions[rule]}`,
        );
      }
    }
  }
  for (const review of manualReviews) {
    console.log(
      `  ${review.path}:${review.line} ${review.rule} 待人工复核（未自动通过）`,
    );
  }
  if (violations.length > 0) throw new Error("Kit 约束要求所有规则为零");
  if (manualReviews.length > 0)
    throw new Error("Kit 约束存在待人工复核项，不能自动通过");
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    await checkKit(process.env);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
