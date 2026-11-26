import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { parseAst } from "vite";
import { expect, it } from "vitest";
import { APPEARANCE_LAYER_ORDER } from "./layer-order";

type CssNode = {
  type: string;
  name?: string;
  params?: string;
  important?: boolean;
  parent?: CssNode;
  nodes?: CssNode[];
};
const require = createRequire(import.meta.resolve("vite/package.json"));
const { parse }: { parse: (css: string) => CssNode } = require("postcss");
const layers = [
  "theme",
  "base",
  "components",
  "utilities",
  "appearance-defaults",
  "appearance-themes",
  "appearance-system",
  "appearance-overrides",
  "appearance-a11y",
];
const sheets: { file: string; root: CssNode; layer?: string }[] = [];

// 遍历真实入口的全部本地/包导入，带入 @import layer(...)，不靠平面文件清单推断级联。
function visit(file: string, layer?: string) {
  const root = parse(readFileSync(file, "utf8"));
  sheets.push({ file, root, layer });
  for (const node of root.nodes ?? []) {
    if (node.type !== "atrule" || node.name !== "import") continue;
    const match = /^["']([^"']+)["'](?:\s+layer\(([^)]+)\))?/.exec(
      node.params ?? "",
    );
    if (!match) throw new Error(`无法解析 CSS import：${file}: ${node.params}`);
    // CSS 中的包根入口采用 Tailwind 的 style 导出，Node require 默认会选 JS。
    const specifier =
      match[1] === "tailwindcss" ? "tailwindcss/index.css" : match[1];
    visit(createRequire(file).resolve(specifier), match[2] ?? layer);
  }
}
visit(resolve("src/app/styles.css"));

function* descendants(node: CssNode): Generator<CssNode> {
  for (const child of node.nodes ?? []) {
    yield child;
    yield* descendants(child);
  }
}
function ancestors(node: CssNode) {
  const parents: CssNode[] = [];
  for (let parent = node.parent; parent; parent = parent.parent)
    parents.push(parent);
  return parents;
}

it("入口第一条语句与运行时声明采用架构九层顺序", () => {
  const first = sheets[0].root.nodes?.[0];
  expect(first).toMatchObject({ type: "atrule", name: "layer" });
  expect(first?.nodes).toBeUndefined();
  expect(first?.params?.split(",").map((name) => name.trim())).toEqual(layers);
  expect(APPEARANCE_LAYER_ORDER).toBe(`@layer ${layers.join(", ")};`);
});

it("main 只加载统一样式入口，入口包含所有当前 kit 样式和供应商 CSS", () => {
  const source = parseAst(readFileSync("src/main.tsx", "utf8"), {
    lang: "tsx",
  });
  expect(
    source.body.flatMap((node) =>
      node.type === "ImportDeclaration" && node.source.value.endsWith(".css")
        ? [node.source.value]
        : [],
    ),
  ).toEqual(["@/app/styles.css"]);
  const included = sheets.map(({ file }) => file);
  for (const name of readdirSync("src/kit/styles").filter((name) =>
    name.endsWith(".css"),
  )) {
    expect(included).toContain(resolve("src/kit/styles", name));
  }
  for (const name of ["sonner/dist/styles.css", "streamdown/styles.css"]) {
    expect(
      sheets.find(({ file }) => file === require.resolve(name))?.layer,
    ).toBe("components");
  }
  expect(
    sheets.find(({ file }) => file === resolve("src/kit/ui/setting-group.css"))
      ?.layer,
  ).toBe("components");
  expect(new Set(included).size).toBe(included.length);
});

it("完整导入链中的普通规则都在已声明层内；主题层只在 visual，偏好覆盖层只有密度", () => {
  const constructs = new Set([
    "theme",
    "utility",
    "custom-variant",
    "keyframes",
    "font-face",
    "property",
  ]);
  for (const { file, root, layer } of sheets) {
    if (layer) expect(layers, file).toContain(layer);
    for (const node of descendants(root)) {
      if (node.type === "atrule" && node.name === "layer" && node.nodes) {
        expect(layers, file).toContain(node.params);
        if (node.params === "appearance-themes")
          expect(file.replaceAll("\\", "/"), file).toContain("/src/visual/");
        if (node.params === "appearance-overrides")
          expect(file.replaceAll("\\", "/"), file).toMatch(
            /\/src\/kit\/styles\/tokens\.css$/,
          );
      }
      if (node.type !== "rule" && node.type !== "decl") continue;
      const parents = ancestors(node);
      if (parents.some((parent) => constructs.has(parent.name ?? ""))) continue;
      const parentLayers = parents
        .filter((parent) => parent.name === "layer")
        .map((parent) => parent.params);
      const effective = [...parentLayers, ...(layer ? [layer] : [])];
      expect(effective.length, file).toBeGreaterThan(0);
      for (const name of effective) expect(layers, file).toContain(name);
    }
  }
});

it("项目 important 只用于无障碍覆盖，不恢复供应商减动动画", () => {
  for (const { file, root } of sheets.filter(({ file }) =>
    file.startsWith(resolve("src")),
  )) {
    for (const node of descendants(root)) {
      if (!node.important) continue;
      const layer = ancestors(node).find((parent) => parent.name === "layer");
      expect(layer?.params, file).toBe("appearance-a11y");
    }
  }
});
