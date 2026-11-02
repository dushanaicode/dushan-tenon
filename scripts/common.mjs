import { spawn } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const root = fileURLToPath(new URL("../", import.meta.url));

export async function environment(command) {
  const temporary = join(root, "Temp", command);
  await mkdir(temporary, { recursive: true });
  return {
    TEMP: temporary,
    TMP: temporary,
    TMPDIR: temporary,
  };
}

export function run(step, executable, args, env) {
  console.log(`\n[${step}]`);
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: root,
      env,
      stdio: "inherit",
      windowsHide: true,
    });
    child.once("error", (error) =>
      reject(new Error(`${step}: ${error.message}`)),
    );
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${step}: 失败（${signal ?? `退出码 ${code}`}）`));
    });
  });
}

export async function runBin(step, packageName, binName, args, env) {
  const manifestPath = join(root, "node_modules", packageName, "package.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const entry =
    typeof manifest.bin === "string" ? manifest.bin : manifest.bin[binName];
  await run(
    step,
    process.execPath,
    [join(dirname(manifestPath), entry), ...args],
    env,
  );
}

export async function task(command, action) {
  try {
    const env = { ...process.env, ...(await environment(command)) };
    await action(env);
  } catch (error) {
    console.error(`[${command}] ${error.message}`);
    process.exitCode = 1;
  }
}
