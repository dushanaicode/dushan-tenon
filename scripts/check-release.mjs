import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { root } from "./common.mjs";

const fields = [
  "channel",
  "downloadHosts",
  "endpoints",
  "productId",
  "pubkey",
  "target",
];

function publicKey(value) {
  assert.equal(typeof value, "string", "发行公钥必须为字符串");
  assert.match(value, /^[A-Za-z0-9+/]+={0,2}$/, "发行公钥必须为 Base64");
  const text = Buffer.from(value, "base64").toString("utf8");
  const lines = text.trimEnd().split(/\r?\n/);
  assert.equal(lines.length, 2, "发行公钥必须是 minisign 公钥");
  assert.match(lines[0], /^untrusted comment: /);
  assert.match(lines[1], /^[A-Za-z0-9+/]{56}$/);
  const key = Buffer.from(lines[1], "base64");
  assert.equal(key.length, 42);
  assert.equal(key.subarray(0, 2).toString("ascii"), "Ed");
}

export function releaseFields(release, config, versions) {
  assert.equal(
    versions.workspace,
    versions.tauri,
    "workspace 与 Tauri 版本不一致",
  );
  assert.equal(
    versions.workspace,
    versions.package,
    "workspace 与 package 版本不一致",
  );
  assert.match(
    versions.workspace,
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/,
  );
  if (release === null) return null;
  assert.ok(release && typeof release === "object" && !Array.isArray(release));
  assert.deepEqual(
    Object.keys(release).sort(),
    fields,
    "发行配置字段必须精确匹配",
  );
  assert.equal(
    release.productId,
    config.identifier,
    "发行产品必须匹配 tauri.conf.json 的 identifier",
  );
  assert.equal(release.channel, "stable", "仅支持 stable");
  assert.match(
    release.target,
    /^(?:windows-(?:x86_64|aarch64|i686)-(?:nsis|msi)|darwin-(?:x86_64|aarch64)-app|linux-(?:x86_64|aarch64)-appimage)$/,
  );
  publicKey(release.pubkey);
  for (const key of ["endpoints", "downloadHosts"]) {
    assert.ok(Array.isArray(release[key]) && release[key].length > 0);
    assert.ok(release[key].length <= 16);
    assert.equal(new Set(release[key]).size, release[key].length);
  }
  for (const host of release.downloadHosts) {
    assert.equal(typeof host, "string");
    const url = new URL(`https://${host}`);
    assert.equal(url.hostname, host, "下载主机须使用精确小写主机名");
    assert.equal(url.host, host);
    assert.equal(url.pathname, "/");
    assert.equal(url.username + url.password + url.search + url.hash, "");
  }
  for (const endpoint of release.endpoints) {
    assert.equal(typeof endpoint, "string");
    assert.ok(endpoint.length <= 2048);
    const url = new URL(endpoint);
    assert.equal(url.protocol, "https:", "发行端点必须为 HTTPS");
    assert.equal(url.username + url.password + url.hash, "");
    assert.ok(url.hostname);
  }
  return {
    createUpdaterArtifacts: true,
    updater: {
      endpoints: release.endpoints,
      pubkey: release.pubkey,
      requireSignedVersion: true,
      allowDowngrades: false,
    },
  };
}

export function generatedReleaseConfig(config, fields) {
  const result = structuredClone(config);
  delete result.bundle.createUpdaterArtifacts;
  if (result.plugins && Object.hasOwn(result.plugins, "updater")) {
    delete result.plugins.updater;
    if (Object.keys(result.plugins).length === 0) delete result.plugins;
  }
  if (fields !== null) {
    result.bundle.createUpdaterArtifacts = fields.createUpdaterArtifacts;
    result.plugins = { ...result.plugins, updater: fields.updater };
  }
  return result;
}

async function inputs(directory) {
  const [release, config, manifest, cargo] = await Promise.all([
    readFile(join(directory, "src-tauri/release.json"), "utf8").then(
      JSON.parse,
    ),
    readFile(join(directory, "src-tauri/tauri.conf.json"), "utf8").then(
      JSON.parse,
    ),
    readFile(join(directory, "package.json"), "utf8").then(JSON.parse),
    readFile(join(directory, "Cargo.toml"), "utf8"),
  ]);
  const workspace = cargo
    .split("[workspace.package]")[1]
    .split("\n[")[0]
    .match(/^version\s*=\s*"([^"]+)"/m)?.[1];
  const fields = releaseFields(release, config, {
    workspace,
    tauri: config.version,
    package: manifest.version,
  });
  return { config, expected: generatedReleaseConfig(config, fields) };
}

export async function checkRelease(directory = root) {
  const { config, expected } = await inputs(directory);
  assert.deepEqual(
    config,
    expected,
    "发行配置有漂移，请运行 pnpm generate；不允许 v1Compatible/ZIP",
  );
  console.log("发行配置检查通过");
}

export async function generateRelease(directory = root) {
  const { config, expected } = await inputs(directory);
  if (JSON.stringify(config) !== JSON.stringify(expected)) {
    await writeFile(
      join(directory, "src-tauri/tauri.conf.json"),
      `${JSON.stringify(expected, null, 2)}\n`,
    );
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  assert.deepEqual(process.argv.slice(2), ["--check"]);
  await checkRelease();
}
