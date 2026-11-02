import { run, runBin, task } from "./common.mjs";

const targets = process.argv.slice(2);
const help = `用法: pnpm test [目标...]
  不带参数             Rust、前端与脚本全部单元测试
  rust                 仅 Rust 单元测试
  rust:<过滤词>        仅匹配的 Rust 单元测试
  web                  仅前端单元测试
  web:<文件>           仅匹配文件的前端单元测试
  scripts              仅 Node 脚本单元测试
  --help               显示此帮助
示例: pnpm test rust:example web:app.test.tsx`;

if (targets.includes("--help") || targets.includes("-h")) {
  console.log(help);
} else {
  await task("test", async (env) => {
    const selected =
      targets.length === 0 ? ["rust", "web", "scripts"] : targets;
    const parsed = selected.map((target) => {
      const separator = target.indexOf(":");
      const kind = separator === -1 ? target : target.slice(0, separator);
      const filter = separator === -1 ? "" : target.slice(separator + 1);
      if (
        !["rust", "web", "scripts"].includes(kind) ||
        (kind === "scripts" && separator !== -1) ||
        (separator !== -1 && !filter) ||
        filter.startsWith("-")
      ) {
        throw new Error(`无效测试目标 ${JSON.stringify(target)}\n${help}`);
      }
      return { target, kind, filter };
    });
    const failed = [];
    for (const { target, kind, filter } of parsed) {
      try {
        if (kind === "scripts") {
          await run(
            "Node 脚本单元测试",
            process.execPath,
            [
              "--test-timeout=15000",
              "--test",
              "scripts/check-identity.test.mjs",
              "scripts/check-structure.test.mjs",
            ],
            env,
          );
        } else if (kind === "rust") {
          await run(
            `Rust 单元测试${filter ? `: ${filter}` : ""}`,
            "cargo",
            [
              "test",
              "--workspace",
              "--lib",
              "--bins",
              "--locked",
              ...(filter ? [filter] : []),
            ],
            env,
          );
        } else {
          await runBin(
            `前端单元测试${filter ? `: ${filter}` : ""}`,
            "vitest",
            "vitest",
            ["run", "--configLoader", "native", ...(filter ? [filter] : [])],
            env,
          );
        }
      } catch (error) {
        failed.push(target);
        console.error(`[${target}] ${error.message}`);
      }
    }
    if (failed.length > 0) {
      throw new Error(`测试失败目标：${failed.join("、")}`);
    }
    console.log(`\n全部测试目标通过：${selected.join("、")}`);
  });
}
