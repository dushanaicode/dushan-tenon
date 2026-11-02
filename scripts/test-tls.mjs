import { run } from "./common.mjs";
import { readConnections, requireConnection } from "./test-connections.mjs";

export async function testTls(dialect, env) {
  const connections = await readConnections(env);
  const prefix = `TENON_TEST_${dialect.toUpperCase()}`;
  const raw = requireConnection(connections, `${prefix}_URL`);
  const enabled =
    dialect === "mysql" ? "enabled" : connections[`${prefix}_TLS`];
  if (!["enabled", "disabled"].includes(enabled))
    throw new Error(
      "缺少或无效的 TENON_TEST_POSTGRES_TLS；请显式选择 enabled 或 disabled。",
    );
  const ca =
    enabled === "enabled"
      ? requireConnection(connections, `${prefix}_CA_FILE`)
      : "";
  let url;
  let name;
  let username;
  let password;
  try {
    url = new URL(raw);
    if (
      url.protocol !== `${dialect}:` ||
      !url.port ||
      !url.hostname ||
      !url.username ||
      url.pathname.length < 2 ||
      url.search ||
      url.hash
    )
      throw new Error();
    name = decodeURIComponent(url.pathname.slice(1));
    username = decodeURIComponent(url.username);
    password = decodeURIComponent(url.password);
  } catch {
    throw new Error(
      `无效的 ${prefix}_URL，需要 ${dialect} 协议、主机、显式端口、用户名与库名。`,
    );
  }
  // 对齐 remote_tls.rs 的显式配置切片；密码仅传子进程环境。
  await run(
    `TLS 实测: ${dialect} (${enabled})`,
    "cargo",
    [
      "test",
      "--package",
      "tenon-framework",
      "--test",
      "remote_tls",
      "--locked",
      "--",
      "--ignored",
      "--nocapture",
    ],
    {
      ...env,
      TENON_TEST_TLS: "1",
      TENON_TEST_TLS_ENABLED: enabled,
      TENON_TEST_TLS_CA_FILE: ca,
      TENON__DATABASE__KIND: dialect,
      TENON__DATABASE__HOST: url.hostname.replace(/^\[|\]$/g, ""),
      TENON__DATABASE__PORT: url.port,
      TENON__DATABASE__NAME: name,
      TENON__DATABASE__USERNAME: username,
      TENON_SECRET__DATABASE__PASSWORD:
        connections.TENON_SECRET__DATABASE__PASSWORD ?? password,
    },
  );
}
