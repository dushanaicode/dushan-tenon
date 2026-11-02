import { spawn } from "node:child_process";
import { randomBytes, X509Certificate } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { root, task } from "./common.mjs";
import { owner } from "./resources-identity.mjs";
import {
  keepaliveStatus,
  startKeepalive,
  stopKeepalive,
} from "./resources-keepalive.mjs";

const directory = join(root, "Temp/test-resources");
const connectionFile = join(directory, "connection.json");
const label = `${owner}.test-resources`;
const resources = [
  {
    kind: "mysql",
    name: `${owner}-test-mysql`,
    port: 34306,
    internalPort: 3306,
    imageVariable: "TENON_TEST_MYSQL_IMAGE",
    passwordVariable: "MYSQL_ROOT_PASSWORD",
    image: "public.ecr.aws/docker/library/mysql:8.4",
    data: "/var/lib/mysql",
    ready:
      'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql --protocol=TCP -h 127.0.0.1 -u root -e "SELECT 1"',
  },
  {
    kind: "postgres",
    name: `${owner}-test-postgres`,
    port: 34432,
    internalPort: 5432,
    imageVariable: "TENON_TEST_POSTGRES_IMAGE",
    passwordVariable: "POSTGRES_PASSWORD",
    image: "public.ecr.aws/docker/library/postgres:17",
    data: "/var/lib/postgresql/data",
    ready:
      'PGPASSWORD="$POSTGRES_PASSWORD" psql -h 127.0.0.1 -U postgres -d postgres -c "SELECT 1"',
  },
  {
    kind: "redis",
    name: `${owner}-test-redis`,
    port: 34379,
    internalPort: 6379,
    tlsPort: 34380,
    imageVariable: "TENON_TEST_REDIS_IMAGE",
    passwordVariable: "REDIS_PASSWORD",
    image: "public.ecr.aws/docker/library/redis:8-alpine",
    data: "/data",
    ready:
      'test "$(REDISCLI_AUTH="$REDIS_PASSWORD" redis-cli -h 127.0.0.1 ping)" = PONG',
  },
];

// 密码只从环境读取并写进 tmpfs 配置，不进入 redis-server 参数。
const redisStartup = `set -eu
umask 077
mkdir -p /data/tls
printf '%s\\n' 'bind 0.0.0.0' 'port 6379' 'dir /data' 'save ""' 'appendonly no' 'maxmemory-policy noeviction' > /data/redis.conf
printf 'requirepass %s\\n' "$REDIS_PASSWORD" >> /data/redis.conf
chown redis:redis /data/redis.conf /data/tls
cd /data
exec /usr/local/bin/docker-entrypoint.sh redis-server /data/redis.conf`;

// Linux shell 写入标记，区分 Docker 输出和 WSL 启动失败的诊断。
const dockerMarker = Buffer.from(`${owner}-docker-started\n`);

// stdout 始终保留原始字节，绝不回显 docker 参数、容器环境或连接文件。
function dockerBytes(env, args, { input, sensitive = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "wsl.exe",
      [
        "--exec",
        "sh",
        "-c",
        `printf '${owner}-docker-started\\n' >&2; exec docker "$@"`,
        `${owner}-docker`,
        ...args,
      ],
      {
        cwd: root,
        env,
        windowsHide: true,
        stdio: [input ? "pipe" : "ignore", "pipe", "pipe"],
      },
    );
    const output = [];
    const errors = [];
    child.stdout.on("data", (data) => output.push(data));
    child.stderr.on("data", (data) => errors.push(data));
    child.once("error", reject);
    if (input) {
      child.stdin.on("error", reject);
      child.stdin.end(input);
    }
    child.once("close", (code) => {
      const stdout = Buffer.concat(output);
      const stderr = Buffer.concat(errors);
      if (code === 0) {
        resolve(stdout);
        return;
      }
      if (sensitive) {
        reject(new Error(`WSL Docker 证书传输失败（${code}）；敏感输出已省略`));
        return;
      }
      const started = stderr
        .subarray(0, dockerMarker.length)
        .equals(dockerMarker);
      if (started && ["run", "exec"].includes(args[0])) {
        reject(new Error(`WSL Docker 失败（${code}）；敏感输出已省略`));
        return;
      }
      const diagnostic = started
        ? stderr.subarray(dockerMarker.length)
        : stderr;
      const bytes = diagnostic.length ? diagnostic : stdout;
      // 只有未到达 Linux shell 的 WSL 自身错误才可能使用 UTF-16。
      const encoding = !started && bytes.includes(0) ? "utf16le" : "utf8";
      reject(
        new Error(
          `WSL Docker 失败（${code}，${started ? "Docker" : "WSL 启动"}）：${bytes.toString(encoding)}`,
        ),
      );
    });
  });
}

async function docker(env, args) {
  return (await dockerBytes(env, args)).toString("utf8").trim();
}

async function checkPort(port) {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", () =>
      reject(
        new Error(
          `127.0.0.1:${port} 已占用，停止占用程序后重试；不会自动换端口。`,
        ),
      ),
    );
    server.listen({ host: "127.0.0.1", port, exclusive: true }, resolve);
  });
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

async function containers(env) {
  const lines = await docker(env, ["ps", "-a", "--format", "{{.Names}}"]);
  return new Set(lines.split("\n"));
}

async function remove(env, resource) {
  const actualOwner = await docker(env, [
    "inspect",
    "--format",
    `{{index .Config.Labels "${label}"}}`,
    resource.name,
  ]);
  if (actualOwner !== owner)
    throw new Error(`拒绝删除所有权不符的容器：${resource.name}`);
  await docker(env, ["rm", "-f", resource.name]);
}

async function removeConnectionFile() {
  for (const path of [
    connectionFile,
    join(directory, "mysql-ca.pem"),
    join(directory, "postgres-ca.pem"),
    join(directory, "redis-ca.pem"),
    join(directory, "redis-wrong-ca.pem"),
  ]) {
    try {
      await unlink(path);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
}

async function configureTls(env, resource, connections) {
  let certificate;
  if (resource.kind === "mysql") {
    certificate = "/var/lib/mysql/ca.pem";
  } else if (resource.kind === "redis") {
    await configureRedisTls(env, resource);
    certificate = "/data/tls/ca.pem";
  } else {
    const openssl = await docker(env, [
      "exec",
      resource.name,
      "sh",
      "-c",
      "if command -v openssl >/dev/null 2>&1; then echo available; else echo unavailable; fi",
    ]);
    if (openssl === "unavailable") {
      throw new Error("PostgreSQL 镜像缺少 openssl，无法准备完整 TLS 测试资源");
    }
    await docker(env, [
      "exec",
      "--user",
      "postgres",
      resource.name,
      "sh",
      "-c",
      `set -eu
umask 077
mkdir -p "$PGDATA/tls"
cd "$PGDATA/tls"
openssl req -x509 -newkey rsa:2048 -nodes -days 2 -subj '/CN=${owner}-test-ca' -addext 'basicConstraints=critical,CA:TRUE' -addext 'keyUsage=critical,keyCertSign,cRLSign' -keyout ca.key -out ca.pem
openssl req -new -newkey rsa:2048 -nodes -subj '/CN=${owner}-postgres-test' -keyout server.key -out server.csr
printf '%s\\n' 'basicConstraints=critical,CA:FALSE' 'keyUsage=critical,digitalSignature,keyEncipherment' 'extendedKeyUsage=serverAuth' 'subjectAltName=DNS:${owner}-postgres-test' > server.ext
openssl x509 -req -days 2 -in server.csr -CA ca.pem -CAkey ca.key -CAcreateserial -extfile server.ext -out server.crt
printf "\\nssl = on\\nssl_cert_file = 'tls/server.crt'\\nssl_key_file = 'tls/server.key'\\n" >> "$PGDATA/postgresql.conf"
pg_ctl -D "$PGDATA" reload`,
    ]);
    const enabled = await docker(env, [
      "exec",
      resource.name,
      "sh",
      "-c",
      'PGPASSWORD="$POSTGRES_PASSWORD" psql -h 127.0.0.1 -U postgres -d postgres -Atc "SHOW ssl"',
    ]);
    if (enabled !== "on") throw new Error("PostgreSQL SSL 未成功启用");
    connections.TENON_TEST_POSTGRES_TLS = "enabled";
    certificate = "/var/lib/postgresql/data/tls/ca.pem";
  }
  const caFile = await exportCa(
    env,
    resource,
    certificate,
    `${resource.kind}-ca.pem`,
  );
  connections[`TENON_TEST_${resource.kind.toUpperCase()}_CA_FILE`] = caFile;
  if (resource.kind === "redis") {
    const wrongCa = await exportCa(
      env,
      resource,
      "/data/tls/wrong-ca.pem",
      "redis-wrong-ca.pem",
    );
    connections.TENON_TEST_REDIS_WRONG_CA_FILE = wrongCa;
    connections.TENON_TEST_REDIS_TLS_PORT = String(resource.tlsPort);
  }
}

async function configureRedisTls(env, resource) {
  // redis:8-alpine 仅保证 TLS 库，不保证 openssl 命令；复用已启动的 PostgreSQL 工具。
  const generator = `${owner}-test-postgres`;
  await docker(env, [
    "exec",
    "--user",
    "postgres",
    generator,
    "sh",
    "-c",
    `set -eu
command -v openssl >/dev/null || { echo 'Redis TLS requires openssl in the PostgreSQL test image' >&2; exit 1; }
umask 077
mkdir -p "$PGDATA/redis-tls"
cd "$PGDATA/redis-tls"
openssl req -x509 -newkey rsa:2048 -nodes -days 2 -subj '/CN=${owner}-redis-test-ca' -addext 'basicConstraints=critical,CA:TRUE' -addext 'keyUsage=critical,keyCertSign,cRLSign' -keyout ca.key -out ca.pem
openssl req -x509 -newkey rsa:2048 -nodes -days 2 -subj '/CN=${owner}-redis-wrong-ca' -addext 'basicConstraints=critical,CA:TRUE' -addext 'keyUsage=critical,keyCertSign,cRLSign' -keyout wrong-ca.key -out wrong-ca.pem
openssl req -new -newkey rsa:2048 -nodes -subj '/CN=${owner}-redis-test' -keyout server.key -out server.csr
printf '%s\\n' 'basicConstraints=critical,CA:FALSE' 'keyUsage=critical,digitalSignature,keyEncipherment' 'extendedKeyUsage=serverAuth' 'subjectAltName=DNS:${owner}-redis-test' > server.ext
openssl x509 -req -days 2 -in server.csr -CA ca.pem -CAkey ca.key -CAcreateserial -extfile server.ext -out server.crt`,
  ]);
  // 只经内存传递字节；服务端私钥不写宿主文件，也不打印到日志。
  const archive = await dockerBytes(
    env,
    [
      "exec",
      generator,
      "tar",
      "-C",
      "/var/lib/postgresql/data/redis-tls",
      "-cf",
      "-",
      "ca.pem",
      "wrong-ca.pem",
      "server.crt",
      "server.key",
    ],
    { sensitive: true },
  );
  try {
    await dockerBytes(
      env,
      [
        "exec",
        "-i",
        resource.name,
        "sh",
        "-c",
        "umask 077; tar -xf - -C /data/tls && chown -R redis:redis /data/tls",
      ],
      { input: archive, sensitive: true },
    );
  } finally {
    archive.fill(0);
  }
  const result = await docker(env, [
    "exec",
    resource.name,
    "sh",
    "-c",
    'REDISCLI_AUTH="$REDIS_PASSWORD" redis-cli CONFIG SET tls-cert-file /data/tls/server.crt tls-key-file /data/tls/server.key tls-ca-cert-file /data/tls/ca.pem tls-auth-clients no tls-port 6380',
  ]);
  if (result !== "OK") throw new Error("Redis TLS 未成功启用");
}

async function exportCa(env, resource, certificate, filename) {
  const caFile = join(directory, filename);
  const encoded = await dockerBytes(env, [
    "exec",
    resource.name,
    "base64",
    "-w0",
    certificate,
  ]);
  const pem = Buffer.from(encoded.toString("ascii"), "base64");
  const header = Buffer.from("-----BEGIN CERTIFICATE-----");
  if (!pem.subarray(0, header.length).equals(header)) {
    throw new Error(`${resource.kind} CA 导出结果不是 PEM 证书`);
  }
  try {
    new X509Certificate(pem);
  } catch {
    throw new Error(`${resource.kind} CA 导出结果无法解析为 PEM 证书`);
  }
  await writeFile(caFile, pem);
  return caFile;
}

await task("resources", async (env) => {
  const [command, ...extra] = process.argv.slice(2);
  if (!["start", "stop", "status"].includes(command) || extra.length) {
    throw new Error("用法: pnpm resources <start|stop|status>");
  }
  const existing = await containers(env);
  if (command === "status") {
    const keepalive = await keepaliveStatus(env);
    console.log(
      `WSL keepalive: ${keepalive.state}${keepalive.pid ? ` (PID ${keepalive.pid})` : ""}`,
    );
    for (const resource of resources) {
      const state = existing.has(resource.name)
        ? await docker(env, [
            "inspect",
            "--format",
            "{{.State.Status}}",
            resource.name,
          ])
        : "absent";
      console.log(`${resource.name}: ${state}`);
    }
    return;
  }
  if (command === "stop") {
    for (const resource of resources) {
      if (existing.has(resource.name)) await remove(env, resource);
    }
    const remaining = await containers(env);
    if (resources.some((resource) => remaining.has(resource.name)))
      throw new Error("测试容器未完全删除");
    try {
      await removeConnectionFile();
    } finally {
      await stopKeepalive(env);
    }
    console.log("测试容器已删除。");
    return;
  }
  for (const resource of resources) {
    if (existing.has(resource.name))
      throw new Error(`${resource.name} 已存在，请先 pnpm resources stop。`);
    await checkPort(resource.port);
    if (resource.tlsPort) await checkPort(resource.tlsPort);
  }
  await mkdir(directory, { recursive: true });
  const created = [];
  const connections = {};
  let keepalive;
  try {
    keepalive = await startKeepalive(env);
    await removeConnectionFile();
    for (const resource of resources) {
      const password = randomBytes(32).toString("hex");
      const variable = resource.passwordVariable;
      const forwarded = (env.WSLENV ?? "")
        .split(":")
        .filter((entry) => entry && entry.split("/")[0] !== variable);
      const containerEnv = {
        ...env,
        [variable]: password,
        WSLENV: [...forwarded, `${variable}/u`].join(":"),
      };
      // Docker run 也可能先创建容器再失败；回收时重新查询并核对 owner。
      created.push(resource);
      await docker(containerEnv, [
        "run",
        "-d",
        "--name",
        resource.name,
        "--label",
        `${label}=${owner}`,
        "--publish",
        `127.0.0.1:${resource.port}:${resource.internalPort}`,
        ...(resource.tlsPort
          ? ["--publish", `127.0.0.1:${resource.tlsPort}:6380`]
          : []),
        "--tmpfs",
        `${resource.data}:rw`,
        "-e",
        variable,
        ...(resource.kind === "mysql" ? ["-e", "MYSQL_ROOT_HOST=%"] : []),
        env[resource.imageVariable] ?? resource.image,
        ...(resource.kind === "redis" ? ["sh", "-c", redisStartup] : []),
      ]);
      const deadline = Date.now() + 120_000;
      while (true) {
        try {
          await docker(env, [
            "exec",
            resource.name,
            "sh",
            "-c",
            resource.ready,
          ]);
          break;
        } catch {
          const state = await docker(env, [
            "inspect",
            "--format",
            "{{.State.Running}}",
            resource.name,
          ]);
          if (state !== "true" || Date.now() >= deadline)
            throw new Error(`${resource.name} 未在 120 秒内就绪。`);
          await setTimeout(1_000);
        }
      }
      connections[`TENON_TEST_${resource.kind.toUpperCase()}_URL`] =
        resource.kind === "mysql"
          ? `mysql://root:${password}@127.0.0.1:${resource.port}/mysql`
          : resource.kind === "postgres"
            ? `postgres://postgres:${password}@127.0.0.1:${resource.port}/postgres`
            : `redis://:${password}@127.0.0.1:${resource.port}/0`;
      await configureTls(env, resource, connections);
      console.log(`${resource.name}: ready`);
    }
    if ((await keepaliveStatus(env)).state !== "running") {
      throw new Error("WSL 保活进程在资源启动完成前退出");
    }
    await writeFile(
      connectionFile,
      `${JSON.stringify(connections, null, 2)}\n`,
      { mode: 0o600 },
    );
    console.log("连接信息已保存到 Temp/test-resources/connection.json。");
  } catch (error) {
    if (!keepalive) throw error;
    const failures = [error.message];
    try {
      const remaining = await containers(env);
      for (const resource of created.reverse()) {
        if (!remaining.has(resource.name)) continue;
        try {
          await remove(env, resource);
        } catch (cleanupError) {
          failures.push(cleanupError.message);
        }
      }
    } catch (cleanupError) {
      failures.push(cleanupError.message);
    }
    try {
      await removeConnectionFile();
    } catch (cleanupError) {
      failures.push(cleanupError.message);
    }
    try {
      await stopKeepalive(env);
    } catch (cleanupError) {
      failures.push(cleanupError.message);
    }
    throw new Error(failures.join("；"));
  }
});
