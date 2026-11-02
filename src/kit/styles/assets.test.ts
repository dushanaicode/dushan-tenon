import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { render, screen } from "@testing-library/react";
import { createElement } from "react";
import { expect, it } from "vitest";
import { StreamText } from "@/kit";
import { withKitI18n } from "../kit.test-support";

const read = (file: string) => readFileSync(file, "utf8");
const require = createRequire(import.meta.url);

it("StreamText 静态 CSS 与上游工具类源可由统一入口构建", () => {
  expect(read("src/kit/styles/stream.css")).toContain(
    '@import "streamdown/styles.css" layer(components);',
  );
  expect(read("src/app/styles.css")).toContain(
    '@source "../../node_modules/streamdown/dist/*.js";',
  );
  expect(read(require.resolve("streamdown/styles.css")).length).toBeGreaterThan(
    0,
  );
  expect(read(require.resolve("sonner/dist/styles.css"))).toContain(
    "data-sonner-toaster",
  );
});

it("从公共出口渲染受限 Markdown，保留内容但不创建脚本、图片或导航外链", () => {
  const { container } = render(
    withKitI18n(
      createElement(StreamText, {
        text: "正文 **强调**\n\n<script>alert(1)</script>\n\n![远程](https://example.com/image.png)\n\n[链接](https://example.com)",
        isAnimating: false,
      }),
    ),
  );
  expect(screen.getByText("强调").tagName).toBe("STRONG");
  expect(screen.getByText("[图片已阻止: 远程]")).toBeTruthy();
  expect(container.querySelector("script, img, a[href]")).toBeNull();
  expect(screen.getByRole("button", { name: /复制链接/ })).toBeTruthy();
});

it("实际分发来源保留精确版本、版权和完整许可", () => {
  const sources = read("src/kit/SOURCES.md");
  const pkg = JSON.parse(read("package.json"));
  for (const name of [
    "radix-ui",
    "cmdk",
    "sonner",
    "@tanstack/react-table",
    "@tanstack/react-virtual",
    "react-resizable-panels",
    "streamdown",
    "@streamdown/cjk",
    "use-stick-to-bottom",
  ]) {
    expect(sources).toContain(name);
    expect(sources).toContain(pkg.dependencies[name]);
  }
  expect(sources).not.toMatch(
    /ImageFramer|react-image-crop|P5|R5|本片|TOKENICODE|prompt-kit/,
  );
  const apache = read("src/kit/licenses/ai-elements.LICENSE");
  expect(apache).toContain("Copyright 2023 Vercel, Inc.");
  expect(apache).toContain("END OF TERMS AND CONDITIONS");
  for (const file of [
    "src/kit/ui/LICENSE",
    "src/kit/licenses/react-resizable-panels.LICENSE",
    "src/kit/licenses/use-stick-to-bottom.LICENSE",
  ]) {
    const license = read(file);
    expect(license).toContain("Permission is hereby granted, free of charge");
    expect(license).toContain("SOFTWARE.");
  }
});
