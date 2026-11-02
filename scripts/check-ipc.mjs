import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { root, task } from "./common.mjs";
import { generate } from "./generate.mjs";

export function checkCommandAdmission(entries, access) {
  const names = new Set();
  const exceptions = new Map([
    ["app_backup_export", "maintenance"],
    ["app_backup_restore", "maintenance"],
    ["app_update_install", "maintenance"],
    ...[
      "app_operation_cancel",
      "app_window_minimize",
      "app_window_toggle_maximize",
      "app_window_start_dragging",
      "app_window_close",
      "app_window_close_decide",
      "app_window_watch",
      "app_window_edit_state",
      "app_window_edit_decide",
    ].map((name) => [name, "control"]),
  ]);
  const levels = new Map(access);
  if (levels.size !== access.length || levels.size !== entries.length)
    throw new Error("命令入口与准入集合不一致");
  for (const [name, admission] of entries) {
    if (names.has(name)) throw new Error(`重复的命令准入声明 ${name}`);
    names.add(name);
    if (admission !== (exceptions.get(name) ?? "normal"))
      throw new Error(`未经许可的命令准入类型 ${name}: ${admission}`);
    const level = levels.get(name);
    if (
      admission === "control"
        ? level !== "execute_control"
        : !["execute", "execute_session", "execute_public"].includes(level)
    ) {
      throw new Error(`命令入口与准入类型冲突 ${name}: ${level}`);
    }
  }
}

export async function compareGenerated(expected, actual) {
  const expectedNames = (await readdir(expected)).sort();
  const actualNames = (await readdir(actual)).sort();
  if (JSON.stringify(expectedNames) !== JSON.stringify(actualNames))
    throw new Error(
      "IPC 合同文件清单有漂移，请运行 pnpm generate 并移除失效生成文件",
    );
  for (const name of expectedNames) {
    const [left, right] = await Promise.all([
      readFile(join(expected, name)),
      readFile(join(actual, name)),
    ]);
    if (!left.equals(right))
      throw new Error(`IPC 合同 ${name} 有漂移，请运行 pnpm generate`);
  }
}

export function missingTranslations(translations, keys) {
  return [...new Set(keys)]
    .filter(
      (key) =>
        typeof translations[key] !== "string" || !translations[key].trim(),
    )
    .sort();
}

export async function translationKeys(output) {
  const read = async (file) => import(pathToFileURL(join(output, file)).href);
  const [errors, permissions, jobs, schedules, messages, dict, params, files] =
    await Promise.all([
      read("error-codes.ts"),
      read("permissions.ts"),
      read("job-kinds.ts"),
      read("schedule-keys.ts"),
      read("message-keys.ts"),
      read("dict-codes.ts"),
      read("param-keys.ts"),
      read("file-purpose-keys.ts"),
    ]);
  return [
    ...errors.ERROR_CODES.map((key) => `errors.${key}`),
    ...permissions.PERMISSION_KEYS.map((key) => `permissions.${key}`),
    ...permissions.MODULE_IDS.map((key) => `modules.names.${key}`),
    ...jobs.JOB_KINDS.map((key) => `jobs.kinds.${key}`),
    ...schedules.SCHEDULE_KEYS.map((key) => `schedules.keys.${key}`),
    ...messages.MESSAGE_KEYS,
    ...dict.DICT_MESSAGE_KEYS,
    ...params.PARAM_MESSAGE_KEYS,
    ...files.FILE_PURPOSE_MESSAGE_KEYS,
  ];
}

export async function checkIpc(env) {
  // 留存本次生成结果供漂移复现，整目录由 Temp/check 的登记管理。
  const output = await mkdtemp(join(root, "Temp/check/ipc-"));
  await generate(output, env);
  await compareGenerated(output, join(root, "src/lib/generated"));
  const { COMMAND_ADMISSION, COMMAND_ACCESS } = await import(
    pathToFileURL(join(output, "admission-commands.ts")).href
  );
  checkCommandAdmission(COMMAND_ADMISSION, COMMAND_ACCESS);
  const keys = await translationKeys(output);
  const missing = [];
  for (const language of ["zh-CN", "en-US"]) {
    const translations = JSON.parse(
      await readFile(join(root, "src/core/i18n", `${language}.json`), "utf8"),
    );
    const absent = missingTranslations(translations, keys);
    if (absent.length)
      missing.push(
        `${language} 缺失 ${absent.length} 个翻译键：\n${absent.join("\n")}`,
      );
  }
  if (missing.length) throw new Error(missing.join("\n"));
  console.log(
    `IPC 文件集合、逐字节合同、准入分类及双语 ${keys.length} 个翻译键检查通过`,
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await task("check", checkIpc);
}
