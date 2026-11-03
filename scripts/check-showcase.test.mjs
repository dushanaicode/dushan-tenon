import assert from "node:assert/strict";
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
import { build } from "vite";
import {
  readReleaseChunks,
  readShowcaseFiles,
  scanReleaseChunks,
  scanShowcase,
} from "./check-showcase.mjs";

const base = "src/modules/demo/showcase";
const catalogPath = `${base}/catalog/buttons.json`;
const pagePath = `${base}/pages/buttons-page.tsx`;
const examplePath = `${base}/examples/button.tsx`;

async function fixture(t) {
  const parent = resolve("Temp/test/check-showcase");
  await mkdir(parent, { recursive: true });
  assert.equal(await realpath(parent), parent);
  const directory = await realpath(await mkdtemp(join(parent, "case-")));
  assert.equal(dirname(directory), parent);
  t.after(async () => {
    assert.equal(dirname(await realpath(directory)), parent);
    await rm(directory, { recursive: true });
  });
  const files = await readShowcaseFiles();
  assert.deepEqual(scanShowcase(files), []);
  for (const [path, source] of files) {
    await mkdir(dirname(join(directory, path)), { recursive: true });
    await writeFile(join(directory, path), source);
  }
  return {
    directory,
    files,
    async change(path, transform) {
      await writeFile(join(directory, path), transform(files.get(path)));
      return scanShowcase(await readShowcaseFiles(directory));
    },
  };
}

function rejected(violations, rule, identity) {
  const found = violations.find(
    (v) => v.rule === rule && v.message.includes(identity),
  );
  assert.ok(found, JSON.stringify(violations));
  assert.ok(found.line >= 1);
  assert.ok(found.path.length > 0);
  assert.match(found.message, /期望.+实际/);
}

for (const rule of ["C01", "C02", "C03", "C04", "C05", "C06"]) {
  test(`${rule} accepts complete real fixtures`, async (t) => {
    const { directory } = await fixture(t);
    assert.deepEqual(scanShowcase(await readShowcaseFiles(directory)), []);
  });
}

for (const [label, mutate] of [
  [
    "required field",
    (entries) => {
      delete entries[0].variants;
    },
  ],
  [
    "closed kind",
    (entries) => {
      entries[0].kind = "widget";
    },
  ],
  [
    "duplicate id",
    (entries) => {
      entries.push(entries[0]);
    },
  ],
  [
    "empty title",
    (entries) => {
      entries[0].titleKey = " ";
    },
  ],
  [
    "missing translation",
    (entries) => {
      entries[0].titleKey = "showcase.buttons.catalog.button.missing";
    },
  ],
  [
    "unresolved related",
    (entries) => {
      entries[0].related = ["component.missing"];
    },
  ],
  [
    "unknown rule",
    (entries) => {
      entries[0].rule = "SC-R99";
    },
  ],
  [
    "non-public import",
    (entries) => {
      entries[0].importPath = "@/kit/ui/button";
    },
  ],
]) {
  test(`C01 rejects ${label}`, async (t) => {
    const f = await fixture(t);
    rejected(
      await f.change(catalogPath, (source) => {
        const entries = JSON.parse(source);
        mutate(entries);
        return JSON.stringify(entries, null, 2);
      }),
      "C01",
      "component.button",
    );
  });
}

for (const [label, path, change] of [
  [
    "unknown page",
    catalogPath,
    (s) => s.replaceAll('"/demo/buttons"', '"/demo/missing"'),
  ],
  [
    "nav order drift",
    `${base}/pages.json`,
    (s) => s.replace('"order": 50', '"order": 51'),
  ],
  [
    "missing coverage",
    `${base}/pages.json`,
    (s) => s.replace(',\n    "noCatalog": "overview"', ""),
  ],
  [
    "false noCatalog",
    `${base}/pages.json`,
    (s) => {
      const pages = JSON.parse(s);
      pages.find((page) => page.id === "buttons").noCatalog = "business";
      return JSON.stringify(pages);
    },
  ],
  [
    "missing catalog connection",
    pagePath,
    (s) => s.replace("entries={catalog}", "entries={[]}"),
  ],
  [
    "wrong parent",
    "src/modules/demo/manifest.ts",
    (s) => s.replaceAll('parentId: "demo.showcase"', 'parentId: "demo.other"'),
  ],
  [
    "unregistered navigation page",
    `${base}/pages.json`,
    (s) =>
      JSON.stringify(JSON.parse(s).filter((page) => page.id !== "buttons")),
  ],
]) {
  test(`C02 rejects ${label}`, async (t) => {
    const f = await fixture(t);
    rejected(
      await f.change(path, change),
      "C02",
      label === "missing coverage" || label === "wrong parent"
        ? "overview"
        : "buttons",
    );
  });
}

for (const [label, path, change] of [
  [
    "missing example",
    catalogPath,
    (s) => s.replaceAll("examples/button.tsx", "examples/missing.tsx"),
  ],
  [
    "outside examples",
    catalogPath,
    (s) => s.replaceAll("examples/button.tsx", "examples/../button.tsx"),
  ],
  ["not rendered", pagePath, (s) => s.replace("<ButtonExample />", "null")],
  [
    "not exported",
    examplePath,
    (s) => s.replace("export function", "function"),
  ],
  [
    "placeholder",
    examplePath,
    () =>
      "// showcase-example\nexport function ButtonExample() { return null; }",
  ],
]) {
  test(`C03 rejects ${label}`, async (t) => {
    const f = await fixture(t);
    rejected(await f.change(path, change), "C03", "component.button");
  });
}

for (const [label, change] of [
  ["marker missing", (s) => s.replace("// showcase-example", "// example")],
  ["UNSAFE identifier", (s) => `${s}\nconst UNSAFE_example = 1;`],
  ["as never", (s) => `${s}\nconst value = null as never;`],
  ["as any", (s) => `${s}\nconst value = null as any;`],
  ["@ts-ignore", (s) => `${s}\n// @ts-ignore\nconst value = 1;`],
  ["@ts-expect-error", (s) => `${s}\n// @ts-expect-error\nconst value = 1;`],
  ["@ts-nocheck", (s) => `${s}\n/* @ts-nocheck */`],
  ["Radix", (s) => `${s}\nimport { Slot } from 'radix-ui';`],
  ["IPC", (s) => `${s}\nimport { invoke } from '@/lib/ipc';`],
  ["Tauri", (s) => `${s}\nimport { invoke } from '@tauri-apps/api/core';`],
  ["kit internals", (s) => s.replace('"@/kit"', '"@/kit/ui/button"')],
  [
    "relative kit internals",
    (s) => s.replace('"@/kit"', '"../../../../kit/ui/button"'),
  ],
  [
    "inline style",
    (s) => s.replace("<Button ", '<Button style={{ color: "red" }} '),
  ],
  [
    "character icon",
    (s) =>
      s
        .replace("<Button ", '<Button size="icon" ')
        .replace('{t("showcase.buttons.add", { count })}', "▼"),
  ],
  [
    "ASCII icon",
    (s) =>
      s
        .replace("<Button ", '<Button size="icon" ')
        .replace('{t("showcase.buttons.add", { count })}', "+"),
  ],
  [
    "template character icon",
    (s) => s.replace('{t("showcase.buttons.add", { count })}', "{`▼`}"),
  ],
  [
    "template ASCII icon",
    (s) =>
      s
        .replace("<Button ", '<Button size="icon" ')
        .replace('{t("showcase.buttons.add", { count })}', "{`+`}"),
  ],
]) {
  test(`C04 rejects ${label}`, async (t) => {
    const f = await fixture(t);
    rejected(await f.change(examplePath, change), "C04", "examples/button.tsx");
  });
}

test("C04 restricts examples, not page-only router machinery", async (t) => {
  const f = await fixture(t);
  assert.deepEqual(
    await f.change(`${base}/pages/navigation-page.tsx`, (source) =>
      [
        source,
        "// @ts-ignore",
        "const UNSAFE_example = null as never;",
        "// @ts-expect-error",
        "const value = null as any;",
        "/* @ts-nocheck */",
      ].join("\n"),
    ),
    [],
  );
});

test("C04 does not mistake literal text for identifiers, assertions or comments", async (t) => {
  const f = await fixture(t);
  assert.deepEqual(
    await f.change(
      examplePath,
      (source) =>
        `${source}\nconst text = "UNSAFE_example as never as any // @ts-ignore";\nconst template = \`/* @ts-expect-error */\`;\nconst element = <p>/* @ts-nocheck */</p>;`,
    ),
    [],
  );
});

for (const [label, change] of [
  [
    "unguarded raw",
    (s) =>
      s.replace(
        /import\.meta\.env\.DEV\s*\?\s*\(\)\s*=>\s*import\("\.\.\/examples\/button\.tsx\?raw"\)\s*:\s*undefined/,
        '() => import("../examples/button.tsx?raw")',
      ),
  ],
  [
    "wrong same-page file",
    (s) =>
      s.replace(
        'import("../examples/button.tsx?raw")',
        'import("../examples/split-button.tsx?raw")',
      ),
  ],
  [
    "different guard",
    (s) => s.replaceAll("import.meta.env.DEV", "import.meta.env.PROD"),
  ],
  [
    "eager import",
    (s) => `${s}\nimport source from '../examples/button.tsx?raw';`,
  ],
  [
    "wrong catalog file index",
    (s) =>
      s.replace("file: catalog[0].exampleFile", "file: catalog[1].exampleFile"),
  ],
  [
    "wrong displayed file path",
    (s) =>
      s.replace(
        "file: catalog[0].exampleFile",
        'file: "src/modules/demo/showcase/examples/split-button.tsx"',
      ),
  ],
  [
    "disconnected source list",
    (s) => s.replace("examples={buttonExamples}", "examples={[]}"),
  ],
]) {
  test(`C05 rejects ${label}`, async (t) => {
    const f = await fixture(t);
    rejected(await f.change(pagePath, change), "C05", "buttons");
  });
}

test("C03 and C05 keep the behavior dialog registered on its rendering page", async (t) => {
  const f = await fixture(t);
  rejected(
    await f.change(`${base}/catalog/appearance-behavior.json`, (source) =>
      JSON.stringify(
        JSON.parse(source).filter(
          (entry) => entry.id !== "pattern.behavior-dialog",
        ),
      ),
    ),
    "C03",
    "appearance-behavior",
  );
  await writeFile(
    join(f.directory, `${base}/catalog/appearance-behavior.json`),
    f.files.get(`${base}/catalog/appearance-behavior.json`),
  );
  rejected(
    await f.change(`${base}/pages/appearance-behavior-page.tsx`, (source) =>
      source.replace(
        'import("../examples/dialog.tsx?raw")',
        'import("../examples/accordion.tsx?raw")',
      ),
    ),
    "C05",
    "appearance-behavior",
  );
});

test("C06 rejects missing rules and empty rule translations", async (t) => {
  const f = await fixture(t);
  rejected(
    await f.change(`${base}/rules.json`, (s) =>
      JSON.stringify(JSON.parse(s).filter((rule) => rule.id !== "SC-R01")),
    ),
    "C06",
    "SC-R01",
  );
  await writeFile(
    join(f.directory, `${base}/rules.json`),
    f.files.get(`${base}/rules.json`),
  );
  rejected(
    await f.change("src/core/i18n/en-US.json", (s) =>
      JSON.stringify({ ...JSON.parse(s), "showcase.common.rules.SC-R01": "" }),
    ),
    "C06",
    "SC-R01",
  );
});

test("C06 requires exactly SC-R01 through SC-R12", async (t) => {
  const f = await fixture(t);
  const path = `${base}/rules.json`;
  assert.deepEqual(
    JSON.parse(f.files.get(path)).map(({ id }) => id),
    Array.from(
      { length: 12 },
      (_, i) => `SC-R${String(i + 1).padStart(2, "0")}`,
    ),
  );
  rejected(
    await f.change(path, (source) =>
      JSON.stringify(JSON.parse(source).filter(({ id }) => id !== "SC-R12")),
    ),
    "C06",
    "SC-R12",
  );
  rejected(
    await f.change(path, (source) =>
      JSON.stringify([
        ...JSON.parse(source),
        { id: "SC-R13", textKey: "showcase.common.rules.SC-R13" },
      ]),
    ),
    "C06",
    "SC-R13",
  );
});

test("C06 rejects a missing English translation for SC-R09", async (t) => {
  const f = await fixture(t);
  rejected(
    await f.change("src/core/i18n/en-US.json", (source) => {
      const messages = JSON.parse(source);
      delete messages["showcase.common.rules.SC-R09"];
      return JSON.stringify(messages);
    }),
    "C06",
    "SC-R09",
  );
});

test("missing showcase files cannot silently exempt the module", async () => {
  const files = await readShowcaseFiles();
  for (const path of files.keys())
    if (path.startsWith(`${base}/`)) files.delete(path);
  for (const rule of ["C02", "C06"])
    assert.ok(scanShowcase(files).some((v) => v.rule === rule));
});

test("C08 scans every chunk, rejects absent output and catches unguarded raw in a real production build", async (t) => {
  assert.deepEqual(
    scanReleaseChunks(
      new Map([
        ["entry.js", "preview()"],
        ["lazy/extra.js", "example()"],
      ]),
    ),
    [],
  );
  rejected(
    scanReleaseChunks(
      new Map([
        ["entry.js", "preview()"],
        ["lazy/raw.js", 'const source="// showcase-example";'],
      ]),
    ),
    "C08",
    "release",
  );
  rejected(scanReleaseChunks(new Map()), "C08", "release");
  const { directory } = await fixture(t);
  const source = await readFile(examplePath, "utf8");
  await writeFile(join(directory, "button.tsx"), source);
  await writeFile(
    join(directory, "index.html"),
    '<html><script type="module" src="/entry.js"></script></html>',
  );
  const guarded =
    'const load = import.meta.env.DEV ? () => import("./button.tsx?raw") : undefined; if(load) load().then(m => document.body.textContent = m.default); else document.body.textContent = "preview";';
  const output = join(directory, "dist");
  const compile = async (entry) => {
    await writeFile(join(directory, "entry.js"), entry);
    await build({
      root: directory,
      configFile: false,
      cacheDir: join(directory, "cache"),
      logLevel: "silent",
      build: { outDir: output },
    });
    return scanReleaseChunks(await readReleaseChunks(output));
  };
  assert.deepEqual(await compile(guarded), []);
  rejected(
    await compile(
      guarded.replace(
        'import.meta.env.DEV ? () => import("./button.tsx?raw") : undefined',
        '() => import("./button.tsx?raw")',
      ),
    ),
    "C08",
    "release",
  );
});
