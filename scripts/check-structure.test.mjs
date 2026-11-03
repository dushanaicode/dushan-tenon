import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "node:test";
import {
  frameworkModules,
  scanAgentsSize,
  scanCrateDependencies,
  scanFrameworkIdentity,
  scanFrameworkLayers,
  scanFrontend,
  scanLegacyBrand,
  scanModuleDocs,
} from "./check-structure.mjs";

const identity = {
  identifier: "com.dushan.sample",
  binary: "dushan-sample",
  product: "Dushan Sample",
};

function frontend(path, text, allowlist = []) {
  return scanFrontend(
    new Map([[path, Buffer.from(text)]]),
    identity,
    allowlist,
  );
}

test("tauri-api-boundary: imports and re-exports outside ipc are rejected", () => {
  for (const source of [
    'import { invoke } from "@tauri-apps/api/core";',
    'import type { Channel } from "@tauri-apps/api/core";',
    'import "@tauri-apps/api";',
    'const api = import("@tauri-apps/api/window");',
    'export { Channel } from "@tauri-apps/api/core";',
    'export type { Channel } from "@tauri-apps/api/core";',
    'export * from "@tauri-apps/api";',
    'type Native = import("@tauri-apps/api/core").Channel<string>;',
  ]) {
    for (const path of [
      "src/lib/generated/commands.ts",
      "src/core/adapter.ts",
      "src/app/adapter.test.ts",
      "src/lib/ipc-other/adapter.ts",
      "src/lib/ipc.ts",
    ]) {
      const violations = frontend(path, source);
      assert.equal(violations.length, 1, `${path}: ${source}`);
      assert.equal(violations[0].rule, "tauri-api-boundary");
    }
  }
});

test("tauri-api-boundary: ipc and its tests may use all Tauri API imports", () => {
  const source = [
    'import { invoke } from "@tauri-apps/api/core";',
    'import type { Channel } from "@tauri-apps/api/core";',
    'const api = import("@tauri-apps/api/window");',
    'type Native = import("@tauri-apps/api/core").Channel<string>;',
    'export * from "@tauri-apps/api";',
  ].join("\n");
  for (const path of [
    "src/lib/ipc/invoke.ts",
    "src/lib/ipc/nested/test.test.ts",
  ]) {
    assert.deepEqual(frontend(path, source), []);
  }
  assert.deepEqual(
    frontend(
      "src/app/example.ts",
      'import "@tauri-apps/api-other"; const label = "@tauri-apps/api/core"; // import("@tauri-apps/api")',
    ),
    [],
  );
});

const layers = [
  ["lib", "src/lib/file.ts", ["lib"]],
  ["kit", "src/kit/file.ts", ["lib", "kit"]],
  ["core", "src/core/file.ts", ["lib", "kit", "core"]],
  ["visual", "src/visual/file.ts", ["lib", "kit", "core", "visual"]],
  ["shell", "src/shell/file.ts", ["lib", "kit", "core", "shell"]],
  [
    "module:files",
    "src/modules/files/file.ts",
    ["lib", "kit", "core", "module:files"],
  ],
  [
    "module:demo",
    "src/modules/demo/file.ts",
    ["lib", "kit", "core", "module:demo", "module:ai"],
  ],
  ["module:ai", "src/modules/ai/file.ts", ["lib", "kit", "core", "module:ai"]],
  [
    "app",
    "src/app/file.ts",
    [
      "lib",
      "kit",
      "core",
      "visual",
      "shell",
      "module:files",
      "module:demo",
      "module:ai",
      "app",
    ],
  ],
];

test("layer-unassigned: all assigned layers and main.tsx pass", () => {
  for (const path of [...layers.map(([, path]) => path), "src/main.tsx"]) {
    assert.deepEqual(frontend(path, "export {};"), [], path);
  }
});

test("layer-unassigned: root files and direct modules files fail once per file", () => {
  for (const path of [
    "src/foo.ts",
    "src/modules/index.ts",
    "src/unknown/foo.ts",
  ]) {
    assert.deepEqual(frontend(path, "export {};"), [
      { rule: "layer-unassigned", path, line: 1, message: "源文件未归层" },
    ]);
  }
});

test("layer-unassigned: only the specified src extensions are scanned", () => {
  for (const extension of [
    "ts",
    "tsx",
    "mts",
    "cts",
    "js",
    "jsx",
    "mjs",
    "d.ts",
  ]) {
    assert.equal(
      frontend(`src/file.${extension}`, "")[0].rule,
      "layer-unassigned",
    );
  }
  for (const path of [
    "public/file.ts",
    "scripts/file.mjs",
    "src/file.cjs",
    "src/style.css",
  ]) {
    assert.deepEqual(frontend(path, "not valid JavaScript"), []);
  }
});

for (const [from, path, allowed] of layers) {
  test(`layer-import: ${from} allows only its declared directions`, () => {
    for (const [to, target] of layers) {
      const violations = frontend(path, `import "@/${target.slice(4)}";`);
      assert.equal(
        violations.length,
        allowed.includes(to) ? 0 : 1,
        `${from} -> ${to}`,
      );
      if (violations.length) assert.equal(violations[0].rule, "layer-import");
    }
    assert.equal(
      frontend(path, 'import "@/unassigned";')[0].rule,
      "layer-import",
    );
  });
}

for (const source of [
  'import { X } from "@/core/missing";',
  'import type { X } from "@/core/missing";',
  'import "@/core/theme.css";',
  'export { X } from "@/core/missing";',
  'export type { X } from "@/core/missing";',
  'export * from "@/core/missing";',
  'export * as X from "@/core/missing";',
  'import("@/core/missing");',
]) {
  test(`layer-import: counts ${source}`, () => {
    assert.deepEqual(frontend("src/app/file.ts", source), []);
    const violations = frontend("src/lib/file.ts", `// 第一行\n${source}`);
    assert.equal(violations.length, 1);
    assert.equal(violations[0].rule, "layer-import");
    assert.equal(violations[0].line, 2);
    assert.match(violations[0].message, /src\/core\//);
  });
}

test("layer-import: resolves aliases, relative paths and normalization without filesystem lookup", () => {
  assert.deepEqual(
    frontend(
      "src/kit/nested/file.ts",
      'import "@/lib/missing"; import "../../lib/missing"; import "@/kit";',
    ),
    [],
  );
  for (const target of [
    "@/kit/../core/missing",
    "../../core/missing",
    "../../../outside",
    "@/../outside",
  ]) {
    assert.equal(
      frontend("src/kit/nested/file.ts", `import "${target}";`)[0].rule,
      "layer-import",
    );
  }
  assert.deepEqual(
    frontend("src/main.tsx", 'import "./app/app"; import "./visual/missing";'),
    [],
  );
  assert.deepEqual(
    frontend(
      "src/lib/file.ts",
      'import "react"; import "node:path"; import "@scope/pkg";',
    ),
    [],
  );
});

test("layer-import: nonliteral dynamic imports fail including static templates", () => {
  for (const expression of [
    "target",
    "`@/lib/a`",
    `\`@/lib/\${id}\``,
    '"@/lib/" + id',
    "42",
  ]) {
    const violations = frontend("src/app/file.ts", `import(${expression});`);
    assert.equal(violations.length, 1, expression);
    assert.equal(violations[0].rule, "layer-import");
    assert.match(violations[0].message, /字符串字面量/);
  }
});

test("layer-import: test files, declaration files, TSX and JSX keep imports", () => {
  for (const extension of [
    "test.ts",
    "test-support.ts",
    "d.ts",
    "mts",
    "cts",
    "mjs",
    "js",
  ]) {
    assert.equal(
      frontend(`src/lib/file.${extension}`, 'import "@/core/x";')[0].rule,
      "layer-import",
    );
  }
  for (const extension of ["tsx", "jsx"]) {
    assert.equal(
      frontend(
        `src/lib/file.${extension}`,
        'import "@/core/x"; const view = <div />;',
      )[0].rule,
      "layer-import",
    );
  }
  assert.equal(
    frontend(
      "src/lib/file.d.ts",
      'declare module "example" { import type { X } from "@/core/x"; }',
    )[0].rule,
    "layer-import",
  );
});

test("global-bridge: only the three exact appearance bridge files pass", () => {
  for (const path of [
    "src/core/appearance-bridge.ts",
    "src/core/appearance-bridge.test.ts",
    "src/core/appearance-bridge.test-support.ts",
  ]) {
    assert.deepEqual(frontend(path, "window.__SAMPLE_X__;"), []);
  }
  for (const path of [
    "src/app/file.ts",
    "src/core/appearance-bridge.tsx",
    "src/core/other.test.ts",
  ]) {
    const violations = frontend(
      path,
      '// __SAMPLE_X__\nconst text = "__SAMPLE_Y__"; window.__SAMPLE_123__;',
    );
    assert.deepEqual(
      violations.map(({ rule, line }) => [rule, line]),
      [
        ["global-bridge", 1],
        ["global-bridge", 2],
        ["global-bridge", 2],
      ],
    );
  }
});

test("global-bridge: derives its prefix from the identifier, not the binary or product", () => {
  const files = new Map([
    [
      "src/app/file.ts",
      Buffer.from("window.__SAMPLE_X__; window.__OTHER_X__;"),
    ],
  ]);
  const otherIdentity = { ...identity, identifier: "org.example.other" };
  assert.match(scanFrontend(files, identity, [])[0].message, /__SAMPLE_X__/);
  const violations = scanFrontend(files, otherIdentity, []);
  assert.equal(violations.length, 1);
  assert.match(violations[0].message, /__OTHER_X__/);
});

test("dom-query: all six methods fail in shell, app and modules", () => {
  for (const path of [
    "src/shell/file.ts",
    "src/app/file.ts",
    "src/modules/demo/file.ts",
  ]) {
    for (const method of [
      "querySelector",
      "querySelectorAll",
      "getElementById",
      "getElementsByClassName",
      "getElementsByTagName",
      "getElementsByName",
    ]) {
      const violations = frontend(
        path,
        `\ndocument.${method}("x"); document["${method}"]("x"); document?.${method}?.("x");`,
      );
      assert.equal(violations.length, 3);
      assert.ok(
        violations.every(
          (item) =>
            item.rule === "dom-query" &&
            item.line === 2 &&
            item.message.includes(method),
        ),
      );
    }
  }
});

test("dom-query: test filenames and lower layers are exempt", () => {
  for (const path of [
    "src/shell/file.test.ts",
    "src/app/file.test.tsx",
    "src/modules/demo/file.test-support.ts",
    "src/lib/file.ts",
    "src/kit/file.ts",
    "src/core/file.ts",
    "src/visual/file.ts",
  ]) {
    assert.deepEqual(frontend(path, 'document.querySelector("x");'), []);
  }
  assert.equal(
    frontend(
      "src/shell/example.test.directory/file.ts",
      'document.querySelector("x");',
    )[0].rule,
    "dom-query",
  );
});

test("dom-query: matches direct calls rather than references, other objects or dynamic properties", () => {
  assert.deepEqual(
    frontend(
      "src/app/file.ts",
      'const f = document.querySelector; root.querySelector("x"); window.document.querySelector("x"); document[querySelector]("x"); document.createElement("div");',
    ),
    [],
  );
});

test("dom-query and stale-allowlist: default mount exception allows every matching call", () => {
  const files = new Map([
    [
      "src/main.tsx",
      Buffer.from(
        'document.getElementById("root"); document["getElementById"]("second");',
      ),
    ],
  ]);
  assert.deepEqual(scanFrontend(files, identity), []);
  files.set(
    "src/main.tsx",
    Buffer.from(
      'document.getElementById("root"); document.querySelector("x");',
    ),
  );
  assert.deepEqual(
    scanFrontend(files, identity).map(({ rule }) => rule),
    ["dom-query"],
  );
  files.set(
    "src/app/file.ts",
    Buffer.from('document.getElementById("other");'),
  );
  assert.equal(
    scanFrontend(files, identity).filter(({ rule }) => rule === "dom-query")
      .length,
    2,
  );
});

test("stale-allowlist: absent files and uncalled methods fail with the recorded reason", () => {
  for (const files of [
    new Map(),
    new Map([["src/main.tsx", Buffer.from("document.getElementById;")]]),
  ]) {
    const violations = scanFrontend(files, identity);
    assert.equal(violations.length, 1);
    assert.equal(violations[0].rule, "stale-allowlist");
    assert.equal(violations[0].path, "src/main.tsx");
    assert.match(violations[0].message, /getElementById.*React 根节点挂载点/);
  }
});

const crateRoot = resolve("Temp/sk2/crate-fixture");
const cratePaths = [
  "src-tauri",
  "crates/framework",
  "crates/module-account",
  "crates/module-ai",
  "crates/module-demo",
  "crates/module-files",
  "crates/worker",
  "crates/utility",
];

function crateFixture() {
  const packages = cratePaths.map((path, index) => ({
    id: `package-${index}`,
    name: index === 0 ? "host-app" : `sample-${path.slice(7)}`,
    manifest_path: resolve(crateRoot, path, "Cargo.toml"),
    dependencies: [],
  }));
  return { packages, workspace_members: packages.map(({ id }) => id) };
}

const crateDirections = [
  [1, 2, 3, 4, 5, 6, 7],
  [],
  [1],
  [1, 2],
  [1, 2, 3],
  [1, 2],
  [1, 2, 3, 4, 5],
  [1, 2, 3, 4, 5],
];
for (const [from, allowed] of crateDirections.entries()) {
  test(`crate-dependency: ${cratePaths[from]} permits only declared workspace dependencies`, () => {
    for (const to of crateDirections.keys()) {
      const metadata = crateFixture();
      metadata.packages[from].dependencies.push({
        name: metadata.packages[to].name,
        kind: null,
        rename: "alias",
      });
      const violations = scanCrateDependencies(metadata, crateRoot, identity);
      assert.equal(
        violations.length,
        allowed.includes(to) ? 0 : 1,
        `${from} -> ${to}`,
      );
      if (violations.length) {
        assert.equal(violations[0].rule, "crate-dependency");
        assert.equal(violations[0].path, `${cratePaths[from]}/Cargo.toml`);
      }
    }
  });
}

test("crate-dependency: normal, dev and build Tauri dependencies are host-only regardless of rename", () => {
  for (const kind of [null, "dev", "build"]) {
    for (const name of ["tauri", "tauri-build", "tauri-plugin-dialog"]) {
      for (const index of [0, 1, 2, 6]) {
        const metadata = crateFixture();
        metadata.packages[index].dependencies.push({
          name,
          kind,
          rename: "renamed",
        });
        assert.equal(
          scanCrateDependencies(metadata, crateRoot, identity).length,
          index === 0 ? 0 : 1,
        );
      }
    }
    const metadata = crateFixture();
    metadata.packages[1].dependencies.push({
      name: "host-app",
      kind,
      rename: "not-the-host-name",
    });
    assert.equal(
      scanCrateDependencies(metadata, crateRoot, identity).length,
      1,
    );
  }
});

test("crate-dependency: external dependencies remain allowed and pure input stays unchanged", () => {
  const metadata = crateFixture();
  metadata.packages[1].dependencies.push(
    ...["serde", "taurine", "sample-external"].map((name) => ({
      name,
      kind: null,
      rename: "tauri",
    })),
  );
  const before = structuredClone(metadata);
  assert.deepEqual(scanCrateDependencies(metadata, crateRoot, identity), []);
  assert.deepEqual(metadata, before);
});

test("crate-dependency: package names must match crates directory names", () => {
  const metadata = crateFixture();
  metadata.packages[6].manifest_path = resolve(
    crateRoot,
    "crates/foo/Cargo.toml",
  );
  assert.match(
    scanCrateDependencies(metadata, crateRoot, identity)[0].message,
    /必须命名为 sample-foo/,
  );
  metadata.packages[6].name = "sample-foo";
  assert.deepEqual(scanCrateDependencies(metadata, crateRoot, identity), []);
});

test("crate-dependency: rejects a prefix from a previous identity", () => {
  const metadata = crateFixture();
  metadata.packages[1].name = "other-framework";
  const violations = scanCrateDependencies(metadata, crateRoot, identity);
  assert.equal(violations.length, 1);
  assert.match(violations[0].message, /必须命名为 sample-framework/);
  metadata.packages[1].name = "sample-framework";
  assert.deepEqual(scanCrateDependencies(metadata, crateRoot, identity), []);
});

test("identity: invalid identifier code names fail even with no files or crates", () => {
  for (const codeName of [
    "",
    "Sample",
    "1sample",
    "sample-app",
    "sample_app",
  ]) {
    const invalid = { ...identity, identifier: `com.dushan.${codeName}` };
    assert.throws(
      () => scanFrontend(new Map(), invalid, []),
      /identifier 最后一段必须匹配/,
    );
    assert.throws(
      () =>
        scanCrateDependencies(
          { packages: [], workspace_members: [] },
          crateRoot,
          invalid,
        ),
      /identifier 最后一段必须匹配/,
    );
  }
});

test("crate-dependency: manifests outside approved locations fail", () => {
  for (const path of [
    "Cargo.toml",
    "nested/Cargo.toml",
    "crates/nested/child/Cargo.toml",
    "../outside/Cargo.toml",
  ]) {
    const metadata = crateFixture();
    metadata.packages[6].manifest_path = resolve(crateRoot, path);
    const violations = scanCrateDependencies(metadata, crateRoot, identity);
    assert.equal(violations.length, 1);
    assert.match(violations[0].message, /不允许的位置/);
  }
});

function legacy(text, productIdentity = identity) {
  return scanLegacyBrand("README.md", Buffer.from(text), productIdentity);
}

test("legacy-brand: configured product, binary, identifier and exact allowlist pass", () => {
  for (const text of [
    "Dushan Sample",
    "Dushan Sample（示例）",
    "dushan-sample",
    "dushan-sample.exe",
    "dushan-sample-cli",
    "dushan_sample",
    "dushan_sample_lib",
    "com.dushan.sample",
    "com.dushan.sample.test-resources",
    "com.dushan.sample.",
    "dushanaicode",
    "dushan-ai",
    "dushan-website",
    "DushanCode",
    "git@gitee.com:dushan-ai/dushan-sample.git",
  ]) {
    assert.deepEqual(legacy(text), [], text);
  }
});

test("legacy-brand: obsolete names, identifiers and case variants fail", () => {
  for (const name of [
    "dushan-rust-desktop",
    "dushan_framework",
    "DUSHAN_STATE_ROOT",
    "Dushan",
    "dushan-samplex",
    "dushan_samplex",
    "DUSHAN-SAMPLE",
    "Dushan sample",
    "dushan-media",
    "__DUSHAN_X__",
    "com.dushan.other",
    "com.dushan.samplex",
    "DUSHANAICODE",
    "Dushancode",
    "COM.DUSHAN.SAMPLE",
  ]) {
    const violations = legacy(`第一行\n${name}`);
    assert.deepEqual(violations, [
      {
        rule: "legacy-brand",
        path: "README.md",
        line: 2,
        message: `旧品牌标识：${name === "Dushan sample" ? "Dushan" : name}`,
      },
    ]);
  }
});

test("legacy-brand: longest token, trailing dots and each occurrence are preserved", () => {
  const violations = legacy("[prefix.__DUSHAN_X__.suffix...] dushan-dushan");
  assert.equal(violations.length, 3);
  assert.equal(violations[0].message, "旧品牌标识：prefix.__DUSHAN_X__.suffix");
  assert.equal(violations[1].message, "旧品牌标识：dushan-dushan");
});

test("legacy-brand: exact product fragments are ignored without losing line numbers", () => {
  const violations = legacy(
    "Dushan SampleDushan Sample\r\nDushan\r\nDushan Sample dushan-media",
  );
  assert.deepEqual(
    violations.map(({ line, message }) => [line, message]),
    [
      [2, "旧品牌标识：Dushan"],
      [3, "旧品牌标识：dushan-media"],
    ],
  );
});

test("legacy-brand: renaming identity changes all product exceptions", () => {
  const renamed = {
    identifier: "com.dushan.renamed",
    binary: "dushan-renamed",
    product: "Dushan Renamed",
  };
  for (const text of [
    "com.dushan.renamed.test",
    "dushan-renamed.exe",
    "dushan-renamed-cli",
    "dushan_renamed_lib",
    "Dushan Renamed",
  ]) {
    assert.deepEqual(legacy(text, renamed), []);
    assert.equal(legacy(text).length, 1);
  }
  for (const text of [
    "com.dushan.sample",
    "dushan-sample",
    "dushan_sample_lib",
    "Dushan Sample",
  ]) {
    assert.equal(legacy(text, renamed).length, 1);
  }
  assert.equal(
    legacy("com.dushan.sample", {
      ...identity,
      identifier: "org.example.product",
    }).length,
    1,
  );
});

test("legacy-brand: skips only checker files and NUL bytes in the first 8KB", () => {
  for (const path of [
    "scripts/check-structure.mjs",
    "scripts/check-structure.test.mjs",
  ]) {
    assert.deepEqual(
      scanLegacyBrand(path, Buffer.from("dushan"), identity),
      [],
    );
  }
  assert.deepEqual(legacy(`${" ".repeat(8191)}\0dushan`), []);
  assert.equal(legacy(`${" ".repeat(8192)}\0dushan`).length, 1);
  assert.equal(
    scanLegacyBrand(
      "other/check-structure.mjs",
      Buffer.from("dushan"),
      identity,
    ).length,
    1,
  );
});

test("agents-size: 300 Chinese or astral code points pass, 301 fail per line", () => {
  for (const character of ["中", "😀"]) {
    assert.deepEqual(scanAgentsSize(Buffer.from(character.repeat(300))), []);
    const violations = scanAgentsSize(
      Buffer.from(
        `标题\r\n${character.repeat(301)}\r\n${character.repeat(301)}`,
      ),
    );
    assert.deepEqual(
      violations.map(({ rule, line }) => [rule, line]),
      [
        ["agents-size", 2],
        ["agents-size", 3],
      ],
    );
    assert.ok(
      violations.every(({ message }) => message.includes("301 个码点")),
    );
  }
});

test("agents-size: exactly 30720 bytes pass and oversized UTF-8 files fail", () => {
  const exact = `${"x".repeat(255)}\n`.repeat(120);
  assert.equal(Buffer.byteLength(exact), 30720);
  assert.deepEqual(scanAgentsSize(Buffer.from(exact)), []);
  for (const text of [`${exact}x`, `${"中".repeat(300)}\n`.repeat(35)]) {
    const violations = scanAgentsSize(Buffer.from(text));
    assert.equal(violations.length, 1);
    assert.equal(violations[0].rule, "agents-size");
    assert.match(violations[0].message, /总量 .* 字节，超过 30720/);
  }
});

function frameworkFiles(entries) {
  return new Map(entries.map(([path, text]) => [path, Buffer.from(text)]));
}

function frameworkLayer(entries) {
  return scanFrameworkLayers(
    frameworkFiles(
      entries.map(([path, text]) => [`crates/framework/src/${path}`, text]),
    ),
  );
}

test("framework-layer: module order matches the architecture table", async () => {
  const architecture = await readFile(
    new URL("../docs/architecture.md", import.meta.url),
    "utf8",
  );
  const section = architecture
    .split("### framework 内部分层")[1]
    .split("\n## ")[0];
  const modules = [...section.matchAll(/^\|\s*\d+\s*\|\s*(\w+)\s*\|/gm)].map(
    (match) => match[1],
  );
  assert.equal(modules.length, 23);
  assert.deepEqual(frameworkModules, modules);
});

test("framework-layer: every module permits only earlier modules and itself", () => {
  for (const [rank, from] of frameworkModules.entries()) {
    for (const [targetRank, to] of frameworkModules.entries()) {
      const violations = frameworkLayer([
        [`${from}.rs`, `\nuse crate::${to}::Tx;`],
      ]);
      assert.equal(
        violations.length,
        targetRank <= rank ? 0 : 1,
        `${from} → ${to}`,
      );
      if (violations.length) {
        assert.equal(violations[0].rule, "framework-layer");
        assert.equal(violations[0].path, `crates/framework/src/${from}.rs`);
        assert.equal(violations[0].line, 2);
        assert.ok(violations[0].message.includes(`${from} → ${to}`));
      }
    }
  }
});

test("framework-layer: paths in expressions, types and generic arguments count separately", () => {
  const violations = frameworkLayer([
    [
      "db.rs",
      [
        "fn call() { crate::job::run(); crate::job::run(); }",
        "type T = crate::error::Result<crate::job::Job>;",
        "fn generic() { crate::error::call::<crate::job::Job>(); }",
      ].join("\n"),
    ],
  ]);
  assert.deepEqual(
    violations.map(({ line }) => line),
    [1, 1, 2, 3],
  );
  assert.ok(violations.every(({ message }) => message.includes("db → job")));
});

test("framework-layer: precise capture bounds do not hide paths in the following body", () => {
  const violations = frameworkLayer([
    [
      "db.rs",
      "fn values() -> impl Iterator<Item = crate::job::X> + use<> {\nstd::iter::empty::<crate::job::X>()\n}",
    ],
  ]);
  assert.deepEqual(
    violations.map(({ line }) => line),
    [1, 2],
  );
});

test("framework-layer: nested grouped uses count each written top-level segment once", () => {
  const violations = frameworkLayer([
    [
      "db/mod.rs",
      [
        "use crate::{",
        "  error::AppError,",
        "  job::{self, JobQueue as Queue, nested::{A, B}, *},",
        "  job::Other,",
        "  backup::{Archive, Restore},",
        "};",
      ].join("\n"),
    ],
  ]);
  assert.deepEqual(
    violations.map(({ line, message }) => [line, message.split("：")[0]]),
    [
      [3, "db → job"],
      [4, "db → job"],
      [5, "db → backup"],
    ],
  );
});

test("framework-layer: grouped roots, aliases, globs and empty groups preserve paths", () => {
  const violations = frameworkLayer([
    [
      "db.rs",
      [
        "pub use {std::io, crate::{error::AppError, job::X as Alias}};",
        "use crate::job::*;",
        "use crate::job::{};",
        "use crate::error as job;",
      ].join("\n"),
    ],
  ]);
  assert.deepEqual(
    violations.map(({ line }) => line),
    [1, 2, 3],
  );
});

test("framework-layer: nested comments and all string forms hide paths and braces", () => {
  const text = String.raw`// crate::job::X; mod fake {
/* crate::job::X; /* nested */ mod fake { */
const A: &str = "escaped \" crate::job::X; }";
const B: &str = r"crate::job::X; mod fake {";
const C: &str = r###"crate::job::X; "## }"###;
const D: &[u8] = b"crate::job::X";
const E: &[u8] = br##"crate::job::X; }"##;
const F: &CStr = c"crate::job::X";
const G: &CStr = cr#"crate::job::X"#;
const H: &str = "multiline
crate::job::X";
use crate::job::X;`;
  const violations = frameworkLayer([["db.rs", text]]);
  assert.equal(violations.length, 1);
  assert.equal(violations[0].line, 12);
});

test("framework-layer: character literals do not change nesting or erase lifetimes and labels", () => {
  const text = String.raw`const CHARS: [char; 7] = ['{', '}', '\'', '\\', '\u{7b}', '\x7d', '🦀'];
const BYTES: [u8; 2] = [b'{', b'\x7d'];
fn value<'a>(x: &'a crate::job::X) -> &'a crate::job::X {
  'again: loop { crate::job::run(); break 'again; }
}
use super::job::X;`;
  assert.deepEqual(
    frameworkLayer([["db.rs", text]]).map(({ line }) => line),
    [3, 3, 4, 6],
  );
});

for (const [name, path, text, count] of [
  [
    "three parents leave pool tests",
    "db/pool.rs",
    "mod tests { use super::super::super::job::X; }",
    1,
  ],
  [
    "two parents stay inside db from pool tests",
    "db/pool.rs",
    "mod tests { use super::super::job::X; }",
    0,
  ],
  [
    "two parents leave mod.rs tests",
    "db/mod.rs",
    "mod tests { use super::super::job::X; }",
    1,
  ],
  ["one parent reaches db from cache", "cache.rs", "use super::db::Tx;", 0],
]) {
  test(`framework-layer: ${name}`, () => {
    const violations = frameworkLayer([[path, text]]);
    assert.equal(violations.length, count);
    if (count) assert.match(violations[0].message, /db → job/);
  });
}

test("framework-layer: super beyond the crate root fails once per chain", () => {
  for (const [path, text] of [
    ["cache.rs", "use super::super::db::Tx;"],
    ["db/mod.rs", "mod tests { use super::super::super::job::X; }"],
    [
      "db/pool.rs",
      "mod tests { use super::super::super::super::{job::X, db::Tx}; }",
    ],
  ]) {
    const violations = frameworkLayer([[path, text]]);
    assert.equal(violations.length, 1);
    assert.match(violations[0].message, /super 超出 crate 根/);
  }
});

test("framework-layer: inline modules add depth but functions, impls and blocks do not", () => {
  const text = [
    "mod outer { pub(crate) mod inner {",
    "  impl X { fn call() { { super::super::super::super::job::run(); } } }",
    "} }",
    "use super::super::job::X;",
  ].join("\n");
  assert.deepEqual(
    frameworkLayer([["db/pool.rs", text]]).map(({ line }) => line),
    [2, 4],
  );
  assert.deepEqual(
    frameworkLayer([
      ["db/nested/mod.rs", "mod tests { use super::super::job::X; }"],
    ]),
    [],
  );
  assert.equal(
    frameworkLayer([
      ["db/nested/mod.rs", "mod tests { use super::super::super::job::X; }"],
    ]).length,
    1,
  );
});

test("framework-layer: grouped super paths resolve each branch with its inherited prefix", () => {
  const text =
    "mod tests { use super::super::{error::X, job::{X, Y}, db::job::X}; }";
  const violations = frameworkLayer([["db/mod.rs", text]]);
  assert.equal(violations.length, 1);
  assert.match(violations[0].message, /db → job/);
  assert.deepEqual(frameworkLayer([["db/pool.rs", text]]), []);
  assert.equal(
    frameworkLayer([["db.rs", "use super::{super::job::X, error::X};"]]).length,
    1,
  );
});

test("framework-layer: self references allow arbitrary internal paths", () => {
  assert.deepEqual(
    frameworkLayer([
      [
        "db/pool.rs",
        [
          "use crate::db::{job::X, unknown::Y};",
          "use super::job::X;",
          "use super::super::db::job::X;",
          "mod tests { use super::{super::job::X, child::Y}; }",
        ].join("\n"),
      ],
    ]),
    [],
  );
});

test("framework-layer: dollar-crate paths belong to the macro definition module", () => {
  for (const module of ["dict", "error"]) {
    const violations = frameworkLayer([
      [
        `${module}/macros.rs`,
        [
          "#[macro_export]",
          "macro_rules! declare { () => { $crate::dict::X; $crate::dict::Y; } }",
        ].join("\n"),
      ],
    ]);
    assert.equal(violations.length, module === "dict" ? 0 : 2);
    assert.ok(
      violations.every(
        ({ message, line }) => line === 2 && message.includes("error → dict"),
      ),
    );
  }
  assert.equal(
    frameworkLayer([
      [
        "error.rs",
        "macro_rules! declare { () => { use $crate::{dict::{X, Y}}; } }",
      ],
    ]).length,
    1,
  );
});

for (const usage of [
  "crate::dict_enum!();",
  "use crate::dict_enum;",
  "dict_enum!();",
  "use crate::{dict_enum as renamed};",
  "super::dict_enum!();",
]) {
  test(`framework-layer: exported macro references resolve their defining module: ${usage}`, () => {
    for (const module of ["cache", "error", "dict"]) {
      const violations = frameworkLayer([
        [`${module}.rs`, `\n${usage}`],
        [
          "dict/macros.rs",
          "#[macro_export]\nmacro_rules! dict_enum { () => {} }",
        ],
      ]);
      assert.equal(violations.length, module === "error" ? 1 : 0);
      if (violations.length) {
        assert.equal(violations[0].line, 2);
        assert.match(violations[0].message, /error → dict/);
      }
    }
  });
}

test("framework-layer: export attributes survive adjacent attributes but not unrelated items", () => {
  const violations = frameworkLayer([
    ["error.rs", "dict_enum!(); local!(); fake!(); external::dict_enum!();"],
    [
      "dict/mod.rs",
      [
        '#[macro_export(local_inner_macros)] #[doc = "description"]',
        "macro_rules! dict_enum { () => {} }",
        "macro_rules! local { () => {} }",
        "// #[macro_export]",
        "macro_rules! fake { () => {} }",
        'const TEXT: &str = "#[macro_export] macro_rules! fake {}";',
      ].join("\n"),
    ],
  ]);
  assert.equal(violations.length, 1);
  assert.match(violations[0].message, /error → dict/);
});

test("framework-layer: macro and module namespaces keep their respective dependencies", () => {
  const violations = frameworkLayer([
    [
      "db.rs",
      "crate::error!();\nuse crate::error;\nuse crate::error::AppError;\nuse crate::error::{AppError};",
    ],
    ["job.rs", "#[macro_export] macro_rules! error { () => {} }"],
  ]);
  assert.deepEqual(
    violations.map(({ line }) => line),
    [1, 2],
  );
  assert.ok(violations.every(({ message }) => message.includes("db → job")));
});

test("framework-layer: conditional exported definitions retain every defining module", () => {
  const violations = frameworkLayer([
    ["db.rs", "crate::selected!();"],
    [
      "error.rs",
      '#[cfg(feature = "first")] #[macro_export] macro_rules! selected { () => {} }',
    ],
    [
      "job.rs",
      '#[cfg(not(feature = "first"))] #[macro_export] macro_rules! selected { () => {} }',
    ],
  ]);
  assert.equal(violations.length, 1);
  assert.match(violations[0].message, /db → job/);
});

test("framework-layer: unknown top-level targets fail per occurrence", () => {
  const violations = frameworkLayer([
    [
      "cache.rs",
      [
        "use crate::{missing::{X, Y}, other::Z};",
        "use super::absent::Tx;",
        "fn call() { crate::unknown!(); }",
      ].join("\n"),
    ],
  ]);
  assert.equal(violations.length, 4);
  assert.ok(
    violations.every(({ message }) => /cache → .*未登记/.test(message)),
  );
});

test("framework-layer: unknown owners fail once per file and scan scope is exact", () => {
  const violations = scanFrameworkLayers(
    frameworkFiles([
      [
        "crates/framework/src/foo.rs",
        "use crate::job::X; use crate::missing::X;",
      ],
      ["crates/framework/src/foo/nested.rs", "use crate::job::X;"],
      ["crates/framework/tests/foo.rs", "use crate::job::X;"],
      ["crates/framework/src/foo.txt", "use crate::job::X;"],
      ["crates/framework-extra/src/foo.rs", "use crate::job::X;"],
      ["src-tauri/src/foo.rs", "use crate::job::X;"],
    ]),
  );
  assert.equal(violations.length, 2);
  assert.ok(
    violations.every(
      ({ line, message }) => line === 1 && /顶层模块：foo/.test(message),
    ),
  );
  assert.deepEqual(scanFrameworkLayers(new Map()), []);
});

test("framework-layer: raw identifiers and spaced paths cannot bypass checks", () => {
  const violations = frameworkLayer([
    [
      "db.rs",
      "use crate /* gap */ :: r#job :: X; mod r#tests { use super::super::r#job::X; }",
    ],
  ]);
  assert.equal(violations.length, 2);
  assert.ok(violations.every(({ message }) => message.includes("db → job")));
});

test("framework-layer: cfg and test attributes do not exempt references", () => {
  const violations = frameworkLayer([
    [
      "error.rs",
      "#[cfg(test)] mod tests { use crate::job::X; }\n#[cfg(any())] fn call() { crate::job::run(); }",
    ],
  ]);
  assert.deepEqual(
    violations.map(({ line }) => line),
    [1, 2],
  );
});

test("framework-layer: lib.rs accepts only inner attributes, comments and registered declarations", () => {
  const text = [
    "//! 内核说明",
    '#![doc = r#"crate::job::X"#]',
    "#![cfg_attr(all(), allow(dead_code))]",
    "/* nested /* comment */ end */",
    ...frameworkModules.map(
      (module, index) => `${index % 2 ? "pub " : ""}mod ${module};`,
    ),
  ].join("\n");
  assert.deepEqual(frameworkLayer([["lib.rs", text]]), []);
});

test("framework-layer: lib.rs rejects every other item including imports and inline modules", () => {
  for (const item of [
    "pub use error::AppError;",
    "use crate::error::AppError;",
    "mod unknown;",
    "pub(crate) mod error;",
    "pub mod error { fn run() {} }",
    "fn run() {}",
    "const X: usize = 1;",
    "struct X;",
    "macro_rules! local { () => {} }",
    "extern crate other;",
    "#[cfg(test)] mod error;",
    '"hidden";',
    "'x';",
  ]) {
    const violations = frameworkLayer([
      ["lib.rs", `//! 内核\n${item}\npub mod error;`],
    ]);
    assert.equal(violations.length, 1, item);
    assert.equal(violations[0].line, 2, item);
    assert.match(violations[0].message, /lib.rs 只允许/);
  }
});

test("framework-layer: lib.rs reports each forbidden item at its original line", () => {
  const violations = frameworkLayer([
    [
      "lib.rs",
      "//! 内核\r\nuse error::{A, B};\r\nfn f() { let x = 1; }\r\npub mod error;\r\npub use error::C;",
    ],
  ]);
  assert.deepEqual(
    violations.map(({ line }) => line),
    [2, 3, 5],
  );
});

test("framework-layer: scanning leaves input buffers unchanged", () => {
  const files = frameworkFiles([
    ["crates/framework/src/error.rs", "use crate::job::X;"],
  ]);
  const before = new Map(
    [...files].map(([path, content]) => [path, Buffer.from(content)]),
  );
  scanFrameworkLayers(files);
  assert.deepEqual(files, before);
});

test("module-doc: crate and both top-level module layouts accept inner documentation", () => {
  const files = frameworkFiles([
    ["crates/framework/src/lib.rs", "//! 通用内核\npub mod db;"],
    ["crates/framework/src/error.rs", "\n\r\n//! 错误模型\n"],
    ["crates/framework/src/db/mod.rs", "\n  //! 数据库\nmod pool;"],
    ["crates/framework/src/db/pool.rs", "use crate::error::AppError;"],
    ["crates/framework/src/db/nested/mod.rs", "mod query;"],
    ["src-tauri/src/lib.rs", "use std::io;"],
  ]);
  assert.deepEqual(scanModuleDocs(files), []);
});

test("module-doc: missing or misplaced documentation reports each root file", () => {
  for (const path of [
    "crates/framework/src/lib.rs",
    "crates/framework/src/error.rs",
    "crates/framework/src/db/mod.rs",
  ]) {
    for (const text of [
      "",
      "use std::io;\n//! 说明",
      "// 注释\n//! 说明",
      "/// 外部文档",
    ]) {
      const violations = scanModuleDocs(frameworkFiles([[path, text]]));
      assert.equal(violations.length, 1);
      assert.equal(violations[0].rule, "module-doc");
      assert.equal(violations[0].path, path);
      assert.equal(violations[0].line, 1);
    }
  }
});

test("module-doc: lib.rs starts with documentation at byte zero; module roots skip blank lines", () => {
  const files = frameworkFiles([
    ["crates/framework/src/lib.rs", "\n//! 说明"],
    ["crates/framework/src/db/mod.rs", "\n\nuse std::io;"],
  ]);
  assert.deepEqual(
    scanModuleDocs(files).map(({ path, line }) => [path, line]),
    [
      ["crates/framework/src/lib.rs", 1],
      ["crates/framework/src/db/mod.rs", 3],
    ],
  );
  assert.deepEqual(scanModuleDocs(new Map()), []);
});

test("framework-identity: product identities and account exceptions are all forbidden in the kernel", () => {
  const names = [
    identity.identifier,
    identity.binary,
    identity.product,
    "dushanaicode",
    "DUSHAN-AI",
  ];
  const files = frameworkFiles([
    ["crates/framework/src/secret.rs", names.join("\n")],
    ["src-tauri/src/lib.rs", names.join("\n")],
    ["crates/framework-extra/src/lib.rs", identity.identifier],
  ]);
  const violations = scanFrameworkIdentity(files);
  assert.equal(violations.length, names.length);
  assert.ok(
    violations.every(
      ({ rule, path }) =>
        rule === "framework-identity" &&
        path === "crates/framework/src/secret.rs",
    ),
  );
  assert.deepEqual(
    violations.map(({ line }) => line),
    [1, 2, 3, 4, 5],
  );
});

test("framework-identity: scans all text formats and counts every case-insensitive occurrence", () => {
  const files = frameworkFiles([
    ["crates/framework/README.md", "dushan DUSHAN\r\nDuShAn"],
    ["crates/framework/Cargo.toml", "dushan"],
    ["crates/framework/assets/data", "dushan"],
  ]);
  assert.deepEqual(
    scanFrameworkIdentity(files).map(({ line }) => line),
    [1, 1, 2, 1, 1],
  );
  assert.deepEqual(
    scanFrameworkIdentity(
      frameworkFiles([
        ["crates/framework/src/secret.rs", 'const PREFIX: &str = "sample";'],
      ]),
    ),
    [],
  );
});

test("framework-identity: only NUL bytes in the first 8KB mark files as binary", () => {
  const path = "crates/framework/assets/data.bin";
  assert.deepEqual(
    scanFrameworkIdentity(
      frameworkFiles([[path, `${" ".repeat(8191)}\0dushan`]]),
    ),
    [],
  );
  assert.equal(
    scanFrameworkIdentity(
      frameworkFiles([[path, `${" ".repeat(8192)}\0dushan`]]),
    ).length,
    1,
  );
  assert.deepEqual(scanFrameworkIdentity(new Map()), []);
});
