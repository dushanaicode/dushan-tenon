import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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
import { checkCommandAdmission } from "./check-ipc.mjs";
import {
  checkRelease,
  generatedReleaseConfig,
  generateRelease,
  releaseFields,
} from "./check-release.mjs";

const identity = { identifier: "fixture" };
const versions = { workspace: "1.2.3", tauri: "1.2.3", package: "1.2.3" };
const key = Buffer.concat([Buffer.from("Ed"), Buffer.alloc(40, 1)]);
const release = {
  productId: "fixture",
  channel: "stable",
  endpoints: ["https://updates.example.test/stable"],
  pubkey: Buffer.from(
    `untrusted comment: test\n${key.toString("base64")}\n`,
  ).toString("base64"),
  downloadHosts: ["downloads.example.test"],
  target: "windows-x86_64-nsis",
};
const config = {
  bundle: { active: true },
  app: { security: { csp: "unchanged" } },
};

test("release checker can be imported from node eval", () => {
  const path = new URL("./check-release.mjs", import.meta.url).href;
  const result = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", `await import(${JSON.stringify(path)})`],
    { encoding: "utf8", windowsHide: true },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "");
});

test("null release leaves the default build unsigned", () => {
  assert.equal(releaseFields(null, identity, versions), null);
  assert.deepEqual(generatedReleaseConfig(config, null), config);
  assert.deepEqual(generatedReleaseConfig({ ...config, plugins: {} }, null), {
    ...config,
    plugins: {},
  });
  const generated = generatedReleaseConfig(
    config,
    releaseFields(release, identity, versions),
  );
  assert.equal(generated.bundle.createUpdaterArtifacts, true);
  assert.equal(generated.plugins.updater.requireSignedVersion, true);
  assert.equal(generated.plugins.updater.allowDowngrades, false);
  assert.deepEqual(generated.app, config.app);
  assert.deepEqual(generatedReleaseConfig(generated, null), config);
  for (const artifacts of ["v1Compatible", false]) {
    const leaked = {
      ...config,
      bundle: { ...config.bundle, createUpdaterArtifacts: artifacts },
    };
    assert.notDeepEqual(generatedReleaseConfig(leaked, null), leaked);
    assert.notDeepEqual(
      generatedReleaseConfig(
        leaked,
        releaseFields(release, identity, versions),
      ),
      leaked,
    );
  }
});

test("release rejects invalid production contracts and v1 ZIP", () => {
  for (const change of [
    { productId: "wrong" },
    { channel: "beta" },
    { endpoints: [] },
    { endpoints: ["http://updates.example.test"] },
    { endpoints: ["https://user:password@updates.example.test"] },
    { downloadHosts: ["downloads.example.test/path"] },
    { downloadHosts: ["Downloads.example.test"] },
    { downloadHosts: ["downloads.example.test:443"] },
    { downloadHosts: [] },
    { pubkey: "" },
    {
      pubkey: Buffer.from("untrusted comment: invalid\nAAAA").toString(
        "base64",
      ),
    },
    { target: "windows-x86_64-nsis.zip" },
    { target: "linux-x86_64-deb" },
    { target: "linux-x86_64-rpm" },
    { target: "linux-x86_64-appimage.tar.gz" },
    { target: "darwin-i686-app" },
    { createUpdaterArtifacts: "v1Compatible" },
  ]) {
    assert.throws(() =>
      releaseFields({ ...release, ...change }, identity, versions),
    );
  }
  assert.throws(() =>
    releaseFields(release, identity, { ...versions, tauri: "1.2.4" }),
  );
  assert.throws(() =>
    releaseFields(release, identity, { ...versions, package: "1.2.4" }),
  );
});

test("Unix release targets are explicit app bundles or bare AppImages", () => {
  for (const target of [
    "darwin-x86_64-app",
    "darwin-aarch64-app",
    "linux-x86_64-appimage",
    "linux-aarch64-appimage",
  ]) {
    assert.equal(
      releaseFields({ ...release, target }, identity, versions)
        .createUpdaterArtifacts,
      true,
    );
  }
});

test("update status is normal active and never control", () => {
  assert.doesNotThrow(() =>
    checkCommandAdmission(
      [
        ["app_update_status", "normal"],
        ["app_update_install", "maintenance"],
        ["app_backup_export", "maintenance"],
        ["app_backup_restore", "maintenance"],
        ["app_operation_cancel", "control"],
      ],
      [
        ["app_update_status", "execute"],
        ["app_update_install", "execute"],
        ["app_backup_export", "execute"],
        ["app_backup_restore", "execute"],
        ["app_operation_cancel", "execute_control"],
      ],
    ),
  );
  assert.throws(() =>
    checkCommandAdmission(
      [["app_update_status", "control"]],
      [["app_update_status", "execute_control"]],
    ),
  );
});

test("window controls are an exact admission exception", () => {
  for (const command of [
    "app_window_minimize",
    "app_window_toggle_maximize",
    "app_window_close",
    "app_window_close_decide",
    "app_window_watch",
  ]) {
    assert.doesNotThrow(() =>
      checkCommandAdmission(
        [[command, "control"]],
        [[command, "execute_control"]],
      ),
    );
    for (const admission of ["normal", "maintenance"]) {
      assert.throws(() =>
        checkCommandAdmission([[command, admission]], [[command, "execute"]]),
      );
    }
  }
  for (const command of ["app_window_state_reset", "app_window_other"]) {
    assert.throws(() =>
      checkCommandAdmission(
        [[command, "control"]],
        [[command, "execute_control"]],
      ),
    );
  }
});

test("null release still requires consistent valid versions", () => {
  for (const change of [
    { tauri: "1.2.4" },
    { package: "1.2.4" },
    { workspace: "1.2.4" },
  ]) {
    assert.throws(() =>
      releaseFields(null, identity, { ...versions, ...change }),
    );
  }
  assert.throws(() =>
    releaseFields(null, identity, {
      workspace: "invalid",
      tauri: "invalid",
      package: "invalid",
    }),
  );
  assert.equal(
    releaseFields(null, identity, {
      workspace: "0.1.0-alpha.1",
      tauri: "0.1.0-alpha.1",
      package: "0.1.0-alpha.1",
    }),
    null,
  );
});

test("release generation and checking use file identity and versions without a brand module", async (t) => {
  t.mock.method(console, "log", () => {});
  const temporary = resolve(process.env.TEMP, "release-test");
  await mkdir(temporary, { recursive: true });
  const parent = await realpath(temporary);
  const directory = await realpath(await mkdtemp(join(parent, "release-")));
  assert.equal(dirname(directory), parent);
  t.after(() => rm(directory, { recursive: true }));
  await mkdir(join(directory, "src-tauri"));
  const configFile = join(directory, "src-tauri/tauri.conf.json");
  const releaseFile = join(directory, "src-tauri/release.json");
  const cargoFile = join(directory, "Cargo.toml");
  const manifestFile = join(directory, "package.json");
  const baseConfig = {
    ...config,
    ...identity,
    version: "1.2.3",
    plugins: { other: { enabled: true } },
  };
  const baseCargo =
    '[workspace]\nversion = "wrong"\n[workspace.package]\nversion = "1.2.3"\n[workspace.dependencies]\nversion = "wrong"\n';
  await writeFile(cargoFile, baseCargo);
  await writeFile(manifestFile, JSON.stringify({ version: "1.2.3" }));
  await writeFile(configFile, JSON.stringify(baseConfig));
  await writeFile(releaseFile, "null\n");
  await checkRelease(directory);
  const original = await readFile(configFile);
  await generateRelease(directory);
  assert.deepEqual(await readFile(configFile), original);

  await writeFile(releaseFile, JSON.stringify(release));
  await assert.rejects(checkRelease(directory), /发行配置有漂移/);
  await generateRelease(directory);
  await checkRelease(directory);
  assert.deepEqual(
    JSON.parse(await readFile(configFile, "utf8")),
    generatedReleaseConfig(
      baseConfig,
      releaseFields(release, identity, versions),
    ),
  );

  await writeFile(
    releaseFile,
    JSON.stringify({ ...release, productId: "wrong" }),
  );
  await assert.rejects(generateRelease(directory), /identifier/);
  await writeFile(releaseFile, "null\n");
  await assert.rejects(checkRelease(directory), /发行配置有漂移/);
  await generateRelease(directory);
  await checkRelease(directory);
  assert.deepEqual(JSON.parse(await readFile(configFile, "utf8")), baseConfig);

  for (const [file, invalid] of [
    [configFile, JSON.stringify({ ...baseConfig, version: "1.2.4" })],
    [manifestFile, JSON.stringify({ version: "1.2.4" })],
    [cargoFile, baseCargo.replace('version = "1.2.3"', 'version = "1.2.4"')],
  ]) {
    const before = await readFile(file);
    await writeFile(file, invalid);
    await assert.rejects(checkRelease(directory), /版本不一致/);
    await assert.rejects(generateRelease(directory), /版本不一致/);
    await writeFile(file, before);
  }
});
