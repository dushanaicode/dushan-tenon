import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, join, posix, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseAst } from "vite";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const rules = [
  "layer-unassigned",
  "layer-import",
  "global-bridge",
  "dom-query",
  "stale-allowlist",
  "crate-dependency",
  "legacy-brand",
  "agents-size",
];
const allowedLayers = {
  lib: [],
  kit: ["lib"],
  core: ["lib", "kit"],
  visual: ["lib", "kit", "core"],
  shell: ["lib", "kit", "core"],
};
const bridgeFiles = new Set([
  "src/core/appearance-bridge.ts",
  "src/core/appearance-bridge.test.ts",
  "src/core/appearance-bridge.test-support.ts",
]);
const domMethods = new Set([
  "querySelector",
  "querySelectorAll",
  "getElementById",
  "getElementsByClassName",
  "getElementsByTagName",
  "getElementsByName",
]);
const domAllowlist = [
  {
    path: "src/main.tsx",
    method: "getElementById",
    reason: "React 根节点挂载点",
  },
];

function lineAt(text, index) {
  return text.slice(0, index).split(/\r\n|\r|\n/).length;
}

function codeNameOf({ identifier }) {
  const codeName = identifier.split(".").at(-1);
  if (!/^[a-z][a-z0-9]*$/.test(codeName)) {
    throw new Error("identifier 最后一段必须匹配 ^[a-z][a-z0-9]*$");
  }
  return codeName;
}

function layerOf(path) {
  if (path === "src/main.tsx") return "app";
  const layer = path.match(/^src\/(lib|kit|core|visual|shell|app)(?:\/|$)/);
  if (layer) return layer[1];
  const module = path.match(/^src\/modules\/([^/]+)\//);
  return module ? `module:${module[1]}` : null;
}

function canImport(from, to) {
  if (from === null || to === null) return false;
  if (from === to || from === "app") return true;
  if (from.startsWith("module:")) {
    return (
      ["lib", "kit", "core"].includes(to) ||
      (from === "module:demo" && to === "module:ai")
    );
  }
  return allowedLayers[from].includes(to);
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

// File maps use repository-relative POSIX paths and Buffer contents.
// Inspected source is parsed, never imported or executed.
export function scanFrontend(files, identity, allowlist = domAllowlist) {
  const globalPattern = new RegExp(
    `__${codeNameOf(identity).toUpperCase()}_[A-Z0-9_]*__`,
    "g",
  );
  const violations = [];
  const used = new Set();
  for (const [path, content] of files) {
    if (!/^src\/.*\.(?:ts|tsx|mts|cts|js|jsx|mjs)$/.test(path)) continue;
    const text = content.toString("utf8");
    const layer = layerOf(path);
    function report(rule, index, message) {
      violations.push({ rule, path, line: lineAt(text, index), message });
    }
    if (layer === null) report("layer-unassigned", 0, "源文件未归层");
    if (!bridgeFiles.has(path)) {
      for (const match of text.matchAll(globalPattern)) {
        report(
          "global-bridge",
          match.index,
          `${match[0]} 只能出现在外观桥文件`,
        );
      }
    }
    const checkDom =
      (layer === "app" || layer === "shell" || layer?.startsWith("module:")) &&
      !/\.test\.|\.test-support\./.test(posix.basename(path));
    const lang = path.endsWith(".tsx")
      ? "tsx"
      : path.endsWith(".jsx")
        ? "jsx"
        : /\.(?:ts|mts|cts)$/.test(path)
          ? "ts"
          : "js";
    const ast = parseAst(text, { lang });
    walkAst(ast, (node) => {
      if (
        [
          "ImportDeclaration",
          "ExportNamedDeclaration",
          "ExportAllDeclaration",
          "ImportExpression",
        ].includes(node.type) &&
        node.source
      ) {
        if (
          node.source.type !== "Literal" ||
          typeof node.source.value !== "string"
        ) {
          report(
            "layer-import",
            node.start,
            "动态 import() 必须使用字符串字面量",
          );
        } else {
          const name = node.source.value;
          const target = name.startsWith("@/")
            ? posix.normalize(`src/${name.slice(2)}`)
            : name.startsWith("./") || name.startsWith("../")
              ? posix.join(posix.dirname(path), name)
              : null;
          if (target !== null && !canImport(layer, layerOf(target))) {
            report(
              "layer-import",
              node.start,
              `${layer ?? "未归层"} 不得导入 ${layerOf(target) ?? "未归层"}：${name} → ${target}`,
            );
          }
        }
      }
      if (
        checkDom &&
        node.type === "CallExpression" &&
        node.callee.type === "MemberExpression" &&
        node.callee.object.type === "Identifier" &&
        node.callee.object.name === "document"
      ) {
        const member = node.callee;
        const method = member.computed
          ? member.property.value
          : member.property.name;
        if (!domMethods.has(method)) return;
        const matches = allowlist.filter(
          (entry) => entry.path === path && entry.method === method,
        );
        if (matches.length > 0) {
          for (const entry of matches) used.add(entry);
        } else {
          report(
            "dom-query",
            node.start,
            `document.${method}() 须改用 ref 或登记白名单`,
          );
        }
      }
    });
  }
  for (const entry of allowlist) {
    if (!used.has(entry)) {
      violations.push({
        rule: "stale-allowlist",
        path: entry.path,
        line: 1,
        message: `${entry.method} 白名单未命中调用：${entry.reason}`,
      });
    }
  }
  return violations;
}

function canDepend(from, to) {
  if (to === "host" || from === null || to === null) return false;
  if (from === "host") return true;
  if (from === "framework") return false;
  if (from === "other") return to === "framework" || to.startsWith("module:");
  return (
    to === "framework" ||
    (to === "module:account" && from !== "module:account") ||
    (from === "module:demo" && to === "module:ai")
  );
}

export function scanCrateDependencies(metadata, root, identity) {
  const codeName = codeNameOf(identity);
  const violations = [];
  const packages = metadata.packages.map((pkg) => {
    const path = relative(root, pkg.manifest_path).replaceAll("\\", "/");
    const directory = path.match(/^crates\/([^/]+)\/Cargo\.toml$/)?.[1];
    const layer =
      path === "src-tauri/Cargo.toml"
        ? "host"
        : directory === "framework"
          ? "framework"
          : directory?.startsWith("module-") && directory.length > 7
            ? `module:${directory.slice(7)}`
            : directory
              ? "other"
              : null;
    return { pkg, path, directory, layer };
  });
  const workspace = new Map(
    packages
      .filter(({ pkg }) => metadata.workspace_members.includes(pkg.id))
      .map((entry) => [entry.pkg.name, entry]),
  );
  for (const { pkg, path, directory, layer } of packages) {
    function report(message) {
      // cargo metadata supplies manifest paths, but no TOML source locations.
      violations.push({ rule: "crate-dependency", path, line: 1, message });
    }
    if (layer === null) report(`package ${pkg.name} 位于不允许的位置`);
    if (directory && pkg.name !== `${codeName}-${directory}`) {
      report(`package ${pkg.name} 必须命名为 ${codeName}-${directory}`);
    }
    for (const dependency of pkg.dependencies) {
      const { name, kind } = dependency;
      const label = `${pkg.name} → ${name}（${kind ?? "normal"}）`;
      if ((name === "tauri" || name.startsWith("tauri-")) && layer !== "host") {
        report(`${label}：只有 host 可以依赖 Tauri`);
      }
      const target = workspace.get(name);
      if (target && !canDepend(layer, target.layer)) {
        report(
          `${label}：${layer ?? "未归类"} 不得依赖 ${target.layer ?? "未归类"}`,
        );
      }
    }
  }
  return violations;
}

export function scanLegacyBrand(
  path,
  content,
  { identifier, binary, product },
) {
  if (
    [
      "scripts/check-structure.mjs",
      "scripts/check-structure.test.mjs",
    ].includes(path) ||
    content.subarray(0, 8192).includes(0)
  ) {
    return [];
  }
  const text = content
    .toString("utf8")
    .replaceAll(product, product.replace(/[^\r\n]/g, " "));
  const underscoredBinary = binary.replaceAll("-", "_");
  const violations = [];
  for (const token of text.matchAll(/[A-Za-z0-9_.-]+/g)) {
    const name = token[0].replace(/\.+$/, "");
    if (
      ["dushanaicode", "dushan-ai", "dushan-website", "DushanCode"].includes(
        name,
      ) ||
      name === identifier ||
      name.startsWith(`${identifier}.`) ||
      name === binary ||
      name.startsWith(`${binary}.`) ||
      name.startsWith(`${binary}-`) ||
      name === underscoredBinary ||
      name.startsWith(`${underscoredBinary}_`)
    ) {
      continue;
    }
    for (const match of token[0].matchAll(/dushan/gi)) {
      violations.push({
        rule: "legacy-brand",
        path,
        line: lineAt(text, token.index + match.index),
        message: `旧品牌标识：${name}`,
      });
    }
  }
  return violations;
}

export function scanAgentsSize(content) {
  const violations = [];
  function report(line, message) {
    violations.push({ rule: "agents-size", path: "AGENTS.md", line, message });
  }
  if (content.length > 30720)
    report(1, `总量 ${content.length} 字节，超过 30720`);
  for (const [index, line] of content
    .toString("utf8")
    .split(/\r\n|\r|\n/)
    .entries()) {
    const length = [...line].length;
    if (length > 300) report(index + 1, `本行 ${length} 个码点，超过 300`);
  }
  return violations;
}

export async function scan(env, root = repositoryRoot) {
  const options = { cwd: root, env, encoding: "utf8", windowsHide: true };
  const paths = execFileSync(
    "git",
    ["ls-files", "-co", "--exclude-standard", "-z"],
    options,
  )
    .split("\0")
    .filter(Boolean);
  const files = new Map(
    await Promise.all(
      [...new Set(paths)]
        .sort()
        .map(async (path) => [path, await readFile(join(root, path))]),
    ),
  );
  const {
    identifier,
    mainBinaryName: binary,
    productName: product,
  } = JSON.parse(files.get("src-tauri/tauri.conf.json").toString("utf8"));
  const identity = { identifier, binary, product };
  codeNameOf(identity);
  const metadata = JSON.parse(
    execFileSync(
      "cargo",
      ["metadata", "--format-version", "1", "--no-deps", "--locked"],
      options,
    ),
  );
  const violations = [
    ...scanFrontend(files, identity),
    ...scanCrateDependencies(metadata, root, identity),
    ...[...files].flatMap(([path, content]) =>
      scanLegacyBrand(path, content, identity),
    ),
    ...scanAgentsSize(files.get("AGENTS.md")),
  ];
  const counts = Object.fromEntries(rules.map((rule) => [rule, 0]));
  for (const violation of violations) counts[violation.rule] += 1;
  return { counts, violations };
}

export async function checkStructure(env) {
  console.log("\n[结构约束]");
  const { counts, violations } = await scan(env);
  for (const rule of rules) {
    console.log(`${rule}: ${counts[rule]}`);
    for (const violation of violations.filter((item) => item.rule === rule)) {
      console.log(`  ${violation.path}:${violation.line} ${violation.message}`);
    }
  }
  if (violations.length > 0) throw new Error("结构约束要求所有规则为零");
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    await checkStructure(process.env);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
