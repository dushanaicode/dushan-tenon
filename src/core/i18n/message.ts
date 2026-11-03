import type { i18n as I18n } from "i18next";

export type MessageParams = Record<string, string | number | { $t: string }>;

// 与 framework::i18n::render 一致：引用复用参数，插入文本不再解释为模板。
export function renderMessage(i18n: I18n, key: string, params: MessageParams) {
  const stack = new Set<string>();
  function expand(key: string): string {
    if (stack.has(key)) throw new Error(`Cyclic translation: ${key}`);
    const template: unknown = i18n.getResource(
      i18n.language,
      "translation",
      key,
    );
    if (typeof template !== "string")
      throw new Error(`Missing translation: ${key}`);
    stack.add(key);
    let rest = template;
    let output = "";
    while (rest.includes("{{")) {
      const start = rest.indexOf("{{");
      const end = rest.indexOf("}}", start + 2);
      if (end < 0) throw new Error(`Invalid interpolation: ${key}`);
      output += rest.slice(0, start);
      const name = rest.slice(start + 2, end).trim();
      const value = params[name];
      if (typeof value === "string" || typeof value === "number") {
        output += String(value);
      } else if (
        value &&
        Object.keys(value).length === 1 &&
        typeof value.$t === "string"
      ) {
        output += expand(value.$t);
      } else {
        throw new Error(`Invalid translation parameter: ${name}`);
      }
      rest = rest.slice(end + 2);
    }
    stack.delete(key);
    return output + rest;
  }
  return expand(key);
}
