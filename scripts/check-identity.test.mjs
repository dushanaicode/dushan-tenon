import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { readIdentityFiles, scanIdentity } from "./check-identity.mjs";

const configPath = "src-tauri/tauri.conf.json";
const cargoPath = "src-tauri/Cargo.toml";
const desktopIdentityPath = "crates/desktop/src/identity.rs";

function fixture() {
  return new Map([
    [
      configPath,
      JSON.stringify(
        {
          mainBinaryName: "dushan-tenon",
          productName: "Dushan Tenon",
          identifier: "com.dushan.tenon",
        },
        null,
        2,
      ),
    ],
    [
      cargoPath,
      [
        "[package]",
        'name = "dushan-tenon"',
        'default-run = "dushan-tenon"',
        "[lib]",
        'name = "dushan_tenon_lib"',
        "[dependencies]",
        'name = "unrelated"',
      ].join("\n"),
    ],
    ["package.json", '{\n  "name": "dushan-tenon"\n}'],
    [
      desktopIdentityPath,
      [
        "//! Product identity.",
        'pub const CREDENTIAL_SERVICE: &str = "com.dushan.tenon";',
        'pub const DEFAULT_CACHE_KEY_PREFIX: &str = "dushan-tenon";',
      ].join("\n"),
    ],
    [
      "index.html",
      "<html>\n<head>\n<title>Dushan Tenon</title>\n</head>\n</html>",
    ],
  ]);
}

function replace(files, path, before, after) {
  const source = files.get(path);
  assert.equal(typeof source, "string");
  assert.ok(source.includes(before), `Fixture does not contain ${before}`);
  files.set(path, source.replace(before, after));
}

function rejects(files, rule, path, message, line) {
  const violations = scanIdentity(files);
  assert.ok(
    violations.some(
      (violation) =>
        violation.rule === rule &&
        violation.path === path &&
        message.test(violation.message) &&
        (line === undefined || violation.line === line),
    ),
    JSON.stringify(violations, null, 2),
  );
}

test("identity: real repository satisfies I1 through I5", async () => {
  assert.deepEqual(scanIdentity(await readIdentityFiles(resolve("."))), []);
});

test("identity: Dushan Tenon identity is valid without mutating input", () => {
  const files = fixture();
  const before = new Map(files);
  assert.deepEqual(scanIdentity(files), []);
  assert.deepEqual(files, before);
});

test("identity: reader loads only identity text", async (t) => {
  const temporary = resolve("Temp/test/identity-tests");
  await mkdir(temporary, { recursive: true });
  const parent = await realpath(temporary);
  assert.equal(parent, temporary);
  const directory = await realpath(await mkdtemp(join(parent, "identity-")));
  assert.equal(dirname(directory), parent);
  t.after(async () => {
    assert.equal(dirname(await realpath(directory)), parent);
    await rm(directory, { recursive: true });
  });
  for (const [path, source] of fixture()) {
    await mkdir(dirname(join(directory, path)), { recursive: true });
    await writeFile(join(directory, path), source, "utf8");
  }
  const loaded = await readIdentityFiles(directory);
  assert.deepEqual(loaded, fixture());
  assert.deepEqual(scanIdentity(loaded), []);
  const empty = join(directory, "empty");
  await mkdir(empty);
  const missing = await readIdentityFiles(empty);
  for (const [rule, path] of [
    ["I1", configPath],
    ["I2", cargoPath],
    ["I2", "package.json"],
    ["I3", desktopIdentityPath],
    ["I4", desktopIdentityPath],
    ["I5", "index.html"],
  ])
    rejects(missing, rule, path, /无法解析/, 1);
});

for (const [key, value] of [
  ["mainBinaryName", "Dushan Tenon App"],
  ["mainBinaryName", "dushan-tenon--app"],
  ["mainBinaryName", ""],
  ["identifier", "single"],
  ["identifier", "Com.example"],
  ["identifier", "com.1example"],
  ["identifier", "com.example_board"],
  ["productName", "  "],
]) {
  test(`I1 rejects invalid ${key}: ${JSON.stringify(value)}`, () => {
    const files = fixture();
    const config = JSON.parse(files.get(configPath));
    files.set(configPath, JSON.stringify({ ...config, [key]: value }, null, 2));
    rejects(files, "I1", configPath, new RegExp(key));
  });
}

for (const [before, after, line] of [
  ['name = "dushan-tenon"', 'name = "other"', 2],
  ['default-run = "dushan-tenon"', 'default-run = "other"', 3],
  ['name = "dushan_tenon_lib"', 'name = "other_lib"', 5],
]) {
  test(`I2 rejects Cargo mismatch: ${before}`, () => {
    const files = fixture();
    replace(files, cargoPath, before, after);
    rejects(files, "I2", cargoPath, /tauri\.conf\.json mainBinaryName/, line);
  });
}

test("I2 rejects npm name mismatch", () => {
  const files = fixture();
  replace(files, "package.json", "dushan-tenon", "other");
  rejects(files, "I2", "package.json", /tauri\.conf\.json mainBinaryName/, 2);
});

test("I5 rejects identity mismatch in index.html", () => {
  const files = fixture();
  replace(files, "index.html", "Dushan Tenon", "Other");
  rejects(files, "I5", "index.html", /tauri\.conf\.json productName/, 3);
});

for (const [rule, name, before, after, key, line] of [
  [
    "I3",
    "CREDENTIAL_SERVICE",
    "com.dushan.tenon",
    "com.example.other",
    "identifier",
    2,
  ],
  [
    "I4",
    "DEFAULT_CACHE_KEY_PREFIX",
    '"dushan-tenon"',
    '"other-app"',
    "mainBinaryName",
    3,
  ],
]) {
  test(`${rule} rejects desktop identity mismatch`, () => {
    const files = fixture();
    replace(files, desktopIdentityPath, before, after);
    rejects(
      files,
      rule,
      desktopIdentityPath,
      new RegExp(`tauri\\.conf\\.json ${key}`),
      line,
    );
  });
  test(`${rule} rejects missing or commented ${name}`, () => {
    for (const replacement of [
      `// pub const ${name}`,
      `pub const OTHER_${name}`,
    ]) {
      const files = fixture();
      replace(files, desktopIdentityPath, `pub const ${name}`, replacement);
      rejects(
        files,
        rule,
        desktopIdentityPath,
        new RegExp(`无法解析 ${name}`),
        1,
      );
    }
  });
}

test("I3 and I4 follow a changed product identity", () => {
  const files = new Map(
    [...fixture()].map(([path, text]) => [
      path,
      text
        .replaceAll("com.dushan.tenon", "org.example.board")
        .replaceAll("dushan-tenon", "example-board")
        .replaceAll("dushan_tenon", "example_board")
        .replaceAll("Dushan Tenon", "Example Board"),
    ]),
  );
  assert.deepEqual(scanIdentity(files), []);
});

for (const [rule, path, key] of [
  ["I1", configPath, "mainBinaryName"],
  ["I1", configPath, "productName"],
  ["I1", configPath, "identifier"],
  ["I2", "package.json", "name"],
]) {
  test(`${rule} rejects missing or non-string JSON key ${key}`, () => {
    for (const value of [undefined, null, 123]) {
      const files = fixture();
      const object = JSON.parse(files.get(path));
      files.set(path, JSON.stringify({ ...object, [key]: value }, null, 2));
      rejects(files, rule, path, new RegExp(`无法解析 ${key}`));
    }
    const files = fixture();
    files.set(path, "{ invalid JSON");
    rejects(files, rule, path, /无法解析 JSON/);
  });
}

for (const [rule, path, removed, label] of [
  ["I2", cargoPath, 'name = "dushan-tenon"', "[package] name"],
  ["I2", cargoPath, 'default-run = "dushan-tenon"', "[package] default-run"],
  ["I2", cargoPath, 'name = "dushan_tenon_lib"', "[lib] name"],
  ["I5", "index.html", "<title>Dushan Tenon</title>", "<title>"],
]) {
  test(`${rule} rejects missing ${label}`, () => {
    const files = fixture();
    replace(files, path, removed, "");
    rejects(files, rule, path, /无法解析/);
    assert.ok(
      scanIdentity(files).some(({ message }) => message.includes(label)),
    );
  });
}

test("identity reports violations in stable rule/path/line order", () => {
  const files = fixture();
  replace(files, "index.html", "Dushan Tenon", "Other");
  replace(files, cargoPath, 'name = "dushan-tenon"', 'name = "other"');
  assert.deepEqual(
    scanIdentity(files).map(({ rule }) => rule),
    ["I2", "I5"],
  );
});
