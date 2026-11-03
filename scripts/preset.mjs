import { constants } from "node:fs";
import { copyFile, mkdir, readdir } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { root, task } from "./common.mjs";
import { hostPackage } from "./product.mjs";

const usage = "用法: pnpm preset <minimal|tool|full> [--state-root <路径>]";

await task("preset", async () => {
  const [name, ...args] = process.argv.slice(2);
  const names = (await readdir(join(root, "presets")))
    .filter((file) => file.endsWith(".toml"))
    .map((file) => file.slice(0, -5));
  if (
    !names.includes(name) ||
    !(
      args.length === 0 ||
      (args.length === 2 &&
        args[0] === "--state-root" &&
        args[1].length > 0 &&
        !args[1].startsWith("-"))
    )
  ) {
    throw new Error(`预设名称或参数无效。\n${usage}`);
  }

  const { PRESET_CATALOG } = await import("../src/lib/generated/assembly.ts");
  const preset = PRESET_CATALOG.find((preset) => preset.name === name);
  if (!preset) {
    throw new Error(`装配目录缺少预设 ${name}，请运行 pnpm generate。`);
  }
  const defaultRoot = resolve(root, "Temp/dev-state");
  const stateRoot = resolve(root, args[1] ?? "Temp/dev-state");
  const configFile = join(stateRoot, "config.toml");
  await mkdir(stateRoot, { recursive: true });
  try {
    await copyFile(
      join(root, "presets", `${name}.toml`),
      configFile,
      constants.COPYFILE_EXCL,
    );
  } catch (error) {
    if (error.code === "EEXIST") {
      throw new Error(`配置文件已存在，拒绝覆盖：${configFile}`);
    }
    throw error;
  }

  console.log(`状态目录：${stateRoot}`);
  console.log(`配置文件：${configFile}`);
  console.log(`启用模块：${preset.enabledModules.join(", ")}`);
  if (relative(defaultRoot, stateRoot) === "") {
    console.log("运行 pnpm dev 即可使用该配置。");
  } else {
    console.log(
      `桌面程序用 --state-root "${stateRoot}" 启动即可使用该状态目录。`,
    );
    console.log(`例如：${hostPackage}.exe --state-root "${stateRoot}"`);
    console.log(
      "pnpm dev 固定使用 Temp/dev-state；要用开发窗口就不带 --state-root 运行 pnpm preset。",
    );
  }
});
