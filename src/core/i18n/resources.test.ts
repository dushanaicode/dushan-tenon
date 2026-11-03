import { expect, test } from "vitest";
import { DICT_MESSAGE_KEYS } from "@/lib/generated/dict-codes";
import { ERROR_CODES } from "@/lib/generated/error-codes";
import { MESSAGE_KEYS } from "@/lib/generated/message-keys";
import en from "./en-US.json";
import { i18n } from "./index";
import zh from "./zh-CN.json";

test("中英文翻译资源的键集合完全一致", () => {
  expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort());
});

test.each([
  ["zh-CN", zh],
  ["en-US", en],
] as const)("%s 翻译值不含连续问号或替换字符", (language, resource) => {
  for (const [key, value] of Object.entries(resource)) {
    expect(value, `${language}: ${key}`).not.toMatch(/\?{2,}|\uFFFD/u);
  }
});

test.each(["modules.names.account", "errors.account.auth.required"] as const)(
  "中文翻译 %s 包含汉字",
  (key) => {
    expect(zh[key]).toMatch(/\p{Script=Han}/u);
  },
);

test("generated error, message and dictionary keys exist in both flat resources", () => {
  for (const key of [
    ...MESSAGE_KEYS,
    ...DICT_MESSAGE_KEYS,
    ...ERROR_CODES.map((code) => `errors.${code}`),
  ]) {
    expect(Object.hasOwn(zh, key), key).toBe(true);
    expect(Object.hasOwn(en, key), key).toBe(true);
  }
});

test("both languages have the same interpolation parameters", () => {
  const parameters = (value: string) =>
    [
      ...new Set(
        [...value.matchAll(/\{\{\s*([^{}]*?)\s*\}\}/g)].map(
          (match) => match[1],
        ),
      ),
    ].sort();
  for (const key of Object.keys(zh) as (keyof typeof zh)[]) {
    expect(parameters(zh[key]), key).toEqual(parameters(en[key]));
  }
});

test("runtime uses one flat namespace and never falls back to another language", () => {
  expect(i18n.options.ns).toEqual(["translation"]);
  expect(i18n.options.keySeparator).toBe(false);
  expect(i18n.options.fallbackLng).toBe(false);
});
