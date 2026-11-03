import { createInstance } from "i18next";
import { expect, test } from "vitest";
import { type MessageParams, renderMessage } from "./message";

test("插值、数字、引用与错误参数使用和 Rust 相同的规则", async () => {
  const i18n = createInstance();
  await i18n.init({
    lng: "zh-CN",
    keySeparator: false,
    resources: {
      "zh-CN": {
        translation: {
          body: "{{ kind }}: {{count}} — {{error}} / {{kind}}",
          kind: "清理",
          error: "无权限 {{permission}}",
          literal: "{{value}}",
          cycle: "{{error}}",
        },
      },
    },
  });
  expect(
    renderMessage(i18n, "body", {
      kind: { $t: "kind" },
      count: 2.5,
      error: { $t: "error" },
      permission: "demo.settings.manage",
    }),
  ).toBe("清理: 2.5 — 无权限 demo.settings.manage / 清理");
  expect(renderMessage(i18n, "literal", { value: "{{raw}} <&>" })).toBe(
    "{{raw}} <&>",
  );
  for (const [key, params] of [
    ["missing", {}],
    ["body", {}],
    ["literal", { value: true }],
    ["literal", { value: { $t: "missing" } }],
    ["cycle", { error: { $t: "cycle" } }],
  ] as const) {
    expect(() => renderMessage(i18n, key, params as MessageParams)).toThrow();
  }
});

test("malformed interpolations, extra reference fields and indirect cycles fail explicitly", async () => {
  const instance = createInstance();
  await instance.init({
    lng: "en-US",
    fallbackLng: false,
    keySeparator: false,
    resources: {
      "en-US": {
        translation: {
          broken: "{{value",
          outer: "{{next}}",
          inner: "{{back}}",
          repeat: "{{item}}/{{item}}",
          item: "Item {{count}}",
        },
      },
    },
  });
  expect(() => renderMessage(instance, "broken", { value: "text" })).toThrow(
    "Invalid interpolation",
  );
  expect(() =>
    renderMessage(instance, "outer", {
      next: { $t: "inner" },
      back: { $t: "outer" },
    }),
  ).toThrow("Cyclic translation");
  expect(() =>
    renderMessage(instance, "outer", {
      next: { $t: "inner", extra: true },
    } as unknown as MessageParams),
  ).toThrow("Invalid translation parameter");
  expect(
    renderMessage(instance, "repeat", { item: { $t: "item" }, count: 2 }),
  ).toBe("Item 2/Item 2");
});
