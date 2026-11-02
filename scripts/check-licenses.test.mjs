import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import {
  collectNpmPackages,
  collectRustPackages,
  generateNotices,
  isPermissiveLicense,
  LICENSE_EXCEPTIONS,
  PERMISSIVE_LICENSES,
  parseLicenseExpression,
  readLicenseData,
  readReleaseTree,
  scanLicenses,
  selectReleasePackages,
} from "./check-licenses.mjs";

const root = resolve("Temp/test/check-licenses/inline-fixture");
const registry = "registry+https://github.com/rust-lang/crates.io-index";

test("licenses: runtime exception matches only its approved expression", () => {
  const entry = LICENSE_EXCEPTIONS.find((item) => item.name === "option-ext");
  assert.equal(entry.license, "MPL-2.0");
  const data = fixture();
  const pkg = addRust(
    data,
    rustPackage(entry.name, join(root, "registry", entry.name), entry.license),
  );
  assert.deepEqual(scan(data, [entry]), []);
  pkg.license = "MIT AND MPL-2.0";
  hasRule(data, "L2", packageId(pkg), [entry]);
});

function rustPackage(name, directory, license = "MIT") {
  return {
    id: `${name}@1.0.0`,
    name,
    version: "1.0.0",
    license,
    manifest_path: join(directory, "Cargo.toml"),
    source: registry,
    targets: [{ kind: ["lib"] }],
  };
}

function addRust(data, pkg, kind = null, parent = "host@1.0.0") {
  data.metadata.packages.push(pkg);
  data.metadata.resolve.nodes.push({ id: pkg.id, deps: [] });
  data.metadata.resolve.nodes
    .find((node) => node.id === parent)
    .deps.push({ pkg: pkg.id, dep_kinds: [{ kind }] });
  return pkg;
}

function fixture(directory = root) {
  const host = rustPackage("host", join(directory, "src-tauri"));
  host.source = null;
  const data = {
    vendor: [],
    notices: "",
    metadata: {
      packages: [host],
      workspace_members: [host.id],
      resolve: { nodes: [{ id: host.id, deps: [] }] },
    },
    npm: {
      MIT: [
        {
          name: "npm-example",
          versions: ["1.0.0"],
          paths: [join(directory, "npm-example")],
          license: "MIT",
        },
      ],
    },
  };
  addRust(data, rustPackage("normal", join(directory, "registry/normal")));
  addRust(
    data,
    rustPackage("builder", join(directory, "registry/builder")),
    "build",
  );
  addRust(
    data,
    rustPackage(
      "test-helper",
      join(directory, "registry/test-helper"),
      "GPL-3.0-only",
    ),
    "dev",
  );
  return data;
}

function scan(data, exceptions = []) {
  return scanLicenses(data, root, exceptions);
}

function hasRule(data, rule, pkg, exceptions = []) {
  const violations = scan(data, exceptions);
  assert.ok(
    violations.some((v) => v.rule === rule && v.package === pkg),
    JSON.stringify(violations),
  );
}

function packageId(pkg) {
  return `${pkg.name}@${pkg.version}`;
}

for (const license of PERMISSIVE_LICENSES) {
  test(`licenses: approved identifier ${license}`, () => {
    assert.equal(isPermissiveLicense(license), true);
  });
}

for (const [expression, allowed] of [
  ["MIT OR GPL-3.0-only", true],
  ["GPL-3.0-only OR MIT", true],
  ["MIT AND MPL-2.0", false],
  ["MIT AND Apache-2.0", true],
  ["MIT OR GPL-3.0-only AND MPL-2.0", true],
  ["(MIT OR GPL-3.0-only) AND MPL-2.0", false],
  ["(Apache-2.0 OR MIT) AND BSD-3-Clause", true],
  ["(MIT OR Apache-2.0) AND Unicode-3.0", true],
  ["MIT/Apache-2.0", true],
  ["Unlicense / MIT", true],
  ["GPL-3.0-only / (MIT AND Apache-2.0)", true],
  ["Apache-2.0 WITH LLVM-exception OR MIT", true],
  ["Apache-2.0 WITH Unknown-exception", false],
  ["MIT WITH LLVM-exception", false],
  ["MPL-2.0", false],
  ["LGPL-2.1-or-later", false],
  ["LicenseRef-private", false],
]) {
  test(`licenses: expression ${expression}`, () => {
    assert.equal(isPermissiveLicense(expression), allowed);
  });
}

test("licenses: WITH binds to one license, not an entire expression", () => {
  assert.deepEqual(parseLicenseExpression("Apache-2.0 WITH LLVM-exception"), {
    type: "license",
    id: "Apache-2.0 WITH LLVM-exception",
  });
  assert.throws(() =>
    parseLicenseExpression("(MIT OR Apache-2.0) WITH LLVM-exception"),
  );
});

test("L1: malformed branches are parsed even when another OR branch is allowed", () => {
  for (const expression of [
    undefined,
    null,
    "",
    " ",
    "MIT OR",
    "MIT AND",
    "(MIT",
    "MIT)",
    "MIT Apache-2.0",
    "MIT OR ()",
    "MIT OR @bad",
    "MIT OR Apache-2.0 WITH",
    "MIT // Apache-2.0",
    "MIT AND OR Apache-2.0",
    "MIT, Apache-2.0",
  ]) {
    assert.throws(() => parseLicenseExpression(expression));
    const data = fixture();
    data.metadata.packages[1].license = expression;
    hasRule(data, "L1", "normal@1.0.0");
  }
});

test("licenses: normal/build transitive traversal excludes dev and unrelated workspace roots", () => {
  const data = fixture();
  addRust(
    data,
    rustPackage("build-child", join(root, "registry/build-child")),
    null,
    "builder@1.0.0",
  );
  addRust(
    data,
    rustPackage(
      "build-test",
      join(root, "registry/build-test"),
      "GPL-3.0-only",
    ),
    "dev",
    "builder@1.0.0",
  );
  const unrelated = rustPackage(
    "other-workspace",
    join(root, "other"),
    "GPL-3.0-only",
  );
  unrelated.source = null;
  data.metadata.packages.push(unrelated);
  data.metadata.workspace_members.push(unrelated.id);
  data.metadata.resolve.nodes.push({ id: unrelated.id, deps: [] });
  const before = structuredClone(data);
  assert.deepEqual(scan(data), []);
  assert.deepEqual(data, before);
  assert.deepEqual(
    collectRustPackages(data.metadata, root)
      .map((pkg) => pkg.name)
      .sort(),
    ["build-child", "builder", "host", "normal"],
  );
  data.metadata.packages.find((pkg) => pkg.name === "build-child").license =
    "GPL-3.0-only";
  hasRule(data, "L2", "build-child@1.0.0");
});

test("licenses: all dep_kinds are considered and graph cycles terminate", () => {
  const data = fixture();
  const node = data.metadata.resolve.nodes[0];
  node.deps[0].dep_kinds = [{ kind: "dev" }, { kind: null }];
  data.metadata.resolve.nodes[1].deps.push({
    pkg: "host@1.0.0",
    dep_kinds: [{ kind: null }],
  });
  assert.deepEqual(scan(data), []);
  assert.equal(collectRustPackages(data.metadata, root).length, 3);
});

test("L1: missing and malformed dependency data fail closed", () => {
  for (const metadata of [null, {}, new Error("cargo failed")]) {
    hasRule({ ...fixture(), metadata }, "L1", "rust@?");
  }
  for (const npm of [
    null,
    {},
    [],
    { error: {} },
    { MIT: [{}] },
    new Error("pnpm failed"),
  ]) {
    hasRule({ ...fixture(), npm }, "L1", "npm@?");
  }
  const data = fixture();
  data.metadata.resolve.nodes[0].deps[0].pkg = "missing-node";
  hasRule(data, "L1", "rust@?");
  data.metadata.resolve.nodes[0].deps[0].dep_kinds = [];
  hasRule(data, "L1", "rust@?");
});

test("L2: an unapproved expression cannot be rescued by a similarly named package", () => {
  const data = fixture();
  data.metadata.packages[1].license = "GPL-3.0-only";
  hasRule(data, "L2", "normal@1.0.0");
  data.npm.MIT[0].license = "MIT AND MPL-2.0";
  hasRule(data, "L2", "npm-example@1.0.0");
});

test("L3: git, non-crates registries, external paths and arbitrary in-repo paths fail", () => {
  for (const [source, manifest] of [
    ["git+https://example.test/project", join(root, "vendor/git/Cargo.toml")],
    [
      "registry+https://example.test/index",
      join(root, "registry/other/Cargo.toml"),
    ],
    [null, resolve(root, "../outside/Cargo.toml")],
    [null, `${root}-sibling/Cargo.toml`],
    [null, join(root, "not-a-workspace/Cargo.toml")],
  ]) {
    const data = fixture();
    Object.assign(data.metadata.packages[1], {
      source,
      manifest_path: manifest,
    });
    hasRule(data, "L3", "normal@1.0.0");
  }
});

test("L3: source=null workspace/vendor packages inside the repository are allowed", () => {
  const data = fixture();
  const normal = data.metadata.packages[1];
  normal.source = null;
  data.metadata.workspace_members.push(normal.id);
  assert.deepEqual(scan(data), []);
  data.metadata.workspace_members.pop();
  normal.manifest_path = join(root, "vendor/normal/Cargo.toml");
  assert.deepEqual(scan(data), []);
});

test("L4: npm requires its own license field, never the group label", () => {
  for (const license of [
    undefined,
    null,
    "",
    "  ",
    "UNLICENSED",
    "SEE LICENSE IN LICENSE.txt",
  ]) {
    const data = fixture();
    data.npm.MIT[0].license = license;
    hasRule(data, "L4", "npm-example@1.0.0");
  }
});

test("licenses: npm grouped versions are all checked", () => {
  const data = fixture();
  data.npm.MIT[0].versions.push("2.0.0");
  data.npm.MIT[0].license = "GPL-3.0-only";
  assert.deepEqual(
    collectNpmPackages(data.npm).map((pkg) => pkg.version),
    ["1.0.0", "2.0.0"],
  );
  assert.deepEqual(
    scan(data).map((v) => v.package),
    ["npm-example@1.0.0", "npm-example@2.0.0"],
  );
});

test("licenses: exceptions carry reason/scope and match exact package + expression across upgrades", () => {
  for (const entry of LICENSE_EXCEPTIONS) {
    assert.ok(entry.reason.length > 0);
    assert.ok(entry.scope.length > 0);
    const data = fixture();
    const pkg = addRust(
      data,
      rustPackage(
        entry.name,
        join(root, "registry", entry.name),
        entry.license,
      ),
      entry.scope.startsWith("构建期") ? "build" : null,
    );
    assert.deepEqual(scan(data, [entry]), []);
    pkg.version = "9.0.0";
    assert.deepEqual(scan(data, [entry]), []);
    for (const license of [
      "GPL-3.0-only",
      `(${entry.license})`,
      `${entry.license} `,
      `${entry.license} OR GPL-3.0-only`,
    ]) {
      pkg.license = license;
      const violations = scan(data, [entry]);
      assert.deepEqual(
        violations.map((v) => v.rule),
        ["L2"],
      );
    }
    pkg.license = entry.license;
    pkg.name += "-different";
    hasRule(data, "L2", `${entry.name}-different@9.0.0`, [entry]);
  }
});

test("L5: an absent or dev-only exception is stale", () => {
  const entry = LICENSE_EXCEPTIONS[0];
  const data = fixture();
  hasRule(data, "L5", entry.name, [entry]);
  addRust(
    data,
    rustPackage(entry.name, join(root, "registry", entry.name), "MPL-2.0"),
    "dev",
  );
  hasRule(data, "L5", entry.name, [entry]);
  assert.match(scan(data, [entry])[0].message, /^例外已过期：option-ext$/);
});

test("L6: declared vendors with license files pass", () => {
  const data = fixture();
  data.vendor = [
    { name: "updater", files: ["Cargo.toml", "LICENSE_MIT"] },
    { name: "window-state", files: ["licence.md"] },
  ];
  data.notices = "`vendor/updater` and `vendor/window-state`";
  assert.deepEqual(scan(data), []);
});

test("L6: a vendor missing its literal notice path is reported", () => {
  const data = fixture();
  data.vendor = [{ name: "updater", files: ["LICENSE_MIT"] }];
  data.notices = "tauri-plugin-updater";
  assert.deepEqual(scan(data), [
    {
      rule: "L6",
      package: "vendor/updater",
      message: "未在 THIRD_PARTY_NOTICES.md 声明",
    },
  ]);
});

test("L6: a vendor missing a license file is reported", () => {
  const data = fixture();
  data.vendor = [{ name: "updater", files: ["COPYING", "NOTICE"] }];
  data.notices = "vendor/updater";
  assert.deepEqual(scan(data), [
    {
      rule: "L6",
      package: "vendor/updater",
      message: "缺少许可文件",
    },
  ]);
});

test("L6: multiple vendors report only the vendor with missing obligations", () => {
  const data = fixture();
  data.vendor = [
    { name: "updater", files: ["LICENSE_MIT"] },
    { name: "missing", files: [] },
    { name: "window-state", files: ["License.md"] },
  ];
  data.notices = "vendor/updater vendor/window-state";
  assert.deepEqual(scan(data), [
    {
      rule: "L6",
      package: "vendor/missing",
      message: "未在 THIRD_PARTY_NOTICES.md 声明",
    },
    { rule: "L6", package: "vendor/missing", message: "缺少许可文件" },
  ]);
});

for (const state of ["absent vendor", "vendor is a file", "absent notices"]) {
  test(`licenses: reads ${state} without hiding other filesystem errors`, async (t) => {
    const parent = resolve("Temp/test/check-licenses/read-tests");
    await mkdir(parent, { recursive: true });
    assert.equal(await realpath(parent), parent);
    const directory = await realpath(await mkdtemp(join(parent, "input-")));
    assert.equal(dirname(directory), parent);
    t.after(async () => {
      assert.equal(dirname(await realpath(directory)), parent);
      await rm(directory, { recursive: true });
    });
    const fixtureData = fixture(directory);
    const run = async (command) => ({
      stdout: JSON.stringify(
        command === "cargo" ? fixtureData.metadata : fixtureData.npm,
      ),
    });
    if (state !== "absent notices")
      await writeFile(
        join(directory, "THIRD_PARTY_NOTICES.md"),
        "# 第三方依赖声明\n",
      );
    if (state === "vendor is a file")
      await writeFile(join(directory, "vendor"), "not a directory");
    if (state === "absent vendor") {
      const data = await readLicenseData(directory, run);
      assert.deepEqual(data.vendor, []);
      assert.deepEqual(scanLicenses(data, directory, []), []);
    } else {
      await assert.rejects(readLicenseData(directory, run), {
        code: state === "vendor is a file" ? "ENOTDIR" : "ENOENT",
      });
    }
  });
}

test("L5: a missing npm exception is reported independently of Rust packages", () => {
  const entry = {
    ecosystem: "npm",
    name: "removed-package",
    license: "MPL-2.0",
    scope: "生产依赖",
    reason: "已移除的直接依赖",
  };
  assert.deepEqual(scan(fixture(), [entry]), [
    { rule: "L5", package: entry.name, message: `例外已过期：${entry.name}` },
  ]);
});

test("licenses: published exception table matches the checker", async () => {
  const notices = await readFile(
    new URL("../THIRD_PARTY_NOTICES.md", import.meta.url),
    "utf8",
  );
  const table = notices.split(/\r?\n/).filter((line) => /^\| [a-z]/.test(line));
  assert.deepEqual(
    table,
    LICENSE_EXCEPTIONS.map(
      (entry) =>
        `| ${entry.name} | ${entry.license} | ${entry.scope} | ${entry.reason} |`,
    ),
  );
});

test("licenses: real repository satisfies L1–L6", async () => {
  const data = await readLicenseData();
  assert.deepEqual(scanLicenses(data), []);
  const normal = selectReleasePackages(data.metadata, await readReleaseTree());
  assert.deepEqual(
    normal.filter((pkg) => pkg.license === "MPL-2.0").map((pkg) => pkg.name),
    ["option-ext"],
  );
});

test("notices: Cargo normal graph excludes feature-unified build packages and deduplicates rows", () => {
  const data = fixture();
  // metadata 把构建域 feature 依赖也挂在共享节点的 normal 边上。
  data.metadata.resolve.nodes[0].deps[1].dep_kinds = [{ kind: null }];
  assert.ok(
    collectRustPackages(data.metadata, root).some(
      (pkg) => pkg.name === "builder",
    ),
  );
  const tree =
    "host v1.0.0 (C:\\path with spaces)\nnormal v1.0.0\nnormal v1.0.0 (*)\n";
  assert.deepEqual(
    selectReleasePackages(data.metadata, tree, root).map((pkg) => pkg.name),
    ["normal"],
  );
});

test("notices: empty, malformed, mismatched and non-host Cargo trees fail closed", () => {
  for (const tree of [
    undefined,
    "",
    " ",
    "invalid",
    "host v1.0.0\nunknown v1.0.0",
    "normal v1.0.0",
    "host v2.0.0",
  ]) {
    assert.throws(() => selectReleasePackages(fixture().metadata, tree, root));
  }
});

test("L1: subprocess read failures become violations, not empty inventories", async () => {
  const execute = promisify(execFile);
  const data = await readLicenseData(undefined, (command, args, options) =>
    execute(command, args, {
      ...options,
      cwd: resolve("Temp/test/check-licenses/nonexistent-command-cwd"),
    }),
  );
  const violations = scanLicenses(data);
  assert.equal(violations.length, 2);
  assert.ok(
    violations.every((v) => v.rule === "L1" && v.message.includes("无法解析")),
  );
});

test("L1: command failures include bounded stdout/stderr and the pnpm store hint", async () => {
  const stdoutJson = JSON.stringify({
    error: {
      code: "ERR_PNPM_MISSING_PACKAGE_INDEX_FILE",
      message: "Failed to find package index file for example@1.0.0",
    },
  });
  const stdoutHead = ` \n${stdoutJson}\r\n`;
  const stderrHead = " \r\n stderr\n details\t ";
  const stdoutFill = "o".repeat(400 - stdoutHead.length);
  const stderrFill = "e".repeat(400 - stderrHead.length);
  const failure = Object.assign(
    new Error("Command failed: injected\nUNTRUNCATED_STDERR"),
    {
      stdout: `${stdoutHead}${stdoutFill}STDOUT_AFTER_400`,
      stderr: `${stderrHead}${stderrFill}STDERR_AFTER_400`,
    },
  );
  const run = async () => {
    throw failure;
  };
  const hint =
    "（pnpm 存储与已安装的依赖不一致时会出现 ERR_PNPM_MISSING_PACKAGE_INDEX_FILE：请在安装依赖所用的同一环境与存储下运行）";
  function assertOutput(message) {
    assert.ok(message.includes(`stdout: ${stdoutJson} ${stdoutFill}`));
    assert.ok(message.includes(`stderr: stderr details ${stderrFill}`));
    assert.doesNotMatch(
      message,
      /[\r\n\t]|STDOUT_AFTER_400|STDERR_AFTER_400|UNTRUNCATED_STDERR/,
    );
  }
  const violations = scan(await readLicenseData(undefined, run));
  assert.deepEqual(
    violations.map(({ rule, package: pkg }) => [rule, pkg]),
    [
      ["L1", "npm@?"],
      ["L1", "rust@?"],
    ],
  );
  for (const violation of violations) assertOutput(violation.message);
  assert.ok(violations[0].message.endsWith(hint));
  assert.ok(!violations[1].message.includes(hint));
  await assert.rejects(readReleaseTree(root, run), (error) => {
    assertOutput(error.message);
    assert.ok(!error.message.includes(hint));
    return true;
  });
});

test("notices: exact text deduplication, missing bodies, MPL sources and release scope", async (t) => {
  const temporary = resolve("Temp/test/check-licenses/license-tests");
  await mkdir(temporary, { recursive: true });
  const parent = await realpath(temporary);
  assert.equal(parent, temporary);
  const directory = await realpath(await mkdtemp(join(parent, "notices-")));
  assert.equal(dirname(directory), parent);
  t.after(async () => {
    assert.equal(dirname(await realpath(directory)), parent);
    await rm(directory, { recursive: true });
  });
  const data = fixture(directory);
  const mpl = addRust(
    data,
    rustPackage(
      "option-ext",
      join(directory, "registry/option-ext"),
      "MPL-2.0",
    ),
  );
  const missing = addRust(
    data,
    rustPackage("missing-text", join(directory, "registry/missing")),
  );
  const vendor = addRust(
    data,
    rustPackage("local-vendor", join(directory, "vendor/local")),
  );
  vendor.source = null;
  const macro = addRust(
    data,
    rustPackage("macro", join(directory, "registry/macro")),
  );
  macro.targets = [{ kind: ["proc-macro"] }];
  addRust(
    data,
    rustPackage("macro-child", join(directory, "registry/macro-child")),
    null,
    macro.id,
  );

  const body = "Copyright fixture authors\nPermission fixture\n```\n";
  async function file(path, text) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, text, "utf8");
  }
  await file(
    join(dirname(data.metadata.packages[1].manifest_path), "LICENSE"),
    body,
  );
  await file(join(dirname(mpl.manifest_path), "licenses/NOTICE.txt"), body);
  await mkdir(dirname(missing.manifest_path), { recursive: true });
  const npm = data.npm.MIT[0];
  npm.versions.push("2.0.0");
  npm.paths.unshift(join(directory, "npm-v2"));
  for (const [index, version] of ["2.0.0", "1.0.0"].entries()) {
    await file(
      join(npm.paths[index], "package.json"),
      JSON.stringify({ name: npm.name, version }),
    );
    await file(join(npm.paths[index], "licence.md"), body);
  }
  const tree =
    "host v1.0.0\nnormal v1.0.0\noption-ext v1.0.0\nmissing-text v1.0.0\nlocal-vendor v1.0.0\n";
  const result = await generateNotices(data, tree, directory);
  assert.equal(result.groups, 1);
  assert.equal(result.packages, 5);
  assert.equal(result.mpl.length, 1);
  assert.deepEqual(
    result.missing.map((pkg) => pkg.name),
    ["missing-text"],
  );
  assert.equal(result.markdown.split("Permission fixture").length - 1, 1);
  assert.ok(result.markdown.includes(`\`\`\`\`text\n${body}\n\`\`\`\``));
  assert.match(result.markdown, /npm-example@1\.0\.0/);
  assert.match(result.markdown, /npm-example@2\.0\.0/);
  assert.match(
    result.markdown,
    /https:\/\/crates.io\/crates\/option-ext\/1.0.0/,
  );
  assert.match(
    result.markdown,
    /缺许可正文[\s\S]*missing-text@1.0.0 \| MIT \| 从上游补/,
  );
  assert.doesNotMatch(
    result.markdown,
    /builder@|test-helper@|local-vendor@|host@|macro@|macro-child@/,
  );
  assert.equal(
    (await generateNotices(data, tree, directory)).markdown,
    result.markdown,
  );
  await t.test("notices: REUSE LICENSES files provide bodies", async () => {
    const reuseData = structuredClone(data);
    const reuse = addRust(
      reuseData,
      rustPackage("reuse", join(directory, "registry/reuse")),
    );
    const path = dirname(reuse.manifest_path);
    await file(join(path, "LICENSES/MIT.txt"), "REUSE MIT body\n");
    await file(join(path, "LICENSES/Apache-2.0.txt"), "REUSE Apache body\n");
    await file(
      join(path, "nested/licenses/ignored.txt"),
      "lowercase directory body\n",
    );
    const generated = await generateNotices(
      reuseData,
      `${tree}reuse v1.0.0\n`,
      directory,
    );
    assert.equal(generated.groups, 3);
    assert.deepEqual(generated.missing.map(packageId), ["missing-text@1.0.0"]);
    assert.match(generated.markdown, /REUSE MIT body/);
    assert.match(generated.markdown, /REUSE Apache body/);
    assert.doesNotMatch(generated.markdown, /lowercase directory body/);
  });
  await t.test("notices: repository headings cover bodies", async () => {
    for (const level of [1, 2, 3, 4]) {
      const generated = await generateNotices(
        {
          ...data,
          notices: `${"#".repeat(level)} missing-text 1.0.0 — LICENSE`,
        },
        tree,
        directory,
      );
      assert.deepEqual(generated.missing, []);
      assert.deepEqual(generated.covered.map(packageId), [
        "missing-text@1.0.0",
      ]);
      assert.match(generated.markdown, /缺许可正文[\s\S]*\| 无 \| — \| — \|/);
      assert.match(
        generated.markdown,
        /由仓库 THIRD_PARTY_NOTICES\.md 提供正文的包[\s\S]*\| rust: missing-text@1\.0\.0 \| MIT \| \[THIRD_PARTY_NOTICES\.md\]\(THIRD_PARTY_NOTICES\.md\) \|/,
      );
    }
  });
  await t.test("notices: shared headings cover every package", async () => {
    const shared = structuredClone(data);
    const npm = {
      name: "npm-declared",
      versions: ["1.0.0"],
      paths: [join(directory, "npm-declared")],
      license: "MIT",
    };
    shared.npm.MIT.push(npm);
    await file(
      join(npm.paths[0], "package.json"),
      JSON.stringify({ name: npm.name, version: "1.0.0" }),
    );
    shared.notices = "### missing-text 1.0.0 / npm-declared 1.0.0 — LICENSE";
    const generated = await generateNotices(shared, tree, directory);
    assert.deepEqual(generated.missing, []);
    assert.deepEqual(generated.covered.map(packageId), [
      "npm-declared@1.0.0",
      "missing-text@1.0.0",
    ]);
    assert.match(generated.markdown, /\| npm: npm-declared@1\.0\.0 \| MIT \|/);
    assert.match(generated.markdown, /\| rust: missing-text@1\.0\.0 \| MIT \|/);
  });
  await t.test("notices: versions and heading levels must match", async () => {
    const upgraded = structuredClone(data);
    const upgradedMissing = upgraded.metadata.packages.find(
      (pkg) => pkg.name === missing.name,
    );
    upgradedMissing.version = "1.0.1";
    for (const notices of [
      "### missing-text 1.0.0 — LICENSE",
      "missing-text 1.0.1 — LICENSE",
      "##### missing-text 1.0.1 — LICENSE",
    ]) {
      const generated = await generateNotices(
        { ...upgraded, notices },
        tree.replace("missing-text v1.0.0", "missing-text v1.0.1"),
        directory,
      );
      assert.deepEqual(generated.missing.map(packageId), [
        "missing-text@1.0.1",
      ]);
      assert.deepEqual(generated.covered, []);
      assert.match(
        generated.markdown,
        /由仓库 THIRD_PARTY_NOTICES\.md 提供正文的包[\s\S]*\| 无 \| — \| — \|/,
      );
    }
  });
  for (const [label, name, version, notices] of [
    ["name suffix", "sys", "1.0.0", "### webview2-com-sys 1.0.0 — LICENSE"],
    ["name prefix", "missing-text", "1.0.0", "### xmissing-text 1.0.0"],
    ["version prefix", "missing-text", "1.0.1", "### missing-text 1.0.10"],
  ]) {
    await t.test(`notices: headings reject ${label} matches`, async () => {
      const exact = structuredClone(data);
      const target = exact.metadata.packages.find(
        (pkg) => pkg.name === missing.name,
      );
      target.name = name;
      target.version = version;
      exact.notices = notices;
      const output = await generateNotices(
        exact,
        tree.replace("missing-text v1.0.0", `${name} v${version}`),
        directory,
      );
      assert.deepEqual(output.missing.map(packageId), [`${name}@${version}`]);
      assert.deepEqual(output.covered, []);
    });
  }
  await t.test("notices: headings cover scoped npm packages", async () => {
    const scoped = structuredClone(data);
    const npm = {
      name: "@scope/name",
      versions: ["1.0.0"],
      paths: [join(directory, "scoped-package")],
      license: "MIT",
    };
    scoped.npm.MIT.push(npm);
    await file(
      join(npm.paths[0], "package.json"),
      JSON.stringify({ name: npm.name, version: "1.0.0" }),
    );
    scoped.notices = "### @scope/name 1.0.0 — LICENSE";
    const output = await generateNotices(scoped, tree, directory);
    assert.deepEqual(output.covered.map(packageId), ["@scope/name@1.0.0"]);
    assert.deepEqual(output.missing.map(packageId), ["missing-text@1.0.0"]);
    assert.match(output.markdown, /\| npm: @scope\/name@1\.0\.0 \| MIT \|/);
  });
  await file(join(dirname(missing.manifest_path), "UNLICENSE"), "\n");
  await assert.rejects(
    generateNotices(data, tree, directory),
    /无法解析.*许可正文/,
  );
});
