import assert from "node:assert/strict";
import { mkdir, mkdtemp, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { beforeEach, mock, test } from "node:test";
import { pathToFileURL } from "node:url";

const workspace = process.cwd();
const temporary = resolve(workspace, "Temp/test/connections-test");
await mkdir(temporary, { recursive: true });
const root = await mkdtemp(join(temporary, "connections-"));
const directory = join(root, "Temp/test-resources");
await mkdir(directory, { recursive: true });
const connectionFile = join(directory, "connection.json");
const saved = {
  TENON_TEST_MYSQL_URL:
    "mysql://root:mysql-test-password@127.0.0.1:34306/mysql",
  TENON_TEST_POSTGRES_URL:
    "postgres://postgres:pg-test-password@127.0.0.1:34432/postgres",
  TENON_TEST_REDIS_URL: "redis://:redis-test-password@127.0.0.1:34379/0",
  TENON_TEST_MYSQL_CA_FILE: join(directory, "mysql-ca.pem"),
  TENON_TEST_POSTGRES_CA_FILE: join(directory, "postgres-ca.pem"),
  TENON_TEST_POSTGRES_TLS: "enabled",
  TENON_TEST_REDIS_TLS_PORT: "34380",
  TENON_TEST_REDIS_CA_FILE: join(directory, "redis-ca.pem"),
  TENON_TEST_REDIS_WRONG_CA_FILE: join(directory, "redis-wrong-ca.pem"),
};
let env;
let failure;
const calls = [];
const output = [];
mock.module(pathToFileURL(join(workspace, "scripts/common.mjs")), {
  namedExports: {
    root,
    task: async (_command, action) => action(env),
    run: async (step, executable, args, environment) => {
      calls.push({ step, executable, args, env: environment });
      if (step === failure) throw new Error("fixture command failed");
    },
    runBin: async (step, packageName, binName, args, environment) => {
      calls.push({ step, packageName, binName, args, env: environment });
    },
  },
});
const { readConnections, requireConnection } = await import(
  "./test-connections.mjs"
);
let invocation = 0;
async function command(...targets) {
  const argv = process.argv;
  process.argv = [process.execPath, "test.mjs", ...targets];
  const log = console.log;
  const error = console.error;
  console.log = console.error = (...args) => output.push(args.join(" "));
  try {
    await import(
      `${pathToFileURL(join(workspace, "scripts/test.mjs"))}?contract=${++invocation}`
    );
  } finally {
    process.argv = argv;
    console.log = log;
    console.error = error;
  }
}

beforeEach(async () => {
  env = { PATH: "inherited-path" };
  failure = undefined;
  calls.length = output.length = 0;
  await writeFile(connectionFile, JSON.stringify(saved));
});

test("connections use environment over file without changing the caller", async () => {
  const overrides = {
    TENON_TEST_MYSQL_URL: "mysql://test:override@localhost:3307/test",
    TENON_TEST_REDIS_CA_FILE: "override-ca.pem",
    TENON_SECRET__DATABASE__PASSWORD: "environment-secret",
  };
  const connections = await readConnections(overrides);
  assert.deepEqual(connections, { ...saved, ...overrides });
  assert.equal(Object.keys(overrides).length, 3);
});

test("missing connection file allows explicit environment values", async () => {
  await unlink(connectionFile);
  assert.deepEqual(await readConnections(env), env);
  assert.throws(
    () => requireConnection(env, "TENON_TEST_MYSQL_URL"),
    /缺少 TENON_TEST_MYSQL_URL/,
  );
});

for (const content of [
  "null",
  "[]",
  "1",
  '"text"',
  '{"url":123}',
  '{"secret":"sensitive-fixture", broken',
]) {
  test(`invalid connection mapping ${content.slice(0, 12)} is rejected without its content`, async () => {
    await writeFile(connectionFile, content);
    await assert.rejects(readConnections(env), (error) => {
      assert.match(error.message, /必须是字符串映射/);
      assert(!error.message.includes("sensitive-fixture"));
      assert.equal(error.cause, undefined);
      return true;
    });
  });
}

test("db:all runs all dialects with workspace filtering and no package list", async () => {
  await command("db:all");
  assert.deepEqual(
    calls.map((call) => call.env.TENON_TEST_DIALECT),
    ["sqlite", "mysql", "postgres"],
  );
  for (const call of calls) {
    assert.equal(call.executable, "cargo");
    assert.deepEqual(call.args, [
      "test",
      "--workspace",
      "--lib",
      "--locked",
      "db::",
    ]);
    assert.equal(call.env.PATH, "inherited-path");
  }
  assert.equal(calls[1].env.TENON_TEST_MYSQL_URL, saved.TENON_TEST_MYSQL_URL);
  assert.equal(
    calls[2].env.TENON_TEST_POSTGRES_URL,
    saved.TENON_TEST_POSTGRES_URL,
  );
  assert(
    !JSON.stringify(calls.map(({ step, args }) => ({ step, args }))).includes(
      "password",
    ),
  );
  assert(!output.join("\n").includes("password"));
});

for (const dialect of ["mysql", "postgres"]) {
  test(`db:${dialect} requires resources and honors an explicit URL`, async () => {
    await unlink(connectionFile);
    await assert.rejects(command(`db:${dialect}`), /测试失败目标/);
    assert.equal(calls.length, 0);
    const key = `TENON_TEST_${dialect.toUpperCase()}_URL`;
    assert(output.some((line) => line.includes(`缺少 ${key}`)));
    env[key] = saved[key];
    await command(`db:${dialect}`);
    assert.equal(calls[0].env[key], saved[key]);
  });
}

test("an empty environment URL does not fall back to file credentials", async () => {
  env.TENON_TEST_MYSQL_URL = "";
  await assert.rejects(command("db:mysql"), /测试失败目标/);
  assert.equal(calls.length, 0);
  assert(output.some((line) => line.includes("缺少 TENON_TEST_MYSQL_URL")));
});

test("db:sqlite and cache:local need no connection file", async () => {
  await unlink(connectionFile);
  await command("db:sqlite", "cache:local");
  assert.equal(calls[0].env.TENON_TEST_DIALECT, "sqlite");
  assert.equal(calls[1].env.TENON_TEST_CACHE_PROVIDER, "local");
  assert.deepEqual(calls[1].args, [
    "test",
    "--package",
    "tenon-framework",
    "--lib",
    "--locked",
    "cache::",
  ]);
});

test("cache:all selects local then Redis with the new framework test environment", async () => {
  env.TENON_TEST_REDIS_URL =
    "redis://cache%20user:encoded%3Apassword@[::1]:34567/3";
  await command("cache:all");
  assert.deepEqual(
    calls.map((call) => call.env.TENON_TEST_CACHE_PROVIDER),
    ["local", "redis"],
  );
  assert.deepEqual(calls[1].env, {
    ...env,
    TENON_TEST_DIALECT: "sqlite",
    TENON_TEST_CACHE_PROVIDER: "redis",
    TENON_TEST_REDIS_HOST: "::1",
    TENON_TEST_REDIS_PORT: "34567",
    TENON_TEST_REDIS_DB: "3",
    TENON_TEST_REDIS_USERNAME: "cache user",
    TENON_TEST_REDIS_TLS: "disabled",
    TENON_SECRET__CACHE__REDIS_PASSWORD: "encoded:password",
  });
  assert(!output.join("\n").includes("encoded"));
});

test("cache URL without a user clears a previously supplied username and honors the secret override", async () => {
  env.TENON_TEST_REDIS_USERNAME = "stale-user";
  env.TENON_SECRET__CACHE__REDIS_PASSWORD = "explicit-secret";
  await command("cache:redis");
  assert.equal(calls[0].env.TENON_TEST_REDIS_USERNAME, undefined);
  assert.equal(
    calls[0].env.TENON_SECRET__CACHE__REDIS_PASSWORD,
    "explicit-secret",
  );
});

for (const url of [
  "not-a-url-secret",
  "https://:secret@localhost:6379/0",
  "redis://:secret@localhost/0",
  "redis://:secret@localhost:6379/nope",
  "redis://:secret@localhost:6379/0?query=secret",
  "redis://:secret@localhost:6379/0#secret",
  "redis://:%ZZsecret@localhost:6379/0",
]) {
  test(`invalid Redis connection ${url.split(":")[0]} fails before cargo`, async () => {
    env.TENON_TEST_REDIS_URL = url;
    await assert.rejects(command("cache:redis"), /测试失败目标/);
    assert.equal(calls.length, 0);
    assert(output.some((line) => line.includes("无效的 TENON_TEST_REDIS_URL")));
    assert(!output.join("\n").includes("secret"));
  });
}

test("tls:all invokes only the explicitly ignored integration tests", async () => {
  await command("tls:all");
  assert.equal(calls.length, 3);
  assert.deepEqual(
    calls.map((call) => call.args[4]),
    ["remote_tls", "remote_tls", "cache_tls"],
  );
  for (const call of calls) {
    assert.equal(call.executable, "cargo");
    assert.deepEqual(call.args.slice(0, 4), [
      "test",
      "--package",
      "tenon-framework",
      "--test",
    ]);
    assert.deepEqual(call.args.slice(5), [
      "--locked",
      "--",
      "--ignored",
      "--nocapture",
    ]);
    assert(!call.step.includes("password"));
  }
  assert.equal(calls[0].env.TENON_TEST_TLS, "1");
  assert.equal(calls[0].env.TENON__DATABASE__KIND, "mysql");
  assert.equal(
    calls[0].env.TENON_SECRET__DATABASE__PASSWORD,
    "mysql-test-password",
  );
  assert.equal(calls[1].env.TENON__DATABASE__KIND, "postgres");
  assert.equal(calls[1].env.TENON_TEST_TLS_ENABLED, "enabled");
  assert.equal(
    calls[1].env.TENON_TEST_TLS_CA_FILE,
    saved.TENON_TEST_POSTGRES_CA_FILE,
  );
  assert.equal(calls[2].env.TENON_TEST_CACHE_TLS, "1");
  assert.equal(calls[2].env.TENON_TEST_REDIS_PORT, "34379");
  assert.equal(calls[2].env.TENON_TEST_REDIS_TLS_PORT, "34380");
  assert.equal(
    calls[2].env.TENON_TEST_REDIS_WRONG_CA_FILE,
    saved.TENON_TEST_REDIS_WRONG_CA_FILE,
  );
});

test("TLS overrides decode URL components and pass secrets only in the child environment", async () => {
  env.TENON_TEST_MYSQL_URL =
    "mysql://test%20user:encoded%40password@[::1]:34307/test%20db";
  env.TENON_TEST_MYSQL_CA_FILE = "explicit-ca.pem";
  env.TENON_SECRET__DATABASE__PASSWORD = "explicit-secret";
  await command("tls:mysql");
  assert.equal(calls[0].env.TENON__DATABASE__HOST, "::1");
  assert.equal(calls[0].env.TENON__DATABASE__PORT, "34307");
  assert.equal(calls[0].env.TENON__DATABASE__NAME, "test db");
  assert.equal(calls[0].env.TENON__DATABASE__USERNAME, "test user");
  assert.equal(calls[0].env.TENON_TEST_TLS_CA_FILE, "explicit-ca.pem");
  assert.equal(
    calls[0].env.TENON_SECRET__DATABASE__PASSWORD,
    "explicit-secret",
  );
  assert(
    !JSON.stringify([calls[0].step, calls[0].args, output]).includes("secret"),
  );
});

test("an external PostgreSQL source can explicitly select disabled TLS without a CA", async () => {
  await unlink(connectionFile);
  env.TENON_TEST_POSTGRES_URL = saved.TENON_TEST_POSTGRES_URL;
  env.TENON_TEST_POSTGRES_TLS = "disabled";
  await command("tls:postgres");
  assert.equal(calls[0].env.TENON_TEST_TLS_ENABLED, "disabled");
  assert.equal(calls[0].env.TENON_TEST_TLS_CA_FILE, "");
  assert.match(calls[0].step, /disabled/);
});

for (const [target, key] of [
  ["cache:redis", "TENON_TEST_REDIS_URL"],
  ["tls:mysql", "TENON_TEST_MYSQL_URL"],
  ["tls:mysql", "TENON_TEST_MYSQL_CA_FILE"],
  ["tls:postgres", "TENON_TEST_POSTGRES_TLS"],
  ["tls:postgres", "TENON_TEST_POSTGRES_CA_FILE"],
  ["tls:redis", "TENON_TEST_REDIS_TLS_PORT"],
  ["tls:redis", "TENON_TEST_REDIS_CA_FILE"],
  ["tls:redis", "TENON_TEST_REDIS_WRONG_CA_FILE"],
]) {
  test(`${target} cannot skip a missing ${key}`, async () => {
    const incomplete = { ...saved };
    delete incomplete[key];
    await writeFile(connectionFile, JSON.stringify(incomplete));
    await assert.rejects(command(target), /测试失败目标/);
    assert.equal(calls.length, 0);
    assert(output.some((line) => line.includes(key)));
  });
}

for (const url of [
  "postgres://root:secret@localhost:34306/mysql",
  "mysql://root:secret@localhost/mysql",
  "mysql://:secret@localhost:34306/mysql",
  "mysql://root:secret@localhost:34306/",
  "mysql://root:secret@localhost:34306/mysql?ssl=secret",
  "mysql://root:%ZZsecret@localhost:34306/mysql",
]) {
  test("invalid database TLS URL never leaks credentials through diagnostics", async () => {
    env.TENON_TEST_MYSQL_URL = url;
    await assert.rejects(command("tls:mysql"), /测试失败目标/);
    assert.equal(calls.length, 0);
    assert(output.some((line) => line.includes("无效的 TENON_TEST_MYSQL_URL")));
    assert(!output.join("\n").includes("secret"));
  });
}

test("default targets keep SQLite/local even when remote test variables were inherited", async () => {
  env.TENON_TEST_DIALECT = "mysql";
  env.TENON_TEST_CACHE_PROVIDER = "redis";
  await unlink(connectionFile);
  await command();
  assert.equal(calls.length, 3);
  assert(calls[0].args.includes("--bins"));
  assert.equal(calls[0].env.TENON_TEST_DIALECT, "sqlite");
  assert.equal(calls[0].env.TENON_TEST_CACHE_PROVIDER, "local");
  assert.equal(calls[1].binName, "vitest");
  assert.equal(calls[2].executable, process.execPath);
  assert(calls[2].args.includes("--experimental-test-module-mocks"));
  for (const file of [
    "scripts/resources.test.mjs",
    "scripts/test-connections.test.mjs",
  ])
    assert(calls[2].args.includes(file));
  assert(!calls[2].args.some((arg) => arg.includes("test-packages")));
});

test("rust and web filters remain literal arguments", async () => {
  await command("rust:cache::", "web:app.test.tsx");
  assert.equal(calls[0].args.at(-1), "cache::");
  assert.equal(calls[1].args.at(-1), "app.test.tsx");
});

test("invalid targets are rejected before any test starts", async () => {
  for (const target of [
    "db",
    "db:sqlite:extra",
    "db:oracle",
    "cache",
    "cache:memory",
    "tls:sqlite",
    "tls",
    "scripts:all",
    "rust:",
    "web:--run",
    "unknown",
  ]) {
    await assert.rejects(command("rust", target), /无效测试目标/);
  }
  assert.equal(calls.length, 0);
});

test("failed expanded targets are reported while the remaining selections still run", async () => {
  failure = "数据库合同: mysql";
  await assert.rejects(
    command("db:all", "cache:local"),
    /测试失败目标：db:mysql/,
  );
  assert.deepEqual(
    calls.map((call) => call.step),
    [
      "数据库合同: sqlite",
      "数据库合同: mysql",
      "数据库合同: postgres",
      "缓存合同: local",
    ],
  );
});

test("help displays remote selectors without running tests", async () => {
  await command("--help");
  assert.equal(calls.length, 0);
  assert(output.some((line) => line.includes("db:sqlite|mysql|postgres|all")));
});
