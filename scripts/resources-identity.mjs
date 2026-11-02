import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { root } from "./common.mjs";

export const { mainBinaryName: owner } = JSON.parse(
  await readFile(join(root, "src-tauri/tauri.conf.json"), "utf8"),
);
if (!/^[a-z][a-z0-9-]*$/.test(owner)) {
  throw new Error(
    "测试资源要求 mainBinaryName 为小写字母、数字与连字符组成的程序名",
  );
}
