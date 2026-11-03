import { run, runBin, task } from "./common.mjs";
import { testCache, testRedisTls } from "./test-cache.mjs";
import { readConnections, requireConnection } from "./test-connections.mjs";
import { testTls } from "./test-tls.mjs";

const targets = process.argv.slice(2);
const help = `用法: pnpm test [目标...]
  不带参数             Rust、前端与脚本全部单元测试
  rust                 仅 Rust 单元测试
  rust:<过滤词>        仅匹配的 Rust 单元测试
  web                  仅前端单元测试
  web:<文件>           仅匹配文件的前端单元测试
  scripts              仅 Node 脚本单元测试
  db:sqlite|mysql|postgres|all  workspace 数据库合同
  cache:local|redis|all        缓存合同
  tls:mysql|postgres|redis|all 显式 ignored 的 TLS 集成测试
  --help               显示此帮助
默认 Rust 测试使用 SQLite 与 local；远端目标缺资源即失败。
示例: pnpm test db:all cache:all tls:all`;

const remoteTargets = {
  db: ["sqlite", "mysql", "postgres"],
  cache: ["local", "redis"],
  tls: ["mysql", "postgres", "redis"],
};

if (targets.includes("--help") || targets.includes("-h")) {
  console.log(help);
} else {
  await task("test", async (env) => {
    env = {
      ...env,
      TENON_TEST_DIALECT: "sqlite",
      TENON_TEST_CACHE_PROVIDER: "local",
    };
    const selected =
      targets.length === 0 ? ["rust", "web", "scripts"] : targets;
    const parsed = selected.flatMap((target) => {
      const separator = target.indexOf(":");
      const kind = separator === -1 ? target : target.slice(0, separator);
      const filter = separator === -1 ? "" : target.slice(separator + 1);
      if (
        !["rust", "web", "scripts", ...Object.keys(remoteTargets)].includes(
          kind,
        ) ||
        (kind === "scripts" && separator !== -1) ||
        (Object.hasOwn(remoteTargets, kind) &&
          ![...remoteTargets[kind], "all"].includes(filter)) ||
        (separator !== -1 && !filter) ||
        filter.startsWith("-")
      ) {
        throw new Error(`无效测试目标 ${JSON.stringify(target)}\n${help}`);
      }
      return filter === "all" && Object.hasOwn(remoteTargets, kind)
        ? remoteTargets[kind].map((value) => ({
            target: `${kind}:${value}`,
            kind,
            filter: value,
          }))
        : [{ target, kind, filter }];
    });
    const failed = [];
    for (const { target, kind, filter } of parsed) {
      try {
        if (kind === "scripts") {
          await run(
            "Node 脚本单元测试",
            process.execPath,
            [
              "--experimental-test-module-mocks",
              "--test-timeout=15000",
              "--test",
              "scripts/db.test.mjs",
              "scripts/generate.test.mjs",
              "scripts/check-ipc.test.mjs",
              "scripts/product.test.mjs",
              "scripts/preset.test.mjs",
              "scripts/check-release.test.mjs",
              "scripts/bundle.test.mjs",
              "scripts/check-kit.test.mjs",
              "scripts/check-identity.test.mjs",
              "scripts/check-licenses.test.mjs",
              "scripts/check-structure.test.mjs",
              "scripts/resources.test.mjs",
              "scripts/test-connections.test.mjs",
            ],
            env,
          );
        } else if (kind === "db") {
          const dbEnv = { ...env, TENON_TEST_DIALECT: filter };
          if (filter !== "sqlite") {
            const key = `TENON_TEST_${filter.toUpperCase()}_URL`;
            dbEnv[key] = requireConnection(await readConnections(env), key);
          }
          await run(
            `数据库合同: ${filter}`,
            "cargo",
            ["test", "--workspace", "--lib", "--locked", "db::"],
            dbEnv,
          );
        } else if (kind === "cache") {
          await testCache(filter, env);
        } else if (kind === "tls") {
          if (filter === "redis") await testRedisTls(env);
          else await testTls(filter, env);
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
