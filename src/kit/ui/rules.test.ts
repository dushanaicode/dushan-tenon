import { readFileSync } from "node:fs";
import { parseAst } from "vite";
import { describe, expect, it } from "vitest";
import * as kit from "@/kit";

const sources = import.meta.glob<string>(["./*.tsx", "!./*.test.tsx"], {
  query: "?raw",
  import: "default",
  eager: true,
});

it("公共出口覆盖当前组件、模板、props 与纯视图类型，不暴露内部原语或暂缓资产", () => {
  const implementations = {
    ...sources,
    ...import.meta.glob<string>(
      [
        "../templates/*.tsx",
        "!../templates/*.test.tsx",
        "../icons.ts",
        "../responsive.ts",
      ],
      { query: "?raw", import: "default", eager: true },
    ),
  };
  function exportsOf(text: string) {
    return parseAst(text, { lang: "tsx" }).body.flatMap((node) => {
      if (node.type !== "ExportNamedDeclaration") return [];
      const declaration = node.declaration;
      if (declaration?.type === "VariableDeclaration") {
        return declaration.declarations.flatMap(({ id }) =>
          id.type === "Identifier" ? [id.name] : [],
        );
      }
      if (
        declaration &&
        "id" in declaration &&
        declaration.id?.type === "Identifier"
      )
        return [declaration.id.name];
      return node.specifiers.map(({ exported }) =>
        exported.type === "Identifier" ? exported.name : exported.value,
      );
    });
  }
  const expected = [
    "toast",
    ...Object.entries(implementations)
      .filter(([file]) => file !== "./table.tsx")
      .flatMap(([, text]) => exportsOf(text)),
  ];
  const actual = exportsOf(readFileSync("src/kit/index.ts", "utf8"));
  expect(actual.sort()).toEqual(expected.sort());
  expect(Object.values(kit).every((value) => value !== undefined)).toBe(true);
  for (const name of [
    "Table",
    "ImageFramer",
    "GpuEffects",
    "announce",
    "EffectsProvider",
    "LoadingStyle",
  ])
    expect(kit).not.toHaveProperty(name);
});

const forbidden = [
  /transition-(?:all|colors|shadow|\[)/,
  /duration-\d/,
  /dark:/,
  /(?:ring|bg|border|text)-[a-z-]+\/\d+/,
  /shadow-(?:xs|sm|md|lg)\b/,
  new RegExp(
    [
      "(?:bg|text|border|ring)-",
      "(?:red|green|blue|amber|yellow|orange|pink|purple|violet|emerald|",
      "teal|cyan|sky|indigo|rose|slate|gray|zinc|neutral|stone)-\\d",
    ].join(""),
  ),
  /\bh-(?:8|9|10)\b/,
];

describe("套件源码规则", () => {
  it("读取组件源码并排除测试文件", () => {
    expect(Object.keys(sources).length).toBeGreaterThan(0);
    for (const [file, source] of Object.entries(sources)) {
      expect(file).not.toMatch(/\.test\.tsx$/);
      expect(source, file).toContain("export");
    }
  });

  it.each(Object.entries(sources))(
    "%s 只使用语义样式与统一动效",
    (file, source) => {
      for (const pattern of forbidden) {
        expect(source, file).not.toMatch(pattern);
      }
    },
  );
});
