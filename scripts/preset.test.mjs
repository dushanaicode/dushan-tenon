import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { root } from "./common.mjs";
import { hostCli, hostDbCliFeature, hostPackage } from "./product.mjs";

const modules = ["account", "notify", "files", "devtools", "demo"];
const presets = [
  { name: "minimal", enabledModules: ["account"] },
  { name: "tool", enabledModules: ["account", "notify"] },
  { name: "full", enabledModules: modules },
];

async function fixture(t) {
  const temporary = resolve(process.env.TEMP, "preset-test");
  await mkdir(temporary, { recursive: true });
  const parent = await realpath(temporary);
  const directory = await realpath(await mkdtemp(join(parent, "preset-test-")));
  assert.equal(dirname(directory), parent);
  t.after(() => rm(directory, { recursive: true }));
  for (const path of [
    "scripts",
    "presets",
    "src-tauri",
    "src/lib/generated",
    "Temp",
  ]) {
    await mkdir(join(directory, path), { recursive: true });
  }
  for (const file of ["preset.mjs", "common.mjs", "product.mjs"]) {
    await copyFile(
      join(root, "scripts", file),
      join(directory, "scripts", file),
    );
  }
  await copyFile(
    join(root, "src-tauri/Cargo.toml"),
    join(directory, "src-tauri/Cargo.toml"),
  );
  for (const { name } of presets) {
    const file = `${name}.toml`;
    await copyFile(
      join(root, "presets", file),
      join(directory, "presets", file),
    );
  }
  // CLI 消费生成的名称与模块列表；真实配置加载由生成器覆盖。
  await writeFile(
    join(directory, "src/lib/generated/assembly.ts"),
    `export const PRESET_CATALOG = ${JSON.stringify(presets)};\n`,
  );
  await writeFile(join(directory, "package.json"), '{"type":"module"}\n');
  return directory;
}

function run(directory, args) {
  const temporary = join(directory, "Temp");
  const result = spawnSync(
    process.execPath,
    [join(directory, "scripts/preset.mjs"), ...args],
    {
      // 相对状态目录按仓库根解析，不跟随调用者的工作目录。
      cwd: temporary,
      env: {
        ...process.env,
        TEMP: temporary,
        TMP: temporary,
        TMPDIR: temporary,
        NODE_COMPILE_CACHE: join(temporary, "node-compile-cache"),
      },
      encoding: "utf8",
      windowsHide: true,
    },
  );
  assert.ifError(result.error);
  return result;
}

test("product derives the package, CLI and feature from Cargo package metadata", async (t) => {
  assert.equal(hostCli, `${hostPackage}-cli`);
  assert.equal(hostDbCliFeature, `${hostPackage}/db-cli`);
  const directory = await fixture(t);
  await writeFile(
    join(directory, "src-tauri/Cargo.toml"),
    '[package]\nname = "sample-board"\n[dependencies]\nname = "unrelated"\n',
  );
  const product = await import(
    pathToFileURL(join(directory, "scripts/product.mjs")).href
  );
  assert.equal(product.hostPackage, "sample-board");
  assert.equal(product.hostCli, "sample-board-cli");
  assert.equal(product.hostDbCliFeature, "sample-board/db-cli");
  const result = run(directory, ["minimal", "--state-root", "Temp/sample"]);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes(`${product.hostPackage}.exe --state-root`));
});

test("product refuses a missing package name instead of reading another table", async (t) => {
  const directory = await fixture(t);
  await writeFile(
    join(directory, "src-tauri/Cargo.toml"),
    '[package]\nversion = "1.0.0"\n[dependencies]\nname = "unrelated"\n',
  );
  await assert.rejects(
    import(pathToFileURL(join(directory, "scripts/product.mjs")).href),
    /无法解析.*\[package\] name/,
  );
});

test("preset copies the selected seed into a fresh state root", async (t) => {
  const directory = await fixture(t);
  for (const { name, enabledModules } of presets) {
    const relativeRoot = `Temp/${name} state`;
    const stateRoot = join(directory, relativeRoot);
    const result = run(directory, [name, "--state-root", relativeRoot]);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(
      await readFile(join(stateRoot, "config.toml")),
      await readFile(join(root, "presets", `${name}.toml`)),
    );
    assert.ok(result.stdout.includes(`状态目录：${stateRoot}`));
    assert.ok(
      result.stdout.includes(`配置文件：${join(stateRoot, "config.toml")}`),
    );
    assert.ok(result.stdout.includes(`启用模块：${enabledModules.join(", ")}`));
    assert.ok(
      result.stdout.includes(`${hostPackage}.exe --state-root "${stateRoot}"`),
    );
    assert.ok(result.stdout.includes("pnpm dev 固定使用 Temp/dev-state"));
    assert.ok(result.stdout.includes("不带 --state-root 运行 pnpm preset"));
    assert.ok(!result.stdout.includes("pnpm dev --"));
  }
});

test("preset explains the default development state root", async (t) => {
  for (const args of [[], ["--state-root", "Temp/unused/../dev-state"]]) {
    const directory = await fixture(t);
    const result = run(directory, ["minimal", ...args]);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(
      await readFile(join(directory, "Temp/dev-state/config.toml")),
      await readFile(join(root, "presets/minimal.toml")),
    );
    assert.ok(result.stdout.includes("运行 pnpm dev 即可使用该配置"));
    assert.ok(!result.stdout.includes(`${hostPackage}.exe`));
    assert.ok(!result.stdout.includes("pnpm dev --"));
  }
});

test("preset refuses an existing config", async (t) => {
  const directory = await fixture(t);
  const stateRoot = join(directory, "Temp/existing");
  await mkdir(stateRoot);
  const configFile = join(stateRoot, "config.toml");
  const original = Buffer.from([0, 255, 13, 10, 65, 66, 67]);
  await writeFile(configFile, original);
  const result = run(directory, ["full", "--state-root", stateRoot]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /配置文件已存在，拒绝覆盖/);
  assert.deepEqual(await readFile(configFile), original);
});

test("preset rejects unknown or repeated arguments", async (t) => {
  const directory = await fixture(t);
  for (const args of [
    [],
    ["unknown"],
    ["workspace"],
    ["minimal", "extra"],
    ["minimal", "--force"],
    ["minimal", "--state-root"],
    ["minimal", "--state-root", ""],
    ["minimal", "--state-root", "--force"],
    ["minimal", "--state-root", "Temp/a", "--state-root", "Temp/b"],
  ]) {
    const result = run(directory, args);
    assert.notEqual(result.status, 0, JSON.stringify(args));
    assert.match(result.stderr, /用法: pnpm preset/);
  }
  for (const name of ["dev-state", "a", "b"]) {
    await assert.rejects(
      readFile(join(directory, "Temp", name, "config.toml")),
      { code: "ENOENT" },
    );
  }
});

test("preset files declare every module explicitly", async () => {
  assert.deepEqual((await readdir(join(root, "presets"))).sort(), [
    "full.toml",
    "minimal.toml",
    "tool.toml",
  ]);
  for (const { name, enabledModules } of presets) {
    const text = await readFile(join(root, "presets", `${name}.toml`), "utf8");
    const sections = [...text.matchAll(/^\[([^\]]+)\]$/gm)].map(
      (match) => match[1],
    );
    assert.deepEqual(sections, [
      "auth",
      "window",
      "tray",
      "modules.account",
      "modules.notify",
      "modules.files",
      "modules.devtools",
      "ui",
      "autostart",
      "shortcuts",
      "network",
      "modules.demo",
      "updater",
    ]);
    const entries = [
      ...text.matchAll(/^\[modules\.([a-z]+)\]\r?\nenabled = (true|false)$/gm),
    ].map((match) => [match[1], match[2] === "true"]);
    assert.deepEqual(
      entries,
      modules.map((id) => [id, enabledModules.includes(id)]),
      name,
    );
    const mode = name === "full" ? "login" : "none";
    assert.ok(text.includes(`mode = "${mode}"`));
    for (const line of [
      'language = "zh-CN"',
      'theme = "system"',
      'theme_style = "standard"',
      'accent = "neutral"',
      'density = "comfortable"',
      "motion = true",
      "developer_mode = false",
      "check_on_start = false",
      `titlebar = "${name === "full" ? "hidden" : "native"}"`,
      'close_action = "ask"',
    ]) {
      assert.equal(
        text.split(/\r?\n/).filter((value) => value === line).length,
        1,
        `${name}: ${line}`,
      );
    }
    assert.match(text, /\[tray\]\r?\nenabled = true\r?\n(?:\r?\n|\[)/);
  }
});

test("generated preset catalog contains only consumed fields and current modules", async () => {
  const { PRESET_CATALOG } = await import("../src/lib/generated/assembly.ts");
  assert.deepEqual(
    [...PRESET_CATALOG].sort((a, b) => a.name.localeCompare(b.name)),
    [...presets].sort((a, b) => a.name.localeCompare(b.name)),
  );
});
