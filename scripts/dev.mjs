import { createServer } from "node:net";
import { join } from "node:path";
import { root, runBin, task } from "./common.mjs";

await task("dev", async (env) => {
  // 探测 IPv4/IPv6 的占用；Vite 的 strictPort 还会拒绝检查后的竞争占用。
  for (const host of ["127.0.0.1", "::1"]) {
    await new Promise((resolve, reject) => {
      const probe = createServer();
      probe.once("error", (error) => {
        reject(
          new Error(
            `检查端口 17430 (${host}) 失败（${error.code}），请释放端口后重试。`,
          ),
        );
      });
      probe.listen({ host, port: 17430, exclusive: true }, () => {
        probe.close((error) => (error ? reject(error) : resolve()));
      });
    });
  }
  // 开发窗口固定使用仓库里的 Temp/dev-state，不碰安装版放在系统应用数据目录里的状态。
  await runBin("Tauri 开发窗口", "@tauri-apps/cli", "tauri", ["dev"], {
    ...env,
    TENON_STATE_ROOT: join(root, "Temp/dev-state"),
  });
});
