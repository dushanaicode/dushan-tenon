import { runBin, task } from "./common.mjs";

await task("build", async (env) => {
  await runBin(
    "Tauri 可执行文件（不生成安装包）",
    "@tauri-apps/cli",
    "tauri",
    ["build", "--no-bundle"],
    env,
  );
});
