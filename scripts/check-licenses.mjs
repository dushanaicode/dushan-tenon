import { execFile } from "node:child_process";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const execute = promisify(execFile);
const cratesIoSource = "registry+https://github.com/rust-lang/crates.io-index";

// 获准的宽松许可；WITH 组合整体批准，不单独放行任意例外。
export const PERMISSIVE_LICENSES = new Set([
  "MIT",
  "MIT-0",
  "Apache-2.0",
  "Apache-2.0 WITH LLVM-exception",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "ISC",
  "Zlib",
  "Unicode-3.0",
  "Unicode-DFS-2016",
  "CC0-1.0",
  "0BSD",
  "BSL-1.0",
  "Unlicense",
  "CDLA-Permissive-2.0",
]);

// 仅维护者可批准例外。包名与原始许可表达式必须精确匹配。
export const LICENSE_EXCEPTIONS = [
  {
    ecosystem: "rust",
    name: "option-ext",
    license: "MPL-2.0",
    scope: "Windows 运行时依赖",
    reason:
      "tauri → dirs → dirs-sys → option-ext，用于运行时定位系统目录；发行时保留许可并提供同版本源码链接",
  },
  {
    ecosystem: "rust",
    name: "cssparser",
    license: "MPL-2.0",
    scope: "构建期 HTML/CSS 处理",
    reason:
      "tauri-build → tauri-utils → dom_query → cssparser，用于构建时解析 CSS",
  },
  {
    ecosystem: "rust",
    name: "cssparser-macros",
    license: "MPL-2.0",
    scope: "构建期过程宏",
    reason:
      "tauri-build → tauri-utils → dom_query → cssparser → cssparser-macros，用于生成 CSS 解析代码",
  },
  {
    ecosystem: "rust",
    name: "dtoa-short",
    license: "MPL-2.0",
    scope: "构建期数字格式化",
    reason:
      "tauri-build → tauri-utils → dom_query → cssparser → dtoa-short，用于构建时输出 CSS 数值",
  },
  {
    ecosystem: "rust",
    name: "selectors",
    license: "MPL-2.0",
    scope: "构建期 HTML/CSS 处理",
    reason:
      "tauri-build → tauri-utils → dom_query → selectors，用于构建时匹配 CSS 选择器",
  },
];

// WITH > AND > OR；Cargo 旧式 / 按 OR 处理。先完整解析，不能短路跳过坏分支。
export function parseLicenseExpression(expression) {
  if (typeof expression !== "string" || !expression.trim())
    throw new Error("许可缺失");
  const tokens = expression.match(/[A-Za-z0-9][A-Za-z0-9.+-]*|[()/]|\S/g);
  let index = 0;
  function identifier() {
    const token = tokens[index++];
    if (
      !token ||
      !/^[A-Za-z0-9][A-Za-z0-9.+-]*$/.test(token) ||
      ["AND", "OR", "WITH"].includes(token)
    )
      throw new Error("预期许可或例外标识");
    return token;
  }
  function atom() {
    if (tokens[index] === "(") {
      index++;
      const value = or();
      if (tokens[index++] !== ")") throw new Error("括号未闭合");
      return value;
    }
    let id = identifier();
    if (tokens[index] === "WITH") {
      index++;
      id += ` WITH ${identifier()}`;
    }
    return { type: "license", id };
  }
  function and() {
    let value = atom();
    while (tokens[index] === "AND") {
      index++;
      value = { type: "and", left: value, right: atom() };
    }
    return value;
  }
  function or() {
    let value = and();
    while (tokens[index] === "OR" || tokens[index] === "/") {
      index++;
      value = { type: "or", left: value, right: and() };
    }
    return value;
  }
  const parsed = or();
  if (index !== tokens.length) throw new Error("表达式存在多余内容");
  return parsed;
}

function permits(node) {
  if (node.type === "license") return PERMISSIVE_LICENSES.has(node.id);
  if (node.type === "and") return permits(node.left) && permits(node.right);
  return permits(node.left) || permits(node.right);
}

export function isPermissiveLicense(expression) {
  return permits(parseLicenseExpression(expression));
}

function requireData(condition, message) {
  if (!condition) throw new Error(message);
}

function inside(root, path) {
  const part = relative(root, path);
  return part !== ".." && !part.startsWith(`..${sep}`) && !isAbsolute(part);
}

function packageId(pkg) {
  return `${pkg.name}@${pkg.version}`;
}

export function collectRustPackages(metadata, root = repositoryRoot) {
  if (metadata instanceof Error) throw metadata;
  requireData(
    Array.isArray(metadata?.packages) &&
      Array.isArray(metadata?.resolve?.nodes) &&
      Array.isArray(metadata?.workspace_members),
    "cargo metadata 缺少 packages / resolve.nodes / workspace_members",
  );
  const packages = new Map(metadata.packages.map((pkg) => [pkg.id, pkg]));
  const nodes = new Map(metadata.resolve.nodes.map((node) => [node.id, node]));
  const workspace = new Set(metadata.workspace_members);
  const host = metadata.packages.find(
    (pkg) => pkg.manifest_path === join(root, "src-tauri/Cargo.toml"),
  );
  requireData(
    host && workspace.has(host.id),
    "找不到 src-tauri 宿主 workspace 包",
  );

  function reachable() {
    const found = new Set();
    const pending = [host.id];
    while (pending.length > 0) {
      const id = pending.pop();
      if (found.has(id)) continue;
      const pkg = packages.get(id);
      const node = nodes.get(id);
      requireData(pkg && Array.isArray(node?.deps), `依赖节点缺失：${id}`);
      found.add(id);
      for (const dep of node.deps) {
        requireData(
          Array.isArray(dep.dep_kinds) &&
            dep.dep_kinds.length > 0 &&
            dep.dep_kinds.every((kind) =>
              [null, "build", "dev"].includes(kind.kind),
            ),
          `dep_kinds 无效：${id}`,
        );
        if (dep.dep_kinds.some(({ kind }) => kind === null || kind === "build"))
          pending.push(dep.pkg);
      }
    }
    return found;
  }

  const all = reachable();
  return [...all].map((id) => {
    const pkg = packages.get(id);
    requireData(
      typeof pkg.name === "string" &&
        pkg.name.length > 0 &&
        typeof pkg.version === "string" &&
        pkg.version.length > 0 &&
        typeof pkg.manifest_path === "string" &&
        isAbsolute(pkg.manifest_path) &&
        (pkg.source === null || typeof pkg.source === "string"),
      `包身份或来源无效：${id}`,
    );
    return {
      ...pkg,
      ecosystem: "rust",
      paths: [dirname(pkg.manifest_path)],
      local:
        pkg.source === null &&
        inside(root, pkg.manifest_path) &&
        (workspace.has(id) || inside(join(root, "vendor"), pkg.manifest_path)),
    };
  });
}

// pnpm 11 licenses --json: { [license]: [{ name, versions, paths, license }] }。
// versions 与 paths 不作位置配对；生成正文时读取各路径的 package.json 确认版本。
export function collectNpmPackages(npm) {
  if (npm instanceof Error) throw npm;
  requireData(
    npm &&
      typeof npm === "object" &&
      !Array.isArray(npm) &&
      Object.keys(npm).length > 0,
    "pnpm licenses 不是许可分组对象",
  );
  const packages = new Map();
  for (const entries of Object.values(npm)) {
    requireData(
      Array.isArray(entries) && entries.length > 0,
      "pnpm 许可组无效",
    );
    for (const pkg of entries) {
      requireData(
        typeof pkg?.name === "string" &&
          pkg.name.length > 0 &&
          Array.isArray(pkg.versions) &&
          pkg.versions.length > 0 &&
          pkg.versions.every((v) => typeof v === "string" && v.length > 0) &&
          Array.isArray(pkg.paths) &&
          pkg.paths.length > 0 &&
          pkg.paths.every(
            (path) => typeof path === "string" && isAbsolute(path),
          ),
        "pnpm 包的 name / versions / paths 无效",
      );
      for (const version of pkg.versions) {
        const entry = {
          ...pkg,
          version,
          ecosystem: "npm",
          scope: "production",
        };
        const id = packageId(entry);
        requireData(!packages.has(id), `pnpm 包重复：${id}`);
        packages.set(id, entry);
      }
    }
  }
  return [...packages.values()];
}

export function scanLicenses(
  { metadata, npm, vendor, notices },
  root = repositoryRoot,
  exceptions = LICENSE_EXCEPTIONS,
) {
  const violations = [];
  function report(rule, pkg, message) {
    violations.push({ rule, package: pkg, message });
  }
  for (const [ecosystem, collect] of [
    ["rust", () => collectRustPackages(metadata, root)],
    ["npm", () => collectNpmPackages(npm)],
  ]) {
    let packages;
    try {
      packages = collect();
    } catch (error) {
      report("L1", `${ecosystem}@?`, `无法解析依赖数据：${error.message}`);
      continue;
    }
    for (const pkg of packages) {
      const id = packageId(pkg);
      if (ecosystem === "rust" && !pkg.local && pkg.source !== cratesIoSource)
        report(
          "L3",
          id,
          "来源不是 crates.io registry、本仓 workspace 或 vendor/**",
        );
      if (
        ecosystem === "npm" &&
        (typeof pkg.license !== "string" ||
          !pkg.license.trim() ||
          /^(?:UNLICENSED$|SEE LICENSE IN\b)/i.test(pkg.license.trim()))
      ) {
        report(
          "L4",
          id,
          "无法解析 npm 许可：缺少许可字段或为 UNLICENSED / SEE LICENSE IN",
        );
        continue;
      }
      let allowed;
      try {
        allowed = isPermissiveLicense(pkg.license);
      } catch (error) {
        report("L1", id, `无法解析许可：${error.message}`);
        continue;
      }
      const exception = exceptions.some(
        (entry) =>
          entry.ecosystem === ecosystem &&
          entry.name === pkg.name &&
          entry.license === pkg.license,
      );
      if (!allowed && !exception)
        report("L2", id, `许可不在白名单且无例外：${pkg.license}`);
    }
    for (const entry of exceptions.filter((e) => e.ecosystem === ecosystem)) {
      if (!packages.some((pkg) => pkg.name === entry.name))
        report("L5", entry.name, `例外已过期：${entry.name}`);
    }
  }
  for (const { name, files } of vendor) {
    const path = `vendor/${name}`;
    if (!files.some((file) => /^LICEN[SC]E/i.test(file)))
      report("L6", path, "缺少许可文件");
    if (!notices.includes(path))
      report("L6", path, "未在 THIRD_PARTY_NOTICES.md 声明");
  }
  return violations.sort((a, b) => {
    for (const key of ["rule", "package", "message"])
      if (a[key] !== b[key]) return a[key] < b[key] ? -1 : 1;
    return 0;
  });
}

function commandFailure(error, command) {
  const output = ["stdout", "stderr"].map(
    (stream) =>
      `${stream}: ${error[stream].slice(0, 400).replace(/\s+/g, " ").trim()}`,
  );
  const hint =
    command === "pnpm" || command === "pnpm.cmd"
      ? "（pnpm 存储与已安装的依赖不一致时会出现 ERR_PNPM_MISSING_PACKAGE_INDEX_FILE：请在安装依赖所用的同一环境与存储下运行）"
      : "";
  return new Error(
    `${error.message.split(/\r?\n/, 1)[0].trim()}；${output.join("；")}${hint}`,
    { cause: error },
  );
}

export async function readLicenseData(root = repositoryRoot, run = execute) {
  async function json(command, args) {
    try {
      // Windows .cmd 经 cmd.exe 执行；仅拼接下面固定的命令与参数。
      const executable = command === "pnpm.cmd" ? "cmd.exe" : command;
      const parameters =
        command === "pnpm.cmd"
          ? ["/d", "/s", "/c", [command, ...args].join(" ")]
          : args;
      const { stdout } = await run(executable, parameters, {
        cwd: root,
        encoding: "utf8",
        maxBuffer: 16 * 1024 * 1024,
        windowsHide: true,
      }).catch((error) => {
        throw commandFailure(error, command);
      });
      return JSON.parse(stdout);
    } catch (error) {
      return error; // 由纯扫描器转成 L1，读取或解析失败绝不视为空依赖。
    }
  }
  const [metadata, npm, vendor, notices] = await Promise.all([
    json("cargo", [
      "metadata",
      "--format-version",
      "1",
      "--locked",
      "--filter-platform",
      "x86_64-pc-windows-msvc",
    ]),
    json(process.platform === "win32" ? "pnpm.cmd" : "pnpm", [
      "licenses",
      "list",
      "--prod",
      "--json",
    ]),
    readdir(join(root, "vendor"), { withFileTypes: true })
      .catch((error) => {
        if (error.code === "ENOENT") return [];
        throw error;
      })
      .then((entries) =>
        Promise.all(
          entries
            .filter((entry) => entry.isDirectory())
            .map(async ({ name }) => ({
              name,
              files: (
                await readdir(join(root, "vendor", name), {
                  withFileTypes: true,
                })
              )
                .filter((entry) => entry.isFile())
                .map((entry) => entry.name),
            })),
        ),
      ),
    readFile(join(root, "THIRD_PARTY_NOTICES.md"), "utf8"),
  ]);
  return { metadata, npm, vendor, notices };
}

// metadata 合并不同构建域的 features。发行集合须用 Cargo 的 normal 单元图，
// 否则 tauri-utils 的构建期 dom_query 等会沿 metadata normal 边误入清单。
export async function readReleaseTree(root = repositoryRoot, run = execute) {
  const { stdout } = await run(
    "cargo",
    [
      "tree",
      "--manifest-path",
      "src-tauri/Cargo.toml",
      "--locked",
      "--target",
      "x86_64-pc-windows-msvc",
      "--edges",
      "normal,no-proc-macro",
      "--prefix",
      "none",
      "--format",
      "{p}",
      "--color",
      "never",
    ],
    {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true,
    },
  ).catch((error) => {
    throw commandFailure(error, "cargo");
  });
  return stdout;
}

export function selectReleasePackages(metadata, tree, root = repositoryRoot) {
  requireData(
    typeof tree === "string" && tree.trim().length > 0,
    "normal 依赖树为空",
  );
  const packages = new Map(
    collectRustPackages(metadata, root).map((pkg) => [packageId(pkg), pkg]),
  );
  const selected = new Set();
  for (const line of tree.trim().split(/\r?\n/)) {
    const match = line.match(/^([^ ]+) v([^ ]+)(?: \(.*\))?$/);
    requireData(match, `无法解析 normal 依赖树：${line}`);
    const id = `${match[1]}@${match[2]}`;
    requireData(packages.has(id), `normal 依赖不在 metadata 图中：${id}`);
    selected.add(packages.get(id));
  }
  requireData(
    [...selected][0].manifest_path === join(root, "src-tauri/Cargo.toml"),
    "normal 依赖树未从 src-tauri 宿主开始",
  );
  return [...selected].filter((pkg) => !pkg.local);
}

export async function generateNotices(
  data,
  releaseTree,
  root = repositoryRoot,
) {
  const packages = selectReleasePackages(data.metadata, releaseTree, root);
  const manifests = new Map();
  for (const pkg of collectNpmPackages(data.npm)) {
    const paths = [];
    for (const path of pkg.paths) {
      if (!manifests.has(path))
        manifests.set(
          path,
          JSON.parse(await readFile(join(path, "package.json"), "utf8")),
        );
      const manifest = manifests.get(path);
      requireData(
        manifest.name === pkg.name && pkg.versions.includes(manifest.version),
        `无法解析 ${packageId(pkg)} 的 package.json 身份`,
      );
      if (manifest.version === pkg.version) paths.push(path);
    }
    requireData(paths.length > 0, `无法解析 ${packageId(pkg)} 的源码路径`);
    packages.push({ ...pkg, paths });
  }
  packages.sort((a, b) => {
    const left = `${a.ecosystem}:${packageId(a)}`;
    const right = `${b.ecosystem}:${packageId(b)}`;
    return left < right ? -1 : left > right ? 1 : 0;
  });
  const groups = new Map();
  const missing = [];
  const covered = [];
  const noticeHeadings = data.notices
    .split(/\r?\n/)
    .filter((line) => /^#{1,4}\s/.test(line));
  for (const pkg of packages) {
    let count = 0;
    for (const path of pkg.paths) {
      const files = (
        await readdir(path, { recursive: true, withFileTypes: true })
      )
        .filter(
          (file) =>
            file.isFile() &&
            (/^(?:LICEN[SC]E|COPYING|NOTICE|UNLICENSE)/i.test(file.name) ||
              basename(file.parentPath) === "LICENSES"),
        )
        .map((file) => join(file.parentPath, file.name))
        .sort();
      for (const file of files) {
        const text = await readFile(file, "utf8");
        requireData(
          text.trim().length > 0,
          `无法解析 ${packageId(pkg)} 的许可正文：${file}`,
        );
        if (!groups.has(text)) groups.set(text, new Set());
        groups.get(text).add(`${pkg.ecosystem}: ${packageId(pkg)}`);
        count++;
      }
    }
    if (count === 0) {
      const declaration = new RegExp(
        `(?:^|[^A-Za-z0-9_.@/+-])${RegExp.escape(pkg.name)} ${RegExp.escape(pkg.version)}(?=$|[^A-Za-z0-9_.+-])`,
      );
      if (noticeHeadings.some((heading) => declaration.test(heading)))
        covered.push(pkg);
      else missing.push(pkg);
    }
  }
  const mpl = packages.filter((pkg) => /\bMPL-2\.0\b/.test(pkg.license));
  const lines = [
    "# 第三方许可清单",
    "",
    "范围：Windows x86_64-pc-windows-msvc 的 Rust normal 依赖（不含 build/dev/过程宏）与 pnpm 生产依赖；本仓 workspace 与 vendor 由仓库声明覆盖。",
    "",
    "## 分发义务摘要",
    "",
    "分发者须保留适用的版权、许可与 NOTICE 声明，随安装包提供本清单和仓库 THIRD_PARTY_NOTICES.md。OR 可选择获准分支，AND 须履行所有分支义务；以下保留源包中的全部许可正文。",
    "",
    "MPL-2.0 包须保留其许可与原声明，并告知接收者对应源码的获取方式。以下 crates.io 链接提供未修改包的同版本源码；若修改 MPL 文件，分发者还须提供对应修改源码。",
    "",
    "| MPL-2.0 包 | 许可 | 对应源码 |",
    "| --- | --- | --- |",
    ...mpl.map(
      (pkg) =>
        `| ${packageId(pkg)} | ${pkg.license} | https://crates.io/crates/${pkg.name}/${pkg.version} |`,
    ),
    ...(mpl.length === 0 ? ["| 无 | — | — |"] : []),
    "",
    "## 缺许可正文",
    "",
    "以下包在发布包和仓库声明中均未找到许可正文；发布包按 LICEN[SC]E*、COPYING*、NOTICE*、UNLICENSE* 或父目录名恰为 LICENSES 的文件查找，分发前须从上游补齐。",
    "",
    "| 包@版本 | 许可表达式 | 建议 |",
    "| --- | --- | --- |",
    ...missing.map(
      (pkg) =>
        `| ${pkg.ecosystem}: ${packageId(pkg)} | ${pkg.license} | 从上游补 |`,
    ),
    ...(missing.length === 0 ? ["| 无 | — | — |"] : []),
    "",
    "### 由仓库 THIRD_PARTY_NOTICES.md 提供正文的包",
    "",
    "| 包@版本 | 许可表达式 | 正文来源 |",
    "| --- | --- | --- |",
    ...covered.map(
      (pkg) =>
        `| ${pkg.ecosystem}: ${packageId(pkg)} | ${pkg.license} | [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) |`,
    ),
    ...(covered.length === 0 ? ["| 无 | — | — |"] : []),
    "",
    "## 许可正文（相同正文去重）",
  ];
  let number = 0;
  for (const [text, members] of groups) {
    let fence = "```";
    for (const match of text.matchAll(/`+/g))
      if (match[0].length >= fence.length)
        fence = "`".repeat(match[0].length + 1);
    lines.push(
      "",
      `### 正文 ${++number}`,
      "",
      ...[...members].map((member) => `- ${member}`),
      "",
      `${fence}text`,
      text,
      fence,
    );
  }
  return {
    markdown: `${lines.join("\n")}\n`,
    groups: groups.size,
    packages: packages.length,
    mpl,
    missing,
    covered,
  };
}

export async function checkLicenses(noticesPath) {
  console.log("\n[依赖许可策略]");
  const data = await readLicenseData();
  const violations = scanLicenses(data);
  for (const rule of ["L1", "L2", "L3", "L4", "L5", "L6"])
    console.log(
      `${rule}: ${violations.filter((item) => item.rule === rule).length}`,
    );
  for (const { rule, package: pkg, message } of violations)
    console.error(`${rule} ${pkg} ${message}`);
  if (violations.length > 0)
    throw new Error(`许可检查失败：${violations.length} 项违规`);
  console.log("L1–L6 许可检查通过");
  if (noticesPath !== undefined) {
    let result;
    try {
      result = await generateNotices(data, await readReleaseTree());
    } catch (error) {
      console.error(`L1 notices@? 无法解析发行许可数据：${error.message}`);
      throw new Error("许可清单生成失败");
    }
    const destination = resolve(noticesPath);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, result.markdown, "utf8");
    console.log(
      `许可清单：${destination}（${result.packages} 包，${result.groups} 组正文，${result.mpl.length} 个 MPL 包，${result.missing.length} 个缺许可正文，${result.covered.length} 个由仓库声明覆盖）`,
    );
  }
}

const help = `用法: node scripts/check-licenses.mjs [--notices <输出路径>]
  不带参数       检查 Windows Rust normal/build 与 npm 生产依赖许可
  --notices      检查通过后用 cargo tree 排除 build/dev/过程宏，生成发行许可清单
  --help         显示此帮助
默认清单路径示例: node scripts/check-licenses.mjs --notices Temp/licenses/THIRD_PARTY_LICENSES.md
先加载项目隔离环境；离线查询由调用环境的 CARGO_NET_OFFLINE 控制。`;

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    const args = process.argv.slice(2);
    if (args.length === 1 && args[0] === "--help") console.log(help);
    else if (args.length === 0) await checkLicenses();
    else if (args.length === 2 && args[0] === "--notices" && args[1].trim())
      await checkLicenses(args[1]);
    else throw new Error(help);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
