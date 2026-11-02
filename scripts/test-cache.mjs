import { run } from "./common.mjs";
import { readConnections, requireConnection } from "./test-connections.mjs";

async function redisEnvironment(env) {
  const connections = await readConnections(env);
  const raw = requireConnection(connections, "TENON_TEST_REDIS_URL");
  let url;
  let username;
  let password;
  try {
    url = new URL(raw);
    if (
      url.protocol !== "redis:" ||
      !url.hostname ||
      !url.port ||
      !/^\/\d+$/.test(url.pathname) ||
      url.search ||
      url.hash
    )
      throw new Error();
    username = decodeURIComponent(url.username);
    password = decodeURIComponent(url.password);
  } catch {
    throw new Error(
      "无效的 TENON_TEST_REDIS_URL；需要 redis 协议、主机、显式端口与数据库编号。",
    );
  }
  return {
    connections,
    env: {
      ...env,
      TENON_TEST_CACHE_PROVIDER: "redis",
      TENON_TEST_REDIS_HOST: url.hostname.replace(/^\[|\]$/g, ""),
      TENON_TEST_REDIS_PORT: url.port,
      TENON_TEST_REDIS_DB: url.pathname.slice(1),
      TENON_TEST_REDIS_USERNAME: username || undefined,
      TENON_TEST_REDIS_TLS: "disabled",
      TENON_SECRET__CACHE__REDIS_PASSWORD:
        connections.TENON_SECRET__CACHE__REDIS_PASSWORD ?? password,
    },
  };
}

export async function testCache(provider, env) {
  const cacheEnv =
    provider === "redis"
      ? (await redisEnvironment(env)).env
      : { ...env, TENON_TEST_CACHE_PROVIDER: "local" };
  await run(
    `缓存合同: ${provider}`,
    "cargo",
    ["test", "--package", "tenon-framework", "--lib", "--locked", "cache::"],
    cacheEnv,
  );
}

export async function testRedisTls(env) {
  const { connections, env: cacheEnv } = await redisEnvironment(env);
  for (const name of [
    "TENON_TEST_REDIS_TLS_PORT",
    "TENON_TEST_REDIS_CA_FILE",
    "TENON_TEST_REDIS_WRONG_CA_FILE",
  ]) {
    cacheEnv[name] = requireConnection(connections, name);
  }
  requireConnection(cacheEnv, "TENON_SECRET__CACHE__REDIS_PASSWORD");
  await run(
    "TLS 实测: redis（三档与错误 CA 反例）",
    "cargo",
    [
      "test",
      "--package",
      "tenon-framework",
      "--test",
      "cache_tls",
      "--locked",
      "--",
      "--ignored",
      "--nocapture",
    ],
    { ...cacheEnv, TENON_TEST_CACHE_TLS: "1" },
  );
}
