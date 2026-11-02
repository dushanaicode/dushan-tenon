import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { mock, test } from "node:test";
import { root } from "./common.mjs";
import { hostPackage } from "./product.mjs";

const calls = [];
mock.module("./common.mjs", {
  namedExports: {
    root,
    task: async () => {},
    run: async (...args) => {
      calls.push(args);
      const output = args[2].at(-1);
      await writeFile(
        join(output, "value.ts"),
        'export const values=["value"] as const;\n',
      );
    },
  },
});
const { generate, formatGenerated } = await import("./generate.mjs");

test("generate runs the host example and formats every output under the production path", async () => {
  const directory = await mkdtemp(join(process.env.TEMP, "ipc-generator-"));
  await generate(directory, process.env);
  assert.deepEqual(calls[0].slice(0, 3), [
    "生成 IPC 合同",
    "cargo",
    [
      "run",
      "--locked",
      "--package",
      hostPackage,
      "--example",
      "ipc_contract",
      "--",
      directory,
    ],
  ]);
  const first = await readFile(join(directory, "value.ts"), "utf8");
  assert.equal(first, 'export const values = ["value"] as const;\n');
  await generate(directory, process.env);
  assert.equal(await readFile(join(directory, "value.ts"), "utf8"), first);
});

test("generation formatting propagates formatter process failure", () => {
  assert.throws(
    () =>
      formatGenerated("export const value = 1;", "value.ts", {
        ...process.env,
        NODE_OPTIONS: "--invalid-formatter-test-option",
      }),
    /格式化生成合同失败/,
  );
});
