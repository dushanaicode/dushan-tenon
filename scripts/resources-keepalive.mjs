import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { root } from "./common.mjs";
import { owner } from "./resources-identity.mjs";

const execute = promisify(execFile);
const pidFile = join(root, "Temp/test-resources/keepalive.pid");
const markerPrefix = `${owner}-keepalive-`;

// 参数只经环境传入常量脚本，不把 PID 文件内容插入 PowerShell 源码。
const startScript = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$arguments = '--exec sh -c "exec sleep infinity" ' + $env:TENON_KEEPALIVE_MARKER
$process = Start-Process -FilePath wsl.exe -ArgumentList $arguments -WindowStyle Hidden -PassThru
try { $process.Id } finally { $process.Dispose() }
`;

const inspectScript = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$id = [int]$env:TENON_KEEPALIVE_PID
$info = Get-CimInstance Win32_Process -Filter ('ProcessId = ' + $id)
if ($null -eq $info) { 'null'; exit 0 }
try { $process = [Diagnostics.Process]::GetProcessById($id) }
catch [ArgumentException] { 'null'; exit 0 }
try {
  if ($process.HasExited) { 'null'; exit 0 }
  @{ pid = $id; name = $info.Name; commandLine = $info.CommandLine; startedAt = $process.StartTime.ToUniversalTime().Ticks.ToString() } | ConvertTo-Json -Compress
} finally { $process.Dispose() }
`;

const stopScript = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
try { $process = [Diagnostics.Process]::GetProcessById([int]$env:TENON_KEEPALIVE_PID) }
catch [ArgumentException] { exit 0 }
try {
  if ($process.HasExited) { exit 0 }
  $null = $process.Handle
  if ($process.ProcessName -ine 'wsl' -or $process.StartTime.ToUniversalTime().Ticks.ToString() -ne $env:TENON_KEEPALIVE_STARTED_AT) {
    throw 'WSL keepalive process identity changed; refusing to stop it'
  }
  $process.Kill()
  if (-not $process.WaitForExit(5000)) { throw 'WSL keepalive did not exit' }
} finally { $process.Dispose() }
`;

async function powershell(script, env, record) {
  const { stdout } = await execute(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    {
      cwd: root,
      windowsHide: true,
      encoding: "utf8",
      env: {
        ...env,
        TENON_KEEPALIVE_PID: record.pid,
        TENON_KEEPALIVE_MARKER: record.marker,
        TENON_KEEPALIVE_STARTED_AT: record.startedAt,
      },
    },
  );
  return stdout;
}

async function readRecord() {
  let text;
  try {
    text = await readFile(pidFile, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw error;
  }
  const record = JSON.parse(text);
  if (
    !record ||
    !Number.isSafeInteger(record.pid) ||
    record.pid <= 0 ||
    typeof record.marker !== "string" ||
    !record.marker.startsWith(markerPrefix) ||
    !/^[0-9a-f]{32}$/.test(record.marker.slice(markerPrefix.length)) ||
    typeof record.startedAt !== "string" ||
    !/^\d+$/.test(record.startedAt)
  ) {
    throw new Error("keepalive.pid 内容无效，拒绝操作进程");
  }
  return record;
}

function belongsToUs(record, process) {
  return (
    process.pid === record.pid &&
    process.name.toLowerCase() === "wsl.exe" &&
    typeof process.commandLine === "string" &&
    process.commandLine
      .trimEnd()
      .endsWith(`--exec sh -c "exec sleep infinity" ${record.marker}`) &&
    process.startedAt === record.startedAt
  );
}

async function inspect(env, record) {
  return JSON.parse(await powershell(inspectScript, env, record));
}

export async function keepaliveStatus(env) {
  const record = await readRecord();
  if (!record) return { state: "absent" };
  const process = await inspect(env, record);
  return {
    state: process
      ? belongsToUs(record, process)
        ? "running"
        : "unverified"
      : "stopped",
    pid: record.pid,
  };
}

export async function startKeepalive(env) {
  const status = await keepaliveStatus(env);
  if (status.state === "running" || status.state === "unverified") {
    throw new Error(
      `已有 WSL 保活记录（${status.state}，PID ${status.pid}），请先核对并运行 resources stop`,
    );
  }
  if (status.state === "stopped") await unlink(pidFile);
  const marker = markerPrefix + randomBytes(16).toString("hex");
  const record = { marker };
  let recorded = false;
  try {
    record.pid = Number(await powershell(startScript, env, record));
    const process = await inspect(env, record);
    if (!process) throw new Error("WSL 保活进程启动后立即退出");
    const identity = { ...record, startedAt: process.startedAt };
    if (!belongsToUs(identity, process))
      throw new Error("无法核对刚启动的 WSL 保活进程");
    record.startedAt = identity.startedAt;
    await writeFile(pidFile, `${JSON.stringify(record)}\n`, { flag: "wx" });
    recorded = true;
    const current = await inspect(env, record);
    if (!current || !belongsToUs(record, current))
      throw new Error("WSL 保活进程已退出或身份发生变化");
    return record;
  } catch (error) {
    // 不再持有原始启动句柄；仅用已核对身份的启动时间交给 stopScript 持有句柄后复核。
    if (!record.startedAt)
      throw new Error(
        `${error.message}；无法确认 WSL 保活进程（标记 ${marker}）的启动时间，未自动终止，请手动核对`,
        { cause: error },
      );
    await powershell(stopScript, env, record);
    if (recorded) await unlink(pidFile);
    throw error;
  }
}

export async function stopKeepalive(env) {
  const record = await readRecord();
  if (!record) return;
  const process = await inspect(env, record);
  if (process) {
    if (!belongsToUs(record, process))
      throw new Error(
        `PID ${record.pid} 不属于本脚本的 WSL 保活进程，拒绝结束`,
      );
    // 在持有目标进程句柄后再次比较启动时间，防止核对后 PID 被复用。
    await powershell(stopScript, env, record);
  }
  await unlink(pidFile);
}
