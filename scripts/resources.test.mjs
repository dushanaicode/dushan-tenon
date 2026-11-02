import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { beforeEach, mock, test } from "node:test";
import { rootCertificates } from "node:tls";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const workspace = process.cwd();
const temporary = resolve(workspace, "Temp/test/resources-test");
await mkdir(temporary, { recursive: true });
const root = await mkdtemp(join(temporary, "resources-"));
await mkdir(join(root, "src-tauri"));
await writeFile(
  join(root, "src-tauri/tauri.conf.json"),
  JSON.stringify({ mainBinaryName: "fixture-desktop" }),
);
const directory = join(root, "Temp/test-resources");
const pidFile = join(directory, "keepalive.pid");
const connectionFile = join(directory, "connection.json");
const names = [
  "fixture-desktop-test-mysql",
  "fixture-desktop-test-postgres",
  "fixture-desktop-test-redis",
];
const containers = new Set();
const processes = new Map();
const calls = [];
const launched = [];
const stopped = [];
const passwords = [];
const output = [];
let nextPid = 1000;
let occupied;
let openssl;
let caFailure;
let initialFailure;
let inspectFailure;
let spawnFailure;
let changeBeforeStop;
let exitBeforeReady;
let inspectCount;
let certificate;
const validCertificate = Buffer.from(
  rootCertificates[0].replace(/\r?\n/g, "\r\n"),
);
const wrongCertificate = Buffer.from(rootCertificates[1]);
let redisTlsFailure;
let wrongCaFailure;
let archiveFailure;
let transferFailure;
let runFailure;
let readinessFailure;
let postgresTlsFailure;
let foreignOwner;
const env = {
  ...process.env,
  WSLENV: "EXISTING/p:MYSQL_ROOT_PASSWORD/p",
  TENON_TEST_MYSQL_IMAGE: "mysql-test-image",
  TENON_TEST_POSTGRES_IMAGE: "postgres-test-image",
};

function execFileMock(executable, args, options, callback) {
  assert.equal(executable, "powershell.exe");
  assert.deepEqual(args.slice(0, 3), [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
  ]);
  assert.equal(options.windowsHide, true);
  assert.equal(options.cwd, root);
  const pid = Number(options.env.TENON_KEEPALIVE_PID);
  const starting = args[3].includes("Start-Process");
  const stopping = args[3].includes("$process.Kill()");
  queueMicrotask(() => {
    if (starting) {
      assert(args[3].includes("-FilePath wsl.exe"));
      assert(args[3].includes("-WindowStyle Hidden -PassThru"));
      assert(args[3].includes('--exec sh -c "exec sleep infinity"'));
      const marker = options.env.TENON_KEEPALIVE_MARKER;
      assert.match(marker, /^fixture-desktop-keepalive-[0-9a-f]{32}$/);
      if (spawnFailure) {
        callback(new Error("keepalive spawn failed"));
        return;
      }
      const pid = ++nextPid;
      const entry = {
        pid,
        name: "wsl.exe",
        commandLine: `"C:\\Windows\\System32\\wsl.exe" --exec sh -c "exec sleep infinity" ${marker}`,
        startedAt: String(1000000000 + pid),
      };
      processes.set(pid, entry);
      launched.push(entry);
      callback(null, `${pid}\r\n`, "");
      return;
    }
    if (!stopping && inspectFailure) {
      callback(new Error("process inspection denied"));
      return;
    }
    if (!stopping && ++inspectCount === 3 && exitBeforeReady) {
      processes.delete(pid);
    }
    const entry = processes.get(pid);
    if (stopping) {
      assert(args[3].includes("$process.Handle"));
      assert(args[3].includes("$process.WaitForExit(5000)"));
      if (entry && changeBeforeStop) entry.startedAt = "999999999999";
      if (
        entry &&
        (entry.name !== "wsl.exe" ||
          entry.startedAt !== options.env.TENON_KEEPALIVE_STARTED_AT)
      ) {
        callback(new Error("process identity changed; refusing to stop it"));
        return;
      }
      if (entry) {
        stopped.push(pid);
        processes.delete(pid);
      }
      callback(null, "", "");
    } else {
      const info = entry
        ? {
            pid,
            name: entry.name,
            commandLine: entry.commandLine,
            startedAt: entry.startedAt,
          }
        : null;
      callback(null, JSON.stringify(info), "");
    }
  });
}
execFileMock[promisify.custom] = (...args) =>
  new Promise((resolve, reject) => {
    execFileMock(...args, (error, stdout, stderr) =>
      error ? reject(error) : resolve({ stdout, stderr }),
    );
  });

mock.module("node:child_process", {
  namedExports: {
    execFile: execFileMock,
    spawn(executable, args, options) {
      assert.equal(executable, "wsl.exe");
      assert.equal(options.windowsHide, true);
      assert.equal(options.cwd, root);
      const child = new EventEmitter();
      assert.deepEqual(args.slice(0, 3), ["--exec", "sh", "-c"]);
      assert(args[3].includes('exec docker "$@"'));
      assert.equal(args[4], "fixture-desktop-docker");
      assert.equal(options.stdio[0], args.includes("-i") ? "pipe" : "ignore");
      const dockerArgs = args.slice(5);
      calls.push(dockerArgs);
      const command = dockerArgs[0];
      let stdout = Buffer.alloc(0);
      let stderr = Buffer.from("fixture-desktop-docker-started\n");
      let code = 0;
      if (command === "ps" && initialFailure) {
        code = 1;
        if (initialFailure === "wsl") {
          stdout = Buffer.from(
            "WSL 启动失败: Wsl/Service/E_ACCESSDENIED",
            "utf16le",
          );
          stderr = Buffer.alloc(0);
        } else
          stderr = Buffer.concat([
            stderr,
            Buffer.from("docker\0failure", "utf8"),
          ]);
      } else if (command === "ps")
        stdout = Buffer.from([...containers].join("\n"));
      else if (command === "run") {
        assert.equal(
          processes.size,
          1,
          "keepalive must run before containers start",
        );
        const name = dockerArgs[dockerArgs.indexOf("--name") + 1];
        assert(names.includes(name));
        const variable = name.endsWith("mysql")
          ? "MYSQL_ROOT_PASSWORD"
          : name.endsWith("postgres")
            ? "POSTGRES_PASSWORD"
            : "REDIS_PASSWORD";
        const password = options.env[variable];
        assert.match(password, /^[0-9a-f]{64}$/);
        assert.equal(dockerArgs[dockerArgs.indexOf("-e") + 1], variable);
        assert(!args.some((arg) => arg.includes(password)));
        assert.equal(
          options.env.WSLENV.split(":")
            .filter((entry) => entry.split("/")[0] === variable)
            .join(":"),
          `${variable}/u`,
        );
        assert(options.env.WSLENV.includes("EXISTING/p"));
        passwords.push(password);
        assert(!dockerArgs.includes("--env-file"));
        assert(dockerArgs.includes("--tmpfs"));
        assert.equal(
          dockerArgs[dockerArgs.indexOf("--label") + 1],
          "fixture-desktop.test-resources=fixture-desktop",
        );
        assert.equal(
          dockerArgs[dockerArgs.indexOf("--tmpfs") + 1],
          name.endsWith("mysql")
            ? "/var/lib/mysql:rw"
            : name.endsWith("postgres")
              ? "/var/lib/postgresql/data:rw"
              : "/data:rw",
        );
        if (name.endsWith("mysql"))
          assert(dockerArgs.includes("mysql-test-image"));
        if (name.endsWith("postgres"))
          assert(dockerArgs.includes("postgres-test-image"));
        assert.equal(
          dockerArgs[dockerArgs.indexOf("--publish") + 1],
          name.endsWith("mysql")
            ? "127.0.0.1:34306:3306"
            : name.endsWith("postgres")
              ? "127.0.0.1:34432:5432"
              : "127.0.0.1:34379:6379",
        );
        if (name.endsWith("redis")) {
          assert(dockerArgs.includes("127.0.0.1:34380:6380"));
          assert(dockerArgs.includes("/data:rw"));
          const script = dockerArgs.at(-1);
          assert(script.includes('"$REDIS_PASSWORD" >> /data/redis.conf'));
          assert(script.includes("redis-server /data/redis.conf"));
          assert(script.includes("maxmemory-policy noeviction"));
          assert(script.includes("umask 077"));
          const owned = script.indexOf(
            "chown redis:redis /data/redis.conf /data/tls",
          );
          assert(
            owned > script.indexOf('"$REDIS_PASSWORD" >> /data/redis.conf'),
            "Redis must own the configuration after its final write",
          );
          assert(
            owned < script.indexOf("exec /usr/local/bin/docker-entrypoint.sh"),
            "ownership must be set before the entrypoint drops privileges",
          );
        }
        containers.add(name);
        if (name === runFailure) {
          code = 1;
          stderr = Buffer.concat([
            stderr,
            Buffer.from(`run failed: ${password}`),
          ]);
        }
      } else if (command === "exec") {
        if (dockerArgs.includes("base64")) {
          assert(dockerArgs.includes("-w0"));
          // 模拟带 NUL 的传输输出；证书还原后必须逐字节一致，不能 trim 或重编码。
          const wrong = dockerArgs.at(-1).endsWith("wrong-ca.pem");
          stdout = Buffer.from(
            (wrong ? wrongCertificate : certificate).toString("base64"),
            "utf16le",
          );
          if (caFailure || (wrong && wrongCaFailure)) {
            code = 1;
            stderr = Buffer.concat([stderr, Buffer.from("export failed")]);
          }
        } else if (dockerArgs.at(-1).includes("Redis TLS requires openssl")) {
          assert(dockerArgs.includes("fixture-desktop-test-postgres"));
          assert(dockerArgs.at(-1).includes("wrong-ca.key -out wrong-ca.pem"));
          assert(
            dockerArgs
              .at(-1)
              .includes("subjectAltName=DNS:fixture-desktop-redis-test"),
          );
          if (!openssl) {
            code = 1;
            stderr = Buffer.concat([
              stderr,
              Buffer.from("Redis TLS requires openssl"),
            ]);
          }
        } else if (dockerArgs.includes("tar")) {
          assert(dockerArgs.includes("server.key"));
          assert(!dockerArgs.includes("ca.key"));
          stdout = Buffer.from("private-key-archive-fixture");
          if (archiveFailure) code = 1;
        } else if (dockerArgs.at(-1).includes("CONFIG SET tls-cert-file")) {
          stdout = Buffer.from(redisTlsFailure ? "ERR TLS failed" : "OK");
        } else if (dockerArgs.includes("-i") && transferFailure) {
          code = 1;
          stderr = Buffer.concat([
            stderr,
            Buffer.from("private-key-archive-fixture"),
          ]);
        } else if (dockerArgs.at(-1).includes("command -v openssl"))
          stdout = Buffer.from(openssl ? "available" : "unavailable");
        else if (dockerArgs.at(-1).includes("SHOW ssl"))
          stdout = Buffer.from(postgresTlsFailure ? "off" : "on");
        else if (readinessFailure && dockerArgs.at(-1).includes("SELECT 1")) {
          code = 1;
        } else stdout = Buffer.from("1");
      } else if (command === "inspect")
        stdout = Buffer.from(
          dockerArgs.includes("{{.State.Status}}")
            ? "running"
            : dockerArgs.includes("{{.State.Running}}")
              ? "false"
              : dockerArgs.at(-1) === foreignOwner
                ? "foreign-product"
                : "fixture-desktop",
        );
      else if (command === "rm") {
        assert(names.includes(dockerArgs.at(-1)));
        containers.delete(dockerArgs.at(-1));
      } else assert.fail(`unexpected Docker command ${command}`);
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      if (options.stdio[0] === "pipe") {
        child.stdin = new EventEmitter();
        child.stdin.end = (input) => {
          assert.deepEqual(input, Buffer.from("private-key-archive-fixture"));
          assert(dockerArgs.at(-1).includes("tar -xf - -C /data/tls"));
          assert(dockerArgs.includes("fixture-desktop-test-redis"));
          assert(
            dockerArgs.at(-1).includes("&& chown -R redis:redis /data/tls"),
          );
        };
      }
      queueMicrotask(() => {
        child.stdout.emit("data", stdout);
        child.stderr.emit("data", stderr.subarray(0, 7));
        child.stderr.emit("data", stderr.subarray(7));
        child.emit("close", code);
      });
      return child;
    },
  },
});
mock.module("node:net", {
  namedExports: {
    createServer() {
      const server = new EventEmitter();
      server.listen = (options, done) => {
        assert.equal(options.host, "127.0.0.1");
        if (occupied === true || occupied === options.port)
          queueMicrotask(() =>
            server.emit(
              "error",
              Object.assign(new Error("busy"), { code: "EADDRINUSE" }),
            ),
          );
        else queueMicrotask(done);
      };
      server.close = (done) => done();
      return server;
    },
  },
});
mock.module(pathToFileURL(join(workspace, "scripts/common.mjs")), {
  namedExports: { root, task: async (_command, action) => action(env) },
});
let invocation = 0;
async function command(...args) {
  const before = process.argv;
  process.argv = [process.execPath, "resources.mjs", ...args];
  const originalLog = console.log;
  console.log = (...args) => output.push(args.join(" "));
  try {
    await import(
      `${pathToFileURL(join(workspace, "scripts/resources.mjs"))}?contract=${++invocation}`
    );
  } finally {
    process.argv = before;
    console.log = originalLog;
  }
}
const record = () => JSON.parse(readFileSync(pidFile, "utf8"));
beforeEach(async () => {
  containers.clear();
  containers.add("unrelated-project");
  processes.clear();
  for (const list of [calls, launched, stopped, passwords, output])
    list.length = 0;
  occupied =
    redisTlsFailure =
    wrongCaFailure =
    archiveFailure =
    caFailure =
    spawnFailure =
    inspectFailure =
    changeBeforeStop =
    exitBeforeReady =
      false;
  initialFailure = undefined;
  runFailure = foreignOwner = undefined;
  transferFailure = readinessFailure = postgresTlsFailure = false;
  openssl = true;
  inspectCount = 0;
  certificate = validCertificate;
  for (const file of [
    pidFile,
    connectionFile,
    join(directory, "mysql-ca.pem"),
    join(directory, "postgres-ca.pem"),
    join(directory, "redis-ca.pem"),
    join(directory, "redis-wrong-ca.pem"),
  ]) {
    try {
      await unlink(file);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
});

test("byte-safe CA export and owned keepalive lifecycle preserve credentials and unrelated containers", async () => {
  await command("start");
  const saved = record();
  assert.equal(saved.pid, launched[0].pid);
  assert.equal(saved.startedAt, launched[0].startedAt);
  assert(launched[0].commandLine.endsWith(saved.marker));
  assert.deepEqual(
    calls
      .filter((args) => args[0] === "run")
      .map((args) => args[args.indexOf("--name") + 1]),
    names,
  );
  const data = JSON.parse(readFileSync(connectionFile, "utf8"));
  assert(new URL(data.TENON_TEST_MYSQL_URL).password === passwords[0]);
  assert(new URL(data.TENON_TEST_POSTGRES_URL).password === passwords[1]);
  assert(new URL(data.TENON_TEST_REDIS_URL).password === passwords[2]);
  assert.equal(new Set(passwords).size, 3);
  assert.equal(data.TENON_TEST_REDIS_TLS_PORT, "34380");
  assert.notEqual(passwords[0], passwords[1]);
  assert.equal(data.TENON_TEST_POSTGRES_TLS, "enabled");
  for (const dialect of ["MYSQL", "POSTGRES", "REDIS"])
    assert.deepEqual(
      readFileSync(data[`TENON_TEST_${dialect}_CA_FILE`]),
      validCertificate,
    );
  assert.deepEqual(
    readFileSync(data.TENON_TEST_REDIS_WRONG_CA_FILE),
    wrongCertificate,
  );
  await command("status");
  assert(output.includes(`WSL keepalive: running (PID ${saved.pid})`));
  await command("stop");
  assert.deepEqual(stopped, [saved.pid]);
  assert.equal(processes.size, 0);
  assert(!existsSync(pidFile));
  assert.deepEqual([...containers], ["unrelated-project"]);
  assert(!existsSync(connectionFile));
  assert(!existsSync(join(directory, "mysql-ca.pem")));
  assert(!existsSync(join(directory, "postgres-ca.pem")));
  assert(!existsSync(join(directory, "redis-ca.pem")));
  assert(!existsSync(join(directory, "redis-wrong-ca.pem")));
  assert(
    passwords.every(
      (password) =>
        !output.join("\n").includes(password) &&
        !JSON.stringify(calls).includes(password),
    ),
  );
  assert.equal(env.WSLENV, "EXISTING/p:MYSQL_ROOT_PASSWORD/p");
  assert(!output.join("\n").includes("private-key-archive-fixture"));
});

test("missing openssl cannot silently skip Redis TLS and rolls back resources", async () => {
  openssl = false;
  await assert.rejects(command("start"), /PostgreSQL 镜像缺少 openssl/);
  assert(!output.some((line) => line.includes("disabled")));
  assert(!existsSync(connectionFile));
  assert.deepEqual([...containers], ["unrelated-project"]);
  assert.equal(processes.size, 0);
});

test("Redis TLS configuration failure rolls back all three owned containers", async () => {
  redisTlsFailure = true;
  await assert.rejects(command("start"), /Redis TLS 未成功启用/);
  assert(!existsSync(connectionFile));
  assert.deepEqual([...containers], ["unrelated-project"]);
  assert.equal(processes.size, 0);
});

test("failed wrong-CA export removes certificates and never publishes connections", async () => {
  wrongCaFailure = true;
  await assert.rejects(command("start"), /WSL Docker/);
  assert(!existsSync(connectionFile));
  assert(!existsSync(join(directory, "redis-ca.pem")));
  assert.deepEqual([...containers], ["unrelated-project"]);
  assert.equal(processes.size, 0);
});

test("private certificate transfer failure never exposes partial archive bytes", async () => {
  archiveFailure = true;
  await assert.rejects(command("start"), (error) => {
    assert.match(error.message, /敏感输出已省略/);
    assert(!error.message.includes("private-key-archive-fixture"));
    return true;
  });
  assert(!existsSync(connectionFile));
  assert.deepEqual([...containers], ["unrelated-project"]);
  assert.equal(processes.size, 0);
});

test("occupied Redis TLS port fails before creating any resources", async () => {
  occupied = 34380;
  await assert.rejects(command("start"), /34380.*已占用/);
  assert.equal(launched.length, 0);
  assert.equal(calls.filter((args) => args[0] === "run").length, 0);
});

for (const [name, bytes] of [
  ["missing PEM header", "not a certificate"],
  [
    "invalid PEM body",
    "-----BEGIN CERTIFICATE-----\ninvalid\n-----END CERTIFICATE-----",
  ],
]) {
  test(`${name} fails before publishing resource metadata and stops keepalive`, async () => {
    certificate = Buffer.from(bytes);
    await assert.rejects(command("start"), /PEM 证书/);
    assert.deepEqual([...containers], ["unrelated-project"]);
    assert.deepEqual(stopped, [launched[0].pid]);
    assert.equal(processes.size, 0);
    assert(!existsSync(pidFile));
    assert(!existsSync(connectionFile));
    assert(!existsSync(join(directory, "mysql-ca.pem")));
  });
}

test("failed CA export cleans owned containers and keepalive", async () => {
  caFailure = true;
  await assert.rejects(command("start"), /WSL Docker/);
  assert.deepEqual([...containers], ["unrelated-project"]);
  assert.deepEqual(stopped, [launched[0].pid]);
  assert(!existsSync(pidFile));
});

test("WSL launcher UTF-16 errors are decoded only before the Docker marker", async () => {
  initialFailure = "wsl";
  await assert.rejects(
    command("status"),
    /WSL 启动失败: Wsl\/Service\/E_ACCESSDENIED/,
  );
});

test("Docker errors containing NUL remain UTF-8", async () => {
  initialFailure = "docker";
  await assert.rejects(command("status"), /docker\0failure/);
});

test("keepalive spawn failure creates no containers or PID record", async () => {
  spawnFailure = true;
  await assert.rejects(command("start"), /keepalive spawn failed/);
  assert.equal(calls.filter((args) => args[0] === "run").length, 0);
  assert(!existsSync(pidFile));
});

test("inspection failure preserves the unverified process and requests manual verification", async () => {
  inspectFailure = true;
  await assert.rejects(command("start"), (error) => {
    assert.match(error.message, /process inspection denied/);
    assert.match(error.message, /未自动终止，请手动核对/);
    assert.match(error.message, /标记 fixture-desktop-keepalive-[0-9a-f]{32}/);
    return true;
  });
  assert.equal(launched.length, 1);
  assert.deepEqual([...processes.values()], launched);
  assert.deepEqual(stopped, []);
  assert.equal(calls.filter((args) => args[0] === "run").length, 0);
  assert(!existsSync(pidFile));
  assert(!existsSync(connectionFile));
});

for (const [name, field, value] of [
  ["different executable", "name", "unrelated.exe"],
  [
    "different marker",
    "commandLine",
    'wsl.exe --exec sh -c "exec sleep infinity" other-project',
  ],
  ["reused PID", "startedAt", "999999999"],
  ["unreadable command line", "commandLine", null],
]) {
  test(`${name} is reported unverified and never terminated`, async () => {
    await command("start");
    const saved = record();
    const actual = processes.get(saved.pid);
    processes.set(saved.pid, { ...actual, [field]: value });
    await command("status");
    assert(output.includes(`WSL keepalive: unverified (PID ${saved.pid})`));
    await assert.rejects(command("stop"), /不属于本脚本/);
    assert.deepEqual(stopped, []);
    assert(processes.has(saved.pid));
    assert(existsSync(pidFile));
    processes.set(saved.pid, actual);
    await command("stop");
  });
}

test("stopped keepalive is reported and stale PID records are removed without killing a process", async () => {
  await command("start");
  const saved = record();
  processes.delete(saved.pid);
  await command("status");
  assert(output.includes(`WSL keepalive: stopped (PID ${saved.pid})`));
  await command("stop");
  assert.deepEqual(stopped, []);
  assert(!existsSync(pidFile));
});

test("PID reuse between inspection and termination is rejected by the native handle check", async () => {
  await command("start");
  const saved = record();
  changeBeforeStop = true;
  await assert.rejects(command("stop"), /identity changed/);
  assert.deepEqual(stopped, []);
  assert(processes.has(saved.pid));
  assert(existsSync(pidFile));
});

test("existing live keepalive prevents start without overwriting its record or connection file", async () => {
  await command("start");
  const saved = readFileSync(pidFile);
  const connections = readFileSync(connectionFile);
  containers.clear();
  containers.add("unrelated-project");
  await assert.rejects(command("start"), /已有 WSL 保活记录/);
  assert.equal(launched.length, 1);
  assert.deepEqual(readFileSync(pidFile), saved);
  assert.deepEqual(readFileSync(connectionFile), connections);
  await command("stop");
});

test("invalid PID records cannot target other processes", async () => {
  await mkdir(directory, { recursive: true });
  await writeFile(
    pidFile,
    JSON.stringify({ pid: -1, marker: "foreign", startedAt: "1" }),
  );
  await assert.rejects(command("stop"), /keepalive.pid 内容无效/);
  assert.equal(inspectCount, 0);
  assert.deepEqual(stopped, []);
  assert(existsSync(pidFile));
});

test("keepalive exiting before readiness rolls back containers and its stale PID record", async () => {
  exitBeforeReady = true;
  await assert.rejects(command("start"), /保活进程在资源启动完成前退出/);
  assert.deepEqual([...containers], ["unrelated-project"]);
  assert(!existsSync(pidFile));
  assert(!existsSync(connectionFile));
});

test("occupied port fails before starting keepalive or containers", async () => {
  occupied = true;
  await assert.rejects(command("start"), /34306.*已占用/);
  assert.equal(launched.length, 0);
  assert.equal(calls.filter((args) => args[0] === "run").length, 0);
  assert.deepEqual([...containers], ["unrelated-project"]);
});

for (const port of [34432, 34379]) {
  test(`occupied port ${port} never starts resources`, async () => {
    occupied = port;
    await assert.rejects(command("start"), new RegExp(`${port}.*已占用`));
    assert.equal(launched.length, 0);
    assert.equal(calls.filter((args) => args[0] === "run").length, 0);
  });
}

test("a partially failed Docker run is rolled back without leaking its password", async () => {
  runFailure = names[1];
  await assert.rejects(command("start"), (error) => {
    assert.match(error.message, /敏感输出已省略/);
    for (const password of passwords) assert(!error.message.includes(password));
    return true;
  });
  assert.deepEqual([...containers], ["unrelated-project"]);
  assert.deepEqual(
    calls.filter((args) => args[0] === "rm").map((args) => args.at(-1)),
    [names[1], names[0]],
  );
  assert.equal(processes.size, 0);
  assert(!existsSync(connectionFile));
});

test("a container that exits before readiness is rolled back", async () => {
  readinessFailure = true;
  await assert.rejects(command("start"), /未在 120 秒内就绪/);
  assert.deepEqual([...containers], ["unrelated-project"]);
  assert.equal(processes.size, 0);
});

test("PostgreSQL must confirm SSL is enabled before connections are published", async () => {
  postgresTlsFailure = true;
  await assert.rejects(command("start"), /PostgreSQL SSL 未成功启用/);
  assert.deepEqual([...containers], ["unrelated-project"]);
  assert.equal(processes.size, 0);
  assert(!existsSync(connectionFile));
});

test("failed private archive import suppresses stderr and rolls back", async () => {
  transferFailure = true;
  await assert.rejects(command("start"), (error) => {
    assert.match(error.message, /敏感输出已省略/);
    assert(!error.message.includes("private-key-archive-fixture"));
    return true;
  });
  assert.deepEqual([...containers], ["unrelated-project"]);
  assert.equal(processes.size, 0);
});

test("stop refuses a same-name container whose owner was replaced", async () => {
  await command("start");
  foreignOwner = names[0];
  await assert.rejects(command("stop"), /拒绝删除所有权不符/);
  assert(containers.has(names[0]));
  assert(!calls.some((args) => args[0] === "rm"));
});

test("rollback preserves a replaced owner and still cleans the other containers", async () => {
  foreignOwner = names[2];
  redisTlsFailure = true;
  await assert.rejects(command("start"), (error) => {
    assert.match(error.message, /Redis TLS 未成功启用/);
    assert.match(error.message, /拒绝删除所有权不符/);
    return true;
  });
  assert.deepEqual([...containers], ["unrelated-project", names[2]]);
  assert.equal(processes.size, 0);
  assert(!existsSync(connectionFile));
});

test("existing fixed-name containers block start before any process or port changes", async () => {
  containers.add(names[0]);
  await assert.rejects(command("start"), /已存在/);
  assert.equal(launched.length, 0);
  assert(!calls.some((args) => ["rm", "run"].includes(args[0])));
});

test("a well-formed keepalive marker for another product cannot target a PID", async () => {
  await mkdir(directory, { recursive: true });
  await writeFile(
    pidFile,
    JSON.stringify({
      pid: 1234,
      marker: `foreign-product-keepalive-${"a".repeat(32)}`,
      startedAt: "1000",
    }),
  );
  await assert.rejects(command("stop"), /keepalive.pid 内容无效/);
  assert.equal(inspectCount, 0);
  assert.deepEqual(stopped, []);
});

test("status with no resources does not launch or stop anything", async () => {
  await command("status");
  assert(output.includes("WSL keepalive: absent"));
  for (const name of names) assert(output.includes(`${name}: absent`));
  assert.equal(launched.length, 0);
  assert.deepEqual(stopped, []);
});

test("invalid commands fail before contacting Docker or WSL", async () => {
  for (const args of [[], ["restart"], ["start", "extra"]]) {
    await assert.rejects(command(...args), /用法/);
  }
  assert.deepEqual(calls, []);
  assert.equal(launched.length, 0);
});
