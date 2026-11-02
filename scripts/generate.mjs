import { spawnSync } from "node:child_process";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { root, run, task } from "./common.mjs";
import { hostPackage } from "./product.mjs";

export function formatGenerated(source, name, env) {
  const result = spawnSync(
    process.execPath,
    [
      join(root, "node_modules/@biomejs/biome/bin/biome"),
      "check",
      "--write",
      "--stdin-file-path",
      join(root, "src/lib/generated", name),
    ],
    { cwd: root, env, windowsHide: true, encoding: "utf8", input: source },
  );
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`格式化生成合同失败: ${result.stderr}`);
  return result.stdout;
}

export async function generate(output, env) {
  await run(
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
      output,
    ],
    env,
  );
  for (const name of await readdir(output)) {
    await writeFile(
      join(output, name),
      formatGenerated(await readFile(join(output, name), "utf8"), name, env),
    );
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await task("generate", async (env) => {
    if (process.argv.length !== 2) throw new Error("用法: pnpm generate");
    await generate(join(root, "src/lib/generated"), env);
  });
}
